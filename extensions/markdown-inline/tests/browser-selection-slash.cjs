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
const output = path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, 'selection-slash.html');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, mod.exports.MarkdownInlineProvider.prototype.webviewHtml.call(
  { context: { extensionUri: root } }, { cspSource: 'file:', asWebviewUri: value => 'file://' + value }, root, 'dark'
).replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, ''));
(async () => {
  const browser = await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true,args:['--allow-file-access-from-files']});
  try {
    const page = await browser.newPage({viewport:{width:1100,height:800}});
    const errors=[], edits=[];
    let text='# Heading\n\nSelect these words.\n\nSecond paragraph.\n',version=1;
    const send=m=>page.evaluate(m=>window.postMessage(m,'*'),m);
    page.on('pageerror',e=>errors.push(e.stack));
    await page.exposeFunction('bridge',async m=>{
      if(m.type==='ready') await send({type:'update',text,version,dirty:false});
      if(m.type==='edit') {
        assert.equal(m.version,version);
        text=m.text;edits.push(text);version++;
        await send({type:'editResult',status:'applied',requestId:m.requestId,text,version,dirty:true});
      }
    });
    await page.addInitScript(()=>{window.acquireVsCodeApi=()=>({postMessage:m=>window.bridge(m),getState:()=>null,setState:()=>{}});});
    await page.goto('file://'+output);await page.waitForSelector('.ProseMirror h1');
    await page.addStyleTag({content:':root {--vscode-font-family:system-ui;--vscode-editor-font-family:monospace;}'});
    const menu=page.getByRole('dialog',{name:'Format selected text'});
    const search=page.getByRole('combobox',{name:'Filter formatting commands'});
    const select=async (selector='.ProseMirror > p',from=0,to=6)=>{
      await page.locator(selector).first().evaluate((el,{from,to})=>{
        document.querySelector('.ProseMirror').focus();
        const node=document.createTreeWalker(el,NodeFilter.SHOW_TEXT).nextNode();
        const r=document.createRange();r.setStart(node,from);r.setEnd(node,to);
        getSelection().removeAllRanges();getSelection().addRange(r);
      },{from,to});
      await page.waitForTimeout(60);
    };
    const reset=async (source='# Heading\n\nSelect these words.\n\nSecond paragraph.\n')=>{
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      text=source;
      await send({type:'update',text,version:++version,dirty:false});
      await page.waitForTimeout(200);
    };
    const open=async()=>{await page.keyboard.press('/');await menu.waitFor();assert.equal(await search.evaluate(el=>el===document.activeElement),true);};
    const run=async(query)=>{await open();await search.fill(query);await page.keyboard.press('Enter');await page.waitForTimeout(350);};
    await select(); const original=text,count=edits.length;
    await open();
    assert.deepEqual(await menu.locator('[role=option] > span:first-child').allTextContents(),
      ['Bold','Italic','Strikethrough','Inline code','Link','Heading 1','Heading 2','Heading 3','Heading 4','Paragraph','Bullet list','Ordered list','Task list','Blockquote','Move up','Move down']);
    await search.fill('not a command');await page.keyboard.press('Enter');
    assert.equal(text,original);assert.equal(edits.length,count);
    await search.fill('bold');await page.keyboard.press('Escape');
    assert.equal(await menu.isVisible(),false);
    assert.equal(await page.evaluate(()=>getSelection().toString()),'Select');
    assert.equal(text,original);
    // A normal typing action after cancel must still replace the original selection.
    await page.keyboard.type('Replacement');await page.waitForTimeout(350);
    assert.match(text,/Replacement these words/);
    for(const [query,selector,syntax] of [
      ['bold','strong',/\*\*Select\*\*/],['italic','em',/\*Select\*/],
      ['strike','del',/~~Select~~/],['inline code','code',/`Select`/],
    ]) {
      await reset();await select();await run(query);
      assert.equal(await page.locator('.ProseMirror > p '+selector).first().textContent(),'Select');
      assert.match(text,syntax);
      await select();await run(query);
      assert.equal(await page.locator('.ProseMirror > p '+selector).count(),0,'same command toggles formatting off');
    }
    for(const level of [1,2,3,4]) {
      await reset();await select();await run('h'+level);
      assert.equal(await page.locator('.ProseMirror h'+level).last().textContent(),'Select these words.');
      await select('.ProseMirror h'+level+(level===1?':last-of-type':''));await run('paragraph');
      assert.equal(await page.locator('.ProseMirror > p').first().textContent(),'Select these words.');
    }
    for(const [query,selector] of [['list','ul'],['ordered','ol'],['task','li[data-item-type="task"]'],['quote','blockquote']]) {
      await reset();await select();await run(query);
      assert.ok(await page.locator('.ProseMirror '+selector).count()>0,query);
    }
    await reset();await select();await run('down');
    assert.ok(text.indexOf('Second paragraph')<text.indexOf('Select these words'));
    await select('.ProseMirror > p:last-of-type');await run('up');
    assert.ok(text.indexOf('Select these words')<text.indexOf('Second paragraph'));
    await reset();await select();await open();await search.fill('link');await page.keyboard.press('Enter');
    const destination=page.getByRole('textbox',{name:'Link destination'});
    await destination.fill('./guide.md');await page.keyboard.press('Enter');await page.waitForTimeout(350);
    assert.match(text,/\[Select\]\(\.\/guide.md\)/);
    // Cell selections use the same inline commands, without invalid block transforms.
    await reset('# Table\n\n| Name | Value |\n| --- | --- |\n| Select text | Other |\n');
    await select('.ProseMirror td');await open();
    assert.equal(await menu.locator('[role=option]').count(),5);
    await search.fill('italic');await page.keyboard.press('Tab');await page.waitForTimeout(350);
    assert.equal(await page.locator('.ProseMirror td em').textContent(),'Select');
    // Keyboard navigation chooses actions while the document remains untouched.
    await reset();await select();await open();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.waitForTimeout(350);
    assert.equal(await page.locator('.ProseMirror em').textContent(),'Select');
    await reset();await select();await open();await search.fill('bold');
    await send({type:'update',text:'# External\n\nNew content.\n',version:++version,dirty:false});
    await page.waitForTimeout(200);assert.equal(await menu.isVisible(),false,'external changes cancel stale selection');
    await reset();await select();await page.keyboard.insertText('/');await menu.waitFor();
    await page.setViewportSize({width:360,height:640});
    await page.waitForTimeout(200);
    await page.screenshot({path:path.join(process.env.MARKDOWN_INLINE_TEST_ROOT,'selection-menu.png')});
    const bounds=await menu.boundingBox();
    assert.ok(bounds.x>=0 && bounds.x+bounds.width<=360 && bounds.y+bounds.height<=640);
    const unchanged=text;
    await search.fill('bold');
    await search.dispatchEvent('keydown',{key:'Enter',isComposing:true});
    assert.equal(text,unchanged);
    await menu.getByRole('option',{name:'Bold',exact:true}).click();await page.waitForTimeout(350);
    assert.match(text,/\*\*Select\*\*/);
    await page.setViewportSize({width:1100,height:800});
    await reset('# Lines\n\nFirst line\nSecond line\n\nThird paragraph\n');
    await page.locator('.ProseMirror').evaluate(editor=>{
      editor.focus();
      const p=editor.querySelectorAll('p'),r=document.createRange();
      r.setStart(p[0].firstChild,0);r.setEnd(p[1].firstChild,5);
      getSelection().removeAllRanges();getSelection().addRange(r);
    });
    await page.waitForTimeout(60);await run('list');
    assert.deepEqual(await page.locator('.ProseMirror li').allTextContents(),['First line','Second line','Third paragraph']);
    await reset('# Code\n\n```js\nSelect text\n```\n');
    await select('.ProseMirror pre code');await page.keyboard.press('/');
    assert.equal(await menu.isVisible(),false,'slash inside code remains literal');
    await page.waitForTimeout(350);assert.ok(text.includes('/ text'));
    // The caret slash insertion menu stays available.
    await reset('# Insert\n\nStart\n');await page.locator('.ProseMirror > p').click();await page.keyboard.press('End');await page.keyboard.press('Enter');await page.keyboard.type('/table');
    await page.getByRole('menu',{name:'Insert block'}).waitFor();await page.keyboard.press('Enter');
    await page.locator('.ProseMirror table').waitFor();
    assert.deepEqual(errors,[]);
    console.log('PASS selection slash: action parity, filter, cancellation without edits, toggle marks, headings, lists, moves, links, cells, keyboard, external updates and insertion regression');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
