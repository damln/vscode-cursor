const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { root, webviewPage } = require('./browser-webview.cjs');
const { output } = webviewPage('mermaid', { csp: true });

(async () => {
 const browser = await chromium.launch({executablePath: process.env.CHROME_BIN, headless:true,args:['--allow-file-access-from-files']});
 try {
  const page=await browser.newPage({viewport:{width:1200,height:900}});
  const errors=[],requests=[],edits=[]; let version=1;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url())});
  const original='# Release flow\n\n```mermaid\nflowchart LR\n  A[Write Markdown] --> B{Review}\n  B -->|Approved| C[Ship]\n  B -->|Changes| A\n```\n\nAfter diagram.\n';
  let text=original;
  await page.exposeFunction('bridge',async message=>{
   if(message.type==='ready')await page.evaluate(m=>window.postMessage(m,'*'),{type:'update',text,version,dirty:false});
   if(message.type==='edit'){
    text=message.text;edits.push(text);version++;
    await page.evaluate(m=>{window.lastAppliedText=m.text;window.postMessage(m,'*')},{type:'editResult',status:'applied',text,version,requestId:message.requestId,dirty:true});
   }
  });
  await page.addInitScript(()=>{window.acquireVsCodeApi=()=>({postMessage:m=>window.bridge(m),getState:()=>null,setState:()=>{}})});
  await page.goto('file://'+output);
  await page.addStyleTag({content:':root {--vscode-font-family:system-ui;--vscode-editor-font-family:monospace}'});
  const ready=()=>page.locator('.mermaid-preview[data-state="ready"]').waitFor();
  await ready();
  assert.equal(await page.locator('.mermaid-block pre').isVisible(),false);
  assert.equal(edits.length,0,'rendering must not change Markdown');
  const image=page.locator('.mermaid-viewport img');
  assert.ok(await image.evaluate(img=>img.complete&&img.naturalWidth>0));
  const svg=decodeURIComponent((await image.getAttribute('src')).split(',').slice(1).join(','));
  fs.writeFileSync(path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, 'diagram.svg'), svg);
  assert.ok(svg.includes('Markdown')&&svg.includes('Approved'));
  const zoom=page.locator('.mermaid-zoom');const initialZoom=await zoom.textContent();
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();assert.notEqual(await zoom.textContent(),initialZoom);
  await page.getByRole('button',{name:'Fit diagram',exact:true}).click();assert.equal(await zoom.textContent(),initialZoom);
  const viewport=page.locator('.mermaid-viewport');const box=await viewport.boundingBox();
  const before=await image.getAttribute('style');
  await page.mouse.move(box.x+150,box.y+150);await page.mouse.down();await page.mouse.move(box.x+210,box.y+180,{steps:8});await page.mouse.up();
  assert.notEqual(await image.getAttribute('style'),before,'drag pans diagram');
  await page.getByRole('button',{name:'Full screen',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Mermaid diagram viewer'});await dialog.waitFor();
  assert.equal(await dialog.evaluate(el=>el.getBoundingClientRect().width),1200);
  await page.keyboard.press('Tab');assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));
  await viewport.focus();await page.keyboard.press('+');await page.keyboard.press('0');
  await page.waitForTimeout(160);
  await page.screenshot({path:path.join(process.env.MARKDOWN_INLINE_TEST_ROOT,'mermaid-fullscreen-dark.png')});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await page.getByRole('button',{name:'Full screen',exact:true}).evaluate(el=>document.activeElement===el),true);
  assert.equal(edits.length,0,'zoom, pan, fullscreen must not modify source');
  await page.getByRole('button',{name:'Edit diagram source'}).click();
  const code=page.locator('.mermaid-block code');await code.fill('flowchart LR'); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('  A[Edited] --> B[Saved]');
  await page.waitForFunction(()=>document.querySelector('.mermaid-viewport img')?.src.includes('Edited'));
  await page.waitForFunction(()=>window.lastAppliedText?.includes('A[Edited] --> B[Saved]'));
  assert.ok(text.includes('A[Edited] --> B[Saved]'));assert.ok(!text.includes('<svg'));
  await page.getByRole('button',{name:'Hide diagram source'}).click();
  await page.evaluate(()=>document.documentElement.dataset.inlineTheme='light');
  await page.waitForFunction(()=>document.querySelector('.mermaid-viewport img')?.src.includes('fff0e4'));
  await page.screenshot({path:path.join(process.env.MARKDOWN_INLINE_TEST_ROOT,'mermaid-inline-light.png')});
  async function update(source){text=source;version++;await page.evaluate(m=>window.postMessage(m,'*'),{type:'update',text,version,dirty:false})}
  await update('```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Welcome\n```\n');await ready();
  await page.waitForFunction(()=>document.querySelector('.mermaid-viewport img')?.src.includes('Alice'));
  await update('```mermaid\nnot a valid diagram\n```\n');await page.locator('.mermaid-preview[data-state="error"]').waitFor();
  assert.equal(await page.locator('.mermaid-block pre').isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'Full screen',exact:true}).isDisabled(),true);
  await update('```mermaid\n%%{init: {"securityLevel": "loose", "htmlLabels": true}}%%\nflowchart LR\n A["<img src=x onerror=window.mermaidAttack=1>"] --> B[Safe]\n click B "javascript:window.mermaidAttack=2"\n```\n');
  await ready();
  assert.equal(await page.evaluate(()=>window.mermaidAttack),undefined);
  assert.equal(await page.locator('.mermaid-preview svg, .mermaid-preview iframe, .mermaid-preview a').count(),0,'SVG remains an inert image');
  await update(original);await ready();
  assert.equal(await page.locator('.mermaid-measure').count(),0,'temporary render DOM is cleaned');
  await page.getByRole('button',{name:'Full screen',exact:true}).click();
  await update('# Replaced externally\n\nNo diagrams.\n');
  await page.locator('.mermaid-block').waitFor({state:'detached'});
  assert.equal(await page.locator('dialog[open]').count(),0,'removing block closes its viewer');
  assert.deepEqual(requests,[],'renderer never uses a CDN or network service');
  assert.deepEqual(errors,[]);
  console.log('PASS Mermaid offline render, preserved source, edit, zoom/pan, fullscreen focus/Escape, theme, sequence, invalid syntax and removal');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
