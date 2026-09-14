// Resource URLs are for loading assets, not for navigating a webview.
function resolveLink(href, documentUri, roots, webview, Uri) {
  const url = new URL(href);
  for (const root of roots) {
    const mapped = new URL(webview.asWebviewUri(root).toString().replace(/\/$/, '') + '/');
    if (url.origin !== mapped.origin || !url.pathname.startsWith(mapped.pathname)) continue;
    const relative = decodeURIComponent(url.pathname.slice(mapped.pathname.length));
    if (relative.split('/').some(part => part === '..') || relative.includes('\\')) throw new Error('Invalid local link.');
    return { kind: 'local', uri: Uri.joinPath(root, relative), fragment: url.hash.slice(1) };
  }
  // Do not send unresolved VS Code asset URLs to a browser.
  if (url.hostname.endsWith('.vscode-cdn.net') || url.protocol === 'command:' || url.protocol === 'vscode:') {
    throw new Error('This link is outside the preview’s accessible folders.');
  }
  if (['https:', 'http:', 'mailto:'].includes(url.protocol)) return { kind: 'external', uri: Uri.parse(href) };
  throw new Error('This link type is not supported in HTML Preview.');
}

function navigationScript(fragment = '') {
  return `<script>(()=>{
    const api = acquireVsCodeApi();
    function scroll(fragment) {
      let id; try { id = decodeURIComponent(fragment); } catch { return; }
      if (!id) { window.scrollTo(0, 0); return; }
      const target = document.getElementById(id) || document.getElementsByName(id)[0];
      if (target) { target.scrollIntoView(); if (typeof target.focus === 'function') target.focus({preventScroll:true}); }
    }
    document.addEventListener('click', event => {
      const link = event.target instanceof Element ? event.target.closest('a[href],area[href]') : null;
      if (!link || event.button !== 0 || event.defaultPrevented) return;
      const raw = link.getAttribute('href').trim();
      // Leave authored JavaScript actions alone; the host never executes these as commands.
      if (/^javascript:/i.test(raw)) return;
      event.preventDefault();
      if (!raw || raw.startsWith('#')) { scroll(raw.slice(1)); return; }
      api.postMessage({type:'navigate', href:link.href});
    });
    window.addEventListener('message', event => {
      if (event.data?.type === 'scrollToFragment') scroll(event.data.fragment);
    });
    document.addEventListener('DOMContentLoaded', () => scroll(${JSON.stringify(fragment).replace(/</g,'\\u003c')}), {once:true});
  })();</script>`;
}
module.exports = { resolveLink, navigationScript };
