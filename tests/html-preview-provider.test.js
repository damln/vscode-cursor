const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
class Uri {
  constructor(pathname,scheme='file',authority='') {this.path=pathname;this.scheme=scheme;this.authority=authority;}
  with(change) {return Object.assign(new Uri(this.path,this.scheme,this.authority),change);}
  toString() {return `${this.scheme}://${this.authority}${this.path}`;}
  static joinPath(root,...parts) {return root.with({path:path.posix.join(root.path,...parts)});}
  static parse(value) {return value;}
}
function harness() {
  const commands=[],external=[],errors=[];let receive,dispose,changed,disposed=0;
  const root=new Uri('/work','vscode-remote','ssh-test'), uri=new Uri('/work/gallery/index.html','vscode-remote','ssh-test');
  const panel={webview:{cspSource:'https://preview.vscode-cdn.net',asWebviewUri:uri=>({toString:()=>`https://preview.vscode-cdn.net${encodeURI(uri.path)}`}),onDidReceiveMessage:callback=>{receive=callback;return {dispose(){disposed++;}};},postMessage:async()=>true},onDidDispose:callback=>{dispose=callback;}};
  const vscode={Uri,FileType:{File:1},commands:{executeCommand:async(...args)=>commands.push(args)},env:{openExternal:async uri=>{external.push(uri);return true;}},window:{showErrorMessage:async text=>errors.push(text)},workspace:{workspaceFolders:[{uri:root}],fs:{stat:async()=>({type:1})},onDidChangeTextDocument:callback=>{changed=callback;return {dispose(){disposed++;}};}}};
  const filename=path.resolve(__dirname,'../extensions/html-preview/extension.js');const localRequire=createRequire(filename);const mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module:mod,require:id=>id==='vscode'?vscode:localRequire(id)});
  const provider=new mod.exports.HtmlPreviewProvider();const document={uri,getText:()=>'<h1>Original</h1>'};
  return {provider,document,panel,vscode,commands,external,errors,navigate:href=>receive({type:'navigate',href}),dispose:()=>dispose(),changed:()=>changed({document}),disposed:()=>disposed};
}
test('HTML navigation opens the linked document with its real Remote SSH URI and fragment',async()=>{
 const h=harness();await h.provider.resolveCustomTextEditor(h.document,h.panel);
 await h.navigate('https://preview.vscode-cdn.net/work/gallery/pages/ornaments.html#detail');
 const [command,target,viewType]=h.commands[0];assert.equal(command,'vscode.openWith');assert.equal(viewType,'damln.htmlPreview');assert.equal(target.path,'/work/gallery/pages/ornaments.html');assert.equal(target.scheme,'vscode-remote');assert.equal(target.authority,'ssh-test');
 assert.equal(h.provider.fragments.get(target.toString()),'detail');
 assert.match(h.panel.webview.html,/Original/);
 h.document.getText=()=>'<h1>Changed</h1>';h.changed();assert.match(h.panel.webview.html,/Changed/);
 h.dispose();assert.equal(h.disposed(),2);assert.equal(h.provider.panels.size,0);
});
test('HTML navigation handles external and non-HTML links without executing arbitrary commands',async()=>{
 const h=harness();await h.provider.resolveCustomTextEditor(h.document,h.panel);
 await h.navigate('https://example.com');assert.equal(h.external.length,1);
 await h.navigate('https://preview.vscode-cdn.net/work/gallery/notes.md');assert.equal(h.commands[0][0],'vscode.open');
 await h.navigate('command:workbench.action.closeWindow');assert.equal(h.commands.length,1);assert.equal(h.errors.length,1);
 h.vscode.workspace.fs.stat=async()=>{throw new Error('File not found');};
 await h.navigate('https://preview.vscode-cdn.net/work/missing.html');assert.match(h.errors.at(-1),/File not found/);assert.equal(h.commands.length,1);
});
