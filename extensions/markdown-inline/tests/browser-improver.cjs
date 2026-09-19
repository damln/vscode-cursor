const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { webviewPage } = require('./browser-webview.cjs');
const { output } = webviewPage('improver');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true, args: ['--allow-file-access-from-files'] });
  try {
    const page = await browser.newPage();
    const errors = [], messages = [];
    page.on('pageerror', error => errors.push(error.stack));
    let text = '---\ntitle: Example\n---\n\n# Original\n\nSome text.\n';
    let version = 1;
    const send = message => page.evaluate(m => window.postMessage(m, '*'), message);
    await page.exposeFunction('bridge', async message => {
      messages.push(message);
      if (message.type === 'ready') await send({ type: 'update', text, version, dirty: false });
      if (message.type === 'edit') {
        text = message.text; version++;
        await send({ type: 'editResult', status: 'applied', requestId: message.requestId, text, version, dirty: true });
      }
      if (message.type === 'improveText') await send({ type: 'textImprover', available: true, running: true });
    });
    await page.addInitScript(() => { window.acquireVsCodeApi = () => ({ postMessage: m => window.bridge(m), getState: () => null, setState: () => {} }); });
    await page.goto('file://' + output);
    await page.waitForSelector('.ProseMirror');
    const button = page.locator('#improve-text');
    assert.equal(await button.isVisible(), false);
    await send({ type: 'textImprover', available: true, running: false });
    await button.waitFor({ state: 'visible' });
    await page.setViewportSize({ width: 320, height: 700 });
    assert.ok(await page.locator('header').evaluate(el => el.scrollWidth <= window.innerWidth),
      JSON.stringify(await page.locator('header, header *').evaluateAll(elements => elements.map(el => ({
        id: el.id || el.tagName, width: el.getBoundingClientRect().width, scroll: el.scrollWidth,
      })))));
    assert.equal(await button.locator('.action-icon').isVisible(), true);
    assert.equal(await button.locator('.improve-spinner').isVisible(), false);
    const before = await button.boundingBox();
    await button.click();
    await page.waitForFunction(() => document.querySelector('#document-scroll').inert);
    assert.equal(await button.isDisabled(), true);
    assert.equal(await page.locator('#open-raw').isDisabled(), true);
    assert.equal(await page.locator('.ProseMirror').getAttribute('contenteditable'), 'false');
    assert.equal(await button.locator('.action-icon').isVisible(), false);
    assert.equal(await button.locator('.improve-spinner').isVisible(), true);
    assert.equal(await button.locator('.improve-spinner').evaluate(el => getComputedStyle(el).animationName), 'header-spin');
    await page.emulateMedia({reducedMotion: 'reduce'});
    assert.equal(await button.locator('.improve-spinner').evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.emulateMedia({reducedMotion: 'no-preference'});
    assert.deepEqual(await button.boundingBox(), before, 'loading does not move the button');
    const priorEdits = messages.filter(m => m.type === 'edit').length;
    await page.keyboard.type('blocked');
    await send({ type: 'command', command: 'toggleBold' });
    await send({ type: 'pasteText', text: 'blocked' });
    await page.waitForTimeout(300);
    assert.equal(messages.filter(m => m.type === 'edit').length, priorEdits);
    await send({ type: 'textImprover', available: true, running: false, error: 'Timed out' });
    await page.waitForFunction(() => !document.querySelector('#document-scroll').inert);
    assert.equal(await button.isEnabled(), true);
    assert.equal(await button.locator('.action-icon').isVisible(), true);
    assert.equal(await button.locator('.improve-spinner').isVisible(), false);
    assert.deepEqual(await button.boundingBox(), before);
    assert.equal(await page.locator('.ProseMirror').getAttribute('contenteditable'), 'true');
    await button.click();
    await page.waitForFunction(() => document.querySelector('#document-scroll').inert);
    text = '# Improved\n'; version++;
    await send({ type: 'update', text, version, dirty: false });
    await send({ type: 'textImprover', available: true, running: false });
    await page.waitForFunction(() => !document.querySelector('#document-scroll').inert);
    assert.equal(await page.locator('.ProseMirror h1').textContent(), 'Improved');
    // Unsupported syntax uses a textarea, which must be locked as well.
    text = '[reference][id]\n\n[id]: ./example.md\n'; version++;
    await send({ type: 'update', text, version, dirty: false });
    await page.waitForSelector('.source-fallback');
    await button.click();
    await page.waitForFunction(() => document.querySelector('#document-scroll').inert);
    assert.equal(await page.locator('.source-fallback').evaluate(el => Boolean(el.closest('[inert]'))), true);
    await send({ type: 'textImprover', available: true, running: false });
    await page.waitForFunction(() => !document.querySelector('#document-scroll').inert);
    await page.locator('.source-fallback').fill('Editable again');
    await page.waitForTimeout(400);
    assert.equal(text, 'Editable again');
    assert.deepEqual(errors, []);
    console.log('PASS: visibility, spinner, stable layout, editing locks, errors, replacement, source fallback');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
