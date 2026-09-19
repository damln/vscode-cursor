const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { flushEditor } = require('./browser-flush.cjs');
const { webviewPage } = require('./browser-webview.cjs');
const { output } = webviewPage('colors');
(async () => {
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true,args:['--allow-file-access-from-files']});
 try {
  const cases=[['color formats','# Colors\n\nSwatch #112233\n\nPrimary ({colors.primary} — #faff69), #e6eb52 and `#abc`.\n\n#ff**ff**ff\n\n| Token | Color |\n| --- | --- |\n| ink | #abcd |\n\n```css\ncolor: #11223344; background: #00000000;\n```\n\nInvalid #12345 #1234567 #abcdefg and https://example.com/#fff\n']];
  if(process.env.MARKDOWN_INLINE_SOURCE_FIXTURE)cases.push(['reported ClickHouse document',fs.readFileSync(process.env.MARKDOWN_INLINE_SOURCE_FIXTURE,'utf8')]);
  for(const [name,source] of cases){
   const page=await browser.newPage({viewport:{width:1100,height:800}}), errors=[];let text=source,version=1,edits=0,copied='',saved='',codeCopied='';
   page.on('pageerror',e=>errors.push(e.stack));
   await page.exposeFunction('bridge',async m=>{
    const send=m=>page.evaluate(m=>window.postMessage(m,'*'),m);
    if(m.type==='ready')await send({type:'update',text,version,dirty:false});
    if(m.type==='edit'){text=m.text;version++;edits++;await send({type:'editResult',status:'applied',requestId:m.requestId,text,version,dirty:true});}
    if(m.type==='save')saved=text;
    if(m.type==='copyCode'){codeCopied=m.text;await send({type:'copyCodeResult',requestId:m.requestId,success:true});}
    if(m.type==='flushComplete'&&!m.error){copied=text;}
   });
   await page.addInitScript(()=>{window.acquireVsCodeApi=()=>({postMessage:m=>window.bridge(m),getState:()=>null,setState:()=>{}});});
   await page.goto('file://'+output);await page.waitForSelector('.inline-color-preview');
   assert.equal(await page.locator('.source-fallback').count(),0);
   assert.equal(edits,0);assert.equal(text,source);
   const swatches=page.locator('.inline-color-preview');
   if(name==='color formats'){
    assert.equal(await swatches.count(),8);
    assert.equal(await page.locator('td .inline-color-preview').count(),1);
    assert.equal(await page.locator('pre .inline-color-preview').count(),2);
    assert.equal(await page.locator('.ProseMirror > p').filter({hasText:'#ffffff'}).locator('.inline-color-preview').count(),1);
    const paragraph=page.locator('.ProseMirror > p').filter({hasText:/^Swatch #112233$/});
    await paragraph.click();await page.keyboard.press('End');await page.keyboard.press('Backspace');
    await page.waitForFunction(()=>document.querySelectorAll('.inline-color-preview').length===7);
    await page.keyboard.type('4');await page.waitForFunction(()=>document.querySelectorAll('.inline-color-preview').length===8);
    assert.equal(await paragraph.count(),0);
    await page.keyboard.press('Control+s');await flushEditor(page);

    assert.equal(text,source.replace('Swatch #112233\n','Swatch #112234\n'));
   }else{
    assert.ok(await swatches.count()>20,'plain-text colors in the actual document have swatches');
    await flushEditor(page);
    assert.equal(text,source);
   }
   assert.equal(copied,text);if(name==='color formats'){
    assert.equal(saved,text);
    await page.locator('.code-lang-wrapper').hover();
    await page.getByRole('button',{name:'Copy code',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.code-lang-action-btn[data-state="success"]'));
    assert.equal(codeCopied,'color: #11223344; background: #00000000;');
   }
   for(const theme of ['light','dark']){
    await page.evaluate(theme=>document.documentElement.dataset.inlineTheme=theme,theme);
    const rect=await swatches.first().boundingBox();assert.ok(rect.width>0&&rect.height>0);
    assert.equal(await swatches.first().getAttribute('aria-hidden'),'true');
   }
   assert.deepEqual(errors,[]);console.log('PASS '+name+': swatches, live edits, exact copy/source and light/dark rendering');await page.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
