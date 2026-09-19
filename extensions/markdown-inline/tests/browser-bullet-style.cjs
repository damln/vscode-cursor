const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { flushEditor } = require('./browser-flush.cjs');
const { webviewPage } = require('./browser-webview.cjs');
const { output } = webviewPage('bullet-style');
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_BIN, headless: true, args: ['--allow-file-access-from-files']});
  try {
    for (const marker of ['-', '*', '+']) {
      const page = await browser.newPage(), errors = [], edits = [];
      page.on('pageerror', error => errors.push(error.stack));
      const source = `# Heading\n\n${marker} First\n${marker} Second\n\n## Other list\n\n+ Other\n`;
      let text = source, version = 1, saved = '', copied = '';
      await page.exposeFunction('bridge', async m => {
        const send = message => page.evaluate(message => window.postMessage(message, '*'), message);
        if (m.type === 'ready') await send({type: 'update', text, version, dirty: false});
        if (m.type === 'edit') {
          assert.equal(m.version, version); text = m.text; edits.push(text);
          await send({type: 'editResult', status: 'applied', requestId: m.requestId, text, version: ++version, dirty: true});
        }
        if (m.type === 'save') saved = text;
        if (m.type === 'flushComplete' && !m.error) {copied = text; }
      });
      await page.addInitScript(() => {window.acquireVsCodeApi = () => ({postMessage: m => window.bridge(m), getState: () => null, setState: () => {}});});
      await page.goto('file://' + output); await page.waitForSelector('.ProseMirror li');
      assert.deepEqual(edits, []);
      await page.locator('.ProseMirror li p').filter({hasText: /^First$/}).click();
      await page.keyboard.press('End'); await page.keyboard.type(' edited');
      await page.waitForTimeout(300);
      assert.equal(text, source.replace('First', 'First edited'), 'typing only changes the edited text');
      await page.keyboard.press('Enter'); await page.keyboard.type('Added');
      await page.waitForTimeout(300);
      const expected = source.replace(`${marker} First`, `${marker} First edited\n${marker} Added`);
      assert.equal(text, expected, 'new items inherit their list marker');
      await page.keyboard.press('Control+s'); await flushEditor(page);
      assert.equal(saved, expected); assert.equal(copied, expected);
      // External source updates establish the next authored style.
      text = '# Heading\n\n- Parent\n  + Nested\n  + Other\n';
      await page.evaluate(m => window.postMessage(m, '*'), {type: 'update', text, version: ++version, dirty: false});
      const nested = page.locator('.ProseMirror li p').filter({hasText: /^Nested$/});
      await nested.waitFor(); await nested.click(); await page.keyboard.press('End'); await page.keyboard.type(' edited');
      await page.waitForTimeout(300);
      assert.match(text, /^- Parent$/m); assert.match(text, /^\s+\+ Nested edited$/m); assert.match(text, /^\s+\+ Other$/m);
      assert.deepEqual(errors, []);
      await page.close(); console.log(`PASS ${marker}: text edit, inserted item, Save, Copy, external update and nested styles`);
    }
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
