const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const root = process.env.MARKDOWN_INLINE_EXTENSION_ROOT || path.resolve(__dirname, '..');
assert.ok(process.env.MARKDOWN_INLINE_TEST_ROOT, 'Set a task output directory');
const localRequire = createRequire(path.join(root, 'extension.js'));
const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'extension.js'), 'utf8'), {
  module: mod, require: id => id === 'vscode'
    ? { Uri: { joinPath: (base, ...parts) => path.join(base, ...parts) } } : localRequire(id),
});
const output = path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, 'phase-c.html');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, mod.exports.MarkdownInlineProvider.prototype.webviewHtml.call(
  { context: { extensionUri: root } }, { cspSource: 'file:', asWebviewUri: value => 'file://' + value }, root, 'dark'
).replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, ''));
(async () => {
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true,args:['--allow-file-access-from-files']});
 try {
  const page=await browser.newPage(), errors=[], opened=[];
  page.on('pageerror',e=>errors.push(e.stack));
  const data='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="orange"/></svg>');
  let text='# Images\n\nBefore ![A café](./caf%C3%A9%20%23.png "Original title") after.\n\n![Missing](./missing.png)\n\n![Remote](https://example.com/image.png?size=2)\n',version=1,edits=0;
  const original=text;
  await page.exposeFunction('bridge',async m=>{
   const send=m=>page.evaluate(m=>window.postMessage(m,'*'),m);
   if(m.type==='ready')await send({type:'update',text,version,dirty:false});
   if(m.type==='resolveImage') {
    await new Promise(r=>setTimeout(r,40));
    await send({type:'imageResourceResult',requestId:m.requestId,...(m.src.includes('missing')?{error:'File not found.'}:{uri:data})});
   }
   if(m.type==='openLink')opened.push(m.href);
   if(m.type==='edit'){text=m.text;version++;edits++;await send({type:'editResult',status:'applied',requestId:m.requestId,text,version,dirty:true});}
  });
  await page.addInitScript(()=>{window.acquireVsCodeApi=()=>({postMessage:m=>window.bridge(m),getState:()=>null,setState:()=>{}});});
  await page.goto('file://'+output);
  await page.waitForFunction(()=>document.querySelectorAll('.inline-image[data-state="loaded"]').length===2);
  assert.equal(edits,0);assert.equal(text,original);
  const images=page.locator('.inline-image');
  assert.equal(await images.first().locator('img').getAttribute('title'),'Original title');
  assert.equal(await images.first().locator('img').getAttribute('alt'),'A café');
  assert.match(await images.nth(1).textContent(),/Missing: File not found/);
  assert.match(await images.nth(1).textContent(),/\.\/missing.png/);
  await images.nth(1).getByRole('button',{name:'Open image',exact:true}).click();assert.deepEqual(opened,['./missing.png']);
  await page.locator('.ProseMirror h1').click();await page.keyboard.press('End');await page.keyboard.type(' edited');await page.waitForTimeout(300);
  assert.equal(text,original.replace('# Images','# Images edited'),'editing nearby preserves every authored image attribute');
  await images.nth(1).getByRole('button',{name:'Edit image path'}).click();
  await page.getByRole('textbox',{name:'Image path',exact:true}).fill('./fixed.png');
  await page.getByRole('button',{name:'Apply',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.inline-image[data-state="loaded"]').length===3);
  await page.waitForTimeout(300);assert.ok(text.includes('![Missing](./fixed.png)'));assert.ok(!text.includes('data:image'));
  await images.first().hover();await images.first().getByRole('button',{name:'Edit image path'}).click();
  await page.keyboard.press('Escape');assert.equal(await page.locator('.image-path-panel[data-show="true"]').count(),0);
  assert.deepEqual(errors,[]);console.log('PASS image loading/error, authored paths, alt/title preservation, Open, Edit path and cancellation');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
