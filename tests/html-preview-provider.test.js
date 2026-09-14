const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

class Uri {
  constructor(pathname, scheme = 'file') {this.path = pathname; this.scheme = scheme;}
}
function harness() {
  const commands = [], errors = [], registered = new Map();
  const uri = new Uri('/work/read me.html');
  const document = {isDirty: false, save: async () => true};
  const vscode = {
    Uri,
    commands: {
      getCommands: async () => ['workbench.action.browser.openFile'],
      executeCommand: async (...args) => commands.push(args),
      registerCommand: (name, callback) => {registered.set(name, callback); return {dispose() {}};},
    },
    window: {
      tabGroups: {activeTabGroup: {activeTab: {input: {uri}}}},
      activeTextEditor: {document: {uri: new Uri('/wrong.html')}},
      showErrorMessage: async message => errors.push(message),
      showInformationMessage: async () => 'Save and open',
    },
    workspace: {isTrusted: true, openTextDocument: async () => document},
  };
  const mod = {exports: {}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../extensions/html-preview/extension.js'), 'utf8'), {
    module: mod, require: () => vscode,
  });
  mod.exports.activate({subscriptions: []});
  return {uri, document, vscode, commands, errors, run: resource => registered.get('damlnHtmlPreview.openPreview')(resource)};
}

test('HTML shortcut delegates the exact local URI to the native browser', async () => {
  const h = harness();
  assert.equal(await h.run(), true);
  assert.equal(h.commands[0][0], 'workbench.action.browser.openFile');
  assert.equal(h.commands[0][1], h.uri);
  const clicked = new Uri('/other/Café #1.HTM');
  assert.equal(await h.run(clicked), true);
  assert.equal(h.commands[1][1], clicked, 'clicked editor wins over the active editor');
  assert.deepEqual(h.errors, []);
});

test('native browser shortcut respects save, cancel and save failure', async () => {
  for (const choice of ['Save and open', 'Cancel', undefined]) {
    const h = harness(); h.document.isDirty = true;
    let saved = false;
    h.document.save = async () => {saved = true; return true;};
    h.vscode.window.showInformationMessage = async () => choice;
    assert.equal(await h.run(), choice === 'Save and open');
    assert.equal(saved, choice === 'Save and open');
    assert.equal(h.commands.length, choice === 'Save and open' ? 1 : 0);
  }
  const h = harness(); h.document.isDirty = true; h.document.save = async () => false;
  assert.equal(await h.run(), false); assert.equal(h.commands.length, 0);
});

test('unsupported hosts, untrusted workspaces and remote paths never start a custom preview', async () => {
  for (const change of [
    h => {h.vscode.commands.getCommands = async () => [];},
    h => {h.vscode.workspace.isTrusted = false;},
    h => {h.uri.scheme = 'vscode-remote';},
    h => {h.uri.path = '/work/test.md';},
    h => {h.vscode.workspace.openTextDocument = async () => {throw new Error('File not found');};},
  ]) {
    const h = harness(); change(h);
    assert.equal(await h.run(), false);
    assert.equal(h.commands.length, 0); assert.equal(h.errors.length, 1);
  }
});

test('HTML extension owns no renderer or duplicate title action, and external browser has a distinct icon', () => {
  const root = path.resolve(__dirname, '../extensions');
  const html = JSON.parse(fs.readFileSync(path.join(root, 'html-preview/package.json')));
  const actions = JSON.parse(fs.readFileSync(path.join(root, 'file-actions/package.json')));
  assert.equal(html.contributes.customEditors, undefined);
  assert.equal(html.contributes.menus['editor/title'], undefined);
  assert.equal(html.files.includes('preview-html.js'), false);
  assert.equal(html.files.includes('navigation.js'), false);
  const external = actions.contributes.commands.find(c => c.command === 'damlnFileActions.openInBrowser');
  assert.equal(external.icon, '$(link-external)');
});
