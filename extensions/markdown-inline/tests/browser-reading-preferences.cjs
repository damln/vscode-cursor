const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const { loadExtension, root, webviewPage } = require('./browser-webview.cjs');
const { output, html } = webviewPage('reading-preferences');
const extension = loadExtension();

(async () => {
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true,args:['--allow-file-access-from-files']});
 const storage=new Map(), edits=[], errors=[];
 const context={workspaceState:{get:()=>({})},globalState:{get:k=>storage.get(k),update:async(k,v)=>storage.set(k,structuredClone(v))}};
 let host=new extension.MarkdownInlineProvider(context);
 const open=async options=>{
  const page=await browser.newPage({viewport:{width:1050,height:700},...options});
  page.on('pageerror',e=>errors.push(e.stack));
  const post=m=>page.evaluate(m=>window.postMessage(m,'*'),m);
  const panel={webview:{postMessage:post}};host.panels.add(panel);
  await page.exposeFunction('bridge',async m=>{
   if(m.type==='ready') {
    await post({type:'readingPreferences',...host.readingPreferences});
    await post({type:'update',text:'# Reading preferences\n\nKeep the document untouched.\n',version:1,dirty:false});
   }
   if(m.type==='setReadingPreference') await host.setReadingPreference(m.key,m.value);
   if(m.type==='edit') edits.push(m);
  });
  await page.addInitScript(()=>window.acquireVsCodeApi=()=>({postMessage:m=>window.bridge(m),getState:()=>null,setState:()=>{}}));
  await page.goto('file://'+output);await page.waitForSelector('.ProseMirror h1');
  await page.addStyleTag({content:':root {--vscode-font-family:system-ui;--vscode-editor-font-family:monospace;}'});
  page.on('close',()=>host.panels.delete(panel));
  return page;
 };
 try {
  const page=await open();
  const font=page.locator('#font-size'),width=page.locator('#content-width');
  const fontMenu=page.locator('#font-size-menu'),widthMenu=page.locator('#content-width-menu');
  await page.locator('.ProseMirror p').click();
  await font.hover();await fontMenu.waitFor({state:'visible'});
  assert.equal(await page.locator('.ProseMirror').evaluate(el=>el===document.activeElement),true,'hover must preserve editor focus');
  assert.equal(await fontMenu.locator('button').count(),3);
  assert.ok(!(await fontMenu.innerText()).includes('Text size'));
  await fontMenu.hover();await page.waitForTimeout(220);
  assert.equal(await font.getAttribute('aria-expanded'),'true','crossing the gap keeps it open');
  await page.screenshot({path:path.join(process.env.MARKDOWN_INLINE_TEST_ROOT,'font-popup.png')});
  await page.getByRole('button',{name:'Increase font size',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#font-size').textContent.includes('18px'));
  await page.mouse.move(100,500);await fontMenu.waitFor({state:'hidden'});
  await width.hover();await widthMenu.waitFor({state:'visible'});
  await page.getByRole('menuitemradio',{name:'Large',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.contentWidth==='large');
  await page.waitForTimeout(250);
  assert.equal(await width.getAttribute('aria-expanded'),'true','choice keeps the width menu open');
  await page.screenshot({path:path.join(process.env.MARKDOWN_INLINE_TEST_ROOT,'width-popup.png')});
  const normal=page.getByRole('menuitemradio',{name:'Normal',exact:true});
  const normalBox=await normal.boundingBox();
  const normalBackground=await normal.evaluate(el=>getComputedStyle(el).backgroundColor);
  await normal.hover();await page.waitForTimeout(150);
  assert.notEqual(await normal.evaluate(el=>getComputedStyle(el).backgroundColor),normalBackground,'unselected option has hover feedback');
  assert.deepEqual(await normal.boundingBox(),normalBox,'hover does not move or resize the option');
  assert.equal(await page.getByRole('menuitemradio',{name:'Large',exact:true}).getAttribute('aria-checked'),'true','hover preserves selection');
  await page.mouse.move(100,500);await widthMenu.waitFor({state:'hidden'});
  await width.focus();await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  assert.equal(await width.getAttribute('aria-expanded'),'true','keyboard choice keeps menu open');
  assert.equal(await page.getByRole('menuitemradio',{name:'Full width',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('Escape');
  assert.equal(await width.evaluate(el=>el===document.activeElement),true,'Escape restores trigger focus');
  assert.equal(storage.get('damlnMarkdownInline.readingPreferences').fontSize,18);
  assert.equal(storage.get('damlnMarkdownInline.readingPreferences').contentWidth,'large');
  const second=await open();
  assert.equal(await second.locator('#font-size').innerText(),'18px');
  assert.equal(await second.locator('html').getAttribute('data-content-width'),'large');
  await second.locator('#font-size').focus();await second.keyboard.press('ArrowDown');
  await second.getByRole('button',{name:'Increase font size',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#font-size').textContent.includes('19px'));
  await second.keyboard.press('Escape');
  assert.equal(await second.locator('#font-size').evaluate(el=>el===document.activeElement),true);
  await second.close();await page.close();
  host=new extension.MarkdownInlineProvider(context);
  const reopened=await open();
  assert.equal(await reopened.locator('#font-size').innerText(),'19px');
  assert.equal(await reopened.locator('html').getAttribute('data-content-width'),'large');
  for(const selector of ['#font-size','#content-width']) {
   const trigger=reopened.locator(selector);await trigger.hover();
   const menu=reopened.locator(selector+'-menu');await menu.waitFor({state:'visible'});
   assert.equal(await menu.evaluate(el=>getComputedStyle(el).borderRadius),'999px');
   assert.equal(await menu.evaluate(el=>getComputedStyle(el).transitionDuration),'0.09s, 0.09s');
   await reopened.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
  }
  await reopened.emulateMedia({reducedMotion:'reduce'});await reopened.locator('#font-size').hover();
  await reopened.locator('#font-size-menu').waitFor({state:'visible'});
  assert.equal(await reopened.locator('#font-size-menu').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  await reopened.keyboard.press('Escape');
  await reopened.setViewportSize({width:360,height:700});
  await reopened.locator('#content-width').hover();
  await reopened.locator('#content-width-menu').waitFor({state:'visible'});
  assert.ok(await reopened.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await reopened.screenshot({path:path.join(process.env.MARKDOWN_INLINE_TEST_ROOT,'reading-controls-narrow.png')});
  await reopened.keyboard.press('Escape');
  await reopened.setViewportSize({width:1400,height:700});
  await reopened.evaluate(()=>window.postMessage({
    type:'update', text:'# Long document\n\n'+('A paragraph that wraps when changing the reading width. '.repeat(15)+'\n\n').repeat(60), version:2, dirty:false,
  },'*'));
  await reopened.waitForFunction(()=>document.querySelectorAll('.ProseMirror p').length>=60);
  await reopened.locator('#document-scroll').evaluate(el=>el.scrollTop=el.scrollHeight/2);
  await reopened.waitForTimeout(200);
  await reopened.locator('#content-width').hover();
  await reopened.getByRole('menuitemradio',{name:'Normal',exact:true}).click();
  await reopened.waitForTimeout(250);
  assert.equal(await reopened.locator('#content-width').getAttribute('aria-expanded'),'true','reflow in a scrolled document keeps width choices open');
  await reopened.mouse.move(100,500);await reopened.locator('#content-width-menu').waitFor({state:'hidden'});
  await reopened.close();
  const touch=await open({hasTouch:true,isMobile:true,viewport:{width:360,height:700}});
  await touch.locator('#font-size').tap();await touch.locator('#font-size-menu').waitFor({state:'visible'});
  await touch.getByRole('button',{name:'Decrease font size',exact:true}).tap();
  assert.equal(await touch.locator('#font-size').innerText(),'18px');
  assert.ok(await touch.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await touch.close();
  assert.deepEqual(edits,[]);assert.deepEqual(errors,[]);
  console.log('PASS persisted preferences across files/restart, live broadcast, hover/gap/dismissal, focus, Escape, rounded compact controls, fade/reduced motion, narrow/touch and no Markdown edits');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
