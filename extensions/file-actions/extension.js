const vscode = require("vscode");

function targetUri(resource) {
  if (resource instanceof vscode.Uri) return resource;
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (tab) return tab.input?.modified || tab.input?.uri;
  return vscode.window.activeTextEditor?.document.uri;
}

function copyPath(uri, parent) {
  if (uri.scheme === "untitled") throw new Error("Save the file first to give it a path.");
  const target = parent ? vscode.Uri.joinPath(uri, "..").with({ query: "", fragment: "" }) : uri;
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder) {
    return target.toString() === folder.uri.toString() ? "." : vscode.workspace.asRelativePath(target, false);
  }
  return target.scheme === "file" ? target.fsPath : target.path;
}

async function copyContent(uri) {
  const notebook = vscode.workspace.notebookDocuments.find(document => document.uri.toString() === uri.toString());
  if (notebook?.isDirty) throw new Error("Save the notebook first to copy its complete file content.");
  const document = await vscode.workspace.openTextDocument(uri);
  return document.getText();
}

function activate(context) {
  for (const [action, label] of [["copyContent", "Content"], ["copyFilePath", "File path"], ["copyParentFolderPath", "Parent folder path"]]) {
    context.subscriptions.push(vscode.commands.registerCommand(`damlnFileActions.${action}`, async resource => {
      const uri = targetUri(resource);
      if (!uri) {
        await vscode.window.showInformationMessage("Open a file to copy its content or path.");
        return false;
      }
      try {
        const value = action === "copyContent" ? await copyContent(uri) : copyPath(uri, action === "copyParentFolderPath");
        await vscode.env.clipboard.writeText(value);
        vscode.window.setStatusBarMessage(`$(check) ${label} copied`, 2000);
        return true;
      } catch (error) {
        await vscode.window.showErrorMessage(`Could not copy ${label.toLowerCase()}: ${error.message || error}`);
        return false;
      }
    }));
  }
}

module.exports = { activate };
