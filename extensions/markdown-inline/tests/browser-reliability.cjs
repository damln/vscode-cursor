const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs'); const path=require('path'); const vm=require('vm'); const {createRequire}=require('module'); const assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const fixtures=require('./fixtures/reliability.json');
assert.ok(process.env.MARKDOWN_INLINE_TEST_ROOT, 'Set MARKDOWN_INLINE_TEST_ROOT to a task directory');
const localRequire=createRequire(path.join(root,'extension.js'));
const mod={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'extension.js'),'utf8'), {module:mod,require:id=>id==='vscode'?{Uri:{joinPath:(base,...parts)=>path.join(base,...parts)}}:localRequire(id)});
const html=mod.exports.MarkdownInlineProvider.prototype.webviewHtml.call({context:{extensionUri:root}}, {cspSource:'file:',asWebviewUri:value=>'file://'+value},root,'dark').replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/,'');
const output=path.join(process.env.MARKDOWN_INLINE_TEST_ROOT,'harness.html');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true,args:['--allow-file-access-from-files']});
try {
 for(const action of ['language','clear','delete','metadata','typing','preserve','source','saveError','conflict','recreation','draftError','rawYamlCRLF','sourceCRLF',...fixtures.markdown.map((_,i)=>'fixture'+i)]) {
  const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.stack));
  let text=action==='metadata'?'---\ntitle: "Before"\ntags: [solo]\n---\n\n# Heading\n':'# Heading\n\n```js\nexample()\n```\n';
  if(action==='preserve') text='# Heading\n\n~~~html\nA<br>B\n~~~\n\n👩‍💻 et français !\n';
  if(action.startsWith('fixture')) text='# Heading\n\n'+fixtures.markdown[Number(action.slice(7))];
  if(action==='source') text='# Heading\n\n[label][ref]\n\n[ref]: https://example.com\n';
  if(action==='rawYamlCRLF') text='---\r\ntitle: "Before"\r\ntags: [solo]\r\n---\r\n\r\n# Heading\r\n';
  if(action==='sourceCRLF') text='# Heading\r\n\r\n[label][ref]\r\n\r\n[ref]: https://example.com\r\n';
  const original=text;
  let version=1,dirty=false;let draftMessages=0;const edits=[];const requestIds=[];let saved='',copied='';
  await page.exposeFunction('bridge', async message=>{
   if(message.type==='retainDraft'&&message.draft&&action==='draftError'){draftMessages++;await page.evaluate(()=>window.postMessage({type:'operationError',error:'Recovery storage unavailable'},'*'));return;}
   const update=()=>({type:'update',version,text,dirty});
   if(message.type==='ready') await page.evaluate(m=>window.postMessage(m,'*'),update());
   if(message.type==='edit'&&action==='conflict') {text='external';version++;await page.evaluate(m=>window.postMessage(m,'*'),{...update(),type:'editResult',requestId:message.requestId,status:'conflict',error:'The file changed. Your draft is retained.'});return;}
   if(message.type==='edit') {requestIds.push(message.requestId);assert.equal(message.version,version);text=action.endsWith('CRLF')?message.text.replace(/\r?\n/g,'\r\n'):message.text;version++;dirty=true;edits.push(text);await page.evaluate(m=>window.postMessage(m,'*'),{...update(),type:'editResult',requestId:message.requestId,status:'applied'});}
   if(message.type==='save'&&action==='saveError'){await page.evaluate(()=>window.postMessage({type:'operationError',error:'No write permission'},'*'));return;}
   if(message.type==='save') {saved=text;dirty=false;await page.evaluate(m=>window.postMessage(m,'*'),update());}
   if(message.type==='copyDocument') copied=text;
  });
  await page.addInitScript(()=>{window.acquireVsCodeApi=()=>({postMessage:m=>window.bridge(m),getState:()=>JSON.parse(localStorage.getItem('vscode-state')||'null'),setState:state=>localStorage.setItem('vscode-state',JSON.stringify(state))});});
  await page.goto('file://'+output);await page.waitForSelector('.milkdown .ProseMirror',{state:'attached'});
  await page.waitForTimeout(350);
  assert.deepEqual(errors,[],action);assert.equal(edits.length,0,'opening must not edit');
  const fallback=await page.locator('.source-fallback').count();
  if(action==='language'){await page.locator('.code-lang-trigger').click();await page.locator('.code-lang-item').filter({hasText:/^python$/}).click();}
  if(action==='clear')await page.getByTitle('Clear code',{exact:true}).click();
  if(action==='delete')await page.getByTitle('Delete block',{exact:true}).click();
  if(action==='rawYamlCRLF'){if (await page.locator('#frontmatter-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#frontmatter-toggle').click();await page.getByRole('button',{name:'YAML',exact:true}).click();await page.locator('.frontmatter-source').fill('title: "After"\ntags: [solo]\n');}
  if(action==='metadata'){await page.locator('#frontmatter-toggle').click();await page.getByRole('textbox',{name:'title (string)',exact:true}).fill('After');}
  if(['typing','preserve','source','saveError','conflict','recreation','draftError','sourceCRLF'].includes(action)||action.startsWith('fixture')) {
    if(fallback) await page.locator('.source-fallback').fill(original.replace('# Heading','# Heading edited'));
    else {await page.locator('.ProseMirror h1').first().click();await page.keyboard.press('End');await page.keyboard.type(' edited');}
  }
  await page.keyboard.press('Control+s');await page.locator('#copy-document').click();
  await page.waitForTimeout(400);
  if(action==='draftError'){assert.equal(await page.locator('#save-state').innerText(),'Draft retained');assert.ok(draftMessages<20,'storage failures must not cause a feedback loop');assert.ok((await page.locator('.ProseMirror').innerText()).includes('edited'));await page.close();console.log('PASS draftError');continue;}
  if(action==='conflict'){assert.equal(text,'external');assert.equal(await page.locator('.sync-recovery').isVisible(),true);assert.ok((await page.locator('.ProseMirror').innerText()).includes('edited'));await page.close();console.log('PASS conflict');continue;}
  if(action==='saveError'){assert.equal(await page.locator('#save-state').innerText(),'Draft retained');assert.equal(saved,'');assert.equal(await page.locator('.sync-recovery').isVisible(),true);await page.close();console.log('PASS saveError');continue;}
  assert.ok(edits.length>0,action+' has edits');assert.equal(saved,text);assert.equal(copied,text);assert.deepEqual(errors,[]);
  if(action==='language')assert.match(text,/```python/);
  if(action==='clear')assert.ok(!text.includes('example()'));
  if(action==='delete')assert.ok(!text.includes('```'));
  if(action==='rawYamlCRLF'){if (await page.locator('#frontmatter-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#frontmatter-toggle').click();await page.getByRole('button',{name:'YAML',exact:true}).click();await page.locator('.frontmatter-source').fill('title: "After"\ntags: [solo]\n');}
  if(action==='metadata')assert.match(text,/title: "After"\ntags: \[solo\]/);
  if(action==='preserve')assert.ok(text.endsWith('~~~html\nA<br>B\n~~~\n\n👩‍💻 et français !\n'));
  if(action==='rawYamlCRLF')assert.equal(text,original.replace('Before','After'));
  if(action.startsWith('fixture')||action==='source'||action==='sourceCRLF')assert.equal(text,original.replace('# Heading','# Heading edited'));
  if(action==='recreation') {
    await page.reload();await page.waitForSelector('.milkdown .ProseMirror');
    await page.locator('.ProseMirror h1').first().click();await page.keyboard.press('End');await page.keyboard.type(' again');
    await page.keyboard.press('Control+s');await page.waitForTimeout(400);
    assert.ok(requestIds.length>=2);assert.equal(new Set(requestIds).size,requestIds.length,'request IDs must stay unique across webview recreation');
    assert.equal(saved,text);assert.ok(text.includes('edited again'));
  }
  console.log('PASS',action);
  await page.close();
 }
} finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
