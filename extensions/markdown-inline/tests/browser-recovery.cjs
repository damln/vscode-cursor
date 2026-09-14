const {chromium} = require(process.env.PLAYWRIGHT_MODULE);
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert/strict');
const {createRequire} = require('module');
const root = process.env.MARKDOWN_INLINE_EXTENSION_ROOT || path.resolve(__dirname, '..');
const localRequire = createRequire(path.join(root,'extension.js')), mod = {exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'extension.js'),'utf8'), {module:mod,require:id=>id==='vscode'?{Uri:{joinPath:(base,...parts)=>path.join(base,...parts)}}:localRequire(id)});
const output = path.join(process.env.MARKDOWN_INLINE_TEST_ROOT,'recovery.html');
fs.writeFileSync(output,mod.exports.MarkdownInlineProvider.prototype.webviewHtml.call({context:{extensionUri:root}}, {cspSource:'file:',asWebviewUri:v=>'file://'+v},root,'light').replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/,''));
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true,args:['--allow-file-access-from-files']});
try {
 for (const mode of ['conflicted','alreadySaved','sourceError','hostOnly']) {
  const same=mode==='alreadySaved';
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.stack));
  const draft='# Heading\n\nComplete draft with the missing rule.\n';
  const recovery={text:draft,baseText:'# Heading\n',...(mode==='sourceError'?{sourceError:'Conversion failed'}:{conflicted:true})};
  let text=same?draft:'# Heading\n',version=1,saved='',restored=false;
  await page.exposeFunction('bridge',async m=>{
   const post=message=>page.evaluate(m=>window.postMessage(m,'*'),message);
   if(m.type==='ready') await post({type:'update',text,version,dirty:false,...(mode==='hostOnly'&&!restored?{recoveredDraft:recovery}:{})});
   if(m.type==='restoreDraft') {assert.equal(m.version,version);text=m.text;version++;restored=true;
    await post({type:'update',text,version,dirty:true});
    await post({type:'editResult',text,version,dirty:true,requestId:m.requestId,status:'applied'});
    await post({type:'draftRestored'});
    saved=text;await post({type:'update',text,version,dirty:false});
   }
   if(m.type==='edit'){text=m.text;version++;await post({type:'editResult',text,version,dirty:true,requestId:m.requestId,status:'applied'});}
   if(m.type==='save'){saved=text;await post({type:'update',text,version,dirty:false});}
  });
  await page.addInitScript(({recovery,mode})=>{window.acquireVsCodeApi=()=>({getState:()=>JSON.parse(localStorage.getItem('state')||'null')||(mode==='hostOnly'?{}:{draft:recovery}),setState:s=>localStorage.setItem('state',JSON.stringify(s)),postMessage:m=>window.bridge(m)});},{recovery,mode});
  await page.goto('file://'+output);await page.waitForSelector('.ProseMirror h1');
  assert.equal(await page.locator('.sync-recovery').isVisible(),!same);
  if(!same){await page.getByRole('button',{name:'Restore retained draft',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.sync-recovery').hidden);assert.equal(saved,draft);assert.equal(restored,true);}
  await page.locator('.ProseMirror h1').click();await page.keyboard.press('End');await page.keyboard.type(' edited');await page.keyboard.press('Control+s');
  await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='Saved');
  assert.equal(saved,draft.replace('Heading','Heading edited'));
  await page.reload();await page.waitForSelector('.ProseMirror h1');
  assert.equal(await page.locator('.sync-recovery').isVisible(),false);
  assert.ok((await page.locator('.ProseMirror').textContent()).includes('missing rule'));
  assert.deepEqual(errors,[]);await page.close();console.log('PASS recovery, editing, saving and reopening; mode='+mode);
 }
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
