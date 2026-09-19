// Builds the Markdown Inline webview page that the browser tests load from disk.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');

const root = process.env.MARKDOWN_INLINE_EXTENSION_ROOT || path.resolve(__dirname, '..');
// Point at an extracted VSIX to verify the shipped extension, not just the checkout.
const localRequire = createRequire(path.join(root, 'extension.js'));

function loadExtension() {
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'extension.js'), 'utf8'), {
    module: mod, require: id => id === 'vscode'
      ? { Uri: { joinPath: (base, ...parts) => path.join(base, ...parts) } } : localRequire(id),
  });
  return mod.exports;
}

// Most tests drop the Content-Security-Policy meta so a file:// page can load
// its scripts; keep it with csp: true to exercise the shipped policy itself.
function webviewHtml({ theme = 'dark', csp = false } = {}) {
  const html = loadExtension().MarkdownInlineProvider.prototype.webviewHtml.call(
    { context: { extensionUri: root } },
    { cspSource: 'file:', asWebviewUri: value => 'file://' + value }, root, theme,
  );
  return csp ? html : html.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/, '');
}

// Writes the page under MARKDOWN_INLINE_TEST_ROOT and returns its path and source.
function webviewPage(name, options = {}) {
  assert.ok(process.env.MARKDOWN_INLINE_TEST_ROOT, 'Set MARKDOWN_INLINE_TEST_ROOT to a task directory');
  const output = path.join(process.env.MARKDOWN_INLINE_TEST_ROOT, `${name}.html`);
  const html = webviewHtml(options);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, html);
  return { output, html };
}

module.exports = { localRequire, loadExtension, root, webviewHtml, webviewPage };
