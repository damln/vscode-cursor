const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const {parseEditorMessage} = require('../extensions/markdown-inline/document-sync');
const extensionPath = path.join(__dirname, '../extensions/markdown-inline/extension.js');
const localRequire = createRequire(extensionPath);
const mod = {exports: {}};
vm.runInNewContext(fs.readFileSync(extensionPath, 'utf8'), {
  module: mod, require: id => id === 'vscode' ? {} : localRequire(id),
});

test('reading preferences persist across providers and merge independent controls', async () => {
  const storage = new Map(), messages = [];
  const context = {workspaceState: {get: () => ({})}, globalState: {
    get: key => storage.get(key), update: async (key, value) => storage.set(key, structuredClone(value)),
  }};
  const provider = new mod.exports.MarkdownInlineProvider(context);
  provider.panels.add({webview: {postMessage: message => messages.push(message)}});
  provider.panels.add({webview: {postMessage: message => messages.push(message)}});
  await provider.setReadingPreference('fontSize', 21);
  await provider.setReadingPreference('contentWidth', 'large');
  assert.equal(provider.readingPreferences.codeWrap, true);
  await provider.setReadingPreference('codeWrap', false);
  const reopened = new mod.exports.MarkdownInlineProvider(context);
  assert.equal(reopened.readingPreferences.fontSize, 21);
  assert.equal(reopened.readingPreferences.contentWidth, 'large');
  assert.equal(messages.length, 6);
  assert.equal(reopened.readingPreferences.codeWrap, false);
  assert.equal(messages[3].type, 'readingPreferences');
  assert.equal(messages[3].fontSize, 21);
  assert.deepEqual([...storage.keys()], ['damlnMarkdownInline.readingPreferences']);
});

test('invalid preference messages and persisted values cannot change CSS or unrelated state', async () => {
  for (const [key, value] of [['fontSize', 9], ['fontSize', 37], ['fontSize', 17.5], ['fontSize', '20'],
    ['contentWidth', '900px'], ['codeWrap', 'false'], ['codeWrap', 0], ['codeWrap', null], ['__proto__', {}]]) {
    assert.equal(parseEditorMessage({type: 'setReadingPreference', key, value}), null);
  }
  const provider = new mod.exports.MarkdownInlineProvider({workspaceState: {get: () => ({})}, globalState: {
    get: key => key.endsWith('readingPreferences') ? {fontSize: 99, contentWidth: 'bad'} : undefined,
    update: () => assert.fail('Invalid preference must not be persisted'),
  }});
  assert.equal(provider.readingPreferences.fontSize, 17);
  assert.equal(provider.readingPreferences.contentWidth, 'normal');
  await provider.setReadingPreference('fontSize', '999px');
});

test('font size endpoints persist and restore without falling back to the default', async () => {
  for (const fontSize of [10, 36]) {
    let stored;
    const context = {workspaceState: {get: () => ({})}, globalState: {
      get: () => stored, update: async (_, value) => {stored = structuredClone(value);},
    }};
    const provider = new mod.exports.MarkdownInlineProvider(context);
    await provider.setReadingPreference('fontSize', fontSize);
    assert.equal(new mod.exports.MarkdownInlineProvider(context).readingPreferences.fontSize, fontSize);
  }
});
