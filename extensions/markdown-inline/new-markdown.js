async function exists(vscode, uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    if (error.code === "FileNotFound") return false;
    throw error;
  }
}

async function createNewMarkdown(vscode, now = new Date()) {
  const folders = vscode.workspace.workspaceFolders || [];
  if (!folders.length) {
    await vscode.window.showInformationMessage("Open a workspace folder before creating a Markdown note.");
    return;
  }
  const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({
    placeHolder: "Choose the workspace root for your new Markdown note"
  });
  if (!folder) return;

  const pad = value => String(value).padStart(2, "0");
  const date = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join("-");
  const stamp = `${date}-${pad(now.getHours())}h${pad(now.getMinutes())}`;
  let created;
  try {
    for (let number = 1; ; number++) {
      const name = `${stamp}-note-${number}.md`;
      const uri = vscode.Uri.joinPath(folder.uri, name);
      if (await exists(vscode, uri)) continue;
      const edit = new vscode.WorkspaceEdit();
      edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
      let failure = new Error("The file could not be created. Check the workspace permissions.");
      try {
        if (await vscode.workspace.applyEdit(edit)) { created = uri; break; }
      } catch (error) { failure = error; }
      if (!await exists(vscode, uri)) throw failure;
    }
  } catch (error) {
    await vscode.window.showErrorMessage(`New Markdown: ${error.message || error}`);
    return;
  }
  try {
    await vscode.commands.executeCommand("vscode.openWith", created, "damln.markdownInline", { preview: false });
  } catch (error) {
    await vscode.window.showErrorMessage(`The note was created at ${created.toString()}, but could not be opened: ${error.message || error}`);
  }
  return created;
}

module.exports = { createNewMarkdown };
