const vscode = require("vscode");
const { renderPreviewHtml } = require("./preview-html");

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
  async resolveCustomTextEditor(document, panel) {
    const documentDirectory = directoryUri(document.uri);
    const workspaceRoots = (vscode.workspace.workspaceFolders || []).map(folder => folder.uri);
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [documentDirectory, ...workspaceRoots]
    };

    const update = () => {
      const base = `${panel.webview.asWebviewUri(documentDirectory).toString()}/`;
      panel.webview.html = renderPreviewHtml(
        document.getText(),
        base,
        panel.webview.cspSource
      );
    };

    update();
    const documentSubscription = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() === document.uri.toString()) {
        update();
      }
    });
    panel.onDidDispose(() => documentSubscription.dispose());
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
  if (!resource || !resource.path.toLowerCase().endsWith(".html")) {
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

module.exports = { activate, deactivate };
