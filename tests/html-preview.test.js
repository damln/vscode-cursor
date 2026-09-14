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
