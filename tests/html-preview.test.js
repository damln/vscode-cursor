const assert = require("node:assert/strict");
const test = require("node:test");

const {
  previewPolicy,
  renderPreviewHtml
} = require("../extensions/html-preview/preview-html");

test("injects the preview base and policy into an existing head", () => {
  const result = renderPreviewHtml(
    "<!doctype html><html><head><title>Page</title></head><body>Hi</body></html>",
    "vscode-webview://preview/site/",
    "https://preview.vscode-cdn.net"
  );

  assert.match(result, /<head>\n<base href="vscode-webview:\/\/preview\/site\/">/);
  assert.match(result, /Content-Security-Policy/);
  assert.match(result, /<title>Page<\/title>/);
});

test("creates a head for an HTML fragment", () => {
  const result = renderPreviewHtml(
    "<main><img src=\"assets/logo.png\"></main>",
    "vscode-webview://preview/site/",
    "https://preview.vscode-cdn.net"
  );

  assert.match(result, /^\n<head>/);
  assert.match(result, /<main><img src="assets\/logo.png"><\/main>$/);
});

test("replaces source base and CSP declarations", () => {
  const result = renderPreviewHtml(
    '<html><head><base href="/old/"><meta http-equiv="Content-Security-Policy" content="default-src none"></head></html>',
    "vscode-webview://preview/new/",
    "https://preview.vscode-cdn.net"
  );

  assert.equal((result.match(/<base /g) || []).length, 1);
  assert.equal((result.match(/Content-Security-Policy/g) || []).length, 1);
  assert.match(result, /vscode-webview:\/\/preview\/new\//);
  assert.doesNotMatch(result, /\/old\//);
});

test("allows local, remote, and inline browser assets", () => {
  const policy = previewPolicy("https://preview.vscode-cdn.net");

  assert.match(policy, /img-src https:\/\/preview\.vscode-cdn\.net https: http: data: blob:/);
  assert.match(policy, /script-src .*'unsafe-inline'/);
  assert.match(policy, /connect-src .* ws: wss:/);
});

const { resolveLink } = require('../extensions/html-preview/navigation');
const path = require('node:path');
const uri = pathname => ({path:pathname, scheme:'vscode-remote',authority:'ssh-remote+test'});
const Uri = {joinPath:(base,relative)=>({...base,path:path.posix.join(base.path,relative)}),parse:value=>value};
const webview = {asWebviewUri:root=>({toString:()=> 'https://vscode-remote+test.vscode-resource.vscode-cdn.net'+encodeURI(root.path)})};
test('preview links map resource URLs back to local or remote document URIs',()=>{
  const root=uri('/workspace'),doc=uri('/workspace/gallery/index.html');
  const result=resolveLink('https://vscode-remote+test.vscode-resource.vscode-cdn.net/workspace/gallery/pages/ornaments.html#details',doc,[uri('/workspace/gallery'),root],webview,Uri);
  assert.equal(result.kind,'local');assert.equal(result.uri.path,'/workspace/gallery/pages/ornaments.html');
  assert.equal(result.uri.scheme,'vscode-remote');assert.equal(result.fragment,'details');
  assert.equal(resolveLink('https://vscode-remote+test.vscode-resource.vscode-cdn.net/workspace/another%20page.html',doc,[root],webview,Uri).uri.path,'/workspace/another page.html');
  assert.equal(resolveLink('https://example.com',doc,[root],webview,Uri).kind,'external');
});
test('preview navigation blocks command links, foreign resource hosts and out-of-root paths',()=>{
  for (const href of ['command:workbench.action.closeWindow','file:///etc/passwd','https://file+.vscode-resource.vscode-cdn.net/workspace/file.html','https://vscode-remote+test.vscode-resource.vscode-cdn.net/elsewhere/file.html','https://vscode-remote+test.vscode-resource.vscode-cdn.net/workspace/%2e%2e%2foutside.html']) {
    assert.throws(()=>resolveLink(href,uri('/workspace/index.html'),[uri('/workspace')],webview,Uri),/supported|outside|Invalid/);
  }
});
