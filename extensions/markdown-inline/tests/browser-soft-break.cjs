const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { flushEditor } = require('./browser-flush.cjs');
const { webviewPage } = require('./browser-webview.cjs');
const { cleanupMarkdown } = require('../markdown-model');
const { output } = webviewPage('soft-break');
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_BIN, headless: true, args: ['--allow-file-access-from-files']});
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.stack));
    const prefix = '---\nmetadata:\n  tags: [hello]\n---\n';
    let text = prefix + 'First\n', version = 1;
    await page.exposeFunction('bridge', async m => {
      const send = message => page.evaluate(message => window.postMessage(message, '*'), message);
      if (m.type === 'ready') await send({type: 'update', text, version, dirty: false});
      if (m.type === 'edit') {
        assert.equal(m.version, version); text = m.text;
        await send({type: 'editResult', status: 'applied', requestId: m.requestId, text, version: ++version, dirty: true});
      }
    });
    await page.addInitScript(() => {window.acquireVsCodeApi = () => ({postMessage: m => window.bridge(m), getState: () => null, setState: () => {}});});
    await page.goto('file://' + output);
    const first = page.locator('.ProseMirror > p').first();
    await first.waitFor(); await first.click(); await page.keyboard.press('End');
    await page.keyboard.press('Shift+Enter'); await page.keyboard.type('Second');
    assert.equal((await flushEditor(page)).error, undefined);
    assert.equal(text, prefix + 'First\nSecond\n');
    assert.equal(await first.textContent(), 'First Second');
    assert.equal(await first.locator('[data-type="hardbreak"]').count(), 1);
    assert.equal(cleanupMarkdown(text), text, 'cleanup retains the soft break');
    await page.reload(); await first.waitFor();
    assert.equal(await first.locator('[data-type="hardbreak"]').count(), 1, 'soft break survives reopening');
    // The second line must be visually lower within the same paragraph.
    const positions = await first.evaluate(p => {
      const range = document.createRange();
      range.selectNodeContents(p.firstChild); const first = range.getBoundingClientRect().top;
      range.selectNodeContents(p.lastChild); return [first, range.getBoundingClientRect().top];
    });
    assert.ok(positions[1] > positions[0], JSON.stringify(positions));
    await first.click(); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('Third');
    assert.equal((await flushEditor(page)).error, undefined);
    assert.equal(text, prefix + 'First\nSecond\n\nThird\n');
    assert.equal(await page.locator('.ProseMirror > p').filter({hasText: /^Third$/}).count(), 1);
    // Formatting across a soft break must not turn it into a hard break.
    await first.click(); await page.keyboard.press('Home');
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+b');
    assert.equal((await flushEditor(page)).error, undefined);
    assert.ok(!text.includes('\\\n'), 'bold must preserve soft-break attributes');
    await page.reload(); await first.waitFor();
    assert.equal(await first.locator('[data-type="hardbreak"]').count(), 1);
    for (const [source, expected] of [
      ['- Parent\n  - Child\n', /Child\n\s+Continuation/],
      ['Before\\\nAfter\n', /Before\\\nAfter\nContinuation/],
    ]) {
      text = source;
      await page.evaluate(m => window.postMessage(m, '*'), {type: 'update', text, version: ++version, dirty: false});
      const target = page.locator('.ProseMirror p').filter({hasText: /Child|After/}).first();
      await target.waitFor(); await target.click(); await page.keyboard.press('End');
      await page.keyboard.press('Shift+Enter'); await page.keyboard.type('Continuation');
      assert.equal((await flushEditor(page)).error, undefined);
      assert.match(text, expected);
    }
    assert.deepEqual(errors, []);
    console.log('PASS Shift+Enter: plain newline, same paragraph, cleanup, reopen and visual line break. Enter: separate paragraph. Frontmatter preserved.');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
