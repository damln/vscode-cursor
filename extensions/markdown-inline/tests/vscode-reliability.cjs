const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const vscode = require('vscode');
const { MarkdownInlineProvider } = require('../extension');

exports.run = async function () {
  const output = process.env.MARKDOWN_INLINE_TEST_ROOT;
  assert.ok(output, 'MARKDOWN_INLINE_TEST_ROOT must be a task directory');
  await fs.mkdir(output, {recursive:true});
  const file = vscode.Uri.file(path.join(output,'native-reliability.md'));
  await vscode.workspace.fs.writeFile(file,Buffer.from('# Original\n'));
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
  async function expectText(expected) {
    const deadline = Date.now() + 5000;
    while (document.getText() !== expected && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(document.getText(), expected);
  }
  const state = new Map();
  const provider = new MarkdownInlineProvider({
    extensionUri:vscode.Uri.file(path.resolve(__dirname,'..')),
    storageUri:vscode.Uri.file(path.join(output,'recovery-storage')),
    globalState:{get:()=>undefined,update:async()=>{}},
    workspaceState:{get:(key,fallback)=>state.get(key)||fallback,update:async(key,value)=>state.set(key,structuredClone(value))},
  });
  provider.webviewHtml=()=>'';
  function panel() {
    const result={active:true,replies:[],onDidChangeViewState(){return {dispose(){}};},onDidDispose(fn){this.dispose=fn;},webview:{
      onDidReceiveMessage(fn){result.receive=fn;},
      postMessage:async message=>{
        result.replies.push(message);
        if(message.type==='flush') await result.receive({type:'flushComplete',flushId:message.flushId});
        return true;
      },
    }};
    return result;
  }
  const first=panel(), second=panel();
  await provider.resolveCustomTextEditor(document,first);
  await provider.resolveCustomTextEditor(document,second);
  await first.receive({type:'ready',session:'one'});
  await second.receive({type:'ready',session:'two'});
  const image = vscode.Uri.file(path.join(output, 'café #(1).svg'));
  await vscode.workspace.fs.writeFile(image, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"/>'));
  const imagePanel = vscode.window.createWebviewPanel('image-test', 'Image test', vscode.ViewColumn.Beside, {
    localResourceRoots:[vscode.Uri.file(output)]
  });
  const {resolveImageResource} = require('../image-resource');
  for (const src of ['./caf%C3%A9%20%23(1).svg', image.fsPath.replace('#','%23'), image.toString()]) {
    assert.equal(await resolveImageResource(file,src,vscode,imagePanel.webview),imagePanel.webview.asWebviewUri(image).toString());
  }
  await assert.rejects(resolveImageResource(file,'../outside.svg',vscode,imagePanel.webview),/outside/);
  imagePanel.dispose();
  await vscode.window.showTextDocument(document);
  const base=document.version;
  await Promise.all([
    first.receive({type:'edit',requestId:'one:1',version:base,text:'# Changed\n'}),
    second.receive({type:'edit',requestId:'two:1',version:base,text:'# Conflicting\n'}),
  ]);
  await expectText('# Changed\n');
  assert.equal(document.isDirty,true);
  assert.equal(first.replies.find(m=>m.requestId==='one:1').status,'applied');
  assert.equal(second.replies.find(m=>m.requestId==='two:1').status,'conflict');
  const saveListener=vscode.workspace.onWillSaveTextDocument(event=>event.waitUntil(provider.flushDocument(event.document)));
  await first.receive({type:'save'});
  assert.equal(document.isDirty,false);
  assert.equal(Buffer.from(await vscode.workspace.fs.readFile(file)).toString(),'# Changed\n');
  assert.ok(first.replies.some(m=>m.type==='update'&&m.dirty===false));
  await vscode.commands.executeCommand('undo');
  await expectText('# Original\n');
  await vscode.commands.executeCommand('redo');
  await expectText('# Changed\n');
  await first.receive({type:'edit',requestId:'one:2',version:document.version,text:'---\ntitle: "After"\ntags: [solo]\n---\n\n# Changed\n'});
  await first.receive({type:'save'});
  let metadata=document.getText();
  const code = "  print('é 👩‍💻')\n\t# keep whitespace\n";
  await first.receive({type: 'copyCode', requestId: 'native-code', text: code});
  assert.equal(await vscode.env.clipboard.readText(), code);
  assert.equal(first.replies.findLast(message => message.type === 'copyCodeResult').success, true);
  await first.receive({type:'copyDocument'});
  assert.equal(await vscode.env.clipboard.readText(),metadata);
  await first.receive({type:'undo'});
  await expectText('# Changed\n');
  await first.receive({type:'redo'});
  await expectText(metadata);
  const files = vscode.workspace.getConfiguration('files');
  await files.update('autoSaveDelay', 50, vscode.ConfigurationTarget.Global);
  await files.update('autoSave', 'afterDelay', vscode.ConfigurationTarget.Global);
  await first.receive({type:'edit',requestId:'one:3',version:document.version,text:metadata+'Auto-saved\n'});
  const deadline=Date.now()+5000;
  while(document.isDirty && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(document.isDirty,false,'auto-save must save the acknowledged edit');
  metadata=document.getText();
  assert.equal(Buffer.from(await vscode.workspace.fs.readFile(file)).toString(),metadata);
  await files.update('autoSave', 'off', vscode.ConfigurationTarget.Global);
  await first.receive({type:'retainDraft',draft:{text:'recovery',baseText:metadata,conflicted:true}});
  first.dispose();
  const reopened=panel();await provider.resolveCustomTextEditor(document,reopened);
  await reopened.receive({type:'ready',session:'reopened'});
  assert.equal(reopened.replies.find(m=>m.recoveredDraft)?.recoveredDraft.text,'recovery');
  await expectText(metadata);
  const passage = document.getText().indexOf('# Changed');
  await reopened.receive({type:'openRaw',offset:passage});
  assert.equal(vscode.window.activeTextEditor.document.uri.toString(),file.toString());
  assert.equal(document.offsetAt(vscode.window.activeTextEditor.selection.active),passage);
  await reopened.receive({type:'ready',session:'reopened'});
  assert.equal(reopened.replies.findLast(m=>m.type==='navigateSource').offset,passage);
  await vscode.env.clipboard.writeText('**Plain clipboard**');
  await reopened.receive({type:'pastePlainText'});
  assert.equal(reopened.replies.findLast(m=>m.type==='pasteText').text,'**Plain clipboard**');
  const post = reopened.webview.postMessage;
  reopened.webview.postMessage = async message => {
    if (message.type === 'flush') return reopened.receive({type:'flushComplete',flushId:message.flushId,error:'Retained draft requires recovery'});
    return post(message);
  };
  await assert.rejects(provider.flushDocument(document), /Retained draft requires recovery/);
  reopened.webview.postMessage = post;
  reopened.dispose();second.dispose();saveListener.dispose();
  await document.save();
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const reopenedDocument=await vscode.workspace.openTextDocument(file);
  assert.equal(reopenedDocument.getText(),metadata);
  await fs.writeFile(path.join(output,'native-result.json'),JSON.stringify({vscode:vscode.version,passed:true,scenarios:['two views','native WorkspaceEdit','dirty state','save handshake','disk read','native undo/redo after save','metadata undo/redo','copy latest source','closed-view recovery','close and reopen','auto-save afterDelay and manual save off','native source passage and return position','plain clipboard routing','code clipboard routing','native image URI resolution and resource roots']},null,2));
};
