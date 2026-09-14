const test = require('node:test');
const assert = require('node:assert/strict');
const {GitBaseline} = require('../extensions/markdown-inline/git-baseline');

const uri = path => ({fsPath: path, toString: () => `file://${path}`});
function event() {
  const listeners = new Set();
  const subscribe = fn => {listeners.add(fn); return {dispose: () => listeners.delete(fn)};};
  subscribe.fire = () => listeners.forEach(fn => fn());
  return subscribe;
}
function fixture() {
  const messages = [], stateChange = event(), opened = event(), closed = event();
  const repository = {state: {indexChanges: [], workingTreeChanges: [], onDidChange: stateChange},
    show: async (ref, path) => {assert.equal(ref, 'HEAD'); assert.equal(path, '/repo/note.md'); return '# Committed\n';}};
  const api = {getRepository: () => repository, onDidOpenRepository: opened, onDidCloseRepository: closed};
  const tracker = new GitBaseline({extensions: {getExtension: () => ({activate: async () => ({getAPI: () => api})})}},
    uri('/repo/note.md'), message => messages.push(message));
  return {tracker, messages, repository, api, stateChange};
}
test('baseline uses HEAD and updates after Git state changes; disposal stops publishing', async () => {
  const f = fixture();
  await f.tracker.start(); await f.tracker.refresh();
  assert.equal(f.messages.at(-1).text, '# Committed\n');
  f.repository.show = async () => '# New commit\n';
  f.stateChange.fire(); await f.tracker.refresh();
  assert.equal(f.messages.at(-1).text, '# New commit\n');
  f.tracker.dispose(); await f.tracker.refresh();
  assert.equal(f.messages.length, 2);
});
test('untracked files use an empty baseline; missing repositories and failed reads clear it', async () => {
  const f = fixture(); await f.tracker.start();
  f.repository.state.workingTreeChanges = [{uri: uri('/repo/note.md'), status: 7}];
  await f.tracker.refresh(); assert.equal(f.messages.at(-1).text, '');
  f.repository.state.workingTreeChanges = [];
  f.repository.show = async () => {throw new Error('unavailable');};
  await f.tracker.refresh(); assert.equal(f.messages.at(-1).text, null);
  f.api.getRepository = () => undefined;
  await f.tracker.refresh(); assert.equal(f.messages.at(-1).text, null);
  f.tracker.dispose();
});
test('stale reads cannot replace a newer baseline', async () => {
  const f = fixture(); await f.tracker.start();
  let resolve;
  f.repository.show = () => new Promise(done => {resolve = done;});
  const pending = f.tracker.refresh();
  f.tracker.schedule();
  f.repository.show = async () => 'new';
  await f.tracker.refresh(); resolve('old'); await pending;
  assert.deepEqual(f.messages.map(m => m.text), ['new']);
  f.tracker.dispose();
});
test('disabled Git remains optional', async () => {
  const tracker = new GitBaseline({}, uri('/note.md'), () => assert.fail('no Git'));
  await tracker.start(); tracker.dispose();
});
