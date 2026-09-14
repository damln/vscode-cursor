const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {GitBaseline} = require('../extensions/markdown-inline/git-baseline');

exports.run = async () => {
  const root = process.env.MARKDOWN_INLINE_TEST_ROOT;
  assert.ok(root, 'Set MARKDOWN_INLINE_TEST_ROOT to an isolated test directory');
  const directory = path.join(root, 'repository');
  const uri = vscode.Uri.file(path.join(directory, 'note.md'));
  const messages = [];
  const tracker = new GitBaseline(vscode, uri, message => messages.push(message));
  const waitFor = async predicate => {
    const end = Date.now() + 15000;
    while (!predicate() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(predicate(), 'Timed out waiting for Git baseline');
  };
  try {
    const extension = vscode.extensions.getExtension('vscode.git');
    const git = (await extension.activate()).getAPI(1);
    const repository = await git.openRepository(vscode.Uri.file(directory));
    assert.ok(repository);
    await tracker.start();
    await waitFor(() => messages.at(-1)?.text === '# Committed\n');
    fs.writeFileSync(uri.fsPath, '# Updated\n');
    await repository.status();
    const gitCommand = args => execFileSync('git', ['-c', 'user.name=Extension Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], {cwd: directory});
    gitCommand(['add', 'note.md']); gitCommand(['commit', '-m', 'Update fixture']);
    await repository.status();
    await waitFor(() => messages.at(-1)?.text === '# Updated\n');
    fs.writeFileSync(path.join(root, 'git-native-result.json'), JSON.stringify({passed: true, checks: ['built-in Git API', 'HEAD content', 'commit updates']}));
  } catch (error) {
    fs.writeFileSync(path.join(root, 'git-native-result.json'), JSON.stringify({passed: false, error: String(error.stack)}));
    throw error;
  } finally { tracker.dispose(); }
};
