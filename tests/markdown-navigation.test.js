const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyDestination, resolveFileDestination, headingIds } = require('../extensions/markdown-inline/link-destination');

test('classifies authored destinations without webview base resolution', () => {
  assert.deepEqual(classifyDestination('./guide%20one.md#installation'), {kind:'file',destination:'./guide%20one.md',fragment:'installation',fileUri:false});
  assert.deepEqual(classifyDestination('#caf%C3%A9'), {kind:'anchor',fragment:'café'});
  assert.equal(classifyDestination('https://example.com').kind, 'external');
  assert.equal(classifyDestination('mailto:hello@example.com').kind, 'external');
  for (const value of ['javascript:alert(1)', 'command:workbench.action.closeWindow', 'data:text/html,x', '//host/path', '#%ZZ', '']) {
    assert.throws(() => classifyDestination(value));
  }
});
test('heading IDs handle accents, punctuation and duplicates without collisions', () => {
  assert.deepEqual(headingIds(['Café & résumé!', 'Café & résumé!', 'A', 'A-1', 'A', '東京']),
    ['café--résumé', 'café--résumé-1', 'a', 'a-1', 'a-2', '東京']);
});
test('relative and absolute files retain the source URI scheme and remote authority', () => {
  const source = {scheme:'vscode-remote',authority:'ssh-remote+dev',path:'/workspace/docs/start.md',with(change){return {...this,...change};}};
  const Uri = {joinPath(base,...parts){return base.with({path:require('node:path').posix.join(base.path,...parts)});},parse(value){const url=new URL(value);return source.with({scheme:'file',authority:url.host,path:decodeURIComponent(url.pathname)});}};
  for (const [href, expected] of [['../guide%20one.md#intro','/workspace/guide one.md'], ['/shared/guide.md','/shared/guide.md'], ['file:///shared/guide.md','/shared/guide.md']]) {
    const target = resolveFileDestination(source, classifyDestination(href), Uri);
    assert.equal(target.scheme, source.scheme); assert.equal(target.authority, source.authority); assert.equal(target.path, expected);
  }
  assert.throws(() => resolveFileDestination(source, classifyDestination('file://other/shared/guide.md'), Uri));
});

test('host opens a resolved Markdown URI and delivers its fragment to an existing view', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  const { createRequire } = require('node:module');
  const file = path.resolve(__dirname, '../extensions/markdown-inline/extension.js');
  const req = createRequire(file), mod = {exports:{}};
  function uri(value) {
    const url = new URL(value);
    return {scheme:url.protocol.slice(0,-1), authority:url.host, path:decodeURIComponent(url.pathname),
      with(change){return uri(`${change.scheme || this.scheme}://${change.authority ?? this.authority}${change.path ?? this.path}`);},
      toString(){return `${this.scheme}://${this.authority}${this.path}`;}};
  }
  const opened = [], replies = [];
  const vscode = {Uri:{joinPath(base,...parts){return base.with({path:path.posix.join(base.path,...parts)});},parse:uri},
    workspace:{fs:{stat:async target=>{if(target.path.includes('missing'))throw Error('File not found');}}},
    commands:{executeCommand:async(...args)=>opened.push(args)},env:{openExternal:async()=>true}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'), {module:mod,require:id=>id==='vscode'?vscode:req(id)});
  const source = {uri:uri('vscode-remote://ssh-remote+dev/root/docs/start.md')};
  const destination = {uri:uri('vscode-remote://ssh-remote+dev/root/guide one.md')};
  const panel = {webview:{postMessage:async message=>replies.push(message)}};
  const provider = {panels:new Set([panel]),panelDocuments:new Map([[panel,destination]]),pendingAnchors:new Map()};
  const open = href => mod.exports.MarkdownInlineProvider.prototype.openLink.call(provider,source,panel,href);
  await open('../guide%20one.md#installation');
  assert.equal(opened[0][0],'vscode.openWith');
  assert.equal(opened[0][1].toString(),destination.uri.toString());
  assert.equal(replies.at(-1).fragment,'installation');
  await open('#café'); assert.equal(replies.at(-1).fragment,'café');
  await open('./missing.md'); assert.equal(replies.at(-1).type,'navigationError');
  await open('command:bad'); assert.equal(replies.at(-1).type,'navigationError');
  assert.equal(opened.length,1,'invalid links never execute a command');
});
