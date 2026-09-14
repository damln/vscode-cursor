const vscode = require("vscode");
const { renderPreviewHtml } = require("./preview-html");

const { resolveLink } = require("./navigation");

const VIEW_TYPE = "damln.htmlPreview";

function directoryUri(uri) {
  const slash = uri.path.lastIndexOf("/");
  return uri.with({ path: slash > 0 ? uri.path.slice(0, slash) : "/" });
}

function activePreviewUri() {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input?.viewType === VIEW_TYPE ? input.uri : undefined;
}

class HtmlPreviewProvider {
  constructor() { this.panels = new Map(); this.fragments = new Map(); }

  async resolveCustomTextEditor(document, panel) {
    const documentDirectory = directoryUri(document.uri);
    const workspaceRoots = (vscode.workspace.workspaceFolders || []).map(folder => folder.uri);
    const roots = [documentDirectory, ...workspaceRoots];
    const key = document.uri.toString();
    this.panels.set(key, panel);
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: roots
    };

    const update = () => {
      const base = `${panel.webview.asWebviewUri(documentDirectory).toString()}/`;
      panel.webview.html = renderPreviewHtml(
        document.getText(),
        base,
        panel.webview.cspSource,
        this.fragments.get(key) || ""
      );
    };

    const navigationSubscription = panel.webview.onDidReceiveMessage(async message => {
      if (message?.type !== "navigate" || typeof message.href !== "string" || message.href.length > 16384) return;
      try {
        const link = resolveLink(message.href, document.uri, roots, panel.webview, vscode.Uri);
        if (link.kind === "external") {
          if (!await vscode.env.openExternal(link.uri)) throw new Error("The external link could not be opened.");
          return;
        }
        const stat = await vscode.workspace.fs.stat(link.uri);
        if (!(stat.type & vscode.FileType.File)) throw new Error("The link does not point to a file.");
        if (/\.html?$/i.test(link.uri.path)) {
          const targetKey = link.uri.toString();
          this.fragments.set(targetKey, link.fragment);
          await vscode.commands.executeCommand("vscode.openWith", link.uri, VIEW_TYPE);
          await this.panels.get(targetKey)?.webview.postMessage({type:"scrollToFragment", fragment:link.fragment});
        } else {
          await vscode.commands.executeCommand("vscode.open", link.uri);
        }
      } catch (error) {
        await vscode.window.showErrorMessage(`Could not open HTML link: ${error.message || error}`);
      }
    });
    update();
    const documentSubscription = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() === document.uri.toString()) {
        update();
      }
    });
    panel.onDidDispose(() => {
      documentSubscription.dispose(); navigationSubscription.dispose();
      if (this.panels.get(key) === panel) this.panels.delete(key);
      this.fragments.delete(key);
    });
  }
}

async function editSource(uri = activePreviewUri()) {
  if (!uri) {
    vscode.window.showInformationMessage("Open an HTML preview to edit its source.");
    return;
  }
  await vscode.commands.executeCommand("vscode.openWith", uri, "default");
}

async function openPreview(uri) {
  const resource = uri || vscode.window.activeTextEditor?.document.uri;
  if (!resource || !/\.html?$/i.test(resource.path)) {
    vscode.window.showInformationMessage("Open an HTML file to preview it.");
    return;
  }
  await vscode.commands.executeCommand("vscode.openWith", resource, VIEW_TYPE);
}

function activate(context) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      VIEW_TYPE,
      new HtmlPreviewProvider(),
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    vscode.commands.registerCommand("damlnHtmlPreview.editSource", editSource),
    vscode.commands.registerCommand("damlnHtmlPreview.openPreview", openPreview)
  );
}

function deactivate() {}

module.exports = { activate, deactivate, HtmlPreviewProvider };
