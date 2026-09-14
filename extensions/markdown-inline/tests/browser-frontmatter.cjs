const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs'); const path=require('path'); const vm=require('vm'); const {createRequire}=require('module'); const assert=require('assert/strict');
// Point at an extracted VSIX to verify the shipped parser, not just the checkout.
const root=process.env.MARKDOWN_INLINE_EXTENSION_ROOT || path.resolve(__dirname,'..');
assert.ok(process.env.MARKDOWN_INLINE_TEST_ROOT, 'Set MARKDOWN_INLINE_TEST_ROOT to a task directory');
const localRequire=createRequire(path.join(root,'extension.js'));
const mod={exports:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'extension.js'),'utf8'), {module:mod,require:id=>id==='vscode'?{Uri:{joinPath:(base,...parts)=>path.join(base,...parts)}}:localRequire(id)});
const html=mod.exports.MarkdownInlineProvider.prototype.webviewHtml.call({context:{extensionUri:root}}, {cspSource:'file:',asWebviewUri:value=>'file://'+value},root,'dark').replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/,'');
const output=path.join(process.env.MARKDOWN_INLINE_TEST_ROOT,'frontmatter.html');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,html);

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_BIN, headless: true, args: ['--allow-file-access-from-files']});
  try {
    const cases = [
      ['later separators', '# Heading\n\n---\ntitle: Body\n---\n', false],
      ['text before first delimiter', '# Heading\n\nIntroduction\n---\ntitle: Body\n---\n', false],
      ['leading blank line', '\n---\ntitle: Body\n---\n\n# Heading\n', false],
      ['plain text between initial rules', '---\n\ncustom-ui-ux\ncustom-slide-creator\n\n---\n\ncurator-ui-ux\n\n---\n\n# Heading\n', false],
      ['only the first delimiter pair is considered', '---\nordinary text\n---\ntitle: Body\n---\n\n# Heading\n', false],
      ['delimiters in a code block', '```yaml\n---\ntitle: Body\n---\n```\n\n# Heading\n', false],
      ['unterminated header', '---\ntitle: Body\n\n# Heading\n', false],
      ['empty header', '---\n---\n\n# Heading\n', true],
      ['real metadata and body rules', '---\ntitle: Real\n---\n\n# Heading\n\n---\nbody: Markdown\n---\n', true],
      ['repairable malformed metadata', '---\ntags: [broken\n---\n\n# Heading\n', true],
      ['removable fields', '---\nname: Example\ndescription: A long description that should wrap naturally without clipping the text inside the metadata field.\nmetadata:\n  category: Utility\n  last_reviewed: 2026-09-12\n---\n\n# Heading\n', true],
      ['protected anchor', '---\noriginal: &value hello\nreference: *value\n---\n\n# Heading\n', true],
    ];
    if (process.env.MARKDOWN_INLINE_SOURCE_FIXTURE) cases.push([
      'reported separator document', fs.readFileSync(process.env.MARKDOWN_INLINE_SOURCE_FIXTURE, 'utf8') + '\n\n# Heading\n', false,
    ]);
    for (let [name, source, metadata] of cases) {
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
        if (message.type === 'copyDocument') {
          copied = text;
          await page.evaluate(m => window.postMessage(m, '*'), {type: 'copyComplete', target: 'document', requestId: message.requestId});
        }
      });
      await page.addInitScript(() => { window.acquireVsCodeApi = () => ({postMessage: message => window.bridge(message), getState: () => null, setState: () => {}}); });
      await page.goto('file://' + output);
      await page.waitForSelector('.ProseMirror h1');
      assert.equal(await page.locator('#frontmatter-toggle').isVisible(), metadata, name);
      assert.equal(edits.length, 0, 'opening never rewrites the file');
      if (name === 'removable fields') {
        const toggle = page.locator('#frontmatter-toggle');
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        assert.ok((await toggle.textContent()).includes('Show'));
        await toggle.click();
        assert.ok((await toggle.textContent()).includes('Hide'));
        assert.equal(await page.locator('#frontmatter-add').isVisible(), false, 'no duplicate View YAML action');
        for (const theme of ['light', 'dark']) {
          await page.evaluate(value => document.documentElement.dataset.inlineTheme = value, theme);
          await page.setViewportSize({width: 1000, height: 720});
          await page.locator('#frontmatter-card').screenshot({path: path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, `metadata-${theme}.png`)});
        }
        await page.setViewportSize({width: 360, height: 720});
        assert.ok(await page.locator('#frontmatter-card').evaluate(el => el.scrollWidth <= el.clientWidth));
        const removeCategory = page.getByRole('button', {name: 'Remove field metadata.category', exact: true});
        await removeCategory.click();
        assert.equal(text, source, 'opening confirmation never removes a field');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Cancel');
        assert.ok((await page.locator('.metadata-confirm').textContent()).includes('metadata.category'));
        await page.locator('.metadata-confirm').getByRole('button', {name: 'Cancel', exact: true}).click();
        assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Remove field metadata.category');
        assert.equal(text, source, 'cancel leaves YAML untouched');
        await removeCategory.click();
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.metadata-confirm').count(), 0);
        await removeCategory.click();
        await page.getByRole('textbox', {name: 'name (string)', exact: true}).click();
        assert.equal(await page.locator('.metadata-confirm').count(), 0, 'clicking outside dismisses');
        await removeCategory.click();
        for (const theme of ['light', 'dark']) {
          await page.evaluate(value => document.documentElement.dataset.inlineTheme = value, theme);
          await page.locator('#frontmatter-card').screenshot({path: path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, `metadata-confirm-${theme}.png`)});
        }
        assert.ok(await page.locator('#frontmatter-card').evaluate(el => el.scrollWidth <= el.clientWidth));
        await page.locator('.metadata-confirm-remove').click();
        source = source.replace('  category: Utility\n', '');
        await page.waitForFunction(expected => !document.querySelector('#frontmatter-fields').textContent.includes(expected), 'metadata.category');
        await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Modified');
        assert.equal(text, source, 'removing a field preserves every unrelated byte');
        assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Remove field metadata.last_reviewed');
        await toggle.click(); await toggle.click();
        assert.equal(await page.getByRole('textbox', {name: 'name (string)', exact: true}).inputValue(), 'Example');
        await page.getByRole('button', {name: 'YAML', exact: true}).click();
        assert.ok(!(await page.locator('.frontmatter-source').inputValue()).includes('category'));
        await page.getByRole('button', {name: 'Fields', exact: true}).click();
      }
      if (name === 'removable fields' || name === 'later separators') {
        const creating = name === 'later separators';
        const priorEdits = edits.length;
        const open = () => page.getByRole('button', {name: creating ? 'Add metadata' : 'Add field', exact: true}).click();
        await open();
        const fieldName = page.getByRole('textbox', {name: 'Field name', exact: true});
        const value = page.getByRole('textbox', {name: 'Value', exact: true});
        const add = page.getByRole('button', {name: 'Add', exact: true});
        assert.equal(await add.isDisabled(), true);
        await fieldName.fill('author'); await value.fill('false');
        await page.locator('#frontmatter-toggle').click(); await page.locator('#frontmatter-toggle').click();
        assert.equal(await fieldName.inputValue(), 'author', 'collapse retains the draft');
        await value.press('Escape');
        assert.equal(edits.length, priorEdits, 'cancel does not create or change metadata');
        await open();
        if (!creating) {
          await fieldName.fill('name'); await add.click();
          assert.ok((await page.locator('.metadata-new-error').textContent()).includes('already exists'));
          assert.equal(edits.length, priorEdits, 'duplicate field does not overwrite data');
        }
        await fieldName.fill('author'); await value.fill('false');
        for (const theme of ['light', 'dark']) {
          await page.evaluate(value => document.documentElement.dataset.inlineTheme = value, theme);
          await page.setViewportSize({width: 1000, height: 720});
          await page.locator('#frontmatter-card').screenshot({path: path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, `metadata-add-${creating}-${theme}.png`)});
        }
        await page.setViewportSize({width: 360, height: 720});
        assert.ok(await page.locator('#frontmatter-card').evaluate(el => el.scrollWidth <= el.clientWidth), 'add form fits a narrow editor');
        await add.click();
        assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'author (string)');
        source = creating ? '---\nauthor: "false"\n---\n' + source : source.replace('\n---\n\n# Heading', '\nauthor: "false"\n---\n\n# Heading');
        await page.waitForFunction(() => document.querySelector('#save-state').textContent === 'Modified');
        await page.keyboard.press('Control+s');
        await page.locator('#copy-document').click();
        await page.waitForFunction(() => document.querySelector('#copy-document').dataset.state === 'success');
        assert.equal(text, source, 'adding one field retains all existing YAML and body bytes');
        assert.equal(await page.getByRole('textbox', {name: 'author (string)', exact: true}).inputValue(), 'false');
        metadata = true;
      }
      if (name === 'protected anchor') {
        await page.locator('#frontmatter-toggle').click();
        await page.getByRole('button', {name: 'Remove field original', exact: true}).click();
        await page.locator('.metadata-confirm-remove').click();
        assert.ok((await page.locator('.frontmatter-error').textContent()).includes('YAML alias'));
        assert.equal(text, source, 'an anchor still in use is not deleted');
      }
      if (name === 'real metadata and body rules') {
        await page.locator('#frontmatter-toggle').click();
        assert.equal(await page.getByRole('textbox', {name: 'title (string)', exact: true}).inputValue(), 'Real');
        assert.ok((await page.locator('.ProseMirror').textContent()).includes('body: Markdown'));
      }
      if (name === 'repairable malformed metadata') assert.equal(await page.locator('.frontmatter-error').isVisible(), true);
      await page.locator('.ProseMirror h1').click();
      await page.keyboard.press('End'); await page.keyboard.type(' edited');
      await page.keyboard.press('Control+s'); await page.locator('#copy-document').click();
      await page.waitForFunction(() => document.querySelector('#copy-document').dataset.state === 'success');
      assert.equal(text, source.replace('# Heading', '# Heading edited'), name + ': every other byte is preserved');
      assert.equal(saved, text); assert.equal(copied, text);
      if (metadata) {
        if (await page.locator('#frontmatter-toggle').getAttribute('aria-expanded') === 'false') await page.locator('#frontmatter-toggle').click();
        await page.locator('.metadata-remove').click();
        assert.equal(await page.locator('.metadata-confirm').count(), 1);
        text = '# Heading\n\n---\ntitle: Later\n---\n'; version++;
        await page.evaluate(m => window.postMessage(m, '*'), {type: 'update', text, version, dirty: false});
        await page.locator('#frontmatter-toggle').waitFor({state: 'hidden'});
        assert.equal(await page.locator('.metadata-confirm').count(), 0, 'external updates cancel stale removal confirmations');
        assert.ok((await page.locator('.ProseMirror').textContent()).includes('title: Later'), 'external updates also respect the first-line rule');
      }
      assert.deepEqual(errors, []);
      await page.close(); console.log('PASS ' + name);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
