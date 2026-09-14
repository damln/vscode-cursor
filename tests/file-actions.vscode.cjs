const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

exports.run = async () => {
  assert.ok(process.env.FILE_ACTIONS_TEST_ROOT, 'Set FILE_ACTIONS_TEST_ROOT to a task directory');
  const root = process.env.FILE_ACTIONS_TEST_ROOT;
  fs.mkdirSync(root, {recursive: true});
  const originalClipboard = await vscode.env.clipboard.readText();
  const checks = [];
  const uri = name => vscode.Uri.file(path.join(root, name));
  const command = async (name, resource, expected) => {
    assert.equal(await vscode.commands.executeCommand('damlnFileActions.' + name, resource), true);
    assert.equal(await vscode.env.clipboard.readText(), expected);
  };
  try {
    const extension = vscode.extensions.getExtension('damln.file-actions');
    assert.ok(extension); await extension.activate();
    fs.writeFileSync(path.join(root, 'native.txt'), 'Saved text\n');
    const doc = await vscode.workspace.openTextDocument(uri('native.txt'));
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit(builder => builder.insert(new vscode.Position(0, 0), 'Unsaved café\r\n'));
    const selection = editor.selection;
    await command('copyContent', doc.uri, doc.getText());
    assert.equal(doc.isDirty, true); assert.equal(editor.selection, selection);
    checks.push('current unsaved text without save or selection change');
    const html = '<!doctype html><html><body><h1>HTML preview</h1></body></html>\n';
    fs.writeFileSync(path.join(root, 'page.html'), html);
    await vscode.commands.executeCommand('vscode.openWith', uri('page.html'), 'default');
    await command('copyContent', undefined, html);
    assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab.input.uri.toString(), uri('page.html').toString());
    checks.push('HTML source using the active editor');
    await command('copyFilePath', undefined, 'page.html');
    await command('copyParentFolderPath', undefined, '.');
    checks.push('HTML file and parent paths');
    await vscode.commands.executeCommand('vscode.openWith', uri('page.html'), 'workbench.editor.browser');
    assert.equal(await vscode.commands.executeCommand('damlnFileActions.editHtmlSource', uri('page.html')), true);
    assert.equal(vscode.window.activeTextEditor.document.uri.toString(), uri('page.html').toString());
    const htmlEditor = vscode.window.activeTextEditor;
    await htmlEditor.edit(builder => builder.insert(new vscode.Position(0, 0), '<!-- unsaved -->\n'));
    const dirtyHtml = htmlEditor.document.getText();
    await vscode.commands.executeCommand('vscode.openWith', uri('page.html'), 'workbench.editor.browser');
    assert.equal(await vscode.commands.executeCommand('damlnFileActions.editHtmlSource'), true);
    assert.equal(vscode.window.activeTextEditor.document.getText(), dirtyHtml);
    assert.equal(vscode.window.activeTextEditor.document.isDirty, true);
    checks.push('native browser title and palette source actions preserve unsaved HTML');
    await vscode.commands.executeCommand('workbench.action.files.revert');

    await command('copyContent', doc.uri, doc.getText());
    checks.push('explicit inactive-group resource');
    const untitled = await vscode.workspace.openTextDocument({content: 'Untitled content'});
    await command('copyContent', untitled.uri, 'Untitled content');
    checks.push('untitled text');
    await vscode.commands.executeCommand('vscode.diff', doc.uri, uri('page.html'));
    await command('copyContent', undefined, html);
    checks.push('diff modified side');
    await vscode.commands.executeCommand('vscode.openWith', uri('page.html'), 'default');
    fs.writeFileSync(path.join(root, 'native-result.json'), JSON.stringify({passed: true, checks, extensionPath: extension.extensionPath}));
    if (process.env.FILE_ACTIONS_UI_HOLD === '1') {
      const deadline = Date.now() + 120000;
      while (!fs.existsSync(path.join(root, 'ui-finished')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
    }
  } catch (error) {
    fs.writeFileSync(path.join(root, 'native-result.json'), JSON.stringify({passed: false, checks, error: String(error.stack)}));
    throw error;
  } finally {
    await vscode.env.clipboard.writeText(originalClipboard);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  }
};
