export interface FrontmatterSplit {
  body: string;
  eol: string;
  hasFrontmatter: boolean;
  prefix: string;
  raw: string;
}

/** Split leading YAML front matter without touching the authored bytes. */
export function editableFrontmatter(source: string): FrontmatterSplit {
  const unchanged = {
    body: source,
    eol: source.includes('\r\n') ? '\r\n' : '\n',
    hasFrontmatter: false,
    prefix: '',
    raw: '',
  };
  // Only the very first physical line may open front matter. Never search
  // forward past prose, blank lines, or a Markdown/code separator.
  const opening = /^(?:﻿)?---[ \t]*(\r?\n)/.exec(source);
  if (!opening) return unchanged;
  const start = opening[0].length;
  for (let lineStart = start; lineStart < source.length; ) {
    const newline = source.indexOf('\n', lineStart);
    const end = newline < 0 ? source.length : newline;
    const line = source.slice(lineStart, end).replace(/\r$/, '');
    if (/^---[ \t]*$/.test(line)) {
      const prefixEnd = newline < 0 ? end : end + 1;
      return {
        body: source.slice(prefixEnd),
        eol: opening[1],
        hasFrontmatter: true,
        prefix: source.slice(0, prefixEnd),
        raw: source.slice(start, lineStart).replace(/\r?\n$/, ''),
      };
    }
    if (newline < 0) break;
    lineStart = newline + 1;
  }
  return unchanged;
}

export function joinPreservedFrontmatter(prefix: string, body: string) {
  return `${prefix}${body}`;
}

export function preserveListSpacingJoin(
  _left: unknown,
  _right: unknown,
  parent: { type?: string; spread?: unknown } | undefined,
) {
  if (
    (parent?.type === 'list' || parent?.type === 'listItem') &&
    typeof parent.spread === 'string'
  ) {
    return parent.spread === 'true' ? 1 : 0;
  }
  return undefined;
}

interface FlowNode {
  type: string;
  children?: FlowNode[];
}

const isEmptyParagraph = (node: FlowNode) => node.type === 'paragraph' && !node.children?.length;

/** An empty paragraph is a line to type on, not authored text. Written out, each one adds two blank lines. */
export function withoutEmptyParagraphs<T extends FlowNode>(node: T): T {
  if (!node.children?.length || node.type === 'paragraph') return node;
  const kept = node.children.filter((child) => !isEmptyParagraph(child));
  const children = (kept.length ? kept : node.children.slice(0, 1)).map(withoutEmptyParagraphs);
  return { ...node, children };
}
