const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const vscode = require('vscode');

exports.run = async () => {
  const directory = process.env.MARKDOWN_INLINE_TEST_ROOT;
  assert.ok(directory, 'Set a disposable task directory');
  const extension = vscode.extensions.getExtension('damln.markdown-inline').extensionPath;
  const localRequire = createRequire(path.join(extension, 'extension.js'));
  let confirmation = () => 'Restore draft';
  const api = Object.create(vscode);
  Object.defineProperty(api, 'window', {value: Object.create(vscode.window)});
  Object.defineProperty(api.window, 'showWarningMessage', {value: async () => confirmation()});
  const module = {exports: {}};
  vm.runInNewContext(fs.readFileSync(path.join(extension, 'extension.js'), 'utf8'), {
    module, Buffer, setTimeout, clearTimeout, require: id => id === 'vscode' ? api : localRequire(id),
  });
  const provider = new module.exports.MarkdownInlineProvider({
    extensionUri: vscode.Uri.file(extension),
    storageUri: vscode.Uri.file(path.join(directory, 'backups')),
    globalState: {get: () => undefined}, workspaceState: {get: () => ({})},
  });
  const file = vscode.Uri.file(path.join(directory, 'workspace', 'recovery.md'));
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(file, '..'));
  await vscode.workspace.fs.writeFile(file, Buffer.from('# File\n'));
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document, {preview:false});
  const messages = [];
  const panel = {webview: {postMessage: async value => messages.push(value)}};
  const replace = async text => {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(file, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
  };
  const restore = async text => {
    const applied = await provider.restoreDraft(document, panel,
      {type: 'restoreDraft', text, version: document.version, requestId: String(messages.length)});
    if (applied === true) await provider.saveDocument(document, panel);
  };

  await restore('# Complete draft\n\nMissing rule restored.\n');
  assert.equal(document.getText(), '# Complete draft\n\nMissing rule restored.\n');
  assert.equal(Buffer.from(await vscode.workspace.fs.readFile(file)).toString(), document.getText());
  assert.equal(document.isDirty, false);
  assert.ok(messages.some(m => m.type === 'draftRestored'));
  const backups = fs.readdirSync(path.join(directory, 'backups', 'recovery'));
  assert.equal(backups.length, 1);
  const backup = path.join(directory, 'backups', 'recovery', backups[0]);
  assert.equal(fs.readFileSync(path.join(backup, 'file.md'), 'utf8'), '# File\n');
  assert.equal(fs.readFileSync(path.join(backup, 'draft.md'), 'utf8'), document.getText());

  confirmation = () => undefined;
  await restore('Cancelled');
  assert.ok(document.getText().includes('Missing rule'));
  assert.equal(messages.at(-1).status, 'error');

  confirmation = async () => { await replace('External edit during confirmation'); return 'Restore draft'; };
  await restore('Must not overwrite');
  assert.equal(document.getText(), 'External edit during confirmation');
  assert.equal(messages.at(-1).status, 'conflict');

  confirmation = () => 'Restore draft';
  const backupRecovery = provider.backupRecovery.bind(provider);
  provider.backupRecovery = async (...args) => {
    await backupRecovery(...args); await replace('External edit during backup');
  };
  await restore('Also must not overwrite');
  assert.equal(document.getText(), 'External edit during backup');
  assert.equal(messages.at(-1).status, 'conflict');

  provider.backupRecovery = async () => { throw new Error('Backup unavailable'); };
  await restore('No backup, no write');
  assert.equal(document.getText(), 'External edit during backup');
  assert.equal(messages.at(-1).status, 'error');
  provider.webviewHtml = () => '';
  let flushError = 'Retained draft requires recovery';
  const failingPanel = {active:false, onDidDispose(fn){this.dispose=fn;},
    onDidChangeViewState(){return {dispose(){}};}, webview:{
      onDidReceiveMessage(fn){failingPanel.receive=fn;},
      postMessage:async message => {
        if (message.type === 'flush') await failingPanel.receive({type:'flushComplete',flushId:message.flushId,error:flushError});
        return true;
      },
    }};
  await provider.resolveCustomTextEditor(document, failingPanel);
  await assert.rejects(provider.flushDocument(document), /Retained draft requires recovery/);
  flushError = undefined;
  assert.equal((await provider.flushDocument(document)).length, 0);
  failingPanel.dispose();
  await document.save();
  fs.writeFileSync(path.join(directory, 'native-result.txt'), 'PASS real WorkspaceEdit, save to disk, recovery backups, cancellation and concurrent edits\n');
};
