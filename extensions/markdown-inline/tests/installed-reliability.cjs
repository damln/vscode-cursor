const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const remoteHost = process.env.MARKDOWN_INLINE_TEST_HOST;
const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
async function read(file) { return remoteHost ? execFileSync('ssh', [remoteHost, 'cat -- ' + quote(file)], {encoding:'utf8'}) : fs.readFile(file,'utf8'); }
async function write(file, text) {
  if (remoteHost) execFileSync('ssh', [remoteHost, 'cat > ' + quote(file)], {input:text});
  else await fs.writeFile(file,text);
}
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  assert.ok(process.env.MARKDOWN_INLINE_TEST_FILE, 'Set MARKDOWN_INLINE_TEST_FILE to an isolated fixture');
  const browser = await chromium.connectOverCDP(process.env.VSCODE_CDP || 'http://127.0.0.1:9333');
  try {
    const cdp = await browser.newBrowserCDPSession();
    const targets = await cdp.send('Target.getTargets');
    const target = targets.targetInfos.find(item => item.type === 'iframe' && item.url.includes('extensionId=damln.markdown-inline') && (remoteHost ? item.url.includes('remoteAuthority=') : !item.url.includes('remoteAuthority=')));
    assert.ok(target, 'The installed Markdown Inline webview must be open');
    let { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
    let id = 0;
    const pending = new Map();
    cdp.on('Target.receivedMessageFromTarget', event => {
      const message = JSON.parse(event.message);
      const callback = pending.get(message.id);
      if (callback) { pending.delete(message.id); callback(message); }
    });
    async function evaluate(body) {
      const request = ++id;
      const response = new Promise(resolve => pending.set(request, resolve));
      await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({
        id: request, method: 'Runtime.evaluate', params: { returnByValue: true,
          expression: `(() => { const frame=document.querySelector('#active-frame'); if (!frame?.contentDocument) return null; const d=frame.contentDocument; const w=frame.contentWindow; ${body} })()` },
      }) });
      const message = await response;
      assert.equal(message.result?.exceptionDetails, undefined, JSON.stringify(message));
      return message.result.result.value;
    }
    async function until(body) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (await evaluate(body)) return;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      assert.fail('Timed out: ' + body);
    }
    const key = (value, shift = false) => evaluate(`d.body.dispatchEvent(new w.KeyboardEvent('keydown', {key:${JSON.stringify(value)},ctrlKey:true,shiftKey:${shift},bubbles:true}));`);
    for (const candidate of targets.targetInfos.filter(item => item.type === 'iframe' && item.url.includes('extensionId=damln.markdown-inline') && (remoteHost ? item.url.includes('remoteAuthority=') : !item.url.includes('remoteAuthority=')))) {
      ({sessionId} = await cdp.send('Target.attachToTarget', {targetId:candidate.targetId,flatten:false}));
      if (await evaluate("return d.querySelector('.ProseMirror h1')?.textContent==='Installed VSIX'")) break;
    }
    const file = process.env.MARKDOWN_INLINE_TEST_FILE;
    const original = await read(file);
    assert.equal(await evaluate("return d.querySelector('#save-state').textContent"), 'Saved');
    await evaluate("d.querySelector('.code-lang-trigger').click();");
    await evaluate("[...d.querySelectorAll('.code-lang-item')].find(item=>item.textContent==='python').click();");
    await until("return d.querySelector('#save-state').textContent==='Modified'");
    assert.equal(await read(file), original, 'manual-save mode must not write prematurely');
    await key('s');
    await until("return d.querySelector('#save-state').textContent==='Saved'");
    assert.equal(await read(file), original.replace('```js', '```python'));
    await key('z');
    await until("return d.querySelector('.code-lang-trigger').textContent==='js'");
    await key('z', true);
    await until("return d.querySelector('.code-lang-trigger').textContent==='python'");
    await evaluate("d.querySelector('#frontmatter-toggle').click();const field=d.querySelector('.frontmatter-value');field.focus();field.value='After';field.dispatchEvent(new w.Event('input',{bubbles:true}));");
    await key('s');
    await until("return d.querySelector('#save-state').textContent==='Saved'");
    let changed = original.replace('```js', '```python').replace('"Before"', '"After"');
    assert.equal(await read(file), changed, 'Save must include the focused field');
    await key('z');
    await until("return d.querySelector('.frontmatter-value').value==='Before'");
    await key('z', true);
    await until("return d.querySelector('.frontmatter-value').value==='After'");
    await key('s');
    await until("return d.querySelector('#save-state').textContent==='Saved'");
    await evaluate("[...d.querySelectorAll('.metadata-modes button')].find(button=>button.textContent==='YAML').click();const field=d.querySelector('.frontmatter-source');field.focus();field.value=field.value.replace('After','From raw');field.dispatchEvent(new w.Event('input',{bubbles:true}));");
    await key('s');
    await until("return d.querySelector('#save-state').textContent==='Saved'");
    await evaluate("d.querySelector('.frontmatter-source').blur();d.querySelector('.metadata-modes button').click();");
    changed=changed.replace('"After"', '"From raw"');
    assert.equal(await read(file), changed, 'raw YAML editing must preserve the native line-ending convention');
    await evaluate("d.querySelector('.frontmatter-delete').click();");
    assert.equal(await read(file), changed, 'opening removal confirmation leaves the file intact');
    await key('Escape');
    assert.equal(await evaluate("return !!d.querySelector('.metadata-confirm')"), false);
    await evaluate("d.querySelector('.frontmatter-delete').click();d.querySelector('.metadata-confirm-remove').click();");
    await until("return d.querySelector('#save-state').textContent==='Modified'");
    await key('s');
    await until("return d.querySelector('#save-state').textContent==='Saved'");
    assert.equal(await read(file), changed.replace(/^title:.*\r?\n/m, ''), 'field removal preserves body and delimiters');
    await key('z');
    await until("return d.querySelector('.frontmatter-value')?.value==='From raw'");
    await key('z', true);
    await until("return !!d.querySelector('.metadata-empty')");
    await key('z');
    await until("return d.querySelector('.frontmatter-value')?.value==='From raw'");
    await key('s');
    await until("return d.querySelector('#save-state').textContent==='Saved'");
    assert.equal(await read(file), changed, 'native undo restores the exact YAML field');
    await evaluate("d.querySelector('#frontmatter-toggle').click();");
    assert.equal(await evaluate("return d.querySelector('#frontmatter-fields').hidden"), true);
    await evaluate("d.querySelector('#frontmatter-toggle').click();");
    console.log('PASS metadata field removal: save, native undo/redo, final-field empty state, collapse without document changes');
    await evaluate("d.querySelector('.metadata-add-field').click();const name=d.querySelector('#metadata-new-name');name.value='author';name.dispatchEvent(new w.Event('input',{bubbles:true}));const value=d.querySelector('#metadata-new-value');value.value='false';value.dispatchEvent(new w.Event('input',{bubbles:true}));d.querySelector('.metadata-new-field').requestSubmit();");
    await until("return d.querySelector('#save-state').textContent==='Modified'");
    await key('s');
    await until("return d.querySelector('#save-state').textContent==='Saved'");
    const eol=changed.includes('\r\n')?'\r\n':'\n';
    const added=changed.replace(eol+'---'+eol+eol, eol+'author: "false"'+eol+'---'+eol+eol);
    assert.equal(await read(file),added,'visual addition preserves existing YAML and body bytes');
    await key('z');
    await until("return d.querySelectorAll('.frontmatter-value').length===1");
    await key('z',true);
    await until("return d.querySelectorAll('.frontmatter-value').length===2");
    await key('s');
    await until("return d.querySelector('#save-state').textContent==='Saved'");
    assert.equal(await read(file),added,'native redo restores the added string field');
    await key('z');
    await until("return d.querySelectorAll('.frontmatter-value').length===1");
    await key('s');
    await until("return d.querySelector('#save-state').textContent==='Saved'");
    assert.equal(await read(file),changed,'native undo removes exactly the added field');
    console.log('PASS visual field addition: save, string typing, native undo/redo, exact source preservation');
    await evaluate("d.querySelector('.metadata-remove').click();");
    assert.equal(await read(file), changed, 'whole-header removal also waits for confirmation');
    await evaluate("d.querySelector('.metadata-confirm-remove').click();");
    await until("return d.querySelector('#save-state').textContent==='Modified'");
    await key('s');
    await until("return d.querySelector('#save-state').textContent==='Saved'");
    assert.equal(await read(file), changed.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, ''), 'confirmed metadata removal retains the exact body');
    await key('z');
    await until("return !d.querySelector('#frontmatter-toggle').hidden && d.querySelector('.frontmatter-value')?.value==='From raw' && d.querySelector('#save-state').textContent==='Modified'");
    await key('s');
    await until("return d.querySelector('#save-state').textContent==='Saved'");
    assert.equal(await read(file), changed, 'native undo restores confirmed metadata removal');
    console.log('PASS confirmed field and full metadata removal, Escape cancellation, native save and undo');
    await evaluate("const h=d.querySelector('.ProseMirror h1'),r=h.getBoundingClientRect();h.dispatchEvent(new w.PointerEvent('pointermove',{bubbles:true,clientX:r.x+10,clientY:r.y+10}));d.querySelector('.block-group-handle').click();");
    assert.equal(await evaluate("return d.querySelector('.block-type').textContent"),'h1');
    await evaluate("d.querySelector('.ProseMirror').dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',shiftKey:true,bubbles:true}));");
    assert.equal(await evaluate("return d.querySelectorAll('[data-block-selected]').length"),2);
    await evaluate("[...d.querySelectorAll('.block-group-toolbar button')].find(b=>b.textContent==='Move down').click();");
    await until("return d.querySelector('#save-state').textContent==='Modified'");
    await key('s'); await until("return d.querySelector('#save-state').textContent==='Saved'");
    const moved=await read(file);
    assert.ok(moved.indexOf('```python')<moved.indexOf('# Installed VSIX'),'native group movement changes the order');
    await key('z');
    await until("return d.querySelector('.ProseMirror').firstElementChild?.tagName==='H1'");
    await key('s'); await until("return d.querySelector('#save-state').textContent==='Saved'");
    assert.equal(await read(file),changed,'one native undo restores the whole group');
    await evaluate("d.querySelector('#content-width').click();d.querySelector('[data-width=full]').click();");
    assert.equal(await evaluate("return d.documentElement.dataset.contentWidth"),'full');
    assert.equal(await evaluate("return Math.round(d.querySelector('#document-scroll').getBoundingClientRect().right)===w.innerWidth"),true,'native webview scrollbar reaches the right edge');
    await evaluate("d.querySelector('#content-width').click();d.querySelector('[data-width=normal]').click();");
    console.log('PASS installed whole-block hover, group movement/undo, header width and flush-right scrollbar');
    await evaluate("w.__originalEditor=d.querySelector('.ProseMirror');");
    const external = changed.replace('# Installed VSIX', '# External Installed VSIX');
    await write(file, external);
    await until("return d.querySelector('.ProseMirror h1').textContent==='External Installed VSIX'");
    assert.equal(await evaluate("return w.__originalEditor===d.querySelector('.ProseMirror')"), true, 'external updates must not rebuild the editor');
    assert.equal(await read(file), external);
    await evaluate("w.dispatchEvent(new w.CustomEvent('damln-open-link',{detail:'#external-installed-vsix'}));");
    await until("return w.getSelection().anchorNode?.parentElement.closest('h1')?.textContent==='External Installed VSIX'");
    await evaluate("w.postMessage({type:'pasteText',text:'**PLAIN**'},'*');");
    await until("return d.querySelector('#save-state').textContent==='Modified'");
    await key('s');
    await until("return d.querySelector('#save-state').textContent==='Saved'");
    assert.ok((await read(file)).includes('PLAIN'));
    await key('z');
    await until("return d.querySelector('.ProseMirror h1').textContent==='External Installed VSIX'");
    await key('s');
    await until("return d.querySelector('#save-state').textContent==='Saved'");
    assert.equal(await read(file),external,'one native undo removes the entire plain paste');
    if (remoteHost && process.env.MARKDOWN_INLINE_TEST_PERMISSIONS === '1') {
      const folder = file.slice(0, file.lastIndexOf('/'));
      assert.ok(folder.includes('/_tmp/'), 'Permission tests require a disposable task folder');
      try {
        execFileSync('ssh', [remoteHost, 'chmod 444 ' + quote(file) + ' && chmod 555 ' + quote(folder)]);
        await evaluate("const field=d.querySelector('.frontmatter-value');field.focus();field.value='Permission test';field.dispatchEvent(new w.Event('input',{bubbles:true}));");
        await key('s');
        await until("return d.querySelector('.sync-recovery').hidden===false");
        assert.equal(await read(file), external, 'a denied save must leave disk unchanged');
        assert.equal(await evaluate("return d.querySelector('#save-state').textContent"), 'Draft retained');
      } finally {
        execFileSync('ssh', [remoteHost, 'chmod 755 ' + quote(folder) + ' && chmod 644 ' + quote(file)]);
      }
      await evaluate("[...d.querySelectorAll('.sync-recovery button')].find(button=>button.textContent==='Retry synchronization').click();");
      await until("return d.querySelector('#save-state').textContent==='Modified'");
      await key('s');
      await until("return d.querySelector('#save-state').textContent==='Saved'");
      assert.ok((await read(file)).includes('title: "Permission test"'));
      console.log('PASS Remote SSH permission failure: disk unchanged, draft retained, retry saved');
    }
    assert.ok(file.includes('/_tmp/'), 'Navigation fixtures require a task directory');
    const guide = file.slice(0, file.lastIndexOf('/')) + '/navigation guide.md';
    const guideSource = '# Guide\n\n## Café\n\nFirst\n\n## Café\n\nSecond\n';
    await write(guide, guideSource);
    const previousTargets = new Set((await cdp.send('Target.getTargets')).targetInfos.map(item => item.targetId));
    await evaluate("w.dispatchEvent(new w.CustomEvent('damln-open-link',{detail:'./navigation%20guide.md#caf%C3%A9-1'}));");
    let destination;
    const deadline = Date.now() + 15000;
    while (!destination && Date.now() < deadline) {
      destination = (await cdp.send('Target.getTargets')).targetInfos.find(item => item.type === 'iframe' && item.url.includes('extensionId=damln.markdown-inline') && !previousTargets.has(item.targetId));
      if (!destination) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(destination, 'Relative Markdown link opens another Inline view');
    ({sessionId} = await cdp.send('Target.attachToTarget', {targetId:destination.targetId,flatten:false}));
    await until("return d.querySelectorAll('.ProseMirror h2').length===2");
    await until("return [...d.querySelectorAll('.ProseMirror h2')].indexOf(w.getSelection().anchorNode?.parentElement.closest('h2'))===1");
    assert.equal(await read(guide), guideSource, 'navigation never edits the target');
    await evaluate("w.dispatchEvent(new w.CustomEvent('damln-open-link',{detail:'./missing-guide.md'}));");
    await until("return d.querySelector('#save-state').textContent.includes('Could not open')");
    console.log('PASS installed navigation: encoded relative file, duplicate accented heading, missing-file feedback');
    console.log('PASS installed VSIX: first action, manual save, keyboard undo/redo, focused metadata save, external refresh without rebuilding');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
