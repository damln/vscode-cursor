function skillName(value) {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function validateSkillName(value) {
  const name = skillName(value);
  if (!name || name.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    return "Use 1–63 lowercase letters, digits, and single hyphens (for example: review-code).";
  }
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(name)) {
    return "This name is reserved on Windows. Choose another skill name.";
  }
  return undefined;
}

function skillTemplate(name, now = new Date()) {
  const words = name.replace(/-/g, " ");
  const title = words[0].toUpperCase() + words.slice(1);
  return `---
name: ${name}
description: "Use this skill when the user requests help with ${words}."
metadata:
  category: UTILITY
  last_reviewed: "${now.toISOString().slice(0, 10)}"
---

# ${title}
`;
}

async function skillParent(vscode, workspace, name) {
  const root = vscode.Uri.joinPath(workspace.uri, "skills");
  let entries;
  try {
    entries = await vscode.workspace.fs.readDirectory(root);
  } catch (error) {
    if (error.code === "FileNotFound") return root;
    throw error;
  }
  const choices = [{label: "skills", description: "Workspace skills folder", uri: root}];
  for (const [folder] of entries.filter(([, type]) => type & vscode.FileType.Directory)
    .sort(([a], [b]) => a.localeCompare(b))) {
    choices.push({label: `skills/${folder}`, description: "", uri: vscode.Uri.joinPath(root, folder)});
  }
  const selected = await vscode.window.showQuickPick(choices, {
    title: "Create Skill: choose a folder", placeHolder: `Where should ${name} go?`,
    ignoreFocusOut: true,
  });
  return selected?.uri;
}

async function createSkill(vscode) {
  let created;
  try {
    const folders = vscode.workspace.workspaceFolders || [];
    if (!folders.length) {
      await vscode.window.showInformationMessage("Open a workspace folder before creating a skill.");
      return;
    }
    const workspace = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({
      placeHolder: "Choose the workspace for your skill",
    });
    if (!workspace) return;
    const input = await vscode.window.showInputBox({
      title: "Create Skill",
      prompt: "Skill name. Spaces and underscores become hyphens; uppercase becomes lowercase.",
      placeHolder: "review-code", ignoreFocusOut: true, validateInput: validateSkillName,
    });
    if (input === undefined) return;
    const invalid = validateSkillName(input);
    if (invalid) throw new Error(invalid);
    const name = skillName(input);
    const parent = await skillParent(vscode, workspace, name);
    if (!parent) return;
    const directory = vscode.Uri.joinPath(parent, name);
    let exists = false;
    try {
      await vscode.workspace.fs.stat(directory);
      exists = true;
    } catch (error) {
      if (error.code !== "FileNotFound") throw error;
    }
    if (exists) throw new Error(`A file or folder already exists at ${directory.toString()}. Choose another name or parent folder.`);
    const uri = vscode.Uri.joinPath(directory, "SKILL.md");
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(uri, {
      overwrite: false, ignoreIfExists: false, contents: Buffer.from(skillTemplate(name), "utf8"),
    });
    if (!await vscode.workspace.applyEdit(edit)) throw new Error("The skill could not be created. Check the folder permissions and whether the file already exists.");
    created = uri;
    await vscode.commands.executeCommand("vscode.openWith", uri, "default", { preview: false });
  } catch (error) {
    const prefix = created ? `Skill created at ${created.toString()}, but could not be opened` : "Could not create skill";
    await vscode.window.showErrorMessage(`${prefix}: ${error.message || error}`);
  }
  return created;
}

module.exports = { createSkill, skillName, skillTemplate, validateSkillName };
