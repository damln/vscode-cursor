function classifyDestination(value) {
  const href = value.trim();
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) throw new Error('Enter a link destination.');
  if (href.startsWith('#')) return { kind: 'anchor', fragment: decodeURIComponent(href.slice(1)) };
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(href)?.[1].toLowerCase();
  if (scheme && ['http', 'https', 'mailto'].includes(scheme)) {
    return { kind: 'external', href: new URL(href).href };
  }
  if (scheme && scheme !== 'file') throw new Error(`Links using ${scheme}: are not supported.`);
  if (href.startsWith('//')) throw new Error('Use an explicit file or https URL.');
  const hash = href.indexOf('#');
  const destination = hash < 0 ? href : href.slice(0, hash);
  const fragment = hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1));
  return { kind: 'file', destination, fragment, fileUri: scheme === 'file' };
}

function resolveFileDestination(source, link, Uri) {
  if (link.fileUri) {
    const target = Uri.parse(link.destination);
    if (source.scheme === 'vscode-remote') {
      if (target.authority) throw new Error('A network file URI cannot be resolved on this remote host.');
      return source.with({ path: target.path, query: '', fragment: '' });
    }
    return target.with({ fragment: '' });
  }
  const path = decodeURIComponent(link.destination);
  if (path.includes('\0')) throw new Error('Invalid file path.');
  return path.startsWith('/')
    ? source.with({ path, query: '', fragment: '' })
    : Uri.joinPath(source.with({ query: '', fragment: '' }), '..', path);
}

function headingIds(titles) {
  const used = new Set();
  return titles.map(title => {
    const base = title.toLowerCase().trim().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
    let id = base, suffix = 0;
    while (used.has(id)) id = `${base}-${++suffix}`;
    used.add(id);
    return id;
  });
}
module.exports = { classifyDestination, resolveFileDestination, headingIds };
