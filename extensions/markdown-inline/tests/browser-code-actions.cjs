const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { webviewPage } = require('./browser-webview.cjs');
const { output } = webviewPage('code-actions');

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_BIN, headless: true, args: ['--allow-file-access-from-files']});
  try {
    const page = await browser.newPage();
    const errors = [], requests = [], history = [];
    page.on('pageerror', error => errors.push(error.stack));
    let text = '# Code actions\n\n```js\n  const x = "é 👩‍💻";\n\tconsole.log(x);\n```\n\nBetween\n\n```python\nprint("second")\n```\n';
    let version = 1, policy = 'success', clipboard = '';
    await page.exposeFunction('bridge', async message => {
      if (message.type === 'ready') await page.evaluate(m => window.postMessage(m, '*'), {type: 'update', text, version, dirty: false});
      if (message.type === 'edit') {
        assert.equal(message.version, version); history.push(text); text = message.text; version++;
        await page.evaluate(m => window.postMessage(m, '*'), {type: 'editResult', status: 'applied', requestId: message.requestId, text, version, dirty: true});
      }
      if (message.type === 'undo') {
        text = history.pop(); version++;
        await page.evaluate(m => window.postMessage(m, '*'), {type: 'update', text, version, dirty: true});
      }
      if (message.type === 'copyCode') {
        requests.push(message);
        if (policy === 'hold') return;
        if (policy === 'success') clipboard = message.text;
        await page.evaluate(m => window.postMessage(m, '*'), {type: 'copyCodeResult', requestId: message.requestId, success: policy === 'success'});
      }
    });
    await page.addInitScript(() => {
      window.browserCopyCalls = 0;
      Object.defineProperty(navigator, 'clipboard', {value: {writeText: async () => { window.browserCopyCalls++; throw new Error('Browser clipboard denied'); }}});
      window.acquireVsCodeApi = () => ({postMessage: message => window.bridge(message), getState: () => null, setState: () => {}});
    });
    await page.goto('file://' + output);
    const blocks = page.locator('.code-lang-wrapper');
    await blocks.nth(1).waitFor();
    const code = blocks.first().locator('code');
    const copy = blocks.first().getByRole('button', {name: 'Copy code', exact: true});
    const clear = blocks.first().getByRole('button', {name: 'Clear code', exact: true});
    await code.click(); await page.keyboard.press('End'); await page.keyboard.type(' // latest');
    const latest = await code.textContent();
    assert.ok(latest.includes('// latest'));
    const dimensions = () => copy.evaluate(el => { const r = el.getBoundingClientRect(); return [r.width, r.height]; });
    const before = await dimensions();
    await copy.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Copy code"]').dataset.state === 'success');
    assert.equal(clipboard, latest, 'copies current code, indentation and Unicode without fences or line numbers');
    assert.equal(await page.evaluate(() => window.browserCopyCalls), 0);
    assert.deepEqual(await dimensions(), before);
    policy = 'failure'; await copy.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Copy code"]').dataset.state === 'error');
    assert.equal(await copy.isEnabled(), true);
    assert.ok((await copy.getAttribute('title')).includes('Try again'));
    assert.deepEqual(await dimensions(), before);
    policy = 'hold'; await copy.focus(); await copy.press('Enter');
    assert.equal(await copy.isDisabled(), true);
    const request = requests.at(-1), count = requests.length;
    await copy.evaluate(el => el.click());
    assert.equal(requests.length, count);
    await page.evaluate(m => window.postMessage(m, '*'), {type: 'copyCodeResult', requestId: 'stale', success: true});
    assert.equal(await copy.isDisabled(), true);
    await page.evaluate(m => window.postMessage(m, '*'), {type: 'copyCodeResult', requestId: request.requestId, success: true});
    await page.waitForFunction(() => !document.querySelector('[aria-label="Copy code"]').disabled);
    policy = 'success';
    await page.waitForTimeout(350);
    const original = text;
    await clear.focus(); await page.mouse.move(1, 1);
    await page.waitForTimeout(180);
    assert.equal(await blocks.first().locator('.code-lang-actions').evaluate(el => getComputedStyle(el).opacity), '1');
    await clear.press('Space');
    assert.equal(await code.textContent(), '');
    assert.equal(await clear.isDisabled(), true);
    assert.equal(await page.evaluate(() => { const node = getSelection().anchorNode; return !!(node instanceof Element ? node : node.parentElement).closest('code'); }), true);
    await copy.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Copy code"]').dataset.state === 'success');
    assert.equal(clipboard, '', 'empty code can be copied without a no-op document edit');
    await page.waitForTimeout(350);
    await page.keyboard.press('Control+z');
    await page.waitForFunction(expected => document.querySelector('.code-lang-wrapper code').textContent === expected, latest);
    assert.equal(text, original, 'clear restores through the native undo bridge in one step');
    const secondCopy = blocks.nth(1).getByRole('button', {name: 'Copy code', exact: true});
    await secondCopy.click();
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="Copy code"]')[1].dataset.state === 'success');
    assert.equal(clipboard, 'print("second")');
    const beforeDelete = text;
    await blocks.nth(1).getByRole('button', {name: 'Delete block', exact: true}).press('Enter');
    assert.equal(await blocks.count(), 1);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('ProseMirror')), true);
    await page.waitForTimeout(350); await page.keyboard.press('Control+z');
    await blocks.nth(1).waitFor(); assert.equal(text, beforeDelete);
    const language = blocks.first().getByRole('button', {name: 'Code language', exact: true});
    await language.press('Enter');
    await page.getByRole('textbox', {name: 'Search languages'}).fill('python');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(350);
    assert.ok(text.includes('```python'));
    assert.equal(await code.textContent(), latest);
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => document.querySelector('.code-lang-trigger').textContent === 'js');
    await language.press('Enter'); await page.keyboard.press('Escape');
    assert.equal(await language.getAttribute('aria-expanded'), 'false');
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.clock.install(); policy = 'hold'; await copy.click();
    assert.equal(await copy.locator('svg').evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.clock.fastForward(15001);
    assert.equal(await copy.isEnabled(), true);
    assert.ok((await copy.getAttribute('title')).includes('did not respond'));
    await copy.click();
    const pending = requests.at(-1);
    await blocks.first().getByRole('button', {name: 'Delete block', exact: true}).click();
    await page.evaluate(m => window.postMessage(m, '*'), {type: 'copyCodeResult', requestId: pending.requestId, success: true});
    await page.clock.fastForward(16000);
    assert.equal(await blocks.count(), 1, 'late completion never changes another block');
    text = '```js\nlast()\n```\n'; version++;
    await page.evaluate(m => window.postMessage(m, '*'), {type: 'update', text, version, dirty: false});
    await page.waitForFunction(() => document.querySelector('.code-lang-wrapper code')?.textContent === 'last()');
    await blocks.first().getByRole('button', {name: 'Delete block', exact: true}).click();
    assert.equal(await blocks.count(), 0);
    assert.equal(await page.locator('.ProseMirror p').count(), 1, 'deleting the only block leaves an editable paragraph');
    assert.deepEqual(errors, []);
    console.log('PASS code copy host routing, latest text, failure/retry, keyboard, clear/delete undo, language, timeout and removed-block cleanup');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
