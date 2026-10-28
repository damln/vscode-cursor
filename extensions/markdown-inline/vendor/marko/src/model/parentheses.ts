// CommonMark reads `1)` at the start of a line as an ordered list, then the
// writer turns that list into `1.` or escapes the parenthesis as `1\)`.
// Neither is what was typed. Read those markers back as the original text.

interface Point {
  offset?: number;
}

interface MdNode {
  type: string;
  ordered?: boolean | null;
  value?: string;
  children?: MdNode[];
  position?: { start: Point; end: Point };
}

function markerPrefix(source: string, item: MdNode): string {
  const start = item.position?.start.offset;
  if (start == null) return '';
  const content = item.children?.[0]?.position?.start.offset;
  const end = content ?? item.position?.end.offset ?? start;
  let raw = source.slice(start, end);
  if (content == null) raw = raw.replace(/[ \t]*\r?\n$/, '');
  return raw.replace(/^[ \t]{0,3}/, '');
}

function isParenList(node: MdNode, source: string): boolean {
  if (node.type !== 'list' || !node.ordered) return false;
  const start = node.children?.[0]?.position?.start.offset;
  if (start == null) return false;
  return /^[ \t]{0,3}\d{1,9}\)/.test(source.slice(start, start + 16));
}

function paragraph(value: string, position: MdNode['position']): MdNode {
  return { type: 'paragraph', children: [{ type: 'text', value, position }], position };
}

function prefixFirst(blocks: MdNode[], item: MdNode, source: string) {
  const prefix = markerPrefix(source, item);
  const first = blocks[0];
  if (!prefix || !first) return;
  if (first.type !== 'paragraph') {
    blocks.unshift(paragraph(prefix.replace(/[ \t]+$/, ''), item.position));
    return;
  }
  first.children ??= [];
  const children = first.children;
  if (children[0]?.type === 'text') {
    children[0].value = prefix + (children[0].value ?? '');
    if (children[0].position && item.position) {
      children[0].position = { ...children[0].position, start: item.position.start };
    }
  } else {
    children.unshift({ type: 'text', value: prefix });
  }
  if (first.position && item.position)
    first.position = { ...first.position, start: item.position.start };
}

function restore(node: MdNode, source: string) {
  if (!node.children) return;
  for (const child of node.children) restore(child, source);
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (!isParenList(child, source)) {
      next.push(child);
      continue;
    }
    for (const item of child.children ?? []) {
      if (!item.children?.length) {
        next.push(paragraph(markerPrefix(source, item), item.position));
        continue;
      }
      prefixFirst(item.children, item, source);
      next.push(...item.children);
    }
  }
  node.children = next;
}

export function restoreParenListMarkers(tree: MdNode, source: string) {
  restore(tree, source);
}

/** Remark plugin. `1)` stays the typed text instead of becoming a dot list. */
export function plainParentheses() {
  return (tree: MdNode, file: unknown) => restoreParenListMarkers(tree, String(file));
}
