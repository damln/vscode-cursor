const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const test = require("node:test");
const { DocumentQueue, parseEditorMessage } = require("../extensions/markdown-inline/document-sync");
const { cleanupMarkdown } = require("../extensions/markdown-inline/markdown-model");

test("cleanup trims line endings and preserves indentation, collapses blank lines, and leaves a final empty line", () => {
  for (const [source, expected] of [
    [" \n\n  # Title  \n \t\n\n text \t\n\n\n", "  # Title\n\n text\n"],
    ["\r\n  one \r\n\r\n \t\r\n two\r\n", "  one\r\n\r\n two\r\n"],
    ["    code  \n\tmore\t", "    code\n\tmore\n"],
    ["- parent  \n  - child \n    - grandchild\t", "- parent\n  - child\n    - grandchild\n"],
    ["", "\n"], [" \t\n\n", "\n"],
    ["- first\n\n- second", "- first\n\n- second\n"],
    ["  code  \n\n\n  more  ", "  code\n\n  more\n"],
  ]) {
    assert.equal(cleanupMarkdown(source), expected);
    assert.equal(cleanupMarkdown(expected), expected);
  }
});

test("cleanup preserves frontmatter bytes while cleaning only the Markdown body", () => {
  for (const eol of ["\n", "\r\n"]) {
    for (const bom of ["", "\uFEFF"]) {
      const prefix = bom + [
        "---  ", "name: custom-design-curator", "metadata:",
        "  category: FRONTEND", '  last_reviewed: "2026-09-17"',
        "  tags:", "    - design", "description: |", "  First line  ",
        "", "", "  Last line", "# Keep this comment  ", "---\t", "",
      ].join(eol);
      const source = prefix + ["", "  # Heading  ", "", "", " Body \t", "", ""].join(eol);
      const expected = prefix + ["  # Heading", "", " Body", ""].join(eol);
      assert.equal(cleanupMarkdown(source), expected);
      assert.equal(cleanupMarkdown(expected), expected);
    }
  }
});

test("cleanup leaves unclosed or unsupported frontmatter untouched", () => {
  for (const source of [
    "---\nmetadata:\n  category: FRONTEND\n\n\n",
    "\uFEFF---\r\nmetadata:\r\n  category: FRONTEND",
    "---\nmetadata:\n  category: FRONTEND\n...\n\n Body  \n",
  ]) assert.equal(cleanupMarkdown(source), source);
});

test("cleanup handles frontmatter-only files and ordinary body separators", () => {
  const frontmatter = "---\nmetadata:\n  category: FRONTEND\n---\n";
  for (const source of [frontmatter.slice(0, -1), frontmatter, frontmatter + "\n\n"]) {
    assert.equal(cleanupMarkdown(source), frontmatter);
    assert.equal(cleanupMarkdown(cleanupMarkdown(source)), frontmatter);
  }
  assert.equal(cleanupMarkdown(" Heading \n\n\n---\n\n Body  "), " Heading\n\n---\n\n Body\n");
});

function fixture() {
  const extensionPath = path.join(__dirname, "../extensions/markdown-inline/extension.js");
  const localRequire = createRequire(extensionPath);
  const module = { exports: {} };
  const events = [], errors = [];
  const document = { uri: { toString: () => "file:///note.md", fsPath: "/note.md" },
    version: 1, text: "original", getText() { return this.text; },
    lineCount: 1, lineAt: () => ({ rangeIncludingLineBreak: { end: {} } }),
    async save() { events.push("save"); return true; },
  };
  const vscode = { window: { showErrorMessage: async text => errors.push(text) },
    Position: class {}, Range: class {},
    WorkspaceEdit: class { replace(_uri, _range, text) { this.text = text; } },
    workspace: { applyEdit: async edit => {
      events.push("apply"); document.text = edit.text; document.version++; return true;
    } },
  };
  vm.runInNewContext(fs.readFileSync(extensionPath, "utf8"), {
    module, require: id => id === "vscode" ? vscode : localRequire(id),
  });
  const provider = new module.exports.MarkdownInlineProvider({
    globalState: { get: () => undefined }, workspaceState: { get: () => ({}) },
  });
  provider.flushDocument = async () => { events.push("flush"); document.text = "latest draft"; document.version++; };
  return { provider, document, events, errors, queue: new DocumentQueue(), vscode, exports: module.exports };
}

test("cleanup flushes the latest draft, applies an undoable edit, and saves", async () => {
  assert.deepEqual(parseEditorMessage({type: "cleanup"}), {type: "cleanup"});
  const f = fixture();
  await f.provider.cleanup(f.document, f.queue);
  assert.equal(f.document.text, "latest draft\n");
  assert.deepEqual(f.events, ["flush", "apply", "save"]);
  f.events.length = 0;
  f.provider.flushDocument = async () => {};
  await f.provider.cleanup(f.document, f.queue);
  assert.deepEqual(f.events, ["save"]);
});

test("cleanup saves YAML indentation unchanged through the document edit path", async () => {
  const f = fixture();
  const prefix = '---\nmetadata:\n  category: FRONTEND\n  last_reviewed: "2026-09-17"\n---\n';
  f.provider.flushDocument = async () => { f.document.text = prefix + "\n Title  \n\n\n Body  "; };
  await f.provider.cleanup(f.document, f.queue);
  assert.equal(f.document.text, prefix + " Title\n\n Body\n");
  assert.deepEqual(f.events, ["apply", "save"]);
  assert.deepEqual(f.errors, []);
});

test("cleanup preserves drafts on flush failure", async () => {
  const f = fixture();
  f.provider.flushDocument = async () => { throw new Error("Draft conflict"); };
  await f.provider.cleanup(f.document, f.queue);
  assert.equal(f.document.text, "original");
  assert.deepEqual(f.events, []);
  assert.equal(f.errors.length, 1);
});

test("File Actions preparation flushes only the requested Inline document and propagates conflicts", async () => {
  const f = fixture();
  let provider;
  f.vscode.commands = { registerCommand: () => ({dispose() {}}) };
  f.vscode.window.onDidChangeTextEditorSelection = () => ({dispose() {}});
  f.vscode.window.registerCustomEditorProvider = (_type, value) => {provider = value; return {dispose() {}};};
  f.vscode.workspace.onWillSaveTextDocument = () => ({dispose() {}});
  const api = f.exports.activate({subscriptions: [], globalState: {get: () => undefined}, workspaceState: {get: () => ({})}});
  provider.panelDocuments.set({}, f.document);
  let flushed = 0;
  provider.flushDocument = async document => {assert.equal(document, f.document); flushed++;};
  await api.prepareCopy({toString: () => "file:///other.md"});
  assert.equal(flushed, 0);
  await api.prepareCopy(f.document.uri);
  assert.equal(flushed, 1);
  provider.flushDocument = async () => {throw new Error("Draft retained");};
  await assert.rejects(api.prepareCopy(f.document.uri), /Draft retained/);
});
