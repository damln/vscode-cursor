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
const output = path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, 'popup-escape.html');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, mod.exports.MarkdownInlineProvider.prototype.webviewHtml.call(
  { context: { extensionUri: root } }, { cspSource: 'file:', asWebviewUri: value => 'file://' + value }, root, 'dark'
).replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, ''));
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_BIN, headless: true, args: ['--allow-file-access-from-files']});
  try {
    const page = await browser.newPage(), errors = [], edits = [];
    page.on('pageerror', error => errors.push(error.stack));
    const text = '# Popup checks\n\nA [link](./guide.md) here.\n\n| Name | Value |\n| --- | --- |\n| first | cell |\n| second | value |\n\n```js\nexample()\n```\n\n![Missing](./missing.png)\n\nCommands\n';
    let version = 1;
    await page.exposeFunction('bridge', async m => {
      const send = message => page.evaluate(message => window.postMessage(message, '*'), message);
      if (m.type === 'ready') await send({type: 'update', text, version, dirty: false});
      if (m.type === 'resolveImage') await send({type: 'imageResourceResult', requestId: m.requestId, error: 'File not found.'});
      if (m.type === 'edit') {
        edits.push(m.text);
        await send({type: 'editResult', status: 'applied', requestId: m.requestId, text: m.text, version: ++version, dirty: true});
      }
    });
    await page.addInitScript(() => { window.acquireVsCodeApi = () => ({postMessage: m => window.bridge(m), getState: () => null, setState: () => {}}); });
    await page.goto('file://' + output);
    await page.waitForSelector('.ProseMirror td');
    const table = page.getByRole('toolbar', {name: 'Table actions'});
    const assertClosed = async () => {
      await page.waitForTimeout(350);
      assert.equal(await page.locator('.floating-panel[data-show="true"]').count(), 0, 'Escape leaves no active popup');
      assert.equal(await page.locator('.floating-panel:not([inert])').count(), 0, 'closed popups cannot receive focus');
    };
    const selection = () => page.evaluate(() => {
      const s = getSelection(); return [s.anchorNode?.textContent, s.anchorOffset, s.focusNode?.textContent, s.focusOffset];
    });
    await page.locator('td').last().click();
    await table.waitFor({state: 'visible'});
    const caret = await selection();
    await page.keyboard.press('Escape'); await assertClosed();
    assert.deepEqual(await selection(), caret, 'Escape preserves the table caret');
    assert.equal(await page.locator('.ProseMirror').evaluate(el => el === document.activeElement), true);
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await assertClosed();
    // Explicit keyboard access still works at exactly the same caret.
    await page.keyboard.press('Alt+F10'); await table.waitFor({state: 'visible'});
    assert.equal(await table.evaluate(el => el.contains(document.activeElement)), true);
    await page.keyboard.press('Escape'); await assertClosed();
    // Navigation starts a new context and makes the toolbar available again.
    await page.keyboard.press('ArrowLeft'); await table.waitFor({state: 'visible'});
    // IME owns Escape while composing.
    await page.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', isComposing: true, bubbles: true, cancelable: true})));
    assert.equal(await table.isVisible(), true);
    // Escape still works with focus elsewhere; it must not pull focus back.
    await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); });
    assert.equal(await table.isVisible(), true);
    await page.keyboard.press('Escape'); await assertClosed();
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
    await page.locator('td').first().click(); await table.waitFor({state: 'visible'});
    await page.keyboard.press('Escape'); await assertClosed();
    // A text selection toolbar also remains dismissed without losing the selection.
    await page.locator('h1').click(); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
    await page.getByRole('toolbar', {name: 'Formatting and block actions'}).waitFor({state: 'visible'});
    const range = await selection();
    await page.keyboard.press('Escape'); await assertClosed();
    assert.deepEqual(await selection(), range);
    await page.keyboard.press('Alt+F10');
    await page.getByRole('toolbar', {name: 'Formatting and block actions'}).waitFor({state: 'visible'});
    await page.keyboard.press('Escape'); await assertClosed();
    const link = page.locator('.ProseMirror a');
    await link.hover(); await page.locator('.milkdown-link-tooltip').waitFor({state: 'visible'});
    await page.keyboard.press('Escape'); await assertClosed();
    await link.click();
    const destination = page.getByRole('textbox', {name: 'Link destination'});
    await destination.fill('./unsaved.md');
    await page.keyboard.press('Escape'); await assertClosed();
    await link.click(); assert.equal(await destination.inputValue(), './guide.md', 'Escape discards only the link draft');
    await page.keyboard.press('Escape'); await assertClosed();
    const language = page.getByRole('button', {name: 'Code language', exact: true});
    await language.click(); await page.keyboard.press('Escape'); await assertClosed();
    assert.equal(await language.evaluate(el => el === document.activeElement), true);
    await language.press('Enter'); await page.locator('.code-lang-dropdown').waitFor({state: 'visible'});
    await page.locator('.ProseMirror').focus();
    await page.keyboard.press('Escape'); await assertClosed();
    const imageEdit = page.getByRole('button', {name: 'Edit image path', exact: true});
    await imageEdit.click(); await page.getByRole('textbox', {name: 'Image path', exact: true}).fill('./unsaved.png');
    await page.keyboard.press('Escape'); await assertClosed();
    assert.equal(await imageEdit.evaluate(el => el === document.activeElement), true);
    const contents = page.getByRole('button', {name: 'Table of contents', exact: true});
    await contents.click(); await page.keyboard.press('Escape'); await assertClosed();
    assert.equal(await contents.evaluate(el => el === document.activeElement), true);
    await page.locator('#copy-document').hover();
    await page.locator('#header-popover').waitFor({state: 'visible'});
    await page.keyboard.press('Escape'); await assertClosed();
    await page.mouse.move(800, 600); await page.locator('#copy-document').hover();
    await page.locator('#header-popover').waitFor({state: 'visible'});
    await page.keyboard.press('Escape'); await assertClosed();
    assert.deepEqual(edits, [], 'popup dismissal does not edit the Markdown');
    await page.locator('.ProseMirror p').filter({hasText: /^Commands$/}).click();
    await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('/code');
    await page.locator('.inline-slash-menu[data-show="true"]').waitFor({state: 'visible'});
    await page.locator('.inline-slash-menu[data-show="true"] button').focus();
    await page.keyboard.press('Escape'); await assertClosed();
    assert.equal(await page.locator('.ProseMirror').evaluate(el => el === document.activeElement), true);
    assert.ok((await page.locator('.ProseMirror').innerText()).includes('/code'), 'dismissing a slash menu preserves typed text');
    assert.deepEqual(errors, []);
    await page.screenshot({path: path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, 'popup-escape.png')});
    console.log('PASS Escape: table caret, toolbar focus, selection retention, outside focus, IME, queued updates, explicit reopening, link draft, language, image, contents, header and slash menu');
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
