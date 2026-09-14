const { navigationScript } = require("./navigation");
const CSP_META_PATTERN = /<meta\s+[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi;
const BASE_PATTERN = /<base\s+[^>]*>/gi;

function previewPolicy(cspSource) {
  return [
    "default-src 'none'",
    `img-src ${cspSource} https: http: data: blob:`,
    `media-src ${cspSource} https: http: data: blob:`,
    `font-src ${cspSource} https: http: data:`,
    `style-src ${cspSource} https: http: 'unsafe-inline'`,
    `script-src ${cspSource} https: http: data: blob: 'unsafe-inline' 'unsafe-eval'`,
    `connect-src ${cspSource} https: http: ws: wss:`,
    `frame-src ${cspSource} https: http: data: blob:`,
    `worker-src ${cspSource} https: http: data: blob:`,
    "form-action https: http:"
  ].join("; ");
}

function previewHead(baseUri, cspSource) {
  return [
    `<base href="${baseUri}">`,
    `<meta http-equiv="Content-Security-Policy" content="${previewPolicy(cspSource)}">`
  ].join("\n");
}

function renderPreviewHtml(source, baseUri, cspSource, fragment = "") {
  const cleaned = source.replace(CSP_META_PATTERN, "").replace(BASE_PATTERN, "");
  const injected = previewHead(baseUri, cspSource) + "\n" + navigationScript(fragment);
  const headMatch = /<head(?:\s[^>]*)?>/i.exec(cleaned);
  if (headMatch) {
    const end = headMatch.index + headMatch[0].length;
    return `${cleaned.slice(0, end)}\n${injected}${cleaned.slice(end)}`;
  }

  const htmlMatch = /<html(?:\s[^>]*)?>/i.exec(cleaned);
  if (htmlMatch) {
    const end = htmlMatch.index + htmlMatch[0].length;
    return `${cleaned.slice(0, end)}\n<head>\n${injected}\n</head>${cleaned.slice(end)}`;
  }

  const doctypeMatch = /^\s*<!doctype[^>]*>/i.exec(cleaned);
  const insertion = doctypeMatch ? doctypeMatch[0].length : 0;
  return `${cleaned.slice(0, insertion)}\n<head>\n${injected}\n</head>\n${cleaned.slice(insertion)}`;
}

module.exports = { previewPolicy, renderPreviewHtml };
