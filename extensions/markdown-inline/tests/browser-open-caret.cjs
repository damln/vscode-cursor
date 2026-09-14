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
const output = path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, 'open-caret.html');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, mod.exports.MarkdownInlineProvider.prototype.webviewHtml.call(
  { context: { extensionUri: root } }, { cspSource: 'file:', asWebviewUri: value => 'file://' + value }, root, 'dark'
).replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, ''));
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_BIN, headless: true, args: ['--allow-file-access-from-files']});
  try {
    for (const [name, original, expected] of [
      ['empty', '', 'Z'],
      ['paragraph', 'First paragraph.\n', 'ZFirst paragraph.'],
      ['heading', '# Heading\n\nBody.\n', '# ZHeading'],
      ['metadata', '---\ntitle: Example\n---\n\n# Heading\n', '# ZHeading'],
      ['list', '- First item\n- Second item\n', '- ZFirst item'],
      ['code', '```js\nconst n = 1;\n```\n', 'Zconst n = 1;'],
      ['html', '<div>\nRaw HTML\n</div>\n', 'Z<div>'],
    ]) {
      const page = await browser.newPage();
      let text = original, version = 1;
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.exposeFunction('bridge', async message => {
        if (message.type === 'ready') await page.evaluate(m => {
          window.postMessage(m, '*');
          window.postMessage({type: 'focusStart'}, '*');
        }, {type: 'update', text, version, dirty: false});
        if (message.type === 'edit') {
          text = message.text; version++;
          await page.evaluate(m => window.postMessage(m, '*'), {type: 'editResult', status: 'applied', requestId: message.requestId, text, version, dirty: true});
        }
      });
      await page.addInitScript(() => {window.acquireVsCodeApi = () => ({postMessage: m => window.bridge(m), getState: () => null, setState() {}});});
      await page.goto('file://' + output);
      await page.waitForFunction(() => document.activeElement?.matches('.ProseMirror, .source-fallback, .html-editable'));
      assert.equal(text, original, `${name}: focusing must not rewrite source`);
      assert.equal(await page.locator('#document-scroll').evaluate(el => el.scrollTop), 0);
      if (name === 'html') {
        // HTML is an atomic source node: opening places the caret before it.
        // Prepending prose to its contents would change its Markdown structure.
        assert.equal(await page.evaluate(() => window.getSelection().anchorOffset), 0);
        await page.close(); console.log('PASS opening caret before HTML'); continue;
      }
      await page.keyboard.type('Z');
      await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Modified');
      assert.ok(text.includes(expected), `${name}: typing starts at the first caret: ${text}`);
      await page.evaluate(m => window.postMessage(m, '*'), {type: 'update', text, version, dirty: false});
      await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Saved');
      await page.keyboard.type('Q');
      await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Modified');
      assert.ok(text.includes(expected.replace('Z', 'ZQ')), `${name}: save acknowledgment must preserve the caret`);
      assert.deepEqual(errors, []);
      await page.close();
      console.log('PASS opening caret: ' + name);
    }
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
