const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs'); const path=require('path'); const vm=require('vm'); const {createRequire}=require('module'); const assert=require('assert/strict');
// Point at an extracted VSIX to verify the shipped parser, not just the checkout.
const root=process.env.MARKDOWN_INLINE_EXTENSION_ROOT || path.resolve(__dirname,'..');
assert.ok(process.env.MARKDOWN_INLINE_TEST_ROOT, 'Set MARKDOWN_INLINE_TEST_ROOT to a task directory');
const localRequire=createRequire(path.join(root,'extension.js'));
const mod={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'extension.js'),'utf8'), {module:mod,require:id=>id==='vscode'?{Uri:{joinPath:(base,...parts)=>path.join(base,...parts)}}:localRequire(id)});
const html=mod.exports.MarkdownInlineProvider.prototype.webviewHtml.call({context:{extensionUri:root}}, {cspSource:'file:',asWebviewUri:value=>'file://'+value},root,'dark').replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/,'');
const output=path.join(process.env.MARKDOWN_INLINE_TEST_ROOT,'git-gutter.html');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_BIN, headless: true, args: ['--allow-file-access-from-files']});
  try {
    const page = await browser.newPage({viewport: {width: 1500, height: 760}});
    const errors = [], edits = [];
    page.on('pageerror', error => errors.push(error.stack));
    const baseline = '# Git example\n\nUnchanged paragraph.\n\nOld details.\n\nKeep this paragraph.\n\nRemoved paragraph.\n\n## More details\n\n' + 'A long unchanged paragraph. '.repeat(180) + '\n';
    let text = baseline.replace('Old details.', 'Updated details.').replace('Keep this paragraph.', 'Added paragraph.\n\nKeep this paragraph.').replace('Removed paragraph.\n\n', '');
    let version = 1;
    await page.exposeFunction('bridge', async message => {
      if (message.type === 'ready') await page.evaluate(m => window.postMessage(m, '*'), {type: 'update', text, version, dirty: false});
      if (message.type === 'edit') {
        text = message.text; version++; edits.push(text);
        await page.evaluate(m => {window.__lastEdit = m.text; window.postMessage(m, '*');}, {type: 'editResult', status: 'applied', requestId: message.requestId, text, version, dirty: true});
      }
    });
    await page.addInitScript(() => { window.acquireVsCodeApi = () => ({postMessage: message => window.bridge(message), getState: () => null, setState: () => {}}); });
    await page.goto('file://' + output);
    await page.addStyleTag({content: ':root {--vscode-font-family: system-ui; --vscode-editor-font-family: monospace;}'});
    await page.waitForSelector('.ProseMirror h1');
    assert.equal(await page.locator('.git-change').count(), 0, 'no decorations without Git');
    for (const width of ['normal', 'large', 'full']) {
      for (const viewport of [1500, 700, 360]) {
        await page.setViewportSize({width: viewport, height: 760});
        await page.evaluate(width => document.documentElement.dataset.contentWidth = width, width);
        const positions = await page.evaluate(() => {
          const x = selector => {const range = document.createRange(); range.selectNodeContents(document.querySelector(selector)); return range.getBoundingClientRect().left;};
          return {metadata: x('#frontmatter-add'), heading: x('.ProseMirror h1')};
        });
        assert.ok(Math.abs(positions.metadata - positions.heading) < 1, JSON.stringify({width, viewport, positions}));
      }
    }
    await page.setViewportSize({width: 1500, height: 760});
    await page.evaluate(m => window.postMessage(m, '*'), {type: 'gitBaseline', text: baseline});
    await page.waitForFunction(() => document.querySelectorAll('.git-change').length === 3);
    assert.deepEqual((await page.locator('.git-change').evaluateAll(nodes => nodes.map(node => node.dataset.kind))).sort(), ['added', 'deleted', 'modified']);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.inlineTheme = theme, theme);
      await page.screenshot({path: path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, `git-gutter-${theme}.png`)});
    }
    const marker = page.locator('.git-change[data-kind="modified"]');
    const changed = page.locator('.ProseMirror p').filter({hasText: 'Updated details.'});
    const aligned = async () => assert.ok(Math.abs((await marker.boundingBox()).y - (await changed.boundingBox()).y) < 1);
    await aligned();
    await page.evaluate(() => {document.querySelector('#document-scroll').scrollTop = 80;});
    await aligned();
    await page.evaluate(() => {document.querySelector('#document-scroll').scrollTop = 0;});
    await page.evaluate(m => window.postMessage(m, '*'), {type: 'gitBaseline', text});
    await page.waitForFunction(() => !document.querySelector('.git-change'));
    await changed.click(); await page.keyboard.press('End'); await page.keyboard.type(' Edited locally.');
    await page.waitForSelector('.git-change[data-kind="modified"]');
    await page.waitForFunction(() => window.__lastEdit?.includes('Edited locally.'));
    assert.ok(edits.length > 0 && text.includes('Edited locally.'), 'unsaved changes update the gutter');
    await page.evaluate(m => window.postMessage(m, '*'), {type: 'gitBaseline', text: null});
    await page.waitForFunction(() => !document.querySelector('.git-change'));
    text = '---\ntitle: New\n---\n\n# Git example\n'; version++;
    await page.evaluate(m => window.postMessage(m, '*'), {type: 'update', text, version, dirty: false});
    await page.evaluate(m => window.postMessage(m, '*'), {type: 'gitBaseline', text: text.replace('New', 'Old')});
    await page.waitForSelector('.git-change[data-kind="modified"]');
    assert.ok(Math.abs((await marker.boundingBox()).y - (await page.locator('#frontmatter-card').boundingBox()).y) < 1, 'metadata marker uses frontmatter geometry');
    const editsBeforeLayout = edits.length;
    for (const width of ['normal', 'large', 'full']) {
      for (const viewport of [1500, 700, 360]) {
        await page.setViewportSize({width: viewport, height: 760});
        await page.evaluate(width => document.documentElement.dataset.contentWidth = width, width);
        for (const expanded of [true, false]) {
          const toggle = page.locator('#frontmatter-toggle');
          if (await toggle.getAttribute('aria-expanded') !== String(expanded)) await toggle.click();
          const card = await page.locator('#frontmatter-card').boundingBox();
          const heading = await page.locator('.ProseMirror h1').boundingBox();
          const context = JSON.stringify({width, viewport, expanded, card, heading});
          assert.ok(Math.abs(card.x - heading.x) < 1, 'metadata left edge: ' + context);
          assert.ok(Math.abs(card.x + card.width - heading.x - heading.width) < 1, 'metadata right edge: ' + context);
          assert.ok(card.x >= 0 && card.x + card.width <= viewport, 'metadata stays in viewport: ' + context);
        }
      }
    }
    assert.equal(edits.length, editsBeforeLayout, 'metadata layout and disclosure never edit Markdown');
    assert.deepEqual(errors, []);
    console.log('PASS metadata alignment, Git colors, scroll, widths, unsaved edits, baseline reset and frontmatter');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
