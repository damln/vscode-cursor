const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createSkill, skillName, skillTemplate, validateSkillName } = require("../extensions/minimal-theme/create-skill");
const manifest = require("../extensions/minimal-theme/package.json");

function harness(parent = "file:///workspace/skills") {
  const files = new Map(), opened = [], errors = [], prompts = [];
  const vscode = {
    FileType: {Directory: 2, File: 1},
    Uri: { joinPath: (base, part) => `${base}/${part}` },
    WorkspaceEdit: class { createFile(uri, options) { this.uri = uri; this.options = options; } },
    workspace: {
      workspaceFolders: [{uri: parent.replace(/\/skills$/, "")}],
      getWorkspaceFolder: () => undefined,
      fs: { readDirectory: async () => [], stat: async uri => {
        if (!files.has(uri)) throw Object.assign(new Error("Missing"), {code: "FileNotFound"});
        return {};
      } },
      applyEdit: async edit => {
        assert.equal(edit.options.overwrite, false);
        assert.equal(edit.options.ignoreIfExists, false);
        if (files.has(edit.uri)) return false;
        files.set(edit.uri, edit.options.contents.toString("utf8"));
        return true;
      },
    },
    window: {
      showInputBox: async options => { prompts.push(options); return " Review_Code "; },
      showQuickPick: async (choices, options) => { prompts.push({choices, ...options}); return choices[0]; },
      showInformationMessage: async message => prompts.push(message),
      showErrorMessage: async message => errors.push(message),
    },
    commands: { executeCommand: async (...args) => opened.push(args) },
  };
  return { vscode, files, opened, errors, prompts, parent };
}

test("Create Skill is available in the theme and registers a disposable command", () => {
  const subscriptions = [], commands = new Map();
  const disposable = { dispose() {} };
  const module = {exports: {}};
  const source = fs.readFileSync(path.join(__dirname, "../extensions/minimal-theme/extension.js"), "utf8");
  vm.runInNewContext(source, {module, require: id => id === "vscode"
    ? {commands: {registerCommand: (id, callback) => {commands.set(id, callback); return disposable;}}}
    : {createSkill: () => "created"}});
  module.exports.activate({subscriptions});
  assert.equal(commands.get("damlnMinimalTheme.createSkill")(), "created");
  assert.deepEqual(subscriptions, [disposable]);
  assert.equal(manifest.contributes.commands[0].title, "Create Skill");
  assert.ok(manifest.activationEvents.includes("onCommand:damlnMinimalTheme.createSkill"));
  for (const file of ["extension.js", "create-skill.js"]) assert.ok(manifest.files.includes(file));
});

test("names normalize predictably and reject unsafe or nonportable folder names", () => {
  assert.equal(skillName(" Review_Code "), "review-code");
  for (const value of ["review-code", "My New Skill", "v2", "a".repeat(63)]) {
    assert.equal(validateSkillName(value), undefined, value);
  }
  for (const value of ["", " ", "../outside", "a/b", "a\\b", "-name", "name-", "a--b", "a".repeat(64), "CON", "nul", "lpt1", 'bad"name']) {
    assert.ok(validateSkillName(value), value);
  }
});

test("template includes matching frontmatter and only a human-readable H1 in the body", () => {
  const text = skillTemplate("review-code", new Date("2026-09-17T12:00:00Z"));
  assert.ok(text.startsWith('---\nname: review-code\ndescription: "Use this skill when the user requests help with review code."\n'));
  assert.match(text, /category: UTILITY\n  last_reviewed: "2026-09-17"/);
  assert.match(text, /# Review code/);
  assert.equal(text.split("\n---\n")[1], "\n# Review code\n");
  assert.ok(text.endsWith("\n"));
});

test("creates named skill in the selected parent and opens its source", async () => {
  const h = harness();
  const uri = await createSkill(h.vscode);
  assert.equal(uri, h.parent + "/review-code/SKILL.md");
  assert.match(h.files.get(uri), /name: review-code/);
  assert.deepEqual(h.opened, [["vscode.openWith", uri, "default", {preview: false}]]);
  assert.deepEqual(h.prompts[1].choices.map(c => c.label), ["skills"]);
  assert.deepEqual(h.errors, []);
});

test("preserves a remote workspace URI", async () => {
  const h = harness("vscode-remote://ssh-remote+dev/home/user/skills");
  assert.equal(await createSkill(h.vscode), h.parent + "/review-code/SKILL.md");
});

test("without a workspace explains the requirement and creates nothing", async () => {
  const h = harness();
  h.vscode.workspace.workspaceFolders = undefined;
  assert.equal(await createSkill(h.vscode), undefined);
  assert.equal(h.files.size, 0);
  assert.match(h.prompts[0], /Open a workspace folder/);
});

test("missing skills directory uses the workspace root without a destination prompt", async () => {
  const h = harness();
  h.vscode.workspace.fs.readDirectory = async () => { throw Object.assign(new Error("Missing"), {code: "FileNotFound"}); };
  h.vscode.window.showQuickPick = async () => { throw new Error("Unexpected picker"); };
  assert.equal(await createSkill(h.vscode), h.parent + "/review-code/SKILL.md");
  assert.equal(h.errors.length, 0);
});

test("picker lists only immediate directories and creates the skill under the selected one", async () => {
  const h = harness();
  const reads = [];
  h.vscode.workspace.fs.readDirectory = async uri => {
    reads.push(uri);
    return [["team", 2], ["README.md", 1], ["custom", 2]];
  };
  h.vscode.window.showQuickPick = async choices => {
    assert.deepEqual(choices.map(c => c.label), ["skills", "skills/custom", "skills/team"]);
    return choices[2];
  };
  assert.equal(await createSkill(h.vscode), h.parent + "/team/review-code/SKILL.md");
  assert.deepEqual(reads, [h.parent]);
});

test("multi-root workspace selection and cancellation stay in the palette", async () => {
  const h = harness();
  const other = {uri: "file:///other"};
  h.vscode.workspace.workspaceFolders.push(other);
  h.vscode.window.showWorkspaceFolderPick = async () => undefined;
  assert.equal(await createSkill(h.vscode), undefined);
  assert.equal(h.files.size, 0);
  h.vscode.window.showWorkspaceFolderPick = async () => other;
  assert.equal(await createSkill(h.vscode), "file:///other/skills/review-code/SKILL.md");
});

test("cancelling either prompt creates nothing", async () => {
  for (const prompt of ["showInputBox", "showQuickPick"]) {
    const h = harness();
    h.vscode.window[prompt] = async () => undefined;
    assert.equal(await createSkill(h.vscode), undefined);
    assert.equal(h.files.size, 0);
    assert.equal(h.opened.length, 0);
    assert.equal(h.errors.length, 0);
  }
});

test("existing folders and racing file creation are never overwritten", async () => {
  const h = harness();
  const directory = h.parent + "/review-code";
  h.files.set(directory, "existing directory");
  await createSkill(h.vscode);
  assert.equal(h.files.size, 1);
  assert.equal(h.errors.length, 1);
  assert.equal(h.opened.length, 0);
  h.files.clear();
  const results = await Promise.all([createSkill(h.vscode), createSkill(h.vscode)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(h.files.size, 1);
});

test("permission and rejected-edit errors are reported without opening a missing file", async () => {
  for (const stage of ["readDirectory", "stat", "applyEdit"]) {
    const h = harness();
    if (stage !== "applyEdit") h.vscode.workspace.fs[stage] = async () => { throw new Error("Permission denied"); };
    else h.vscode.workspace.applyEdit = async () => false;
    await createSkill(h.vscode);
    assert.equal(h.errors.length, 1);
    assert.equal(h.files.size, 0);
    assert.equal(h.opened.length, 0);
  }
});

test("failure to open retains the new skill and reports its location", async () => {
  const h = harness();
  h.vscode.commands.executeCommand = async () => { throw new Error("Editor unavailable"); };
  const uri = await createSkill(h.vscode);
  assert.ok(h.files.has(uri));
  assert.ok(h.errors[0].includes(uri));
  assert.match(h.errors[0], /could not be opened/);
});
