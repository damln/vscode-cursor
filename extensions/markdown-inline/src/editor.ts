import { setupEditorSettings } from "./lib/theme-picker";
import { isInlineTheme } from "../themes";
import { fontSize, setupFontSize } from './lib/font-size';
import { GitGutter, type RenderedBlock } from './lib/git-gutter';
import { contentWidth, setupContentWidth } from './lib/content-width';
import { pastePlainText } from "./milkdown/markdown-paste";
import { setupHeaderPopovers } from "./lib/header-popover";
import { navigateHeading } from "./lib/heading-navigation";
import {
  commandsCtx,
  Editor,
  editorViewCtx,
  rootCtx,
  remarkCtx,
  remarkPluginsCtx,
  serializerCtx,
  parserCtx,
} from "@milkdown/kit/core";
import {
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { Selection, TextSelection } from "@milkdown/kit/prose/state";
import { applyExternalDocument } from "./lib/external-document";
import { FlushActions } from "./lib/flush-actions";
import { SyncClient, type DocumentUpdate } from "./lib/sync-client";
import { FrontmatterEditor } from "./frontmatter-editor";
import { documentFrontmatter } from "./lib/frontmatter";
import { SourceMarkdown } from "@/lib/source-markdown";
import { configureEditor, getEditorPlugins } from "@/milkdown/editor-setup";
import { moveCurrentBlock } from "./milkdown/block-movement";
import { focusToolbar, openLinkEditor } from "@/milkdown/toolbar";
import {
  joinPreservedFrontmatter,
} from "../markdown-model";
import { linkClickAction } from "../link-click";
import { InlineJumpController, type InlineJumpOptions } from "./inline-jump";
import "./editor.css";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

type InlineTheme = string;

interface CommandMessage {
  type: "command";
  command:
    | "toggleBold"
    | "toggleItalic"
    | "toggleStrikethrough"
    | "toggleInlineCode"
    | "addLink" | "focusToolbar" | "moveBlockUp" | "moveBlockDown";
}

interface JumpMessage extends InlineJumpOptions {
  type: "jump";
}

interface ThemeMessage {
  type: "theme";
  theme: InlineTheme;
}

interface EditorSnapshot {
  selection: unknown;
  head: number;
  focused: boolean;
  scrollTop: number;
}

const vscode = acquireVsCodeApi();
const stored = vscode.getState() as { fontSize?: unknown; contentWidth?: unknown; codeWrap?: unknown; metadataExpanded?: boolean; session?: string; draft?: { text?: unknown; baseText?: unknown; conflicted?: boolean; sourceError?: string } } | null;
const restoredDraft = typeof stored?.draft?.text === 'string' && typeof stored.draft.baseText === 'string'
  ? { text: stored.draft.text, baseText: stored.draft.baseText, conflicted: stored.draft.conflicted, sourceError: stored.draft.sourceError } : null;
let metadataExpanded = stored?.metadataExpanded === true;
let width = contentWidth(stored?.contentWidth);
let textSize = fontSize(stored?.fontSize);
let codeWrap = stored?.codeWrap !== false;
const session = stored?.session || crypto.randomUUID();
const sync = new SyncClient(crypto.randomUUID(), restoredDraft);
let typingTimer: number | null = null;
let acknowledgmentTimer: number | null = null;
let updates = Promise.resolve();
let lastDraftMessage: string | null = null;
const actions = new FlushActions();
let improving = false;
let improvementError = "";
const improveText = document.querySelector<HTMLButtonElement>("#improve-text");
const rootElement = document.getElementById("editor");
const openRawElement = document.getElementById("open-raw");
const saveStateElement = document.getElementById("save-state");
const inlineThemeElement = document.getElementById("inline-theme");
const documentScrollElement = document.getElementById("document-scroll");
const frontmatterCardElement = document.getElementById("frontmatter-card");
const frontmatterFieldsElement = document.getElementById("frontmatter-fields");
const addFrontmatterFieldElement = document.getElementById("frontmatter-add");
if (
  !rootElement ||
  !openRawElement ||
  !saveStateElement ||
  !(inlineThemeElement instanceof HTMLButtonElement) ||
  !documentScrollElement ||
  !frontmatterCardElement ||
  !frontmatterFieldsElement ||
  !(addFrontmatterFieldElement instanceof HTMLButtonElement)
) {
  throw new Error("Markdown Inline webview is missing required elements");
}
const root = rootElement;
const openRaw = openRawElement;
const applyContentWidth = setupContentWidth(width, value => {
  width = value;
  vscode.setState({ session, draft: sync.draft, metadataExpanded, contentWidth: width, fontSize: textSize, codeWrap });
  vscode.postMessage({type: "setReadingPreference", key: "contentWidth", value});
});
const applyFontSize = setupFontSize(textSize, value => {
  textSize = value;
  vscode.setState({ session, draft: sync.draft, metadataExpanded, contentWidth: width, fontSize: textSize, codeWrap });
  vscode.postMessage({type: "setReadingPreference", key: "fontSize", value});
});
setupHeaderPopovers();
const saveState = saveStateElement;

const documentScroll = documentScrollElement;
const frontmatterCard = frontmatterCardElement;
const frontmatterFieldsRoot = frontmatterFieldsElement;
const addFrontmatterField = addFrontmatterFieldElement;

let editor: Editor | null = null;
let ready = false;
let preservedPrefix = "";
let currentBodyText = "";
let statusTimeout: number | null = null;
let sourceMarkdown: SourceMarkdown | null = null;
const gitGutter = new GitGutter(documentScroll, () => sync.text, () => {
  const blocks: RenderedBlock[] = [];
  if (preservedPrefix) blocks.push({from: 0, to: preservedPrefix.length, element: frontmatterCard});
  const fallback = document.querySelector<HTMLTextAreaElement>('.source-fallback');
  if (fallback) blocks.push({from: preservedPrefix.length, to: sync.text.length, element: fallback});
  else {
    const elements = root.querySelector('.ProseMirror')?.children;
    const ranges = sourceMarkdown?.blockRanges() ?? [];
    for (let index = 0; elements && index < elements.length; index++) {
      const range = ranges[index] ?? {from: currentBodyText.length, to: currentBodyText.length};
      blocks.push({from: preservedPrefix.length + range.from, to: preservedPrefix.length + range.to,
        element: elements[index] as HTMLElement});
    }
  }
  return blocks;
});

const jumpController = new InlineJumpController(message => {
  setStatus(message);
  if (statusTimeout !== null) window.clearTimeout(statusTimeout);
  statusTimeout = window.setTimeout(() => setStatus(""), 1200);
});

const {applyTheme: applyInlineTheme, applyCodeWrap} = setupEditorSettings(inlineThemeElement, theme => {
  vscode.postMessage({type: "setTheme", theme});
}, value => {
  codeWrap = value;
  vscode.setState({session, draft: sync.draft, metadataExpanded, contentWidth: width, fontSize: textSize, codeWrap});
  vscode.postMessage({type: "setReadingPreference", key: "codeWrap", value});
});
applyCodeWrap(codeWrap);

function setStatus(value: string, error = false) {
  const status = improving ? "Improving…" : improvementError || value;
  if (saveState.textContent !== status) saveState.textContent = status;
  saveState.title = status;
  saveState.dataset.state = error || improvementError || sync.error ? 'error'
    : improving || status === 'Synchronizing' ? 'saving'
    : status === 'Modified' ? 'modified'
    : status === 'Saved' ? 'saved' : 'idle';
}

function setImproving(running: boolean) {
  improving = running;
  document.body.classList.toggle("improving", running);
  documentScroll.inert = running;
  recovery.inert = running;
  openRaw.toggleAttribute("disabled", running);
  documentScroll.setAttribute("aria-busy", String(running));
  if (improveText) {
    improveText.disabled = running || !ready || sync.pending || Boolean(sync.error);
    improveText.setAttribute("aria-busy", String(running));
    improveText.dataset.state = running ? "loading" : "idle";
  }
  editor?.action(ctx => ctx.get(editorViewCtx).setProps({
    editable: () => !improving && Boolean(sourceMarkdown?.supported),
  }));
  if (running && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  setStatus(sync.dirty ? "Modified" : "Saved");
}

const recovery = document.createElement('section');
recovery.className = 'sync-recovery';
recovery.hidden = true;
const recoveryText = document.createElement('p');
recoveryText.setAttribute('role', 'alert');
const compareDraft = document.createElement('button');
compareDraft.textContent = 'Compare retained draft';
compareDraft.addEventListener('click', () => vscode.postMessage({ type: 'compareDraft', text: sync.text }));
const retry = document.createElement('button');
retry.textContent = 'Retry synchronization';
retry.addEventListener('click', () => {
  sync.retry();
  lastDraftMessage = null;
  vscode.postMessage({ type: 'ready', session });
});
const restoreDraft = document.createElement('button');
restoreDraft.textContent = 'Restore retained draft';
restoreDraft.addEventListener('click', () => {
  const request = sync.restoreRequest();
  if (request) { vscode.postMessage(request); sendNextEdit(); }
});
const useFile = document.createElement('button');
useFile.textContent = 'Discard draft and use file';
useFile.addEventListener('click', () => {
  vscode.postMessage({type: 'discardDraft', text: sync.text});
});
recovery.append(recoveryText, compareDraft, restoreDraft, retry, useFile);
documentScroll.before(recovery);

function sendNextEdit() {
  gitGutter.update();
  if (improveText) improveText.disabled = improving || !ready || sync.pending || Boolean(sync.error);
  const request = typingTimer === null ? sync.next() : null;
  const draftMessage = JSON.stringify({ session, draft: sync.draft });
  if (draftMessage !== lastDraftMessage) {
    lastDraftMessage = draftMessage;
    vscode.setState({ session, draft: sync.draft, metadataExpanded, contentWidth: width, fontSize: textSize, codeWrap });
    vscode.postMessage({ type: "retainDraft", draft: sync.draft });
  }
  recovery.hidden = !sync.error;
  recoveryText.textContent = sync.error;
  retry.disabled = sync.conflicted || Boolean(sync.sourceError) || Boolean(sync.inFlight);
  restoreDraft.disabled = Boolean(sync.inFlight);
  setStatus(sync.error ? 'Draft retained' : sync.pending ? 'Synchronizing' : sync.dirty ? 'Modified' : 'Saved');
  actions.drain(sync.version < 0 || sync.pending, sync.error, action => {
    vscode.postMessage(action);
  });
  if (!request) return;
  if (acknowledgmentTimer !== null) window.clearTimeout(acknowledgmentTimer);
  acknowledgmentTimer = window.setTimeout(() => {
    sync.disconnected();
    sendNextEdit();
  }, 10000);
  vscode.postMessage(request);
}

function flushAction(action: { type: string; flushId?: string; offset?: number; requestId?: string }) {
  if (typingTimer !== null) window.clearTimeout(typingTimer);
  typingTimer = null;
  actions.enqueue(action);
  sendNextEdit();
}

function queueEdit(typing = true) {
  if (typingTimer !== null) window.clearTimeout(typingTimer);
  typingTimer = typing ? window.setTimeout(() => {
    typingTimer = null;
    sendNextEdit();
  }, 250) : null;
  sendNextEdit();
}

function onMarkdownChanged(markdown: string, previousMarkdown: string, typing: boolean) {
  if (
    !ready || markdown === previousMarkdown
  ) {
    return;
  }
  try {
    currentBodyText = sourceMarkdown?.update(markdown) ?? markdown;
  } catch (error) {
    currentBodyText = markdown;
    sync.retainSource(joinPreservedFrontmatter(preservedPrefix, markdown),
      (error instanceof Error ? error.message : "Could not preserve Markdown.") + " Your draft is retained. Restore it to continue saving.");
    sendNextEdit();
    return;
  }
  sync.sourceSucceeded();
  const nextText = joinPreservedFrontmatter(preservedPrefix, currentBodyText);
  if (nextText === sync.text) {
    return;
  }
  sync.text = nextText;
  queueEdit(typing);
}

const metadata = new FrontmatterEditor(frontmatterCard, frontmatterFieldsRoot, addFrontmatterField, prefix => {
  preservedPrefix = prefix;
  sync.text = joinPreservedFrontmatter(prefix, currentBodyText);
  queueEdit();
}, metadataExpanded, expanded => {
  metadataExpanded = expanded;
  vscode.setState({ session, draft: sync.draft, metadataExpanded, contentWidth: width, fontSize: textSize, codeWrap });
});

function captureEditorSnapshot(): EditorSnapshot | null {
  if (!editor) return null;
  let snapshot: EditorSnapshot | null = null;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    snapshot = {
      selection: view.state.selection.toJSON(),
      head: view.state.selection.head,
      focused: view.hasFocus(),
      scrollTop: documentScroll.scrollTop,
    };
  });
  return snapshot;
}

function restoreEditorSnapshot(snapshot: EditorSnapshot | null) {
  if (!editor || !snapshot) return;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    let selection: Selection;
    try {
      selection = Selection.fromJSON(view.state.doc, snapshot.selection);
    } catch {
      const head = Math.max(0, Math.min(snapshot.head, view.state.doc.content.size));
      selection = Selection.near(view.state.doc.resolve(head));
    }
    view.dispatch(view.state.tr.setSelection(selection));
    if (snapshot.focused) view.focus();
  });
  requestAnimationFrame(() => {
    documentScroll.scrollTop = snapshot.scrollTop;
  });
}

async function createEditor(source: string, snapshot: EditorSnapshot | null = null) {
  ready = false;
  jumpController.clear();
  await editor?.destroy();
  root.replaceChildren();
  root.hidden = false;
  document.querySelectorAll(".source-fallback, .source-fallback-notice").forEach(node => node.remove());

  const split = documentFrontmatter(source);
  preservedPrefix = split.prefix;
  currentBodyText = split.body;
  metadata.load(split.prefix, split.eol);
  const markdown = split.body;
  editor = Editor.make()
    .config(ctx => ctx.set(rootCtx, root))
    .use(getEditorPlugins().flat());
  configureEditor(editor, { markdown, onChange: onMarkdownChanged });
  await editor.create();
  editor.action(ctx => {
    const remark = ctx.get(remarkCtx)();
    for (const entry of ctx.get(remarkPluginsCtx)) remark.use(entry.plugin, entry.options);
    sourceMarkdown = new SourceMarkdown(split.body,
      ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc), value => remark.parse(value));
    if (!sourceMarkdown.supported) {
      ctx.get(editorViewCtx).setProps({ editable: () => false });
      root.hidden = true;
      const source = document.createElement("textarea");
      source.className = "source-fallback";
      source.setAttribute("aria-label", "Markdown source (unsupported visual syntax)");
      source.value = split.body;
      source.addEventListener("input", () => {
        currentBodyText = source.value.replace(/\r?\n/g, split.eol);
        sync.text = joinPreservedFrontmatter(preservedPrefix, currentBodyText);
        queueEdit();
      });
      const notice = document.createElement("p");
      notice.className = "source-fallback-notice";
      notice.textContent = "Source mode preserves syntax that cannot be represented faithfully in the visual editor.";
      root.after(notice, source);
    }
  });
  ready = true;
  setImproving(improving);
  restoreEditorSnapshot(snapshot);
}

async function updateEditor(source: string) {
  if (!editor || root.hidden) return createEditor(source, captureEditorSnapshot());
  const split = documentFrontmatter(source);
  let supported = false;
  editor.action(ctx => {
    const next = ctx.get(parserCtx)(split.body);
    if (!next) return;
    const remark = ctx.get(remarkCtx)();
    for (const entry of ctx.get(remarkPluginsCtx)) remark.use(entry.plugin, entry.options);
    const model = new SourceMarkdown(split.body, ctx.get(serializerCtx)(next), value => remark.parse(value));
    if (!model.supported) return;
    supported = true;
    sourceMarkdown = model;
    currentBodyText = split.body;
    if (preservedPrefix !== split.prefix) metadata.load(split.prefix, split.eol);
    preservedPrefix = split.prefix;
    const scroll = documentScroll.scrollTop;
    applyExternalDocument(ctx.get(editorViewCtx), next);
    documentScroll.scrollTop = scroll;
  });
  if (!supported) await createEditor(source, captureEditorSnapshot());
}

async function receiveUpdate(message: DocumentUpdate) {
  const changed = sync.receive(message);
  if (!sync.inFlight && acknowledgmentTimer !== null) {
    window.clearTimeout(acknowledgmentTimer);
    acknowledgmentTimer = null;
  }
  if (!ready) await createEditor(sync.text);
  else if (changed) await updateEditor(sync.text);
  sendNextEdit();
}

function isCommandMessage(value: any): value is CommandMessage {
  return (
    value?.type === "command" &&
    [
      "toggleBold",
      "toggleItalic",
      "toggleStrikethrough",
      "toggleInlineCode",
      "addLink", "focusToolbar", "moveBlockUp", "moveBlockDown",
    ].includes(value.command)
  );
}

function isJumpMessage(value: any): value is JumpMessage {
  return (
    value?.type === "jump" &&
    typeof value.matchStartOfWord === "boolean" &&
    typeof value.expandSelection === "boolean"
  );
}

function isThemeMessage(value: any): value is ThemeMessage {
  return value?.type === "theme" && isInlineTheme(value.theme);
}

function receiveCommand(message: CommandMessage) {
  if (!editor || improving) return;
  if ((document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)
    && message.command !== 'focusToolbar') return;
  if (message.command === "focusToolbar") { focusToolbar(); return; }
  if (message.command === "moveBlockUp" || message.command === "moveBlockDown") {
    editor.action(ctx => moveCurrentBlock(ctx.get(editorViewCtx), message.command === "moveBlockUp" ? -1 : 1));
    return;
  }
  if (message.command === "addLink") {
    openLinkEditor();
    return;
  }
  editor.action((ctx) => {
    if (message.command === "toggleBold") {
      ctx.get(commandsCtx).call(toggleStrongCommand.key);
    } else if (message.command === "toggleItalic") {
      ctx.get(commandsCtx).call(toggleEmphasisCommand.key);
    } else if (message.command === "toggleStrikethrough") {
      ctx.get(commandsCtx).call(toggleStrikethroughCommand.key);
    } else if (message.command === "toggleInlineCode") {
      ctx.get(commandsCtx).call(toggleInlineCodeCommand.key);
    }
    ctx.get(editorViewCtx).focus();
  });
}

function receiveJump(message: JumpMessage) {
  if (!editor || improving) return;
  editor.action(ctx => {
    jumpController.start(ctx.get(editorViewCtx), message);
  });
}

window.addEventListener(
  "keydown",
  event => {
    if (improving) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (event.isComposing || event.keyCode === 229) return;
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'v') {
      event.preventDefault(); event.stopPropagation(); flushAction({type: 'pastePlainText'}); return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      event.stopPropagation();
      flushAction({ type: 'save' });
      return;
    }
    if ((event.metaKey || event.ctrlKey) && !event.altKey &&
        (event.key.toLowerCase() === 'z' || (!event.metaKey && event.key.toLowerCase() === 'y'))) {
      event.preventDefault();
      event.stopPropagation();
      flushAction({ type: event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo' });
      return;
    }
    jumpController.handleKeyDown(event);
  },
  true
);

// Let ProseMirror reconcile the DOM caret before choosing the contextual toolbar.
window.addEventListener("keydown", event => {
  if (!improving && !event.isComposing && event.altKey && event.key === "F10") {
    event.preventDefault(); focusToolbar();
  }
});

window.addEventListener("message", event => {
  const message = event.data;
  if (message?.type === 'readingPreferences') {
    width = contentWidth(message.contentWidth); textSize = fontSize(message.fontSize);
    applyContentWidth(width); applyFontSize(textSize);
    codeWrap = message.codeWrap !== false; applyCodeWrap(codeWrap);
    vscode.setState({ session, draft: sync.draft, metadataExpanded, contentWidth: width, fontSize: textSize, codeWrap });
    return;
  }
  if (message?.type === 'gitBaseline' && (message.text === null || typeof message.text === 'string')) {
    updates = updates.then(() => gitGutter.setBaseline(message.text));
    return;
  }
  if (message?.type === "textImprover") {
    updates = updates.then(() => {
      if (improveText) improveText.hidden = !message.available;
      improvementError = typeof message.error === "string" ? message.error : "";
      setImproving(message.running === true);
    });
    return;
  }
  if (improving && message?.type === 'history') return;
  if (message?.type === 'history' && ['undo', 'redo'].includes(message.action)) {
    flushAction({ type: message.action });
    return;
  }
  if (message?.type === 'flush') {
    flushAction(message.flushId ? { type: 'flushComplete', flushId: message.flushId } : { type: 'save' });
    return;
  }
  if (message?.type === 'draftDiscarded' && message.text === sync.text) {
    sync.useFile();
    updates = updates.then(() => createEditor(sync.text, captureEditorSnapshot())).then(sendNextEdit);
    return;
  }
  if (message?.type === 'draftRestored') {
    updates = updates.then(() => createEditor(sync.text, captureEditorSnapshot())).then(sendNextEdit);
    return;
  }
  if (message?.type === 'operationError' && typeof message.error === 'string') {
    sync.error = message.error;
    sendNextEdit();
    return;
  }
  if (isCommandMessage(message)) {
    receiveCommand(message);
    return;
  }
  if (isJumpMessage(message)) {
    receiveJump(message);
    return;
  }
  if (isThemeMessage(message)) {
    applyInlineTheme(message.theme);
    return;
  }
  if (
    message &&
    ["update", "editResult"].includes(message.type) &&
    Number.isSafeInteger(message.version) &&
    typeof message.text === "string"
  ) {
    updates = updates.then(() => receiveUpdate(message)).catch(error => {
      sync.error = `Could not update the editor: ${String(error)}`;
      sendNextEdit();
    });
  }
});

function moveCursorIntoLink(event: MouseEvent, anchor: HTMLAnchorElement) {
  if (!editor) return;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
    const linkType = view.state.schema.marks.link;
    if (!linkType) return;

    const max = view.state.doc.content.size;
    let anchorStart: number | null = null;
    let anchorEnd: number | null = null;
    try {
      anchorStart = view.posAtDOM(anchor, 0);
      anchorEnd = view.posAtDOM(anchor, anchor.childNodes.length);
    } catch {
      // Fall back to pointer coordinates when the DOM position is unavailable.
    }
    const positions = [
      anchorStart,
      anchorStart === null ? null : anchorStart + 1,
      anchorEnd === null ? null : anchorEnd - 1,
      hit?.pos ?? null,
      hit ? hit.pos - 1 : null,
      hit ? hit.pos + 1 : null,
    ];
    const position = positions.find((candidate): candidate is number => {
      if (candidate === null) return false;
      if (candidate <= 0 || candidate >= max) return false;
      return view.state.doc.resolve(candidate).marks().some(mark => mark.type === linkType);
    });
    if (position === undefined) return;

    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, position))
    );
    view.focus();
  });
}

root.addEventListener(
  "click",
  event => {
    const target = event.target;
    if (!(event instanceof MouseEvent) || !(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor) return;

    const action = linkClickAction(event);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action === "open") {
      window.dispatchEvent(
        new CustomEvent("damln-open-link", { detail: anchor.getAttribute("href") || "" })
      );
      return;
    }
    moveCursorIntoLink(event, anchor);
    openLinkEditor();
  },
  true
);

// Let ProseMirror reconcile the DOM caret before choosing the contextual toolbar.
window.addEventListener("keydown", event => {
  if (!improving && !event.isComposing && event.altKey && event.key === "F10") {
    event.preventDefault(); focusToolbar();
  }
});

window.addEventListener("message", event => {
  const message = event.data;
  if (message?.type === "focusStart") {
    updates = updates.then(() => {
      const fallback = document.querySelector<HTMLTextAreaElement>('.source-fallback');
      if (fallback) {
        fallback.focus({ preventScroll: true });
        fallback.setSelectionRange(0, 0);
      } else editor?.action(ctx => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.setSelection(Selection.atStart(view.state.doc)));
        view.focus();
      });
      documentScroll.scrollTop = 0;
    });
  }
  if (improving && ["requestPlainPaste", "pasteText"].includes(message?.type)) return;
  if (message?.type === "requestPlainPaste") flushAction({type: "pastePlainText"});
  if (message?.type === "pasteText" && typeof message.text === "string" && editor) {
    const field = document.activeElement;
    if ((field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement) && !field.readOnly && !field.disabled) {
      field.setRangeText(message.text, field.selectionStart ?? 0, field.selectionEnd ?? 0, 'end');
      field.dispatchEvent(new Event('input')); field.focus();
    } else editor.action(ctx => pastePlainText(ctx.get(editorViewCtx), message.text));
  }
  if (message?.type === "navigateSource" && Number.isSafeInteger(message.offset)) {
    updates = updates.then(() => {
      const fallback = document.querySelector<HTMLTextAreaElement>('.source-fallback');
      if (fallback) { fallback.focus(); fallback.setSelectionRange(message.offset - preservedPrefix.length, message.offset - preservedPrefix.length); return; }
      editor?.action(ctx => {
        const view = ctx.get(editorViewCtx);
        const index = sourceMarkdown?.blockIndexAtOffset(Math.max(0, message.offset - preservedPrefix.length)) ?? 0;
        let pos = 0;
        for (let i = 0; i < Math.min(index, view.state.doc.childCount - 1); i++) pos += view.state.doc.child(i).nodeSize;
        view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(pos + 1))).scrollIntoView());
        view.focus();
      });
    });
  }
  if (message?.type === "navigationError" && typeof message.error === "string") setStatus(message.error, true);
  if (message?.type === "navigateHeading" && typeof message.fragment === "string") {
    updates = updates.then(() => {
      if (!editor) return;
      editor.action(ctx => {
        if (!navigateHeading(ctx.get(editorViewCtx), message.fragment)) setStatus(`Heading not found: ${message.fragment}`, true);
      });
    });
  }
});

window.addEventListener("damln-image-resource", event => {
  if (event instanceof CustomEvent) vscode.postMessage({type: "resolveImage", ...event.detail});
});

window.addEventListener("damln-copy-code", event => {
  if (event instanceof CustomEvent && typeof event.detail?.text === "string" && typeof event.detail?.requestId === "string") {
    vscode.postMessage({type: "copyCode", text: event.detail.text, requestId: event.detail.requestId});
  }
});

window.addEventListener("damln-open-link", event => {
  if (event instanceof CustomEvent && typeof event.detail === "string") {
    vscode.postMessage({ type: "openLink", href: event.detail });
  }
});

openRaw.addEventListener("click", () => {
  if (improving) return;
  let offset = preservedPrefix.length;
  const fallback = document.querySelector<HTMLTextAreaElement>('.source-fallback');
  if (fallback) offset += fallback.selectionStart;
  else editor?.action(ctx => {
    const view = ctx.get(editorViewCtx);
    offset += sourceMarkdown?.blockOffset(view.state.selection.$from.index(0)) ?? 0;
  });
  flushAction({ type: "openRaw", offset });
});
for (const type of ["pointerdown", "click", "beforeinput", "paste", "drop"] as const) {
  window.addEventListener(type, event => {
    if (improving && event.target instanceof Element && !event.target.closest("header, .theme-picker")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}
improveText?.addEventListener("click", () => {
  if (!improving && !sync.error) vscode.postMessage({ type: "improveText" });
});
vscode.postMessage({ type: "ready", session });
