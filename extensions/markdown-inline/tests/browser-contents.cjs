const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { webviewPage } = require('./browser-webview.cjs');
const { output } = webviewPage('phase-c');
(async () => {
 const browser = await chromium.launch({executablePath:process.env.CHROME_BIN, headless:true,args:['--allow-file-access-from-files']});
 try {
  const page = await browser.newPage({viewport:{width:1100,height:700}}), errors=[];
  page.on('pageerror',e=>errors.push(e.stack));
  let text = '---\ntitle: Hidden metadata\n---\n\n# Été\n\n'+ 'Paragraph.\n\n'.repeat(30) + '## Été\n\n### Three\n\n#### Four\n\n##### Five\n\nSetext\n======\n\n~~~md\n# Hidden code\n~~~\n';
  await page.exposeFunction('bridge', async m=>{
   if(m.type==='ready') await page.evaluate(m=>window.postMessage(m,'*'),{type:'update',text,version:1,dirty:false});
   if(m.type==='edit') throw new Error('Navigation must not edit the document');
  });
  await page.addInitScript(()=>{window.acquireVsCodeApi=()=>({postMessage:m=>window.bridge(m),getState:()=>null,setState:()=>{}});});
  await page.goto('file://'+output); await page.waitForSelector('.ProseMirror h1');
  const trigger=page.getByRole('button',{name:'Table of contents',exact:true});
  const geometry = await page.evaluate(() => {
    const t=document.querySelector('.contents-trigger').getBoundingClientRect(), actions=document.querySelector('.header-actions').getBoundingClientRect();
    return {before:t.right<=actions.left, sameRow:Math.abs(t.y+t.height/2-actions.y-actions.height/2)<2,right:document.querySelector('#document-scroll').getBoundingClientRect().right};
  });
  assert.equal(geometry.before,true); assert.equal(geometry.sameRow,true); assert.equal(geometry.right,1100);
  await page.setViewportSize({width:1600,height:700});
  const widths=[];
  for (const name of ['Normal','Large','Full width']) {
    await page.locator('#content-width').click();
    await page.getByRole('menuitemradio',{name,exact:true}).click();
    widths.push(await page.locator('.milkdown').evaluate(el=>el.getBoundingClientRect().width));
  }
  assert.ok(widths[0]<widths[1]&&widths[1]<widths[2]);
  await page.locator('#content-width').click(); await page.keyboard.press('Home');
  assert.equal(await page.getByRole('menuitemradio',{name:'Normal',exact:true}).getAttribute('aria-checked'),'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#content-width').getAttribute('aria-expanded'),'false');
  await page.setViewportSize({width:1100,height:700});
  await trigger.click();
  assert.deepEqual(await page.locator('.contents-panel .contents-title').allTextContents(),['Été','Été','Three','Four','Setext']);
  assert.deepEqual(await page.locator('.contents-panel button').evaluateAll(es=>es.map(e=>e.dataset.headingId)),['été','été-1','three','four','setext']);
  assert.deepEqual(await page.locator('.contents-level').allTextContents(),['H1','H2','H3','H4','H1']);
  assert.equal(await page.locator('[data-heading-id="été-1"]').getAttribute('aria-label'),'Été, heading level 2');
  const box=await page.locator('.contents-panel').boundingBox(); assert.ok(box.width<=240 && box.x>=0 && box.y>=0);
  await page.locator('[data-heading-id="été-1"]').click(); await page.waitForTimeout(250);
  const scroll=await page.locator('#document-scroll').evaluate(e=>e.scrollTop); assert.ok(scroll>200);
  await trigger.click(); assert.equal(await page.locator('.contents-panel [aria-current] .contents-title').textContent(),'Été');
  await page.keyboard.press('Home'); assert.equal(await page.locator(':focus').getAttribute('data-heading-id'),'été');
  await page.keyboard.press('End'); assert.equal(await page.locator(':focus .contents-title').textContent(),'Setext');
  await page.keyboard.press('Escape'); assert.equal(await trigger.getAttribute('aria-expanded'),'false');
  assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);
  await page.waitForTimeout(300); assert.equal(await trigger.getAttribute('aria-expanded'),'false','Escape must not reopen on restored focus');
  // Editing/renaming and reordering refresh positions, including duplicate slugs.
  text='# New first\n\n# Été\n\n'+ 'Paragraph.\n\n'.repeat(30) + '## Renamed\n';
  await page.evaluate(m=>window.postMessage(m,'*'),{type:'update',text,version:2,dirty:false});
  await trigger.click(); assert.deepEqual(await page.locator('.contents-panel .contents-title').allTextContents(),['New first','Été','Renamed']);
  await page.locator('[data-heading-id="new-first"]').click();
  await page.waitForTimeout(40); await page.mouse.wheel(0,50); await page.waitForTimeout(30);
  const cancelled=await page.locator('#document-scroll').evaluate(e=>e.scrollTop); await page.waitForTimeout(220);
  assert.equal(await page.locator('#document-scroll').evaluate(e=>e.scrollTop),cancelled,'user wheel cancels animated navigation');
  await page.emulateMedia({reducedMotion:'reduce'}); await trigger.click();
  await page.locator('[data-heading-id="renamed"]').click();
  assert.ok(await page.locator('#document-scroll').evaluate(e=>e.scrollTop)>200);
  await page.setViewportSize({width:420,height:600}); await trigger.click();
  const narrow=await page.locator('.contents-panel').boundingBox(); assert.ok(narrow.x>=0&&narrow.x+narrow.width<=420&&narrow.y+narrow.height<=600);
  assert.equal(await trigger.isVisible(),true);
  assert.equal(await trigger.locator('svg').isVisible(),true);
  await page.evaluate(m=>window.postMessage(m,'*'),{type:'update',text:'No headings here.\n',version:3,dirty:false});
  await page.waitForFunction(()=>document.querySelectorAll('.contents-panel button').length===0);
  assert.equal(await page.locator('.contents-panel button').count(),0);
  assert.match(await page.locator('.contents-panel').textContent(),/Add a heading/);
  assert.deepEqual(errors,[]); console.log('PASS contents index, duplicates, Setext, code exclusion, refresh, keyboard, narrow layout, scroll cancellation and reduced motion');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
