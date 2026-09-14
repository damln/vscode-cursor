const vscode = require("vscode");

const OPEN_FILE = "workbench.action.browser.openFile";

function targetUri(resource) {
  if (resource instanceof vscode.Uri) return resource;
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (tab) return tab.input?.modified || tab.input?.uri;
  return vscode.window.activeTextEditor?.document.uri;
}

async function openPreview(resource) {
  try {
    const uri = targetUri(resource);
    if (!uri || uri.scheme !== "file" || !/\.html?$/i.test(uri.path)) {
      throw new Error("Choose a local HTML file. For a remote site, open its forwarded HTTP URL in the Integrated Browser.");
    }
    if (!vscode.workspace.isTrusted) throw new Error("Trust this workspace before running HTML in a browser.");
    if (!(await vscode.commands.getCommands(true)).includes(OPEN_FILE)) {
      throw new Error("This editor does not include the native HTML browser. Use VS Code 1.121 or newer.");
    }
    const document = await vscode.workspace.openTextDocument(uri);
    if (document.isDirty) {
      const choice = await vscode.window.showInformationMessage(
        "Save your HTML changes before opening them in the Integrated Browser?", "Save and open", "Cancel"
      );
      if (choice !== "Save and open" || !await document.save()) return false;
    }
    await vscode.commands.executeCommand(OPEN_FILE, uri);
    return true;
  } catch (error) {
    await vscode.window.showErrorMessage(`Could not open HTML in Integrated Browser: ${error.message || error}`);
    return false;
  }
}

function activate(context) {
  context.subscriptions.push(vscode.commands.registerCommand("damlnHtmlPreview.openPreview", openPreview));
}

module.exports = { activate };
