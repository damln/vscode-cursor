const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const { webviewPage } = require('./browser-webview.cjs');
const { output } = webviewPage('formatting-state');
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_BIN, headless: true, args: ['--allow-file-access-from-files']});
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.stack));
    let text = '# Formatting\n\n**Bold paragraph**\n\n| Kind | Value |\n| --- | --- |\n| Bold | **Bold cell** |\n| Italic | *Italic cell* |\n| Strike | ~~Strike cell~~ |\n| Code | `Code cell` |\n| Plain | Plain cell |\n| Mixed | **Bold** plain |\n| Combined | ***Both*** |\n';
    let version = 1;
    await page.exposeFunction('bridge', async m => {
      const send = message => page.evaluate(message => window.postMessage(message, '*'), message);
      if (m.type === 'ready') await send({type: 'update', text, version, dirty: false});
      if (m.type === 'edit') {
        assert.equal(m.version, version);
        text = m.text;
        await send({type: 'editResult', status: 'applied', requestId: m.requestId, text, version: ++version, dirty: true});
      }
    });
    await page.addInitScript(() => {window.acquireVsCodeApi = () => ({postMessage: m => window.bridge(m), getState: () => null, setState: () => {}});});
    await page.goto('file://' + output);
    await page.waitForSelector('.ProseMirror td');
    const table = page.getByRole('toolbar', {name: 'Table actions'});
    const formats = ['strong', 'emphasis', 'strike_through', 'inlineCode'];
    const cell = kind => page.locator('tr').filter({has: page.locator('td').filter({hasText: new RegExp('^' + kind + '$')})}).locator('td').last();
    const button = (bar, name) => bar.locator(`button[data-mark="${name}"]`);
    async function assertState(bar, active) {
      await bar.waitFor({state: 'visible'});
      await page.waitForTimeout(150);
      for (const name of formats) {
        const b = button(bar, name);
        assert.equal(await b.getAttribute('aria-pressed'), String(active.includes(name)), name);
        assert.equal(await b.evaluate(el => el.classList.contains('tb-active')), active.includes(name), name);
      }
    }
    const selectCell = async kind => {
      await cell(kind).click();
      await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
    };
    for (const [index, kind] of ['Bold', 'Italic', 'Strike', 'Code'].entries()) {
      const name = formats[index];
      await cell(kind).click(); await assertState(table, [name]);
      await selectCell(kind); await assertState(table, [name]);
      await button(table, name).click(); await assertState(table, []);
      await button(table, name).click(); await assertState(table, [name]);
      // The toolbar must refresh even while keyboard focus remains in it.
      await page.keyboard.press('Alt+F10'); await button(table, name).focus();
      await page.keyboard.press('Space'); await assertState(table, []);
      await page.keyboard.press('Space'); await assertState(table, [name]);
      await page.keyboard.press('Escape');
    }
    await selectCell('Mixed'); await assertState(table, []);
    await selectCell('Combined'); await assertState(table, ['strong', 'emphasis']);
    await cell('Plain').click(); await assertState(table, []);
    await button(table, 'emphasis').click(); await assertState(table, ['emphasis']);
    await button(table, 'emphasis').click(); await assertState(table, []);
    await button(table, 'strong').click(); await assertState(table, ['strong']);
    await page.keyboard.type('X'); await page.waitForTimeout(300);
    assert.ok(text.includes('**X**'), 'stored marks control the next typed character');
    // Regular toolbar: same states, including updates while a button has focus.
    const paragraph = page.locator('.ProseMirror > p').filter({hasText: /^Bold paragraph$/});
    await paragraph.click(); await page.keyboard.press('Home');
    for (let i = 0; i < 'Bold paragraph'.length; i++) await page.keyboard.press('Shift+ArrowRight');
    assert.equal(await page.evaluate(() => getSelection().toString()), 'Bold paragraph');
    const regular = page.getByRole('toolbar', {name: 'Formatting and block actions'});
    await assertState(regular, ['strong']);
    await page.keyboard.press('Alt+F10');
    await button(regular, 'strong').focus(); await page.keyboard.press('Space'); await assertState(regular, []);
    await page.keyboard.press('Space'); await assertState(regular, ['strong']);
    await page.keyboard.press('Escape');
    // The active color remains distinct when hovering, in either theme.
    await selectCell('Bold');
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => document.documentElement.dataset.inlineTheme = theme, theme);
      await button(table, 'strong').hover(); await page.waitForTimeout(150);
      const style = b => b.evaluate(el => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
      assert.notDeepEqual(await style(button(table, 'strong')), await style(button(table, 'emphasis')));
      await page.screenshot({path: path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, `formatting-${theme}.png`)});
    }
    await page.emulateMedia({forcedColors: 'active'});
    assert.equal(await button(table, 'strong').evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    assert.deepEqual(errors, []);
    console.log('PASS formatting states: four marks, caret/range, pointer/keyboard toggles, mixed/combined text, stored marks, regular toolbar, dark/light hover and forced colors');
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
