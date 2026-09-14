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
 const browser = await chromium.launch({executablePath: process.env.CHROME_BIN, headless: true, args: ['--allow-file-access-from-files']});
 try {
  const page = await browser.newPage({viewport: {width: 1100, height: 850}}), errors = [], history = [], future = [];
  page.on('pageerror', error => errors.push(error.stack));
  let text = '# First\n\nAlpha\n\n```js\nx()\n```\n\n| Name | Value |\n| --- | --- |\n| key | cell |\n\n- one\n- two\n  - nested\n- three\n\nOmega\n\n# Last\n', version = 1;
  const original = text;
  await page.exposeFunction('bridge', async message => {
   if (message.type === 'ready') await page.evaluate(m => window.postMessage(m, '*'), {type:'update', text, version, dirty:false});
   if (message.type === 'edit') {
    assert.equal(message.version, version); history.push(text); future.length = 0; text = message.text; version++;
    await page.evaluate(m => window.postMessage(m, '*'), {type:'editResult', status:'applied', requestId:message.requestId, text, version, dirty:true});
   }
   if (message.type === 'undo' && history.length) {future.push(text); text = history.pop(); version++; await page.evaluate(m=>window.postMessage(m,'*'),{type:'update',text,version,dirty:true});}
   if (message.type === 'redo' && future.length) {history.push(text); text = future.pop(); version++; await page.evaluate(m=>window.postMessage(m,'*'),{type:'update',text,version,dirty:true});}
  });
  await page.addInitScript(() => {window.acquireVsCodeApi = () => ({postMessage:m=>window.bridge(m), getState:()=>null, setState:()=>{}});});
  await page.goto('file://' + output); await page.waitForSelector('.ProseMirror h1');
  const alpha = page.locator('.ProseMirror > p').filter({hasText:'Alpha'});
  const code = page.locator('.ProseMirror > div').filter({has:page.locator('pre')}).first();
  const margin = async (locator, shift = false) => {
   await locator.scrollIntoViewIfNeeded(); const r = await locator.boundingBox();
   if (shift) await page.keyboard.down('Shift');
   await page.mouse.click(r.x - 2, r.y + 4);
   if (shift) await page.keyboard.up('Shift');
  };
  // The whole content block reveals its grip and semantic type.
  await alpha.hover();
  assert.equal(await page.locator('.block-group-handle').isVisible(),true);
  assert.equal(await page.locator('.block-type').textContent(),'p');
  await page.locator('.ProseMirror h1').first().hover();
  assert.equal(await page.locator('.block-type').textContent(),'h1');
  await alpha.hover(); await page.locator('.block-group-handle').click();
  await code.hover(); await page.keyboard.down('Shift'); await page.locator('.block-group-handle').click(); await page.keyboard.up('Shift');
  assert.equal(await page.locator('[data-block-selected]').count(),2,'Shift-click a visible grip extends a group');
  await page.keyboard.press('Escape');
  // Clicking the margin never edits the source, and Shift+Arrow extends the group.
  await margin(alpha); assert.equal(await page.locator('[data-block-selected]').count(), 1);
  await page.keyboard.press('Shift+ArrowDown'); assert.equal(await page.locator('[data-block-selected]').count(), 2);
  await page.keyboard.press('Shift+ArrowDown');
  assert.equal(await page.locator('table[data-block-selected]').count(), 1);
  await page.keyboard.press('Shift+ArrowUp');
  assert.equal(text, original); assert.equal(history.length, 0);
  await page.getByRole('button', {name:'Move down',exact:true}).click();
  assert.equal(await page.locator('.ProseMirror').getAttribute('data-block-motion'),'true','moving a group starts a visual transition');
  await page.waitForTimeout(350);
  assert.equal(history.length, 1, 'one host edit moves the whole group');
  assert.ok(text.indexOf('| Name') < text.indexOf('Alpha') && text.indexOf('Alpha') < text.indexOf('x()'));
  await page.evaluate(()=>window.postMessage({type:'history',action:'undo'},'*'));
  await page.waitForTimeout(200); assert.equal(text, original);
  await page.evaluate(()=>window.postMessage({type:'history',action:'redo'},'*'));
  await page.waitForTimeout(200); assert.ok(text.indexOf('| Name') < text.indexOf('Alpha'));
  // A rectangle begins in the margin and includes a whole code block.
  await page.evaluate(()=>window.postMessage({type:'history',action:'undo'},'*')); await page.waitForTimeout(200);
  const a = await alpha.boundingBox();
  const codeElement = page.locator('.ProseMirror > div').filter({has:page.locator('pre')}).first();
  const c = await codeElement.boundingBox(); assert.ok(c);
  await page.mouse.move(a.x-2,a.y+4); await page.mouse.down(); await page.mouse.move(c.x+40,c.y+c.height/2,{steps:8}); await page.mouse.up();
  assert.equal(await page.locator('[data-block-selected]').count(), 2);
  const beforeCancel = text;
  await page.evaluate(() => {
    const handle = document.querySelector('.block-group-handle');
    handle.dispatchEvent(new DragEvent('dragstart', {bubbles:true, dataTransfer:new DataTransfer()}));
    if (!document.querySelector('.ProseMirror[data-block-dragging]')) throw new Error('Drag did not start');
    window.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  });
  await page.waitForTimeout(100); assert.equal(text, beforeCancel);
  assert.equal(history.length, 0);
  // Drag the selected pair as a group, then verify cancellation never writes.
  await page.mouse.move(a.x-12,a.y+8);
  const target = await page.locator('.ProseMirror h1').last().boundingBox();
  const grip = await page.locator('.block-group-handle').boundingBox();
  await page.mouse.move(grip.x+10,grip.y+10); await page.mouse.down();
  await page.mouse.move(grip.x+18,grip.y+18,{steps:3});
  await page.mouse.move(target.x+20,target.y+30,{steps:8});
  await page.mouse.move(target.x+21,target.y+31); await page.mouse.up();
  await page.waitForTimeout(350); assert.equal(history.length, 1); assert.ok(text.indexOf('# Last') < text.indexOf('Alpha'));
  assert.equal(await page.locator('[data-block-selected]').count(), 2);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('[data-block-selected]').count(), 0);
  // Sibling list items form their own group and keep the nested list attached.
  const one = page.locator('.ProseMirror > ul > li').filter({hasText:/^one$/});
  await margin(one); await page.keyboard.press('Shift+ArrowDown');
  assert.match(await page.locator('.block-group-toolbar').textContent(), /2 list items/);
  await page.getByRole('button',{name:'Move down',exact:true}).click(); await page.waitForTimeout(350);
  assert.ok(text.indexOf('three') < text.indexOf('one') && text.indexOf('two') < text.indexOf('nested'));
  // Edge scrolling stays bounded, and cancelling a long-document drag never edits.
  text = original + Array.from({length:60}, (_,i)=>`\nParagraph ${i}\n`).join(''); version++;
  await page.evaluate(m=>window.postMessage(m,'*'),{type:'update',text,version,dirty:false});
  await margin(alpha);
  const edits = history.length, beforeLongDrag = text;
  await page.evaluate(() => {
    const scroller = document.querySelector('#document-scroll'); scroller.scrollTop = 0;
    document.querySelector('.block-group-handle').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()}));
    const r = scroller.getBoundingClientRect();
    document.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,clientX:r.x+50,clientY:r.bottom-3,dataTransfer:new DataTransfer()}));
  });
  assert.equal(await page.locator('.ProseMirror').evaluate(el=>el.getAnimations({subtree:true}).some(a=>a.effect.getTiming().fill==='forwards')),true,'drag shows a transform-only reorder preview');
  assert.equal(text,beforeLongDrag,'preview does not change Markdown');
  await page.waitForTimeout(220);
  assert.ok(await page.locator('#document-scroll').evaluate(e=>e.scrollTop) > 0);
  await page.keyboard.press('Escape');
  const stopped = await page.locator('#document-scroll').evaluate(e=>e.scrollTop);
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#document-scroll').evaluate(e=>e.scrollTop), stopped);
  assert.equal(text, beforeLongDrag); assert.equal(history.length, edits);
  assert.equal(await page.locator('.ProseMirror').evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a.effect.getTiming().fill==='forwards').length),0,'cancellation clears preview transforms');
  await page.emulateMedia({reducedMotion:'reduce'});
  await margin(alpha); await page.getByRole('button',{name:'Move down',exact:true}).click();
  assert.equal(await page.locator('.ProseMirror').getAttribute('data-block-motion'),null,'reduced motion keeps movement instant');

  assert.deepEqual(errors, []);
  console.log('PASS margin, Shift/keyboard, rectangle, whole-table boundary, grouped drag, native-history routing and nested-list movement');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
