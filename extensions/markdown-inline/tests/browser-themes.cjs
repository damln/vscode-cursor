const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const { loadExtension, localRequire, root, webviewPage } = require('./browser-webview.cjs');
const { output, html } = webviewPage('themes');
const extension = loadExtension();
(async () => {
  const {THEMES}=localRequire('./themes');
  const stored=new Map(), notifications=[];
  const host={context:{globalState:{update:async(k,v)=>stored.set(k,v)}},panels:new Set([
    {webview:{postMessage:async message=>notifications.push(message)}},
    {webview:{postMessage:async message=>notifications.push(message)}},
  ])};
  await extension.MarkdownInlineProvider.prototype.setTheme.call(host,'midnight');
  assert.equal(stored.get('damlnMarkdownInline.theme'),'midnight');
  assert.equal(notifications.length,2);
  await extension.MarkdownInlineProvider.prototype.setTheme.call(host,'<style>');
  assert.equal(notifications.length,2);
  const browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true,args:['--allow-file-access-from-files']});
  try {
    const page=await browser.newPage({viewport:{width:1100,height:900}});
    const errors=[], edits=[];
    let saved='charcoal', codeWrap=true;
    const text='---\ntitle: Theme sample\n---\n\n# A little clarity\n\nA [good idea](https://example.com) and **a useful note**.\n\n| Notes | Status |\n| --- | --- |\n| Next chapter | Ready |\n\n~~~js\nconst idea = "abcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghijabcdefghij";\n\nconst next = 2;\n~~~\n';
    page.on('pageerror',e=>errors.push(e.stack));
    await page.exposeFunction('bridge',async m=>{
      if(m.type==='ready') {
        await page.evaluate(m=>window.postMessage(m,'*'),{type:'update',text,version:1,dirty:false});
        await page.evaluate(m=>window.postMessage(m,'*'),{type:'theme',theme:saved});
        await page.evaluate(m=>window.postMessage(m,'*'),{type:'readingPreferences',fontSize:17,contentWidth:'normal',codeWrap});
      }
      if(m.type==='setTheme') {
        saved=m.theme;
        await page.evaluate(m=>window.postMessage(m,'*'),{type:'theme',theme:saved});
      }
      if(m.type==='setReadingPreference' && m.key==='codeWrap') codeWrap=m.value;
      if(m.type==='edit') edits.push(m);
    });
    await page.addInitScript(()=>{window.acquireVsCodeApi=()=>({postMessage:m=>window.bridge(m),getState:()=>null,setState:()=>{}});});
    const load=async()=>{await page.goto('file://'+output);await page.waitForSelector('.ProseMirror h1');await page.addStyleTag({content:':root {--vscode-font-family:system-ui;--vscode-editor-font-family:monospace;}'});};
    await load();
    const trigger=page.getByRole('button',{name:'Editor settings',exact:true});
    const dialog=page.getByRole('dialog',{name:'Editor settings'});
    const code=page.locator('pre.code-with-gutter > code');
    await page.waitForFunction(()=>{const code=document.querySelector('pre.code-with-gutter > code');return code && code.scrollWidth <= code.clientWidth+1;});
    const wrappedHeight=await code.evaluate(el=>el.clientHeight);
    await trigger.click(); await dialog.waitFor();
    await page.waitForTimeout(180);
    await page.screenshot({path:path.join(process.env.MARKDOWN_INLINE_TEST_ROOT,'editor-settings.png')});
    const wrap=dialog.getByRole('switch',{name:'Wrap code lines'});
    assert.equal(await wrap.getAttribute('aria-checked'),'true');
    await wrap.click(); assert.equal(codeWrap,false);
    await page.waitForFunction(()=>{const code=document.querySelector('pre.code-with-gutter > code');return code.scrollWidth>code.clientWidth;});
    assert.ok(await code.evaluate(el=>el.clientHeight)<wrappedHeight);
    await page.keyboard.press('Escape'); await load();
    assert.equal(await page.locator('html').getAttribute('data-code-wrap'),'false','wrap preference restores on reopen');
    await trigger.click(); await wrap.click(); assert.equal(codeWrap,true);
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:480,height:850});
    await page.waitForTimeout(100);
    const alignment=await code.evaluate(el=>{
      const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
      let offset=el.textContent.indexOf('const next'), node;
      while ((node=walker.nextNode())) {if(offset<node.length)break;offset-=node.length;}
      const range=document.createRange();range.setStart(node,offset);range.setEnd(node,offset+1);
      const rect=range.getBoundingClientRect();
      const label=el.parentElement.querySelector('.code-gutter > span:nth-child(3)').getBoundingClientRect();
      return {code:rect.top+rect.height/2,number:label.top+label.height/2,overflow:el.scrollWidth>el.clientWidth+1};
    });
    assert.equal(alignment.overflow,false,'long unbroken code wraps at narrow widths');
    assert.ok(Math.abs(alignment.code-alignment.number)<2,'logical line numbers align after wrapped and blank lines');
    assert.equal(edits.length,0,'wrapping and settings never edit Markdown');
    await page.setViewportSize({width:1100,height:900});
    const rgb=hex=>'rgb('+hex.slice(1).match(/../g).map(v=>parseInt(v,16)).join(', ')+')';
    await trigger.click();await dialog.waitFor();
    assert.equal(await dialog.getByRole('radio').count(),10);
    for(const theme of THEMES) {
      const radio=dialog.getByRole('radio',{name:theme.name+', '+theme.mode,exact:true});
      assert.equal(await radio.locator('.theme-preview').evaluate(el=>getComputedStyle(el).backgroundColor),rgb(theme.colors[0]));
      await radio.click();
      assert.equal(saved,theme.id);
      assert.equal(await page.locator('html').getAttribute('data-inline-theme'),theme.mode);
      assert.equal(await page.locator('html').getAttribute('data-editor-theme'),theme.id);
      assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),rgb(theme.colors[0]));
      assert.equal(await dialog.locator('[role=radio][aria-checked=true]').count(),1);
      assert.equal(await radio.getAttribute('aria-checked'),'true');
      if(['dune','glacier','obsidian','cocoa'].includes(theme.id)) {
        await page.waitForTimeout(180);
        await page.screenshot({path:path.join(process.env.MARKDOWN_INLINE_TEST_ROOT,'themes-'+theme.id+'.png')});
      }
    }
    await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
    assert.equal(saved,'cocoa');
    await load();
    await page.waitForFunction(()=>document.documentElement.dataset.editorTheme==='cocoa');
    await trigger.focus();await page.keyboard.press('Space');await dialog.waitFor();
    assert.equal(await page.locator(':focus').getAttribute('role'),'switch');
    await dialog.getByRole('radio',{name:'Cocoa, dark',exact:true}).focus();
    await page.keyboard.press('Home');assert.equal(saved,'linen');
    await page.keyboard.press('ArrowRight');assert.equal(saved,'paper');
    await page.keyboard.press('ArrowDown');assert.equal(saved,'glacier');
    await page.keyboard.press('End');assert.equal(saved,'cocoa');
    for(let i=0;i<5;i++) {await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);}
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await trigger.click();await page.mouse.click(2,2);await dialog.waitFor({state:'hidden'});
    await page.setViewportSize({width:360,height:640});await trigger.click();await dialog.waitFor();
    const box=await dialog.boundingBox();
    assert.ok(box.x>=0 && box.x+box.width<=360 && box.y>=0 && box.y+box.height<=640);
    assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await dialog.getByRole('radio',{name:'Rose, light',exact:true}).click();
    assert.equal(saved,'rose');
    await page.keyboard.press('Escape');
    await page.emulateMedia({reducedMotion:'reduce'});await trigger.click();
    assert.equal(await dialog.evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
    await page.evaluate(()=>window.postMessage({type:'theme',theme:'paper'},'*'));
    await page.waitForFunction(()=>document.documentElement.dataset.editorTheme==='paper');
    assert.equal(await dialog.getByRole('radio',{name:'Paper, light',exact:true}).getAttribute('aria-checked'),'true');
    assert.deepEqual(edits,[]);
    assert.deepEqual(errors,[]);
    console.log('PASS ten theme previews, persistence/broadcast, host validation, immediate application, keyboard, modal focus, Escape/backdrop, narrow layout, reduced motion and no document edits');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
