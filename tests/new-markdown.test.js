const assert = require("node:assert/strict");
const test = require("node:test");
const { createNewMarkdown } = require("../extensions/markdown-inline/new-markdown");
const manifest = require("../extensions/markdown-inline/package.json");

const date = new Date(2026, 0, 2, 3, 4);
const name = "2026-01-02-03h04-note";
function harness(root = "file:///workspace") {
  const files = new Map(), opened = [], errors = [], information = [];
  const folder = { uri: root };
  const vscode = {
    Uri: { joinPath: (base, part) => `${base}/${part}` },
    WorkspaceEdit: class { createFile(uri, options) { this.uri = uri; this.options = options; } },
    workspace: {
      workspaceFolders: [folder],
      fs: { stat: async uri => {
        if (!files.has(uri)) throw Object.assign(new Error("Missing"), { code: "FileNotFound" });
        return {};
      } },
      applyEdit: async edit => {
        assert.deepEqual(edit.options, { overwrite: false, ignoreIfExists: false });
        if (files.has(edit.uri)) return false;
        files.set(edit.uri, "");
        return true;
      }
    },
    window: {
      showWorkspaceFolderPick: async () => { throw new Error("Unexpected picker"); },
      showInformationMessage: async message => information.push(message),
      showErrorMessage: async message => errors.push(message)
    },
    commands: { executeCommand: async (...args) => opened.push(args) }
  };
  return { vscode, files, opened, errors, information, root };
}

test("New Markdown is exposed in the palette before an editor is open", () => {
  assert.ok(manifest.activationEvents.includes("onCommand:damlnMarkdownInline.newMarkdown"));
  const command = manifest.contributes.commands.find(c => c.command === "damlnMarkdownInline.newMarkdown");
  assert.equal(command.title, "New Markdown");
  assert.equal(command.enablement, undefined);
  assert.ok(manifest.files.includes("new-markdown.js"));
});

test("creates an empty note using local date and HHhmm, then opens inline", async () => {
  const h = harness();
  const uri = await createNewMarkdown(h.vscode, date);
  assert.equal(uri, `${h.root}/${name}-1.md`);
  assert.equal(h.files.get(uri), "");
  assert.deepEqual(h.opened, [["vscode.openWith", uri, "damln.markdownInline", { preview: false }]]);
});

test("existing notes and occupied names remain untouched", async () => {
  const h = harness();
  h.files.set(`${h.root}/${name}-1.md`, "Existing note");
  h.files.set(`${h.root}/${name}-2.md`, "Another note");
  assert.equal(await createNewMarkdown(h.vscode, date), `${h.root}/${name}-3.md`);
  assert.equal(h.files.get(`${h.root}/${name}-1.md`), "Existing note");
  assert.equal(h.files.get(`${h.root}/${name}-2.md`), "Another note");
});

test("simultaneous requests retry collisions without overwriting", async () => {
  const h = harness();
  const uris = await Promise.all([createNewMarkdown(h.vscode, date), createNewMarkdown(h.vscode, date)]);
  assert.deepEqual(uris.sort(), [`${h.root}/${name}-2.md`, `${h.root}/${name}-1.md`].sort());
  assert.equal(h.files.size, 2);
  const nextMinute = new Date(2026, 0, 2, 3, 5);
  assert.equal(await createNewMarkdown(h.vscode, nextMinute), `${h.root}/2026-01-02-03h05-note-1.md`);
  assert.deepEqual(h.errors, []);
});

test("multi-root selection preserves remote URI and cancel creates nothing", async () => {
  const h = harness();
  const remote = { uri: "vscode-remote://ssh-remote+dev/home/user/project" };
  h.vscode.workspace.workspaceFolders.push(remote);
  h.vscode.window.showWorkspaceFolderPick = async () => undefined;
  await createNewMarkdown(h.vscode, date);
  assert.equal(h.files.size, 0);
  h.vscode.window.showWorkspaceFolderPick = async () => remote;
  assert.equal(await createNewMarkdown(h.vscode, date), `${remote.uri}/${name}-1.md`);
});

test("no workspace explains the requirement without writing files", async () => {
  const h = harness();
  h.vscode.workspace.workspaceFolders = undefined;
  await createNewMarkdown(h.vscode, date);
  assert.equal(h.information.length, 1);
  assert.equal(h.files.size, 0);
  assert.equal(h.opened.length, 0);
});

test("permission and provider failures stop without opening a phantom note", async () => {
  for (const failure of ["stat", "rejected edit", "thrown edit"]) {
    const h = harness();
    if (failure === "stat") h.vscode.workspace.fs.stat = async () => { throw new Error("Permission denied"); };
    if (failure === "rejected edit") h.vscode.workspace.applyEdit = async () => false;
    if (failure === "thrown edit") h.vscode.workspace.applyEdit = async () => { throw new Error("Read-only provider"); };
    await createNewMarkdown(h.vscode, date);
    assert.equal(h.errors.length, 1, failure);
    assert.equal(h.files.size, 0, failure);
    assert.equal(h.opened.length, 0, failure);
  }
});

test("an editor failure retains the created file and reports its location", async () => {
  const h = harness();
  h.vscode.commands.executeCommand = async () => { throw new Error("Editor unavailable"); };
  const uri = await createNewMarkdown(h.vscode, date);
  assert.equal(h.files.get(uri), "");
  assert.ok(h.errors[0].includes(uri));
  assert.ok(h.errors[0].includes("could not be opened"));
});
