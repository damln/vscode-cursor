const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs'); const path=require('path'); const vm=require('vm'); const {createRequire}=require('module'); const assert=require('assert/strict');
// Point at an extracted VSIX to verify the shipped parser, not just the checkout.
const root=process.env.MARKDOWN_INLINE_EXTENSION_ROOT || path.resolve(__dirname,'..');
assert.ok(process.env.MARKDOWN_INLINE_TEST_ROOT, 'Set MARKDOWN_INLINE_TEST_ROOT to a task directory');
const localRequire=createRequire(path.join(root,'extension.js'));
const mod={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'extension.js'),'utf8'), {module:mod,require:id=>id==='vscode'?{Uri:{joinPath:(base,...parts)=>path.join(base,...parts)}}:localRequire(id)});
const html=mod.exports.MarkdownInlineProvider.prototype.webviewHtml.call({context:{extensionUri:root}}, {cspSource:'file:',asWebviewUri:value=>'file://'+value},root,'dark').replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/,'');
const output=path.join(process.env.MARKDOWN_INLINE_TEST_ROOT,'reading-controls.html');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_BIN, headless: true, args: ['--allow-file-access-from-files']});
  try {
    const page = await browser.newPage({viewport: {width: 900, height: 800}});
    const errors = [], edits = [];
    const text = '---\ntitle: Example\n---\n\n# Reading controls\n\nA paragraph with **formatting**.\n\n- Changed list item\n- Another item\n\n```js\nconst value = 1;\n```\n';
    page.on('pageerror', error => errors.push(error.stack));
    await page.exposeFunction('bridge', async message => {
      if (message.type === 'ready') {
        await page.evaluate(m => window.postMessage(m, '*'), {type: 'update', text, version: 1, dirty: false});
        await page.evaluate(m => window.postMessage(m, '*'), {type: 'gitBaseline', text: text.replace('Changed', 'Original')});
      }
      if (message.type === 'edit') edits.push(message);
    });
    await page.addInitScript(() => {window.acquireVsCodeApi = () => ({
      postMessage: message => window.bridge(message),
      getState: () => JSON.parse(sessionStorage.getItem('editorState') || 'null'),
      setState: value => sessionStorage.setItem('editorState', JSON.stringify(value)),
    });});
    const size = () => page.locator('.milkdown').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    const openSize = () => page.locator('#font-size').click();
    await page.goto('file://' + output);
    await page.addStyleTag({content: ':root {--vscode-font-family: system-ui; --vscode-editor-font-family: monospace;}'});
    await page.waitForSelector('.ProseMirror h1');
    assert.equal(await size(), 17);
    assert.equal(await page.locator('#content-width').evaluate(el => el.nextElementSibling.id), 'font-size');
    await openSize(); await page.getByRole('button', {name: 'Increase font size', exact: true}).click();
    assert.equal(await size(), 18);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#font-size').getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'font-size');
    await page.locator('#content-width').click(); await page.getByRole('menuitemradio', {name: 'Large', exact: true}).click();
    await page.locator('#frontmatter-toggle').click();
    await page.reload(); await page.waitForSelector('.ProseMirror h1');
    await page.addStyleTag({content: ':root {--vscode-font-family: system-ui; --vscode-editor-font-family: monospace;}'});
    assert.equal(await size(), 18, 'font choice survives width, metadata and reload');
    assert.equal(await page.locator('html').getAttribute('data-content-width'), 'large');
    for (const [name, expected] of [['Decrease font size', 12], ['Increase font size', 24]]) {
      await openSize(); const button = page.getByRole('button', {name, exact: true});
      while (await button.isEnabled()) await button.click();
      assert.equal(await size(), expected);
      await page.getByRole('button', {name: 'Close font size controls', exact: true}).click();
    }
    await openSize(); await page.getByRole('button', {name: 'Reset font size to 17 pixels'}).click();
    assert.equal(await size(), 17);
    await page.keyboard.press('Escape');
    await page.locator('#frontmatter-toggle').click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.inlineTheme = theme, theme);
      for (const width of ['normal', 'large', 'full']) {
        await page.evaluate(width => document.documentElement.dataset.contentWidth = width, width);
        for (const viewport of [900, 360]) {
          await page.setViewportSize({width: viewport, height: 800});
          const list = page.locator('.ProseMirror > ul');
          await list.hover();
          const handle = page.locator('.block-group-handle');
          await handle.waitFor({state: 'visible'});
          const grip = await handle.boundingBox(), marker = await page.locator('.git-change').first().boundingBox(), block = await list.boundingBox();
          assert.equal(grip.width, 40); assert.equal(grip.height, 24);
          assert.ok(grip.x >= marker.x + marker.width + 6, 'Git gutter has its own space');
          assert.ok(grip.x + grip.width <= block.x - 6, 'text has a gap after the handle');
          await handle.hover();
          assert.equal(await page.locator('.git-change').first().evaluate(el => {
            const r = el.getBoundingClientRect(); return document.elementFromPoint(r.left + 1, r.top + 2) === el;
          }), true, 'hovered handle never covers the Git marker');
          await page.evaluate(() => {document.getElementById('improve-text').hidden = false; document.getElementById('save-state').textContent = 'Draft retained';});
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          const bar = await page.locator('header').boundingBox();
          if (viewport === 900) assert.ok(bar.height <= 32, 'desktop header remains one compact row');
          else assert.ok(bar.height <= 84, 'narrow header wraps compactly');
        }
      }
      await page.setViewportSize({width: 900, height: 800});
      await page.locator('.ProseMirror > ul').hover();
      await page.screenshot({path: path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, `reading-controls-${theme}.png`)});
    }
    assert.deepEqual(edits, [], 'view controls and hover never write Markdown');
    assert.deepEqual(errors, []);
    console.log('PASS font controls, persistence, compact toolbar and separate Git/drag gutters');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
