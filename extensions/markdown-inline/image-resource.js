const { classifyDestination, resolveFileDestination } = require('./link-destination');

/** Rendering URLs are transient. Never write them back into Markdown attributes. */
async function resolveImageResource(source, src, vscode, webview) {
  const href = src.trim();
  if (/^https:/i.test(href)) return new URL(href).href;
  if (/^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml|bmp|x-icon)[;,]/i.test(href)) return href;
  if (/^http:/i.test(href)) throw new Error('HTTP images are blocked. Use HTTPS or a local file.');
  const link = classifyDestination(href);
  if (link.kind !== 'file') throw new Error('Use an image file, HTTPS URL, or data:image URI.');
  const target = vscode.Uri.joinPath(resolveFileDestination(source, link, vscode.Uri), '.');
  const roots = webview.options.localResourceRoots || [];
  if (!roots.some(root => target.scheme === root.scheme && target.authority === root.authority &&
      (target.path === root.path || target.path.startsWith(root.path.replace(/\/$/, '') + '/')))) {
    throw new Error('Image is outside the document folder and workspace. Open it separately, or move it into the workspace.');
  }
  let info;
  try { info = await vscode.workspace.fs.stat(target); }
  catch (error) {
    if (/FileNotFound|ENOENT/i.test(String(error?.code || '') + String(error?.message || ''))) {
      throw new Error('Image file was not found. Check its path.');
    }
    throw new Error('Could not read this image file. Check access and the connection.');
  }
  if (!(info.type & vscode.FileType.File)) throw new Error('Image path does not point to a file.');
  return webview.asWebviewUri(target.with({fragment: link.fragment})).toString();
}
module.exports = { resolveImageResource };
