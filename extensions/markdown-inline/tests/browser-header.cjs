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
const output = path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, 'header.html');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, mod.exports.MarkdownInlineProvider.prototype.webviewHtml.call(
  { context: { extensionUri: root } }, { cspSource: 'file:', asWebviewUri: value => 'file://' + value }, root, 'dark'
).replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, ''));
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true, args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    const errors = [], messages = [];
    page.on('pageerror', error => errors.push(error.stack));
    let text = '# Heading\n\nA [link](./guide.md) here.\n\n| Name | Value |\n| --- | --- |\n| [table link](./table.md) | cell |\n\n```js\nexample()\n```\n';
    let version = 1;
    await page.exposeFunction('bridge', async message => {
      messages.push(message);
      if (message.type === 'ready') await page.evaluate(m => window.postMessage(m, '*'), { type: 'update', text, version, dirty: false });
      if (message.type === 'edit') {
        assert.equal(message.version, version);
        text = message.text; version++;
        await page.evaluate(m => window.postMessage(m, '*'), { type: 'editResult', status: 'applied', requestId: message.requestId, text, version, dirty: true });
      }
    });
    await page.addInitScript(() => { window.acquireVsCodeApi = () => ({ postMessage: m => window.bridge(m), getState: () => null, setState: () => {} }); });
    await page.goto('file://' + output);
    await page.waitForSelector('.ProseMirror');

    const buttons = page.locator('.header-icon-button:visible');
    assert.equal(await buttons.count(), 4);
    const popup = page.getByRole('tooltip');
    const copy = page.locator('#open-raw');
    assert.equal(await page.locator('#copy-document, #copy-path, #copy-folder-path').count(), 0);
    await copy.hover();
    await popup.waitFor({state: 'visible'});
    assert.ok((await popup.textContent()).includes('Markdown source'));
    assert.equal(await copy.getAttribute('title'), null, 'custom popover replaces the native tooltip');
    assert.equal(await copy.getAttribute('aria-describedby'), 'header-popover');
    await popup.hover();
    await page.waitForTimeout(250);
    assert.equal(await popup.isVisible(), true, 'pointer can travel into the popover');
    await page.keyboard.press('Escape');
    await popup.waitFor({state: 'hidden'});
    assert.equal(await copy.getAttribute('aria-describedby'), null);
    await page.keyboard.press('Tab');
    await copy.focus();
    await popup.waitFor({state: 'visible'});
    await page.keyboard.press('Escape');
    await popup.waitFor({state: 'hidden'});
    if (await page.locator('#improve-text').count()) {
      await page.locator('#improve-text').evaluate(el => { el.hidden = false; el.disabled = false; });
      assert.equal((await page.locator('#improve-text').textContent()).trim(), 'Improve text');
      await page.locator('#improve-text').hover();
      await popup.waitFor({state: 'visible'});
      assert.ok((await popup.textContent()).includes('Improve'));
      await page.keyboard.press('Escape');
    }
    const geometry = () => page.locator('header').evaluate(el => [el, ...el.querySelectorAll('button:not([hidden])')].map(node => {
      const {x, y, width, height} = node.getBoundingClientRect(); return {x, y, width, height};
    }));
    for (const width of [320, 480, 768, 1440]) {
      await page.setViewportSize({width, height: 700});
      const before = await geometry();
      assert.ok(await page.locator('.header-icon-button:not([hidden])').evaluateAll(buttons => buttons.every(b => b.getBoundingClientRect().width >= 24 && b.getBoundingClientRect().height === 24)));
      assert.deepEqual(await page.locator('.header-action-label').allTextContents(), ['Improve text', 'Width', '17px', 'Edit']);
      await page.locator('#open-raw').hover();
      await popup.waitFor({state: 'visible'});
      const popoverBox = await popup.boundingBox();
      assert.ok(popoverBox.x >= 8 && popoverBox.x + popoverBox.width <= width - 8);
      await page.keyboard.press('Escape');
      await popup.waitFor({state: 'hidden'});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    const theme = page.locator('#inline-theme');
    await theme.focus();
    assert.equal(await theme.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    await theme.press('Space');
    await page.getByRole('dialog', {name:'Editor settings'}).waitFor();
    assert.equal(await theme.locator('svg:visible').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await theme.evaluate(el => el === document.activeElement), true);
    await page.setViewportSize({width: 480, height: 700});
    const before = await geometry();
    await theme.hover();
    await page.waitForTimeout(150);
    assert.deepEqual(await geometry(), before);
    const hover = await theme.locator('svg:visible').evaluate(el => getComputedStyle(el).transform);
    assert.equal(hover, 'none', 'hover does not translate the icon');
    await page.mouse.down();
    await page.waitForTimeout(150);
    assert.equal(await theme.locator('svg:visible').evaluate(el => getComputedStyle(el).opacity), '0.8');
    assert.equal(await theme.locator('svg:visible').evaluate(el => getComputedStyle(el).transform), 'none', 'press does not scale the icon');
    await page.mouse.up();
    await page.keyboard.press('Escape');
    for (const id of ['open-raw', 'improve-text']) {
      const action = page.locator('#' + id);
      await action.hover(); await page.waitForTimeout(150);
      assert.equal(await action.locator('svg:visible').evaluate(el => getComputedStyle(el).transform), 'none', id);
    }
    await page.emulateMedia({reducedMotion: 'reduce'});
    assert.equal(await theme.locator('svg:visible').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    await theme.hover();
    await popup.waitFor({state: 'visible'});
    assert.equal(await popup.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    await page.keyboard.press('Escape');
    await page.reload();
    await page.waitForSelector('.ProseMirror');
    await page.addStyleTag({content: 'body { --vscode-font-family: Arial, sans-serif; }'});
    await page.screenshot({path: path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, 'header-dark.png')});
    await page.emulateMedia({forcedColors: 'active'});
    assert.equal(await theme.evaluate(el => getComputedStyle(el).borderTopStyle), 'solid');
    const touch = await browser.newPage({viewport: {width: 320, height: 700}, hasTouch: true});
    await touch.addInitScript(() => {
      window.acquireVsCodeApi = () => ({getState: () => null, setState: () => {}, postMessage: message => {
        if (message.type === 'ready') window.postMessage({type: 'update', text: '# Touch targets\n', version: 1, dirty: false}, '*');
      }});
    });
    await touch.goto('file://' + output);
    await touch.waitForSelector('.ProseMirror');
    assert.ok(await touch.locator('.header-icon-button:not([hidden])').evaluateAll(buttons => buttons.every(b => b.getBoundingClientRect().width >= 44 && b.getBoundingClientRect().height === 44)));
    assert.equal(await touch.evaluate(() => matchMedia('(hover: hover)').matches), false);
    assert.ok(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth), JSON.stringify(await touch.evaluate(() => [...document.querySelectorAll('body, header, .header-actions, #save-state, .header-icon-button')].map(el => ({tag:el.id||el.tagName, width:el.getBoundingClientRect().width,x:el.getBoundingClientRect().x, flex:getComputedStyle(el).flex, min:getComputedStyle(el).minWidth})))));
    await touch.close();
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Labelled header and custom popovers passed: icon geometry, keyboard, hover/press, reduced motion and high contrast.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
