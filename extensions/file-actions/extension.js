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
  const inline = vscode.extensions.getExtension("damln.markdown-inline");
  if (inline?.isActive && typeof inline.exports?.prepareCopy === "function") {
    await inline.exports.prepareCopy(uri);
  } else if (vscode.window.tabGroups.activeTabGroup.activeTab?.input?.viewType === "damln.markdownInline") {
    throw new Error("Update Markdown Inline and reload the window before copying visual edits.");
  }
  const document = await vscode.workspace.openTextDocument(uri);
  return document.getText();
}

function activate(context) {
  const { BrowserPreview } = require("./browser-preview");
  const browser = new BrowserPreview();
  context.subscriptions.push(browser, vscode.commands.registerCommand("damlnFileActions.openInBrowser", async resource => {
    const uri = targetUri(resource);
    try {
      if (!uri || uri.scheme !== "file" || !/\.html?$/i.test(uri.path)) throw new Error("Choose a local HTML file. For remote sites, open a forwarded HTTP URL.");
      if (!vscode.workspace.isTrusted) throw new Error("Trust this workspace before running HTML in a browser.");
      const document = await vscode.workspace.openTextDocument(uri);
      if (document.isDirty) {
        const choice = await vscode.window.showInformationMessage("Save your HTML changes before opening them in the browser?", "Save and open", "Cancel");
        if (choice !== "Save and open" || !await document.save()) return false;
      }
      const folder = vscode.workspace.getWorkspaceFolder(uri)?.uri;
      const root = folder?.scheme === "file" ? folder.fsPath : vscode.Uri.joinPath(uri, "..").fsPath;
      const url = await browser.url(uri.fsPath, root);
      if (!await vscode.env.openExternal(vscode.Uri.parse(url))) throw new Error("The browser could not be opened.");
      return true;
    } catch (error) {
      await vscode.window.showErrorMessage(`Could not open HTML in browser: ${error.message || error}`);
      return false;
    }
  }));
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
