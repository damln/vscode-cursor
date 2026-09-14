const { resolveImageResource } = require("./image-resource");
const { classifyDestination, resolveFileDestination } = require("./link-destination");
const { DraftStore } = require("./draft-store");
const { GitBaseline } = require("./git-baseline");
const { createNewMarkdown } = require("./new-markdown");
const crypto = require("node:crypto");
const vscode = require("vscode");
const { findTextImprover, runTextImprover } = require("./text-improver");
const {
  documentPayload,
  parseEditorMessage,
  DocumentQueue,
  applyDocumentRequest
} = require("./document-sync");
const {
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_COLOR,
  DEFAULT_PRIMARY_CHARSET,
  DEFAULT_WORD_END_REGEXP,
  DEFAULT_WORD_REGEXP,
  DEFAULT_WORD_REGEXP_FLAGS
} = require("./jump-model");

const VIEW_TYPE = "damln.markdownInline";
const THEME_STATE_KEY = "damlnMarkdownInline.theme";
const { findTheme, isInlineTheme, themeStyles } = require("./themes");
const CUSTOM_EDITOR_OPTIONS = Object.freeze({
  webviewOptions: Object.freeze({ enableFindWidget: true }),
  supportsMultipleEditorsPerDocument: true
});
const FORMAT_COMMANDS = Object.freeze({
  "damlnMarkdownInline.toggleBold": "toggleBold",
  "damlnMarkdownInline.toggleItalic": "toggleItalic",
  "damlnMarkdownInline.toggleStrikethrough": "toggleStrikethrough",
  "damlnMarkdownInline.toggleInlineCode": "toggleInlineCode",
  "damlnMarkdownInline.addLink": "addLink",
  "damlnMarkdownInline.focusToolbar": "focusToolbar",
  "damlnMarkdownInline.moveBlockUp": "moveBlockUp",
  "damlnMarkdownInline.moveBlockDown": "moveBlockDown"
});
const JUMP_COMMANDS = Object.freeze({
  "damlnMarkdownInline.jumpToStart": {
    matchStartOfWord: true,
    expandSelection: false
  },
  "damlnMarkdownInline.jumpToEnd": {
    matchStartOfWord: false,
    expandSelection: false
  },
  "damlnMarkdownInline.selectToStart": {
    matchStartOfWord: true,
    expandSelection: true
  },
  "damlnMarkdownInline.selectToEnd": {
    matchStartOfWord: false,
    expandSelection: true
  }
});

function wholeDocumentRange(document) {
  const lastLine = document.lineAt(document.lineCount - 1);
  return new vscode.Range(new vscode.Position(0, 0), lastLine.rangeIncludingLineBreak.end);
}

class MarkdownInlineProvider {
  constructor(context) {
    this.context = context;
    this.panels = new Set();
    this.panelDocuments = new Map();
    this.documentQueues = new Map();
    this.panelSessions = new Map();
    this.flushes = new Map();
    this.pendingAnchors = new Map();
    this.sourcePositions = new Map();
    this.improvements = new Map();
    this.drafts = new DraftStore(context.workspaceState);
    const kind = vscode.window?.activeColorTheme?.kind;
    const light = kind === 1 || kind === 4;
    this.theme = findTheme(context.globalState.get(THEME_STATE_KEY) || "auto", light).id;
  }

  async setTheme(theme) {
    if (!isInlineTheme(theme)) return;
    theme = findTheme(theme).id;
    this.theme = theme;
    await this.context.globalState.update(THEME_STATE_KEY, theme);
    await Promise.all(
      [...this.panels].map(panel =>
        panel.webview.postMessage({ type: "theme", theme })
      )
    );
  }

  runFormatCommand(command) {
    const panel = [...this.panels].find(candidate => candidate.active);
    return panel?.webview.postMessage({ type: "command", command });
  }

  runJumpCommand(mode) {
    const panel = [...this.panels].find(candidate => candidate.active);
    const document = panel && this.panelDocuments.get(panel);
    if (!panel || !document) return undefined;
    const jump = vscode.workspace.getConfiguration("jump", document.uri);
    return panel.webview.postMessage({
      type: "jump",
      ...mode,
      primaryCharset: jump.get("primaryCharset", DEFAULT_PRIMARY_CHARSET),
      wordRegexp: jump.get("wordRegexp", DEFAULT_WORD_REGEXP),
      wordRegexpEndOfWord: jump.get("wordRegexpEndOfWord", DEFAULT_WORD_END_REGEXP),
      wordRegexpFlags: jump.get("wordRegexpFlags", DEFAULT_WORD_REGEXP_FLAGS),
      color: jump.get("display.color", DEFAULT_COLOR),
      backgroundColor: jump.get("display.backgroundColor", DEFAULT_BACKGROUND_COLOR)
    });
  }

  flushDocument(document) {
    const panels = [...this.panels].filter(panel => this.panelDocuments.get(panel) === document);
    return Promise.all(panels.map(panel => new Promise((resolve, reject) => {
      const flushId = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.flushes.delete(flushId);
        reject(new Error("Markdown Inline is still synchronizing; the draft is retained."));
      }, 1200);
      this.flushes.set(flushId, { panel, complete: error => { clearTimeout(timer); error ? reject(new Error(error)) : resolve(); } });
      panel.webview.postMessage({ type: "flush", flushId });
    }))).then(() => []);
  }

  async saveDocument(document, panel) {
    try {
      if (!await document.save()) throw new Error("The file could not be saved. Check its permissions.");
      await panel.webview.postMessage(documentPayload(document));
    } catch (error) {
      await panel.webview.postMessage({ type: "operationError", error: String(error) });
    }
  }

  async backupRecovery(document, text) {
    const root = this.context.storageUri || this.context.globalStorageUri;
    if (!root) throw new Error("Recovery storage is unavailable; the file was not changed.");
    const directory = vscode.Uri.joinPath(root, "recovery", crypto.randomUUID());
    await vscode.workspace.fs.createDirectory(directory);
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(directory, "file.md"), Buffer.from(document.getText()));
    await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(directory, "draft.md"), Buffer.from(text));
    return directory;
  }

  async restoreDraft(document, panel, message) {
    const result = (status, error) => ({...documentPayload(document), type: "editResult",
      requestId: message.requestId, status, ...(error ? {error} : {})});
    try {
      const answer = await vscode.window.showWarningMessage(
        "Restore the retained Markdown draft to this file?",
        {modal: true, detail: "Both versions will be backed up before replacing and saving the file."},
        "Restore draft");
      if (answer !== "Restore draft") { await panel.webview.postMessage(result("error", "Restoration cancelled. Your draft is still retained.")); return false; }
      if (message.version !== document.version) { await panel.webview.postMessage(result("conflict", "The file changed. Compare the latest file before restoring.")); return false; }
      await this.backupRecovery(document, message.text);
      const applied = await applyDocumentRequest(document, message, async text => {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, wholeDocumentRange(document), text);
        return vscode.workspace.applyEdit(edit);
      });
      await panel.webview.postMessage(applied);
      if (applied.status === "applied") {
        await panel.webview.postMessage({type: "draftRestored"});
        return true;
      }
    } catch (error) {
      await panel.webview.postMessage(result("error", `Could not restore the draft: ${String(error)}`));
    }
  }

  textImprover(document) {
    return findTextImprover(vscode.workspace.workspaceFolders, document.uri, vscode.workspace.isTrusted);
  }

  async sendImprovementState(document, error) {
    const key = document.uri.toString();
    const message = { type: "textImprover", available: Boolean(this.textImprover(document)),
      running: this.improvements.has(key), error };
    await Promise.all([...this.panels].filter(panel =>
      this.panelDocuments.get(panel)?.uri.toString() === key
    ).map(panel => panel.webview.postMessage(message)));
  }

  async improveText(document, queue) {
    const key = document.uri.toString();
    if (this.improvements.has(key)) return;
    const operation = { controller: new AbortController(), running: false };
    this.improvements.set(key, operation);
    let failure;
    try {
      const tool = this.textImprover(document);
      if (!tool) throw new Error("Text improver is unavailable in this workspace.");
      await this.sendImprovementState(document);
      await this.flushDocument(document);
      await queue.run(() => {});
      if (!await document.save()) throw new Error("Could not save the file before improving it.");
      operation.running = true;
      const version = document.version;
      const original = document.getText();
      const text = await runTextImprover(tool, document.uri.fsPath, { signal: operation.controller.signal });
      await queue.run(async () => {
        if (operation.controller.signal.aborted) throw new Error("Text improvement cancelled.");
        if (document.version !== version || document.getText() !== original) {
          throw new Error("The file changed during text improvement. Run it again on the latest text.");
        }
        if (text === original) return;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, wholeDocumentRange(document), text);
        if (!await vscode.workspace.applyEdit(edit)) throw new Error("VS Code rejected the improved text.");
      });
      if (!await document.save()) throw new Error("Improved text is in the editor but could not be saved.");
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      this.improvements.delete(key);
      await this.sendImprovementState(document, failure);
    }
    if (failure) void vscode.window.showErrorMessage(`Text improver: ${failure}`);
  }

  async openLink(document, panel, href) {
    let target;
    try {
      const link = classifyDestination(href);
      if (link.kind === "external") {
        if (!await vscode.env.openExternal(vscode.Uri.parse(link.href))) throw new Error("Could not open the link.");
        return;
      }
      if (link.kind === "anchor") {
        await panel.webview.postMessage({ type: "navigateHeading", fragment: link.fragment });
        return;
      }
      target = resolveFileDestination(document.uri, link, vscode.Uri);
      await vscode.workspace.fs.stat(target);
      if (/\.md$/i.test(target.path)) {
        const key = target.toString();
        const existing = [...this.panels].find(candidate => this.panelDocuments.get(candidate)?.uri.toString() === key);
        if (link.fragment && !existing) this.pendingAnchors.set(key, link.fragment);
        await vscode.commands.executeCommand("vscode.openWith", target, VIEW_TYPE);
        if (link.fragment && existing) await existing.webview.postMessage({ type: "navigateHeading", fragment: link.fragment });
      } else {
        await vscode.commands.executeCommand("vscode.open", target.with({ fragment: link.fragment }));
      }
    } catch (error) {
      if (target) this.pendingAnchors.delete(target.toString());
      await panel.webview.postMessage({ type: "navigationError", error: `Could not open ${href}: ${String(error)}` });
    }
  }

  async resolveCustomTextEditor(document, panel) {
    const key = document.uri.toString();
    if (!this.documentQueues.has(key)) this.documentQueues.set(key, new DocumentQueue());
    const queue = this.documentQueues.get(key);
    let session;
    let initialized = false;
    this.panels.add(panel);
    this.panelDocuments.set(panel, document);
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const documentRoot = vscode.Uri.joinPath(document.uri, "..");
    const workspaceRoots = (vscode.workspace.workspaceFolders || []).map(folder => folder.uri);
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot, documentRoot, ...workspaceRoots]
    };
    panel.webview.html = this.webviewHtml(panel.webview, documentRoot, this.theme);

    const gitBaseline = new GitBaseline(vscode, document.uri, message => panel.webview.postMessage(message));
    const sendDocument = () => initialized && panel.webview.postMessage(documentPayload(document));
    let openingNavigation;
    const focusOpenedDocument = () => {
      if (!panel.active || !openingNavigation) return;
      const message = openingNavigation;
      openingNavigation = undefined;
      return panel.webview.postMessage(message);
    };
    const viewSubscription = panel.onDidChangeViewState(focusOpenedDocument);
    const changeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() === document.uri.toString()) {
        sendDocument();
      }
    });
    const saveSubscription = vscode.workspace.onDidSaveTextDocument(saved => {
      if (saved.uri.toString() === key) sendDocument();
    });
    panel.onDidDispose(() => {
      gitBaseline.dispose();
      viewSubscription.dispose();
      saveSubscription.dispose();
      changeSubscription.dispose();
      this.panels.delete(panel);
      this.panelDocuments.delete(panel);
      this.panelSessions.delete(panel);
      if (![...this.panelDocuments.values()].some(doc => doc.uri.toString() === key)) {
        this.improvements.get(key)?.controller.abort();
      }
      void queue.pending.then(() => {
        if (this.documentQueues.get(key) === queue &&
            ![...this.panelDocuments.values()].some(doc => doc.uri.toString() === key)) {
          this.documentQueues.delete(key);
        }
      });
    });

    panel.webview.onDidReceiveMessage(async rawMessage => {
      const message = parseEditorMessage(rawMessage);
      const firstReady = message?.type === "ready" && !this.panelSessions.has(panel);
      const active = firstReady ? new Set(this.panelSessions.values()) : undefined;
      if (message?.type === "ready") {
        session = message.session;
        this.panelSessions.set(panel, session);
      }
      if (message?.type === "saveBlocked") {
        void vscode.window.showWarningMessage("The retained Markdown draft has NOT been saved. Restore or compare it first.");
        return;
      }
      if (message?.type === "retainDraft") {
        return session ? this.drafts.retain(key, session, message.draft).catch(error =>
          panel.webview.postMessage({ type: "operationError", error: `Could not retain the draft: ${String(error)}` })) : undefined;
      }
      if (message?.type === "flushComplete") {
        const pending = this.flushes.get(message.flushId);
        if (pending?.panel === panel) {
          this.flushes.delete(message.flushId);
          pending.complete(message.error);
        }
        return;
      }
      if (message?.type === "improveText") return this.improveText(document, queue);
      if (message?.type === "restoreDraft") {
        if (this.improvements.has(key)) return panel.webview.postMessage({...documentPayload(document),
          type: "editResult", requestId: message.requestId, status: "error", error: "Wait for text improvement before restoring."});
        return queue.run(() => this.restoreDraft(document, panel, message))
          .then(applied => applied === true ? this.saveDocument(document, panel) : undefined);
      }
      if (message?.type === "save") {
        if (this.improvements.has(key)) return;
        return queue.run(() => {}).then(() => this.saveDocument(document, panel));
      }
      if (message?.type === "resolveImage") {
        try {
          const uri = await resolveImageResource(document.uri, message.src, vscode, panel.webview);
          await panel.webview.postMessage({type: "imageResourceResult", requestId: message.requestId, uri});
        } catch (error) {
          await panel.webview.postMessage({type: "imageResourceResult", requestId: message.requestId,
            error: error instanceof Error ? error.message : String(error)});
        }
        return;
      }
      return queue.run(async () => {
      if (!message) {
        return;
      }
      if (message.type === "ready") {
        void gitBaseline.start();
        const recovered = firstReady && this.drafts.recover(key, message.session, active, document.getText());
        if (recovered) await this.backupRecovery(document, recovered.draft.text);
        if (recovered && recovered.owner !== message.session) {
          await this.drafts.transfer(key, recovered.owner, message.session, recovered.draft);
        }
        await panel.webview.postMessage({ ...documentPayload(document), ...(recovered ? { recoveredDraft: recovered.draft } : {}) });
        initialized = true;
        sendDocument();
        await panel.webview.postMessage({ type: "theme", theme: this.theme });
        await this.sendImprovementState(document);
        const fragment = this.pendingAnchors.get(key);
        if (fragment !== undefined) {
          this.pendingAnchors.delete(key);
          openingNavigation = { type: "navigateHeading", fragment };
        } else if (this.sourcePositions.has(key)) {
          openingNavigation = {type: "navigateSource", offset: this.sourcePositions.get(key)};
        } else if (firstReady) {
          openingNavigation = { type: "focusStart" };
        }
        await focusOpenedDocument();
        return;
      }
      if (this.improvements.has(key) && ["undo", "redo", "openRaw", "pastePlainText"].includes(message.type)) return;
      if (this.improvements.get(key)?.running && message.type === "edit") {
        await panel.webview.postMessage({ ...documentPayload(document), type: "editResult",
          requestId: message.requestId, status: "error", error: "Text improvement is running. Your draft is retained." });
        return;
      }
      if (message.type === "undo" || message.type === "redo") {
        if (panel.active) await vscode.commands.executeCommand(message.type);
        return;
      }
      if (message.type === "setTheme") {
        await this.setTheme(message.theme);
        return;
      }
      if (message.type === "openRaw") {
        const position = document.positionAt(message.offset ?? 0);
        this.sourcePositions.set(key, document.offsetAt(position));
        await vscode.commands.executeCommand("vscode.openWith", document.uri, "default", {selection: new vscode.Range(position, position)});
        return;
      }
      if (message.type === "copyCode") {
        let success = false;
        try { await vscode.env.clipboard.writeText(message.text); success = true; } catch {}
        await panel.webview.postMessage({type: "copyCodeResult", requestId: message.requestId, success});
        return;
      }
      // Older webviews can remain open while the extensions are updated.
      if (["copyDocument", "copyPath", "copyFolderPath"].includes(message.type)) {
        const target = message.type === "copyDocument" ? "document"
          : message.type === "copyFolderPath" ? "folderPath" : "path";
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const uri = target === "folderPath"
          ? vscode.Uri.joinPath(document.uri, "..") : document.uri;
        const value = message.type === "copyDocument"
          ? document.getText()
          : workspaceFolder
            ? uri.toString() === workspaceFolder.uri.toString()
              ? "." : vscode.workspace.asRelativePath(uri, false)
            : uri.fsPath || uri.path;
        try {
          await vscode.env.clipboard.writeText(value);
          await panel.webview.postMessage({ type: "copyComplete", target, requestId: message.requestId });
        } catch {
          await panel.webview.postMessage({ type: "copyFailed", target, requestId: message.requestId });
          await vscode.window.showErrorMessage(
            target === "document"
              ? "Could not copy the Markdown document."
              : "Could not copy the Markdown path."
          );
        }
        return;
      }
      if (message.type === "pastePlainText") {
        try {
          await panel.webview.postMessage({type: "pasteText", text: await vscode.env.clipboard.readText()});
        } catch {
          await panel.webview.postMessage({type: "navigationError", error: "Could not read the clipboard."});
        }
        return;
      }
      if (message.type === "openLink") {
        await this.openLink(document, panel, message.href);
        return;
      }
      if (message.type === "openExternal") {
        await vscode.env.openExternal(vscode.Uri.parse(message.href));
        return;
      }
      if (message.type === "discardDraft") {
        const answer = await vscode.window.showWarningMessage("Discard the retained Markdown draft?",
          {modal: true, detail: "A backup of your draft will be kept before returning to the file."}, "Discard draft");
        if (answer === "Discard draft") {
          try {
            await this.backupRecovery(document, message.text);
            await panel.webview.postMessage({type: "draftDiscarded", text: message.text});
          } catch (error) { await panel.webview.postMessage({type: "operationError", error: `Could not back up the draft: ${String(error)}`}); }
        }
        return;
      }
      if (message.type === "compareDraft") {
        const draft = await vscode.workspace.openTextDocument({ content: message.text, language: "markdown" });
        await vscode.commands.executeCommand("vscode.diff", document.uri, draft.uri, "File ↔ retained Markdown draft");
        return;
      }
      const result = await applyDocumentRequest(document, message, async text => {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, wholeDocumentRange(document), text);
        return vscode.workspace.applyEdit(edit);
      });
      await panel.webview.postMessage(result);
    }).catch(error => panel.webview.postMessage({ type: "operationError", error: String(error) }));
    });
  }

  webviewHtml(webview, documentRoot, initialTheme) {
    const nonce = crypto.randomBytes(18).toString("base64");
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "editor.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "editor.js")
    );
    const mermaidUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "mermaid.js"));
    const documentBaseUri = `${webview.asWebviewUri(documentRoot).toString()}/`;
    const icon = (body, className = "") => `<svg class="${className}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
    const selectedTheme = findTheme(initialTheme);
    return `<!doctype html>
<html lang="en" data-inline-theme="${selectedTheme.mode}" data-editor-theme="${selectedTheme.id}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; style-src-attr 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <base href="${documentBaseUri}">
  <link rel="stylesheet" href="${styleUri}">
  <style>${themeStyles()}</style>
  <title>Markdown Inline</title>
</head>
<body>
  <header>
    <div class="header-navigation">
      <span id="contents-slot"></span>
      <span id="save-state" role="status" aria-live="polite" aria-atomic="true"></span>
    </div>
    <div class="header-actions">
      <button id="improve-text" class="header-button header-icon-button" type="button" hidden aria-label="Improve text" data-tooltip="Improve and save this file using Codex with GPT-5.6 Luna">
        ${icon('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/><path d="m15 5 3 3"/>', "action-icon")}
        <span class="header-action-label">Improve text</span>
        ${icon('<path d="M12 3a9 9 0 1 1-9 9"/>', "action-loading improve-spinner")}
      </button>
      <button id="content-width" class="header-button header-icon-button" type="button" aria-label="Content width: Normal" aria-haspopup="menu" aria-expanded="false">
        ${icon('<path d="M4 4v16M20 4v16M7 8h10M7 12h10M7 16h10"/>', "action-icon")}
        <span class="header-action-label">Width</span>
      </button>
      <button id="font-size" class="header-button header-icon-button" type="button" aria-label="Font size: 17 pixels" aria-haspopup="dialog" aria-expanded="false">
        ${icon('<path d="m3 19 6-14 6 14M5 14h8m3-3h6m-3 0v8"/>', "action-icon")}
        <span class="header-action-label">17px</span>
      </button>
      <button id="inline-theme" class="header-button header-icon-button" type="button" aria-label="Choose editor theme" data-tooltip="Choose editor theme" aria-haspopup="dialog" aria-expanded="false">
        ${icon('<path d="M12 3a9 9 0 1 0 0 18h1.4a2.1 2.1 0 0 0 1.4-3.7 1.6 1.6 0 0 1 1-2.8h1.5A3.7 3.7 0 0 0 21 11 9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="10" r=".8"/><circle cx="10" cy="6.8" r=".8"/><circle cx="14" cy="6.8" r=".8"/><circle cx="17" cy="10" r=".8"/>', "action-icon")}
      </button>
      <button id="open-raw" class="header-button header-icon-button" type="button" aria-label="Edit source" data-tooltip="Open this document as Markdown source in VS Code.">
        ${icon('<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16"/>', "action-icon")}
        <span class="header-action-label">Edit</span>
      </button>
    </div>
  </header>
  <main id="document-scroll" aria-label="Markdown editor">
    <section id="frontmatter-card" class="frontmatter-card" aria-label="Frontmatter" hidden>
      <div class="frontmatter-header">
        <span aria-hidden="true">◇</span>
        <span>Frontmatter</span>
      </div>
      <div id="frontmatter-fields" class="frontmatter-fields"></div>
      <button id="frontmatter-add" class="frontmatter-add" type="button">+ Add field</button>
    </section>
    <div id="editor"></div>
  </main>
  <script nonce="${nonce}" src="${scriptUri}" data-mermaid-src="${mermaidUri}"></script>
</body>
</html>`;
  }
}

function activate(context) {
  const provider = new MarkdownInlineProvider(context);
  const formatCommandRegistrations = Object.entries(FORMAT_COMMANDS).map(
    ([commandId, editorCommand]) =>
      vscode.commands.registerCommand(commandId, () =>
        provider.runFormatCommand(editorCommand)
      )
  );
  const jumpCommandRegistrations = Object.entries(JUMP_COMMANDS).map(
    ([commandId, mode]) =>
      vscode.commands.registerCommand(commandId, () =>
        provider.runJumpCommand(mode)
      )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("damlnMarkdownInline.newMarkdown", () => createNewMarkdown(vscode)),
    vscode.commands.registerCommand("damlnMarkdownInline.correctText", () => {
      const panel = [...provider.panels].find(candidate => candidate.active);
      const document = panel && provider.panelDocuments.get(panel);
      if (!document) return;
      return provider.improveText(document, provider.documentQueues.get(document.uri.toString()));
    }),
    vscode.window.onDidChangeTextEditorSelection(event => {
      if (event.textEditor.document.languageId === "markdown") {
        provider.sourcePositions.set(event.textEditor.document.uri.toString(), event.textEditor.document.offsetAt(event.selections[0].active));
      }
    }),
    vscode.commands.registerCommand("damlnMarkdownInline.pastePlainText", () => {
      const panel = [...provider.panels].find(candidate => candidate.active);
      return panel?.webview.postMessage({type: "requestPlainPaste"});
    }),
    ...["undo", "redo"].map(action => vscode.commands.registerCommand(`damlnMarkdownInline.${action}`, () => {
      const panel = [...provider.panels].find(candidate => candidate.active);
      return panel?.webview.postMessage({ type: "history", action });
    })),
    vscode.commands.registerCommand("damlnMarkdownInline.save", () => {
      const panel = [...provider.panels].find(candidate => candidate.active);
      return panel?.webview.postMessage({ type: "flush" });
    }),
    vscode.workspace.onWillSaveTextDocument(event => {
      event.waitUntil(provider.flushDocument(event.document).catch(error => {
        void vscode.window.showWarningMessage(`The Markdown draft has NOT been saved. ${String(error)}`);
        return [];
      }));
    }),
    vscode.window.registerCustomEditorProvider(
      VIEW_TYPE,
      provider,
      CUSTOM_EDITOR_OPTIONS
    ),
    ...formatCommandRegistrations,
    ...jumpCommandRegistrations
  );
  return {
    async prepareCopy(uri) {
      const document = [...provider.panelDocuments.values()].find(item => item.uri.toString() === uri.toString());
      if (document) await provider.flushDocument(document);
    }
  };
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
  FORMAT_COMMANDS,
  JUMP_COMMANDS,
  CUSTOM_EDITOR_OPTIONS,
  MarkdownInlineProvider,
  wholeDocumentRange
};
