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
const output = path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, 'toolbar-pointer.html');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, mod.exports.MarkdownInlineProvider.prototype.webviewHtml.call(
  { context: { extensionUri: root } }, { cspSource: 'file:', asWebviewUri: value => 'file://' + value }, root, 'dark'
).replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, ''));
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_BIN, headless: true, args: ['--allow-file-access-from-files']});
  try {
    const page = await browser.newPage({viewport: {width: 1100, height: 700}});
    const errors = [], edits = [];
    page.on('pageerror', error => errors.push(error.stack));
    const text = '# Toolbar pointers\n\n' + 'Some introductory text.\n\n'.repeat(4)
      + 'Start of a paragraph with selected words and enough text to reach the other edge.\n\n'
      + '| Name | Value |\n| --- | --- |\n| Table selection | Another value |\n\n'
      + 'More content.\n\n'.repeat(30);
    await page.exposeFunction('bridge', async message => {
      if (message.type === 'ready') await page.evaluate(m => window.postMessage(m, '*'), {type:'update', text, version:1, dirty:false});
      if (message.type === 'edit') edits.push(message);
    });
    await page.addInitScript(() => { window.acquireVsCodeApi = () => ({postMessage:m=>window.bridge(m),getState:()=>null,setState:()=>{}}); });
    await page.goto('file://' + output);
    await page.waitForSelector('.ProseMirror h1');
    await page.addStyleTag({content: ':root {--vscode-font-family:system-ui;--vscode-editor-font-family:monospace;}'});
    const select = async (selector, from, to) => {
      await page.locator(selector).first().evaluate((el, {from, to}) => {
        const editor = document.querySelector('.ProseMirror'); editor.focus();
        const textNode = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
        const range = document.createRange(); range.setStart(textNode, from); range.setEnd(textNode, to);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      }, {from, to});
    };
    const check = async (selector, side) => {
      const toolbar = page.locator(selector);
      await page.waitForFunction(({selector,side}) => {
        const el=document.querySelector(selector);
        return el?.dataset.show==='true' && el.dataset.pointerSide===side;
      }, {selector, side});
      await page.waitForTimeout(180);
      const geometry = await toolbar.evaluate(el => {
        const r=el.getBoundingClientRect(), css=getComputedStyle(el), arrow=getComputedStyle(el,'::after');
        const selection=getSelection().getRangeAt(0).getBoundingClientRect();
        return {x:r.x, right:r.right, width:r.width, pointer:parseFloat(css.getPropertyValue('--toolbar-pointer-x')),
          target:(selection.left+selection.right)/2-r.left, radius:parseFloat(css.borderTopLeftRadius),
          content:arrow.content, overflow:css.overflow, transform:arrow.transform};
      });
      assert.ok(geometry.x>=7 && geometry.right<=await page.evaluate(()=>innerWidth)-7);
      assert.ok(Math.abs(geometry.pointer-Math.max(24,Math.min(geometry.target,geometry.width-24)))<2);
      assert.ok(geometry.radius>=20);
      assert.equal(geometry.content,'""');
      assert.equal(geometry.overflow,'visible');
      assert.ok(side==='top' ? geometry.transform.includes('-0.707') : geometry.transform.includes('0.707'));
    };
    for (const theme of ['light','dark']) {
      await page.evaluate(theme=>document.documentElement.dataset.inlineTheme=theme,theme);
      await select('.ProseMirror > p:nth-of-type(5)',0,5);
      await check('.milkdown-selection-toolbar','bottom');
      await page.screenshot({path:path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, 'toolbar-'+theme+'.png')});
      await select('.ProseMirror > p:nth-of-type(5)',70,78);
      await check('.milkdown-selection-toolbar','bottom');
      await select('.ProseMirror td',0,5);
      await check('.milkdown-table-toolbar','bottom');
    }
    await select('.ProseMirror > p:nth-of-type(5)',0,5);
    await page.locator('.ProseMirror > p:nth-of-type(5)').evaluate(el => {
      const scroller=document.querySelector('#document-scroll');
      scroller.scrollTop += el.getBoundingClientRect().top - 12;
    });
    await check('.milkdown-selection-toolbar','top');
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:420,height:700});
    await page.locator('#document-scroll').evaluate(el=>el.scrollTop=0);
    await select('.ProseMirror > p:nth-of-type(5)',1,6);
    await check('.milkdown-selection-toolbar','bottom');
    assert.deepEqual(edits,[]);
    assert.deepEqual(errors,[]);
    console.log('PASS rounded toolbars and selection pointers: light/dark, shifted edges, tables, flipped placement, narrow viewport, no document edits');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
