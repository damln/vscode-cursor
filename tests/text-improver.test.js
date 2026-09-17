const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const test = require("node:test");
const { findTextImprover, runTextImprover } = require("../extensions/markdown-inline/text-improver");
const { DocumentQueue, parseEditorMessage } = require("../extensions/markdown-inline/document-sync");
const { cleanupMarkdown } = require("../extensions/markdown-inline/markdown-model");

test("cleanup trims every line, collapses blank lines, and leaves a final empty line", () => {
  for (const [source, expected] of [
    [" \n\n  # Title  \n \t\n\n text \t\n\n\n", "# Title\n\ntext\n"],
    ["\r\n  one \r\n\r\n \t\r\n two\r\n", "one\r\n\r\ntwo\r\n"],
    ["", "\n"], [" \t\n\n", "\n"],
    ["- first\n\n- second", "- first\n\n- second\n"],
    ["  code  \n\n\n  more  ", "code\n\nmore\n"],
  ]) {
    assert.equal(cleanupMarkdown(source), expected);
    assert.equal(cleanupMarkdown(expected), expected);
  }
});

test("discovers the skill only in trusted local workspace roots", () => {
  const scratch = path.resolve(__dirname, "../_tmp/markdown-improver-validation");
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, "improver-"));
  const folder = { uri: { scheme: "file", fsPath: root } };
  const document = { scheme: "file", fsPath: "/outside workspace/note.md" };
  const directory = path.join(root, "skills/shared/custom/custom-cli-tools/scripts");
  try {
    fs.mkdirSync(path.join(directory, "text-improver"), { recursive: true });
    fs.writeFileSync(path.join(directory, "apps"), "");
    fs.writeFileSync(path.join(directory, "text-improver/main.py"), "");
    const missing = { uri: { scheme: "file", fsPath: path.join(root, "missing") } };
    const incomplete = { uri: { scheme: "file", fsPath: path.join(root, "incomplete") } };
    const incompleteScripts = path.join(incomplete.uri.fsPath, "skills/shared/custom/custom-cli-tools/scripts");
    fs.mkdirSync(incompleteScripts, { recursive: true });
    fs.writeFileSync(path.join(incompleteScripts, "apps"), "");
    assert.equal(findTextImprover([missing], document, true), null);
    assert.equal(findTextImprover([incomplete], document, true), null);
    assert.deepEqual(findTextImprover([folder], document, true), { script: path.join(directory, "apps"), cwd: root });
    assert.equal(findTextImprover([folder], document, false), null);
    assert.equal(findTextImprover([folder], { scheme: "vscode-remote" }, true), null);
    assert.equal(findTextImprover([{ uri: { scheme: "vscode-remote" } }], document, true), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("runs Python without a shell, preserving spaces and shell metacharacters", async () => {
  const tool = { script: "/workspace with spaces/apps", cwd: "/workspace with spaces" };
  const file = "/notes/$(touch nope) '中文'.md";
  const result = await runTextImprover(tool, file, { execute(command, args, options, done) {
    assert.equal(command, "python3");
    assert.deepEqual(args, [
      tool.script, "text-improver", file,
      "--provider", "codex",
      "--timeout", "120",
    ]);
    assert.equal(options.shell, undefined);
    assert.equal(options.timeout, 120000);
    assert.equal(options.killSignal, "SIGKILL");
    done(null, "# Corrected\n", "");
  } });
  assert.equal(result, "# Corrected\n");
});

test("rejects timeouts, process errors, cancellation, and empty output", async () => {
  for (const [error, stdout, stderr, expected] of [
    [{ killed: true }, "partial", "", /timed out/],
    [{ message: "missing python" }, "", "", /missing python/],
    [{ message: "exit 1" }, "partial", "Codex unavailable", /Codex unavailable/],
    [{ name: "AbortError" }, "", "", /cancelled/],
    [null, " \n", "", /empty response/],
  ]) {
    await assert.rejects(runTextImprover({ script: "apps", cwd: "/workspace" }, "note.md", {
      execute: (_command, _args, _options, done) => done(error, stdout, stderr),
    }), expected);
  }
});

test("kills a real stalled process at the deadline", async () => {
  const { execFile } = require("node:child_process");
  const started = Date.now();
  await assert.rejects(runTextImprover({ script: "unused", cwd: process.cwd() }, "note.md", {
    timeout: 50,
    execute: (_command, _args, options, done) => execFile(process.execPath,
      ["-e", "setInterval(() => {}, 1000)"], options, done),
  }), /timed out/);
  assert.ok(Date.now() - started < 3000);
});

function fixture(run) {
  const extensionPath = path.join(__dirname, "../extensions/markdown-inline/extension.js");
  const localRequire = createRequire(extensionPath);
  const module = { exports: {} };
  const events = [], states = [], errors = [];
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
    module, AbortController, require: id => id === "vscode" ? vscode
      : id === "./text-improver" ? { runTextImprover: (...args) => { events.push("run"); return run(document, ...args); } }
      : localRequire(id),
  });
  const provider = new module.exports.MarkdownInlineProvider({
    globalState: { get: () => undefined }, workspaceState: { get: () => ({}) },
  });
  provider.textImprover = () => ({ script: "apps", cwd: "/workspace" });
  provider.sendImprovementState = async () => states.push(provider.improvements.has(document.uri.toString()));
  provider.flushDocument = async () => { events.push("flush"); document.text = "latest draft"; document.version++; };
  return { provider, document, events, states, errors, queue: new DocumentQueue(), vscode, exports: module.exports };
}

test("Command Palette correction uses the active inline document and its existing queue", async () => {
  const f = fixture(async () => "unused");
  const commands = new Map();
  let provider;
  f.vscode.commands = { registerCommand(id, callback) { commands.set(id, callback); return { dispose() {} }; } };
  f.vscode.window.onDidChangeTextEditorSelection = () => ({ dispose() {} });
  f.vscode.window.registerCustomEditorProvider = (_type, value) => { provider = value; return { dispose() {} }; };
  f.vscode.workspace.onWillSaveTextDocument = () => ({ dispose() {} });
  f.exports.activate({ subscriptions: [], globalState: { get: () => undefined }, workspaceState: { get: () => ({}) } });
  const commandId = "damlnMarkdownInline.correctText";
  const run = commands.get(commandId);
  assert.equal(typeof run, "function");
  let calls = 0;
  provider.improveText = async (document, queue) => {
    calls++;
    assert.equal(document, f.document);
    assert.equal(queue, f.queue);
  };
  const inactive = { active: false }, active = { active: true };
  provider.panels.add(inactive);
  provider.panelDocuments.set(inactive, { uri: { toString: () => "file:///other.md" } });
  await run();
  assert.equal(calls, 0);
  provider.panels.add(active);
  provider.panelDocuments.set(active, f.document);
  provider.documentQueues.set(f.document.uri.toString(), f.queue);
  await run();
  assert.equal(calls, 1);
  const manifest = require("../extensions/markdown-inline/package.json");
  const entry = manifest.contributes.commands.find(value => value.command === commandId);
  assert.equal(entry.title, "Correct Text");
  assert.equal(entry.category, "Markdown Inline");
  assert.equal(entry.enablement, "activeCustomEditorId == damln.markdownInline");
  assert.ok(manifest.activationEvents.includes(`onCommand:${commandId}`));
});

test("flushes before invoking the CLI and saves an undoable replacement to the same file", async () => {
  assert.deepEqual(parseEditorMessage({ type: "improveText" }), { type: "improveText" });
  const f = fixture(async document => { assert.equal(document.text, "latest draft"); return "improved"; });
  await f.provider.improveText(f.document, f.queue);
  assert.equal(f.document.text, "improved");
  assert.deepEqual(f.events, ["flush", "save", "run", "apply", "save"]);
  assert.deepEqual(f.states, [true, false]);
  assert.deepEqual(f.errors, []);
});

test("cleanup flushes the latest draft, applies an undoable edit, and saves without AI", async () => {
  assert.deepEqual(parseEditorMessage({type: "cleanup"}), {type: "cleanup"});
  const f = fixture(async () => { throw new Error("AI must not run"); });
  await f.provider.cleanup(f.document, f.queue);
  assert.equal(f.document.text, "latest draft\n");
  assert.deepEqual(f.events, ["flush", "apply", "save"]);
  f.events.length = 0;
  f.provider.flushDocument = async () => {};
  await f.provider.cleanup(f.document, f.queue);
  assert.deepEqual(f.events, ["save"]);
});

test("cleanup preserves drafts on flush failure and refuses to race an improvement", async () => {
  const f = fixture(async () => "unused");
  f.provider.flushDocument = async () => { throw new Error("Draft conflict"); };
  await f.provider.cleanup(f.document, f.queue);
  assert.equal(f.document.text, "original");
  assert.deepEqual(f.events, []);
  assert.equal(f.errors.length, 1);
  f.provider.improvements.set(f.document.uri.toString(), {});
  await f.provider.cleanup(f.document, f.queue);
  assert.equal(f.errors.length, 1);
});

test("preserves concurrent edits and unlocks after failures", async () => {
  for (const run of [
    async () => { throw new Error("Ollama timed out"); },
    async document => { document.text = "external edit"; document.version++; return "obsolete"; },
  ]) {
    const f = fixture(run);
    await f.provider.improveText(f.document, f.queue);
    assert.equal(f.events.includes("apply"), false);
    assert.equal(f.errors.length, 1);
    assert.deepEqual(f.states, [true, false]);
    assert.equal(f.provider.improvements.size, 0);
  }
});

test("ignores duplicate clicks and does not run after a failed save", async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const first = f.provider.improveText(f.document, f.queue);
  await f.provider.improveText(f.document, f.queue);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  finish("improved"); await first;
  assert.equal(f.events.filter(event => event === "run").length, 1);
  const failed = fixture(async () => "unused");
  failed.document.save = async () => false;
  await failed.provider.improveText(failed.document, failed.queue);
  assert.equal(failed.events.includes("run"), false);
  assert.deepEqual(failed.states, [true, false]);
});


test("File Actions preparation flushes only the requested Inline document and propagates conflicts", async () => {
  const f = fixture(async () => "unused");
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
