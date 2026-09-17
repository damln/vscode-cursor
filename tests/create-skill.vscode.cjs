const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createSkill} = require('../extensions/minimal-theme/create-skill');

exports.run = async () => {
  const root = process.env.CREATE_SKILL_TEST_ROOT;
  assert.ok(root, 'Set CREATE_SKILL_TEST_ROOT to a task directory');
  const extension = vscode.extensions.getExtension('damln.minimal-theme');
  assert.ok(extension);
  await extension.activate();
  assert.ok((await vscode.commands.getCommands()).includes('damlnMinimalTheme.createSkill'));
  const errors = [];
  const api = {
    Uri: vscode.Uri, WorkspaceEdit: vscode.WorkspaceEdit, FileType: vscode.FileType,
    workspace: vscode.workspace, commands: vscode.commands,
    window: {
      showInputBox: async () => 'Review Code',
      showQuickPick: async choices => choices[0],
      showErrorMessage: async error => errors.push(error),
    },
  };
  const uri = await createSkill(api);
  assert.deepEqual(errors, []);
  assert.equal(uri.fsPath, path.join(root, 'skills', 'review-code', 'SKILL.md'));
  const content = fs.readFileSync(uri.fsPath, 'utf8');
  assert.match(content, /^---\nname: review-code\n/);
  assert.equal(content.split('\n---\n')[1], '\n# Review code\n');
  assert.equal(vscode.window.activeTextEditor.document.uri.toString(), uri.toString());
  assert.equal(vscode.window.activeTextEditor.document.isDirty, false);
  assert.equal(await createSkill(api), undefined);
  assert.equal(errors.length, 1);
  assert.equal(fs.readFileSync(uri.fsPath, 'utf8'), content);
  fs.mkdirSync(path.join(root, 'skills', 'team'));
  api.window.showQuickPick = async choices => {
    assert.deepEqual(choices.map(choice => choice.label), ['skills', 'skills/review-code', 'skills/team']);
    return choices[2];
  };
  const nested = await createSkill(api);
  assert.equal(nested.fsPath, path.join(root, 'skills', 'team', 'review-code', 'SKILL.md'));
  assert.equal(fs.readFileSync(nested.fsPath, 'utf8'), content);
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({passed: true}));
  console.log('PASS: missing skills folder creation, immediate subfolder picker, saved H1-only template, source editor, collision protection');
};
