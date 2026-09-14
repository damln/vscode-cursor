import assert from 'node:assert/strict';
import test from 'node:test';
import {gitChanges} from '../src/lib/git-changes';

test('Git changes distinguish additions, edits and deleted boundaries', () => {
  assert.deepEqual(gitChanges('A\nB\nC\nD\n', 'A\nnew\nB\nchanged\n'), [
    {kind: 'added', from: 2, to: 6, added: 1, removed: 0},
    {kind: 'modified', from: 8, to: 16, added: 1, removed: 2},
  ]);
  assert.deepEqual(gitChanges('A\nB\nC\n', 'A\nC\n'), [
    {kind: 'deleted', from: 2, to: 2, added: 0, removed: 1},
  ]);
});
test('CRLF offsets and metadata use the complete authored source', () => {
  assert.deepEqual(gitChanges('---\r\ntitle: Old\r\n---\r\n# Same\r\n', '---\r\ntitle: New\r\n---\r\n# Same\r\n'), [
    {kind: 'modified', from: 5, to: 17, added: 1, removed: 1},
  ]);
  assert.deepEqual(gitChanges('same\n', 'same\r\n'), []);
});
test('new, emptied and unchanged files have accurate markers', () => {
  assert.deepEqual(gitChanges('', '# Note\n'), [{kind: 'added', from: 0, to: 7, added: 1, removed: 0}]);
  assert.deepEqual(gitChanges('# Note\n', ''), [{kind: 'deleted', from: 0, to: 0, added: 0, removed: 1}]);
  assert.deepEqual(gitChanges('same', 'same'), []);
  assert.equal(gitChanges('same\n', 'same')[0].kind, 'modified');
});
