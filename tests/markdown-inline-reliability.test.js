const assert = require("node:assert/strict");
const test = require("node:test");
const fixtures = require("../extensions/markdown-inline/tests/fixtures/reliability.json");
const { editableFrontmatter, joinPreservedFrontmatter } = require("../extensions/markdown-inline/markdown-model");

for (const { name, source, recognized } of fixtures.frontmatter) {
  test(`front matter boundary: ${name}`, () => {
    const result = editableFrontmatter(source);
    assert.equal(result.hasFrontmatter, recognized);
    assert.equal(joinPreservedFrontmatter(result.prefix, result.body), source);
    if (!recognized) assert.equal(result.body, source);
  });
}

const { DocumentQueue, applyDocumentRequest, parseEditorMessage } = require('../extensions/markdown-inline/document-sync');
test('edit messages require bounded request IDs', () => {
  for (const requestId of [undefined, '', 3, 'x'.repeat(129)]) {
    assert.equal(parseEditorMessage({type:'edit',version:1,text:'draft',requestId}), null);
  }
});
test('two views applying the same base version are serialized and the second conflicts', async () => {
  const document = {version:1,text:'original',isDirty:false,getText(){return this.text;}};
  const queue = new DocumentQueue();
  const apply = async text => { await Promise.resolve(); document.text=text; document.version++; document.isDirty=true; return true; };
  const results = await Promise.all(['one','two'].map((text,index) => queue.run(() =>
    applyDocumentRequest(document, {requestId:String(index),version:1,text}, apply))));
  assert.equal(results[0].status,'applied'); assert.equal(results[0].requestId,'0');
  assert.equal(results[1].status,'conflict'); assert.equal(document.text,'one');
});
test('failed applyEdit and exceptions are explicit and do not poison the queue', async () => {
  const document={version:1,getText:()=> 'original'};
  const queue=new DocumentQueue();
  for (const apply of [async()=>false, async()=>{throw new Error('offline');}]) {
    const result=await queue.run(()=>applyDocumentRequest(document,{requestId:'a',version:1,text:'draft'},apply));
    assert.equal(result.status,'error'); assert.equal(result.text,'original');
  }
  await assert.rejects(queue.run(()=>{throw new Error('failure');}));
  assert.equal(await queue.run(()=>42),42);
});

const { DraftStore } = require('../extensions/markdown-inline/draft-store');
test('retains closed-view drafts, isolates active views and clears only its owner', async () => {
  let value = {};
  const state = {get:()=>value, update: async(_key,next)=>{value=structuredClone(next);}};
  const store = new DraftStore(state);
  const draft={text:'pending',baseText:'original',conflicted:true};
  await store.retain('file:a','one',draft);
  await store.retain('file:a','two',{text:'other',baseText:'original'});
  assert.equal(store.recover('file:a','new',new Set(['one','two'])),null);
  const reopened=new DraftStore(state);
  assert.deepEqual(reopened.recover('file:a','new',new Set(['two'])),{owner:'one',draft});
  await reopened.retain('file:a','one',null);
  assert.equal(reopened.recover('file:a','two',new Set()).draft.text,'other');
});

test('closing a view retains its draft even while a file edit is blocked', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const { createRequire } = require('node:module');
  const extensionPath = path.join(__dirname,'../extensions/markdown-inline/extension.js');
  const localRequire = createRequire(extensionPath);
  const module = {exports:{}};
  const uri = {toString:()=> 'file:///fixture.md'};
  let changed;
  const vscode = {Uri:{joinPath:()=>uri},workspace:{
    onDidChangeTextDocument:fn=>{changed=fn;return {dispose(){}};},onDidSaveTextDocument:()=>({dispose(){}}),
  }};
  vm.runInNewContext(fs.readFileSync(extensionPath,'utf8'),{module,require:id=>id==='vscode'?vscode:localRequire(id)});
  let stored = {};
  const provider = new module.exports.MarkdownInlineProvider({extensionUri:uri,
    globalState:{get:()=>undefined},workspaceState:{get:()=>stored,update:async(_key,value)=>{stored=structuredClone(value);}},
  });
  provider.webviewHtml=()=>'';
  const recoveryBackups=[];
  provider.backupRecovery=async (_doc,text)=>recoveryBackups.push(text);
  function panel() {
    const result={active:false,messages:[],webview:{onDidReceiveMessage(fn){result.receive=fn;},postMessage:async message=>result.messages.push(message)},onDidDispose(fn){result.dispose=fn;},onDidChangeViewState(fn){result.viewChanged=fn;return {dispose(){}};}};
    return result;
  }
  const document={uri,version:1,getText:()=> 'original'};
  const first=panel();await provider.resolveCustomTextEditor(document,first);
  changed({document});
  assert.equal(first.messages.length,0,'document events cannot race ahead of recovery initialization');
  const startupQueue=provider.documentQueues.get(uri.toString());
  let allowReady;
  const starting=startupQueue.run(()=>new Promise(resolve=>{allowReady=resolve;}));
  await Promise.resolve();
  const ready=first.receive({type:'ready',session:'one'});
  await first.receive({type:'retainDraft',draft:{text:'early draft',baseText:'original'}});
  assert.equal(stored[uri.toString()].one.text,'early draft','retention works before the ready queue runs');
  allowReady(); await starting; await ready;
  assert.equal(first.messages.find(m=>m.type==='update').recoveredDraft.text,'early draft');
  assert.deepEqual(recoveryBackups,['early draft']);
  assert.equal(first.messages.some(message=>message.type==='focusStart'),false,'background views must not steal focus');
  first.active=true;await first.viewChanged();
  assert.equal(first.messages.filter(message=>message.type==='focusStart').length,1,'focus the first caret when first activated');
  await first.viewChanged();
  assert.equal(first.messages.filter(message=>message.type==='focusStart').length,1,'switching back must not reset the caret');
  const queue=provider.documentQueues.get(uri.toString());
  let release;
  const blocked=queue.run(()=>new Promise(resolve=>{release=resolve;}));
  await Promise.resolve();
  try {
    const retain=first.receive({type:'retainDraft',draft:{text:'pending',baseText:'original'}});
    await Promise.resolve();
    assert.equal(stored[uri.toString()]?.one?.text,'pending','retention must bypass the file edit queue');
    first.dispose();
    const second=panel();await provider.resolveCustomTextEditor(document,second);
    assert.equal(provider.documentQueues.get(uri.toString()),queue,'reopening must keep the in-flight document queue');
    assert.equal(provider.drafts.recover(uri.toString(),'new',new Set()).draft.text,'pending');
    await retain;
    second.dispose();
  } finally { release();await blocked; }
});


test('draft writes are immutable, ordered and survive a failed persistence attempt', async () => {
  const writes = []; let release;
  const state = {get:()=>({}), update: async(_key, value)=> {
    writes.push(value);
    if (writes.length === 1) await new Promise(resolve => {release = resolve;});
    if (writes.length === 2) throw new Error('storage busy');
  }};
  const store = new DraftStore(state);
  const first = store.retain('file:a','one',{text:'first',baseText:'base'});
  await Promise.resolve();
  const second = store.retain('file:a','one',{text:'second',baseText:'base'});
  const rejected = assert.rejects(second, /storage busy/);
  const third = store.retain('file:a','one',{text:'third',baseText:'base'});
  assert.equal(writes.length, 1);
  assert.equal(writes[0]['file:a'].one.text, 'first');
  release(); await first; await rejected; await third;
  assert.deepEqual(writes.map(value=>value['file:a'].one.text), ['first','second','third']);
});
test('transferring an orphan draft persists one owner in one write', async () => {
  const writes = [];
  const draft = {text:'pending',baseText:'base'};
  const store = new DraftStore({get:()=>({'file:a':{old:draft}}),update:async(_key,value)=>writes.push(value)});
  await store.transfer('file:a','old','new',draft);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], {'file:a':{new:draft}});
});
test('recovery message validation retains source-error reason and checks restoration version', () => {
  assert.equal(parseEditorMessage({type:'restoreDraft',text:'draft',version:-1,requestId:'r'}),null);
  assert.equal(parseEditorMessage({type:'restoreDraft',text:'draft',version:1,requestId:'r'}).type,'restoreDraft');
  assert.equal(parseEditorMessage({type:'retainDraft',draft:{text:'draft',baseText:'base',sourceError:'conversion'}}).draft.sourceError,'conversion');
});

test('recovery ignores no-op drafts and content already present in the file', () => {
  const store = new DraftStore({get:()=>({'file:a':{one:{text:'base',baseText:'base'},two:{text:'saved',baseText:'old'}}})});
  assert.equal(store.recover('file:a','new',new Set(),'saved'),null);
});
