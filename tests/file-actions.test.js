const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

class Uri {
  constructor(scheme, pathname) { this.scheme = scheme; this.path = pathname; this.fsPath = pathname; }
  toString() { return `${this.scheme}://${this.path}`; }
  with(changes) { return Object.assign(new Uri(this.scheme, this.path), changes); }
  static parse(value) { const url = new URL(value); return new Uri(url.protocol.slice(0,-1), url.pathname); }
  static joinPath(uri, suffix) { return uri.with({path: path.posix.join(uri.path, suffix), fsPath: path.posix.join(uri.path, suffix)}); }
}

function harness() {
  const commands = new Map(), copied = [], opened = [], errors = [], statuses = [];
  const file = new Uri("file", "/work/read me.txt");
  const browserUrls = [], external = [];
  class BrowserPreview { async url(file, root) {browserUrls.push({file,root});return "http://127.0.0.1:1234/token/index.html";} dispose() {} }
  const vscode = {
    Uri,
    extensions: {getExtension: () => undefined},
    commands: {registerCommand(id, callback) {commands.set(id, callback);return {dispose() {}};}},
    env: {openExternal: async uri => {external.push(uri); return true;}, clipboard: {async writeText(value) {copied.push(value);}}},
    workspace: {
      isTrusted: true,
      notebookDocuments: [],
      getWorkspaceFolder: () => ({uri: new Uri("file", "/work")}),
      asRelativePath: uri => path.posix.relative("/work", uri.path),
      async openTextDocument(uri) {opened.push(uri); return {getText: () => "Unsaved café\r\n  text\r\n"};},
    },
    window: {
      tabGroups: {activeTabGroup: {activeTab: {input: {uri: file}}}},
      activeTextEditor: {document: {uri: new Uri("file", "/wrong.txt")}},
      setStatusBarMessage: text => statuses.push(text),
      showErrorMessage: text => errors.push(text),
      showInformationMessage: text => errors.push(text),
    },
  };
  const mod = {exports: {}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../extensions/file-actions/extension.js"), "utf8"), {module: mod, require: id => id === "./browser-preview" ? {BrowserPreview} : vscode});
  mod.exports.activate({subscriptions: []});
  return {vscode, file, browserUrls, external, copied, opened, errors, statuses, run: (action, uri) => commands.get(`damlnFileActions.${action}`)(uri)};
}

test("copies the clicked group's current content, independent of the active text editor", async () => {
  const h = harness(), other = new Uri("file", "/work/other.txt");
  assert.equal(await h.run("copyContent", other), true);
  assert.equal(h.opened[0], other);
  assert.deepEqual(h.copied, ["Unsaved café\r\n  text\r\n"]);
  assert.equal(h.statuses.length, 1);
});

test("HTML preview actions use its URI even when a stale native editor exists", async () => {
  const h = harness(), html = new Uri("file", "/work/site/index.html");
  h.vscode.window.tabGroups.activeTabGroup.activeTab.input = {uri: html, viewType: "damln.htmlPreview"};
  await h.run("copyContent"); await h.run("copyFilePath"); await h.run("copyParentFolderPath");
  assert.equal(h.opened[0], html);
  assert.deepEqual(h.copied.slice(1), ["site/index.html", "site"]);
});

test("diff actions target the modified file", async () => {
  const h = harness(), modified = new Uri("file", "/work/new.txt");
  h.vscode.window.tabGroups.activeTabGroup.activeTab.input = {original: h.file, modified};
  await h.run("copyContent"); assert.equal(h.opened[0], modified);
});

test("copies root, remote and outside-workspace paths", async () => {
  const h = harness();
  await h.run("copyParentFolderPath"); assert.equal(h.copied.pop(), ".");
  h.vscode.workspace.getWorkspaceFolder = () => undefined;
  const remote = new Uri("vscode-remote", "/home/me/é file.py"); remote.fsPath = "\\wrong\\host";
  await h.run("copyFilePath", remote); assert.equal(h.copied.pop(), remote.path);
  await h.run("copyParentFolderPath", remote); assert.equal(h.copied.pop(), "/home/me");
  await h.run("copyFilePath", h.file); assert.equal(h.copied.pop(), h.file.fsPath);
});

test("untitled content is copyable but cannot pretend to have a file path", async () => {
  const h = harness(), untitled = new Uri("untitled", "Untitled-1");
  await h.run("copyContent", untitled); assert.equal(h.copied.length, 1);
  assert.equal(await h.run("copyFilePath", untitled), false);
  assert.equal(h.copied.length, 1); assert.match(h.errors[0], /Save the file first/);
});

test("empty files copy an empty string", async () => {
  const h = harness(); h.vscode.workspace.openTextDocument = async () => ({getText: () => ""});
  await h.run("copyContent"); assert.deepEqual(h.copied, [""]);
});

test("unsupported tabs do not copy a stale background editor", async () => {
  const h = harness(); h.vscode.window.tabGroups.activeTabGroup.activeTab.input = {viewType: "terminal"};
  assert.equal(await h.run("copyContent"), false); assert.equal(h.copied.length, 0);
});

test("binary/read failures and clipboard failures cannot report success", async () => {
  const h = harness(); h.vscode.workspace.openTextDocument = async () => {throw new Error("Binary file");};
  assert.equal(await h.run("copyContent"), false); assert.equal(h.copied.length, 0);
  h.vscode.env.clipboard.writeText = async () => {throw new Error("Clipboard unavailable");};
  assert.equal(await h.run("copyFilePath"), false);
  assert.equal(h.statuses.length, 0); assert.equal(h.errors.length, 2);
});

test("dirty notebooks cannot silently copy older disk content", async () => {
  const h = harness(); h.vscode.workspace.notebookDocuments = [{uri: h.file, isDirty: true}];
  assert.equal(await h.run("copyContent"), false); assert.equal(h.opened.length, 0);
  await h.run("copyFilePath"); assert.equal(h.copied[0], "read me.txt");
});


test("Markdown Inline content waits for pending visual edits", async () => {
  const h = harness(), uri = new Uri("file", "/work/notes/draft.md");
  h.vscode.window.tabGroups.activeTabGroup.activeTab.input = {uri, viewType: "damln.markdownInline"};
  let release;
  h.vscode.extensions.getExtension = () => ({isActive: true, exports: {
    prepareCopy: async target => {assert.equal(target, uri); await new Promise(resolve => {release = resolve;});}
  }});
  const copying = h.run("copyContent");
  assert.equal(h.opened.length, 0); assert.equal(h.copied.length, 0);
  release(); await copying;
  assert.equal(h.opened[0], uri);
  assert.equal(h.copied[0], "Unsaved café\r\n  text\r\n");
  await h.run("copyFilePath"); await h.run("copyParentFolderPath");
  assert.deepEqual(h.copied.slice(1), ["notes/draft.md", "notes"]);
});

test("a conflicting Markdown draft or old Inline version cannot copy stale content", async () => {
  const h = harness();
  h.vscode.window.tabGroups.activeTabGroup.activeTab.input.viewType = "damln.markdownInline";
  assert.equal(await h.run("copyContent"), false);
  h.vscode.extensions.getExtension = () => ({isActive: true, exports: {
    prepareCopy: async () => {throw new Error("Resolve the retained draft first");}
  }});
  assert.equal(await h.run("copyContent"), false);
  assert.equal(h.copied.length, 0); assert.equal(h.opened.length, 0);
  assert.match(h.errors[1], /retained draft/);
});

test("paths use the file's workspace root in multi-root and Remote SSH workspaces", async () => {
  const h = harness(), uri = new Uri("vscode-remote", "/projects/second/docs/read me.md");
  h.vscode.workspace.getWorkspaceFolder = target => {
    assert.equal(target, uri); return {uri: new Uri("vscode-remote", "/projects/second")};
  };
  h.vscode.workspace.asRelativePath = (target, includeWorkspace) => {
    assert.equal(includeWorkspace, false);
    return path.posix.relative("/projects/second", target.path);
  };
  await h.run("copyFilePath", uri); await h.run("copyParentFolderPath", uri);
  assert.deepEqual(h.copied, ["docs/read me.md", "docs"]);
});


test("browser action uses the selected HTML file and starts a browser URL", async () => {
  const h = harness(), uri = new Uri("file", "/work/site/page.htm");
  h.vscode.window.tabGroups.activeTabGroup.activeTab.input = {uri, viewType:"damln.htmlPreview"};
  assert.equal(await h.run("openInBrowser"), true);
  assert.deepEqual(h.browserUrls, [{file:"/work/site/page.htm",root:"/work"}]);
  assert.equal(h.external[0].scheme,"http");
});

test("browser action rejects unsupported files, remote paths and untrusted workspaces", async () => {
  const h = harness();
  assert.equal(await h.run("openInBrowser", h.file),false);
  assert.equal(await h.run("openInBrowser",new Uri("vscode-remote","/work/index.html")),false);
  h.vscode.workspace.isTrusted=false;
  assert.equal(await h.run("openInBrowser",new Uri("file","/work/index.html")),false);
  assert.equal(h.browserUrls.length,0);assert.equal(h.external.length,0);
});

test("browser action respects cancelled or failed saves and opener failures", async () => {
  const h=harness(), uri=new Uri("file","/work/index.html");let saves=0;
  h.vscode.workspace.openTextDocument=async()=>({isDirty:true,save:async()=>{saves++;return false;}});
  h.vscode.window.showInformationMessage=async()=>"Cancel";
  assert.equal(await h.run("openInBrowser",uri),false);assert.equal(saves,0);
  h.vscode.window.showInformationMessage=async()=>"Save and open";
  assert.equal(await h.run("openInBrowser",uri),false);assert.equal(saves,1);
  assert.equal(h.browserUrls.length,0);
  h.vscode.workspace.openTextDocument=async()=>({isDirty:true,save:async()=>true});
  h.vscode.env.openExternal=async()=>false;
  assert.equal(await h.run("openInBrowser",uri),false);assert.match(h.errors.at(-1),/could not be opened/);
});
