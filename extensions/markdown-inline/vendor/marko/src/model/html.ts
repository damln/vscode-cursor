export const HTML_TAG_PATTERN = String.raw`<(?:[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>\x60]+|'[^']*'|"[^"]*"))?)*\s*\/?|\/[A-Za-z][A-Za-z0-9-]*\s*)>`;

export function escapeHtmlText(markdown: string): string {
  return markdown.replace(new RegExp(HTML_TAG_PATTERN, 'g'), (tag, offset) => {
    const slashes = markdown.slice(0, offset).match(/\\+$/)?.[0].length ?? 0;
    return slashes % 2 ? tag : '\\' + tag;
  });
}
