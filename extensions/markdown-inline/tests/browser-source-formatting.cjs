const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { flushEditor } = require('./browser-flush.cjs');
const { webviewPage } = require('./browser-webview.cjs');
const { output } = webviewPage('source-formatting');

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_BIN, headless: true, args: ['--allow-file-access-from-files']});
  try {
    const cases = [
      ['italic code', '# Heading\n\n_A snapshot of `/vocabulary` with examples._\n'],
      ['bold code and nested marks', '# Heading\n\n**Use `code` here**\n\n**before _nested_ after**\n'],
      ['inline code in link label', '# Heading\n\n[`export.md` § Sizing the export](references/export.md).\n'],
      ['compact block boundaries', '# Heading\nhttps://example.com/\n\n~~~js\nx()\n~~~\n'],
      ['formatted links', '# Heading\n\n_[label](https://example.com)_\n'],
    ];
    if (process.env.MARKDOWN_INLINE_SOURCE_FIXTURE) cases.push(['reported file', fs.readFileSync(process.env.MARKDOWN_INLINE_SOURCE_FIXTURE, 'utf8')]);
    for (const [name, source] of cases) {
      const page = await browser.newPage();
      const errors = [], edits = [];
      page.on('pageerror', error => errors.push(error.stack));
      let text = source, version = 1, saved = '', copied = '';
      await page.exposeFunction('bridge', async message => {
        if (message.type === 'ready') await page.evaluate(m => window.postMessage(m, '*'), {type: 'update', text, version, dirty: false});
        if (message.type === 'edit') {
          assert.equal(message.version, version);
          text = message.text; version++; edits.push(text);
          await page.evaluate(m => window.postMessage(m, '*'), {type: 'editResult', status: 'applied', requestId: message.requestId, text, version, dirty: true});
        }
        if (message.type === 'save') saved = text;
        if (message.type === 'flushComplete' && !message.error) {
          copied = text;
        }
      });
      await page.addInitScript(() => { window.acquireVsCodeApi = () => ({postMessage: message => window.bridge(message), getState: () => null, setState: () => {}}); });
      await page.goto('file://' + output);
      await page.waitForSelector('.ProseMirror h1');
      assert.equal(await page.locator('.source-fallback').isVisible(), false, name);
      assert.equal(edits.length, 0, 'opening never rewrites the file');
      const heading = source.match(/^# .+$/m)[0];
      await page.locator('.ProseMirror h1').click();
      await page.keyboard.press('End'); await page.keyboard.type(' edited');
      await page.keyboard.press('Control+s'); await flushEditor(page);
      assert.equal(text, source.replace(heading, heading + ' edited'), name + ': every other byte is preserved');
      assert.equal(saved, text); assert.equal(copied, text);
      // An external edit must also pass the visual representation check.
      text = text.replace(heading + ' edited', heading + ' external');
      await page.evaluate(m => window.postMessage(m, '*'), {type: 'update', text, version: ++version, dirty: false});
      await page.waitForFunction(() => document.querySelector('.ProseMirror h1')?.textContent.endsWith(' external'));
      assert.equal(await page.locator('.source-fallback').isVisible(), false, name);
      if (name === 'compact block boundaries') {
        await page.locator('.ProseMirror h1').evaluate(heading => {
          heading.closest('[contenteditable]').focus();
          const selection = window.getSelection();
          selection.collapse(heading.firstChild, 0);
        });
        await page.keyboard.press('Backspace');
        await page.waitForFunction(() => !document.querySelector('.ProseMirror h1'));
        await page.keyboard.press('Control+s');
        await flushEditor(page);
        assert.equal(text, source.replace('# Heading\n', 'Heading external\n\n'));
        assert.equal(saved, text, 'heading conversion can be saved');
        assert.equal(copied, text, 'heading conversion can be copied');
        assert.equal(await page.locator('.sync-recovery').isVisible(), false, 'ordinary edits do not retain a false-conflict draft');
      }
      assert.deepEqual(errors, []);
      await page.close(); console.log('PASS ' + name);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
