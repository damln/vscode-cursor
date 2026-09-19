const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const { flushEditor } = require('./browser-flush.cjs');
const { webviewPage } = require('./browser-webview.cjs');
const { output, html } = webviewPage('table-insert');
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_BIN, headless: true, args: ['--allow-file-access-from-files']});
  try {
    const page = await browser.newPage(), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.stack));
    let text = '# Tables\n\nStart\n', version = 1, saved = '', copied = '';
    const send = m => page.evaluate(m => window.postMessage(m, '*'), m);
    await page.exposeFunction('bridge', async m => {
      if (m.type === 'ready') await send({type: 'update', text, version, dirty: false});
      if (m.type === 'edit') {
        assert.equal(m.version, version); text = m.text;
        await send({type: 'editResult', status: 'applied', requestId: m.requestId, text, version: ++version, dirty: true});
      }
      if (m.type === 'save') saved = text;
      if (m.type === 'flushComplete' && !m.error) {copied = text; }
    });
    await page.addInitScript(() => {window.acquireVsCodeApi = () => ({postMessage: m => window.bridge(m), getState: () => null, setState: () => {}});});
    await page.goto('file://' + output); await page.waitForSelector('.ProseMirror');
    const reset = async source => {
      // Drain the previous edit acknowledgement before simulating a new file.
      await page.waitForFunction(() => !['Synchronizing', 'Loading'].includes(document.querySelector('#save-state').textContent));
      text = source; await send({type: 'update', text, version: ++version, dirty: false});
      await page.waitForTimeout(200);
      await page.locator('.ProseMirror > p').first().click();
      await page.keyboard.press('End');
    };
    for (const mode of ['enter', 'tab', 'pointer', 'arrow']) {
      await reset('# Tables\n\nStart\n');
      await page.keyboard.press('Enter');
      await page.keyboard.type(mode === 'arrow' ? '/' : '/table');
      const menu = page.getByRole('menu', {name: 'Insert block'});
      await menu.waitFor({state: 'visible'});
      if (mode === 'arrow') {await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');}
      else if (mode === 'pointer') await page.getByRole('menuitem', {name: 'Insert table', exact: true}).click();
      else await page.keyboard.press(mode === 'tab' ? 'Tab' : 'Enter');
      const table = page.locator('.ProseMirror table'); await table.waitFor();
      assert.equal(await table.locator('tr').count(), 2);
      assert.equal(await table.locator('th').count(), 2);
      assert.equal(await table.locator('td').count(), 2);
      assert.equal(await page.evaluate(() => getSelection().anchorNode?.parentElement.closest('th')?.cellIndex), 0, 'caret starts in the first header cell');
      await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Modified');
      assert.ok(!text.includes('<br'), 'new empty cells must not contain HTML placeholders');
      await page.keyboard.type('Theme'); await page.keyboard.press('Tab'); await page.keyboard.type('Reference');
      await page.keyboard.press('Tab'); await page.keyboard.type('Login'); await page.keyboard.press('Tab'); await page.keyboard.type('Login flow');
      await page.waitForTimeout(300);
      assert.ok(!text.includes('/table'));
      assert.match(text, /\| Theme \| Reference \|/); assert.match(text, /\| Login \| Login flow \|/);
      console.log('PASS /table via ' + mode);
    }
    const cell = page.locator('td').last();
    await cell.click(); await page.keyboard.press('Home');
    for (let i = 0; i < 'Login flow'.length; i++) await page.keyboard.press('Shift+ArrowRight');
    assert.equal(await page.evaluate(() => getSelection().toString()), 'Login flow');
    const toolbar = page.getByRole('toolbar', {name: 'Table actions'});
    const link = toolbar.getByRole('button', {name: 'Add link (⌘K)', exact: true});
    await link.click();
    const destination = page.getByRole('textbox', {name: 'Link destination'});
    await destination.fill('./login.md'); await destination.press('Enter');
    await page.waitForTimeout(300);
    assert.equal(await cell.locator('a').textContent(), 'Login flow');
    assert.equal(await cell.locator('a').getAttribute('href'), './login.md');
    assert.ok(text.includes('[Login flow](./login.md)'));
    await page.keyboard.press('Control+s'); await flushEditor(page);
    assert.equal(saved, text); assert.equal(copied, text);
    await cell.locator('a').click(); await destination.fill('./changed.md'); await page.keyboard.press('Escape');
    assert.equal(await cell.locator('a').getAttribute('href'), './login.md');
    await cell.locator('a').click(); await page.getByRole('button', {name: 'Remove', exact: true}).click();
    await page.waitForTimeout(200); assert.equal(await cell.locator('a').count(), 0); assert.equal(await cell.textContent(), 'Login flow');
    // Existing slash code/list behavior, cancellation, and ordinary paths remain intact.
    await reset('# Tables\n\nStart\n'); await page.keyboard.press('Enter'); await page.keyboard.type('/table');
    await page.getByRole('menuitem', {name: 'Insert table', exact: true}).focus(); await page.keyboard.press('Escape');
    await page.waitForTimeout(200); assert.equal(await page.locator('.inline-slash-menu[data-show="true"]').count(), 0);
    assert.equal(await page.locator('table').count(), 0); assert.ok((await page.locator('.ProseMirror').innerText()).includes('/table'));
    await reset('# Tables\n\nStart\n'); await page.keyboard.press('Enter'); await page.keyboard.type('/code'); await page.keyboard.press('Enter');
    await page.locator('.code-lang-wrapper').waitFor();
    await reset('# Tables\n\nStart\n'); await page.keyboard.type(' /list'); await page.keyboard.press('Enter'); await page.locator('.ProseMirror ul').waitFor();
    await reset('# Tables\n\nStart\n'); await page.keyboard.type(' /table/path'); await page.waitForTimeout(200);
    assert.equal(await page.locator('.inline-slash-menu[data-show="true"]').count(), 0);
    // Row/column insertion and clearing cells must save blanks, not HTML fillers.
    await reset('# Tables\n\nStart\n\n| Theme | Reference |\n| - | - |\n| Navigation | [Guide](./guide.md) |\n');
    const synced = () => page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Modified');
    await page.locator('th').last().click();
    await toolbar.getByRole('button', {name: 'Add column right', exact: true}).click();
    await synced();
    assert.equal(await page.locator('th').count(), 3);
    assert.ok(!text.includes('<br'), 'added columns stay empty');
    await page.locator('td').first().click();
    await toolbar.getByRole('button', {name: 'Add row below', exact: true}).click();
    await synced();
    assert.equal(await page.locator('tr').count(), 3);
    assert.ok(!text.includes('<br'), 'added rows stay empty');
    await page.locator('td').first().click(); await page.keyboard.press('Home'); await page.keyboard.press('Shift+End'); await page.keyboard.press('Backspace');
    await synced();
    assert.ok(!text.includes('<br'), 'cleared cells stay empty');
    assert.ok(text.includes('[Guide](./guide.md)'), 'neighboring links survive table changes');
    await page.keyboard.press('Control+s'); await flushEditor(page);
    assert.equal(saved, text); assert.equal(copied, text);
    await reset(saved);
    assert.equal(await page.locator('th').count(), 3, 'blank cells reload in the visual editor');
    await reset('# Tables\n\nStart\n\nEnd\n'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    assert.equal(await page.locator('.ProseMirror > p').count(), 4);
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => document.querySelector('#save-state').textContent !== 'Synchronizing');
    assert.ok(!text.includes('<br'), 'blank paragraphs do not create HTML');
    // Explicit breaks and code examples are authored content, not placeholders.
    for (const br of ['<br>', '<br/>', '<br />']) {
      await reset(`# Tables\n\nStart\n\n| Theme | Reference |\n| - | - |\n| Navigation | Before${br}After |\n| Break | ${br} |\n\n${br}\n\n\`${br}\`\n\n\`\`\`html\n${br}\n\`\`\`\n`);
      await page.locator('td').first().click(); await page.keyboard.press('End'); await page.keyboard.type(' changed');
      await synced();
      assert.ok(text.includes(`Before${br}After`), 'explicit cell breaks survive editing');
      assert.ok(text.includes(`| Break | ${br} |`), 'explicit breaks alone in a cell are preserved');
      assert.ok(text.includes(`\n\n${br}\n\n`));
      assert.ok(text.includes(`\`${br}\``)); assert.ok(text.includes(`\n${br}\n`));
    }
    console.log('PASS blank cells/rows/columns, clearing, blank paragraphs, save/copy and authored HTML/code preservation');
    assert.deepEqual(errors, []); console.log('PASS cell text link, save/copy, edit cancellation, removal, slash cancellation, code/list regression and ordinary paths');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
