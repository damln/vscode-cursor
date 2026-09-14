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
    const source = process.env.MARKDOWN_INLINE_SOURCE_FIXTURE
      ? fs.readFileSync(process.env.MARKDOWN_INLINE_SOURCE_FIXTURE, 'utf8')
      : '---\nname: Example\nprimary: "#0092ff"\nalpha: "#ffffff0d"\nshort: "#abc #abcd"\ninvalid: "#12345 https://example.com/#abcdef"\nshadow: "0 2px #000, 0 4px #fff"\nlong: "' + 'A long description that grows naturally. '.repeat(150) + '"\n---\n\n# Example\n';
    let text = source, version = 1;
    const page = await browser.newPage({viewport: {width: 1450, height: 950}});
    const errors = [], edits = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('bridge', async message => {
      if (message.type === 'ready') await page.evaluate(m => window.postMessage(m, '*'), {type: 'update', text, version, dirty: false});
      if (message.type === 'edit') {
        assert.equal(message.version, version);
        text = message.text; version++; edits.push(text);
        await page.evaluate(m => window.postMessage(m, '*'), {type: 'editResult', status: 'applied', requestId: message.requestId, text, version, dirty: true});
      }
    });
    await page.addInitScript(() => {window.acquireVsCodeApi = () => ({postMessage: m => window.bridge(m), getState: () => null, setState: () => {}});});
    await page.goto('file://' + output);
    await page.addStyleTag({content: ':root {--vscode-font-family:system-ui;--vscode-editor-font-family:monospace}'});
    await page.locator('#frontmatter-toggle').click();
    const noOverflow = () => page.waitForFunction(() => [...document.querySelectorAll('.frontmatter-value')].every(el =>
      el.clientHeight > 0 && el.scrollHeight <= el.clientHeight && getComputedStyle(el).overflowY === 'hidden'));
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.inlineTheme = theme, theme);
      for (const width of [1450, 420, 1450]) {
        await page.setViewportSize({width, height: 950});
        await noOverflow();
      }
      await page.screenshot({path: path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, `colors-${theme}.png`)});
    }
    await page.locator('#frontmatter-toggle').click();
    await page.locator('#frontmatter-toggle').click();
    await noOverflow();
    assert.equal(edits.length, 0, 'rendering, resizing and expanding never edit the source');
    if (!process.env.MARKDOWN_INLINE_SOURCE_FIXTURE) {
      const row = key => page.locator('.frontmatter-row').filter({has: page.getByRole('textbox', {name: `${key} (string)`, exact: true})});
      assert.equal(await row('name').locator('.metadata-color').count(), 0);
      assert.equal(await row('invalid').locator('.metadata-color').count(), 0);
      assert.equal(await row('short').locator('.metadata-color').count(), 2);
      assert.equal(await row('shadow').locator('.metadata-color').count(), 2);
      assert.equal(await row('alpha').locator('.metadata-color-chip').evaluate(el => getComputedStyle(el, '::after').backgroundColor), 'rgba(255, 255, 255, 0.05)');
      const primary = row('primary').locator('textarea');
      await row('primary').locator('.metadata-color').click();
      assert.equal(await primary.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd)), '#0092ff');
      assert.equal(edits.length, 0, 'selecting a swatch never changes source');
      await primary.fill('#f0a8');
      await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Modified');
      assert.equal(text, source.replace('#0092ff', '#f0a8'), 'editing retains unrelated YAML and Markdown bytes');
      assert.equal(await row('primary').locator('.metadata-color-chip').evaluate(el => el.style.getPropertyValue('--metadata-color')), '#f0a8');
      await primary.fill('ordinary text');
      assert.equal(await row('primary').locator('.metadata-color').count(), 0);
      await primary.fill('Line one\n' + 'More content\n'.repeat(80));
      await noOverflow();
      await primary.fill('Short again');
      await noOverflow();
      assert.ok(await primary.evaluate(el => el.clientHeight < 60), 'field shrinks again after removing lines');
    }
    await page.getByRole('button', {name: 'YAML', exact: true}).click();
    const yaml = page.locator('.frontmatter-source');
    const swatch = page.locator('.metadata-color-palette .metadata-color').first();
    assert.ok(await swatch.count());
    const color = (await swatch.textContent()).trim();
    await swatch.click();
    assert.equal(await yaml.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd)), color);
    assert.deepEqual(errors, []);
    console.log('PASS metadata colors, alpha, source preservation and scrollbar-free auto-growing fields');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
