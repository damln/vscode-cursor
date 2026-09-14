const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {resolveImageResource} = require('../extensions/markdown-inline/image-resource');
const {parseEditorMessage} = require('../extensions/markdown-inline/document-sync');
function uri(value) {
  const url = new URL(value);
  return {scheme:url.protocol.slice(0,-1),authority:url.host,path:decodeURIComponent(url.pathname),fragment:url.hash.slice(1),
    with(change){return {...this,...change};},toString(){return `${this.scheme}://${this.authority}${this.path}`;}};
}
const Uri = {parse:uri,joinPath(base,...parts){return base.with({path:path.posix.join(base.path,...parts)});}};
for (const scheme of ['file','vscode-remote']) test(`image paths preserve ${scheme} source and authority`,async()=>{
  const authority=scheme==='file'?'':'ssh-remote+dev';
  const source=uri(`${scheme}://${authority}/workspace/docs/start.md`), resolved=[];
  const vscode={Uri,FileType:{File:1},workspace:{fs:{stat:async target=>{resolved.push(target);if(target.path.includes('missing'))throw Object.assign(Error('File not found'),{code:'ENOENT'});return {type:1};}}}};
  const webview={options:{localResourceRoots:[source.with({path:'/workspace'})]},asWebviewUri:target=>({toString:()=>`render:${target.path}`})};
  for(const [src,expected] of [['./photo.png','/workspace/docs/photo.png'],['../images/caf%C3%A9%20%23(1).png','/workspace/images/café #(1).png'],['/workspace/photo.png','/workspace/photo.png'],['file:///workspace/photo.png','/workspace/photo.png']]) {
    assert.equal(await resolveImageResource(source,src,vscode,webview),`render:${expected}`);
    assert.equal(resolved.at(-1).scheme,scheme);assert.equal(resolved.at(-1).authority,authority);
  }
  await assert.rejects(resolveImageResource(source,'/workspace-other/private.png',vscode,webview),/outside/);
  await assert.rejects(resolveImageResource(source,'/workspace/../private.png',vscode,webview),/outside/);
  await assert.rejects(resolveImageResource(source,'../../private.png',vscode,webview),/outside/);
  await assert.rejects(resolveImageResource(source,'./missing.png',vscode,webview),/not found/);
  for(const bad of ['http://example.com/image.png','command:bad','javascript:bad','data:text/html,bad','#anchor','mailto:a@b.com']) await assert.rejects(resolveImageResource(source,bad,vscode,webview));
  const remote='https://example.com/caf%C3%A9.png?size=2&name=a%20b#part';
  assert.equal(await resolveImageResource(source,remote,vscode,webview),remote);
  const data='data:image/png;base64,YQ==';assert.equal(await resolveImageResource(source,data,vscode,webview),data);
});
test('image requests require a bounded correlated request',()=>{
 assert.deepEqual(parseEditorMessage({type:'resolveImage',src:'../x.png',requestId:'image-1'}),{type:'resolveImage',src:'../x.png',requestId:'image-1'});
 for(const message of [{src:4,requestId:'x'},{src:'x',requestId:''},{src:'x',requestId:3}])assert.equal(parseEditorMessage({type:'resolveImage',...message}),null);
});
