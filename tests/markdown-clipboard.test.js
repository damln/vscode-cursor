const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const test = require("node:test");

const extensionPath = path.join(__dirname, "../extensions/markdown-inline/extension.js");
function uri(value) {
  const url = new URL(value);
  return { path: url.pathname, fsPath: decodeURIComponent(url.pathname), toString: () => url.href };
}

for (const [name, file, root, expected] of [
  ["nested local file", "file:///work/docs/readme.md", "file:///work", "docs"],
  ["workspace root", "file:///work/readme.md", "file:///work", "."],
  ["Remote SSH file", "vscode-remote://ssh-remote+dev/work/docs/readme.md", "vscode-remote://ssh-remote+dev/work", "docs"],
  ["outside workspace", "file:///other/my%20docs/readme.md", null, "/other/my docs"],
]) {
  test(`copies parent folder for ${name}`, async () => {
    let receive;
    let fail = false;
    const copied = [];
    const replies = [];
    const vscode = {
      Uri: { joinPath: (base, part) => uri(new URL(path.posix.join(base.path, part), base.toString()).href) },
      workspace: {
        getWorkspaceFolder: () => root ? { uri: uri(root) } : undefined,
        asRelativePath: target => path.posix.relative(uri(root).path, target.path),
        onDidSaveTextDocument: () => ({ dispose() {} }),
        onDidChangeTextDocument: () => ({ dispose() {} }),
      },
      env: { clipboard: { writeText: async value => { if (fail) throw new Error('Clipboard unavailable'); copied.push(value); } } },
      window: { showErrorMessage: async () => {} },
    };
    const localRequire = createRequire(extensionPath);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(extensionPath, "utf8"), {
      module, require: id => id === "vscode" ? vscode : localRequire(id),
    });
    const provider = new module.exports.MarkdownInlineProvider({
      extensionUri: uri("file:///extension"), globalState: { get() {} },
      workspaceState: { get: (_key, fallback) => fallback, update: async () => {} },
    });
    provider.webviewHtml = () => "";
    await provider.resolveCustomTextEditor({ uri: uri(file), getText: () => "content" }, {
      onDidDispose() {},
      onDidChangeViewState() { return { dispose() {} }; },
      webview: {
        onDidReceiveMessage: handler => { receive = handler; },
        postMessage: async message => replies.push(message),
      },
    });
    await receive({ type: "copyFolderPath", path: "/ignored", requestId: "copy-1" });
    assert.deepEqual(copied, [expected]);
    assert.equal(replies[0].target, "folderPath");
    assert.equal(replies[0].type, "copyComplete");
    assert.equal(replies[0].requestId, "copy-1");
    await receive({ type: "copyDocument" });
    assert.equal(copied[1], "content");
    await receive({ type: "copyPath" });
    assert.equal(copied[2], root
      ? path.posix.relative(uri(root).path, uri(file).path) : uri(file).fsPath);
    const code = "  const message = 'é 👩‍💻';\n\tconsole.log(message);\n";
    await receive({type: 'copyCode', requestId: 'block-1', text: code});
    assert.equal(copied.at(-1), code);
    assert.equal(replies.at(-1).type, 'copyCodeResult');
    assert.equal(replies.at(-1).requestId, 'block-1');
    assert.equal(replies.at(-1).success, true);
    fail = true;
    await receive({type: 'copyCode', requestId: 'block-2', text: code});
    assert.equal(replies.at(-1).success, false);
    assert.equal(replies.at(-1).requestId, 'block-2');
    for (const [type, target] of [['copyDocument', 'document'], ['copyPath', 'path'], ['copyFolderPath', 'folderPath']]) {
      await receive({type, requestId: 'failed-copy'});
      assert.equal(replies.at(-1).type, 'copyFailed');
      assert.equal(replies.at(-1).target, target);
      assert.equal(replies.at(-1).requestId, 'failed-copy');
    }
  });
}

test('code copy messages require text and a bounded correlation ID', () => {
  const {parseEditorMessage} = require('../extensions/markdown-inline/document-sync');
  for (const value of [
    {text: 'code'}, {text: 'code', requestId: ''}, {text: 'code', requestId: 'x'.repeat(129)},
    {text: 42, requestId: 'id'}, {text: 'code', requestId: 42},
  ]) assert.equal(parseEditorMessage({type: 'copyCode', ...value}), null);
  assert.deepEqual(parseEditorMessage({type: 'copyCode', text: '', requestId: 'id', extra: 'ignored'}),
    {type: 'copyCode', text: '', requestId: 'id'});
});
