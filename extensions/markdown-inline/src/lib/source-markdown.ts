interface Block {
  type?: string;
  ordered?: boolean | null;
  children?: Block[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}
type Parse = (source: string) => { children: Block[] };

type Node = { type?: string; children?: Node[]; value?: string; [key: string]: unknown };

// Milkdown can distribute one link around inline code, moving separating
// whitespace outside the links. Preserve that whitespace while comparing the
// contiguous label as one link with the same destination and title.
function appendNormalized(result: Node[], node: Node) {
  const previous = result.at(-1);
  if (node.type === 'link') {
    const gap = previous?.type === 'text' && /^[\t\n\r ]+$/.test(previous.value ?? '') ? previous : undefined;
    const link = gap ? result.at(-2) : previous;
    if (link?.type === 'link' && link.url === node.url && link.title === node.title) {
      if (gap) result.pop();
      const children = link.children ?? (link.children = []);
      for (const child of [...(gap ? [gap] : []), ...(node.children ?? [])]) appendNormalized(children, child);
      return;
    }
  }
  if (node.type === 'text' && previous?.type === 'text' &&
      JSON.stringify(previous.marks) === JSON.stringify(node.marks)) {
    previous.value = String(previous.value) + node.value;
  } else result.push(node);
}

// The editor distributes marks around inline code and links. Compare their
// meaning, not whether remark grouped them under one formatting container.
function normalizeChildren(children: Node[], marks: string[] = []): Node[] {
  const result: Node[] = [];
  const append = (node: Node) => appendNormalized(result, node);
  for (const node of children) {
    if (['emphasis', 'strong', 'delete'].includes(node.type ?? '')) {
      normalizeChildren(node.children ?? [], [...new Set([...marks, node.type!])].sort()).forEach(append);
    } else if (node.type === 'text') {
      // Emphasis delimiters cannot enclose boundary whitespace. Keep every
      // whitespace byte, but allow the serializer to move it outside bold/italic.
      for (const value of (node.value ?? '').split(/([\t\n\r ]+)/).filter(Boolean)) {
        append({type: 'text', value, marks: /^[\t\n\r ]+$/.test(value)
          ? marks.filter(mark => mark !== 'emphasis' && mark !== 'strong') : marks});
      }
    } else if (node.type === 'link' || node.type === 'linkReference') {
      append({...node, children: normalizeChildren(node.children ?? [], marks)});
    } else {
      append({...node, ...(marks.length ? {marks} : {}),
        ...(node.children ? {children: normalizeChildren(node.children)} : {})});
    }
  }
  return result;
}

function semanticKey(value: unknown): string {
  const nodes = Array.isArray(value) ? value : [value];
  return JSON.stringify(normalizeChildren(nodes), (key, item) => {
    if (["position", "data", "spread"].includes(key)) return undefined;
    return typeof item === "string" ? item.replace(/\r\n?/g, "\n") : item;
  });
}

/** Match unchanged siblings first so an inserted block cannot steal their style. */
function pairBlocks(previous: Block[], next: Block[]): number[] {
  const keys = previous.map(semanticKey), used = new Set<number>();
  const pairs = next.map((node, index) => {
    const key = semanticKey(node);
    const match = keys[index] === key && !used.has(index) ? index
      : keys.findIndex((candidate, i) => candidate === key && !used.has(i));
    if (match >= 0) used.add(match);
    return match;
  });
  return pairs.map((match, index) => {
    if (match >= 0) return match;
    const candidates = previous.map((node, i) => ({node, i})).filter(({node, i}) =>
      !used.has(i) && node.type === next[index].type && node.ordered === next[index].ordered);
    candidates.sort((a, b) => Math.abs(a.i - index) - Math.abs(b.i - index));
    const candidate = candidates[0]?.i ?? -1;
    if (candidate >= 0) used.add(candidate);
    return candidate;
  });
}

/** Replace only AST-identified bullet tokens, never dashes/stars inside content. */
function preserveBulletMarkers(source: string, previous: Block | undefined, markdown: string, next: Block): string {
  const start = next.position?.start.offset ?? 0;
  const result = markdown.slice(start, next.position?.end.offset ?? 0).split('');
  const visit = (node: Block, old: Block | undefined, inherited?: string) => {
    let bullet = inherited;
    if (node.type === 'list' && !node.ordered) {
      const offset = old?.children?.[0]?.position?.start.offset;
      const original = offset === undefined ? '' : source[offset];
      if (/^[-*+]$/.test(original)) bullet = original;
      if (bullet) for (const item of node.children ?? []) {
        const offset = item.position?.start.offset;
        if (offset !== undefined && /^[-*+]$/.test(markdown[offset])) result[offset - start] = bullet;
      }
    }
    const children = node.children ?? [], oldChildren = old?.children ?? [];
    const pairs = pairBlocks(oldChildren, children);
    children.forEach((child, i) => visit(child, oldChildren[pairs[i]], bullet));
  };
  visit(next, previous);
  return result.join('');
}

/** Preserve authored blocks; refuse visual editing when the parser loses meaning. */
export class SourceMarkdown {
  constructor(private source: string, private canonical: string, private parse: Parse) {}

  get supported() {
    return semanticKey(this.parse(this.source).children) ===
      semanticKey(this.parse(this.canonical).children);
  }

  blockRanges() {
    return this.parse(this.source).children.map(block => ({
      from: block.position?.start.offset ?? 0,
      to: block.position?.end.offset ?? this.source.length,
    }));
  }

  blockOffset(index: number) {
    return this.parse(this.source).children[index]?.position?.start.offset ?? this.source.length;
  }

  blockIndexAtOffset(offset: number) {
    const blocks = this.parse(this.source).children;
    let index = 0;
    for (let i = 0; i < blocks.length; i++) {
      if ((blocks[i].position?.start.offset ?? 0) > offset) break;
      index = i;
    }
    return index;
  }

  update(markdown: string): string {
    if (markdown === this.canonical) return this.source;
    if (!this.supported) throw new Error("This Markdown requires source editing.");
    const old = this.parse(this.source).children;
    const next = this.parse(markdown).children;
    const eol = this.source.includes("\r\n") ? "\r\n" : "\n";
    const pairs = pairBlocks(old, next);
    const start = (node: Block) => node.position?.start.offset ?? 0;
    const end = (node: Block) => node.position?.end.offset ?? 0;
    const leading = old.length ? this.source.slice(0, start(old[0])) : "";
    const trailing = old.length ? this.source.slice(end(old.at(-1)!)) : "";
    const blocks = next.map((node, index) => {
      const match = pairs[index];
      if (match < 0 || semanticKey(old[match]) !== semanticKey(node)) {
        return preserveBulletMarkers(this.source, old[match], markdown, node).replace(/\r?\n/g, eol);
      }
      return this.source.slice(start(old[match]), end(old[match]));
    });
    const join = (preserveGaps: boolean) => blocks.map((block, index) => {
      if (!index) return leading + block;
      const match = pairs[index];
      const adjacent = match > 0 && pairs[index - 1] === match - 1;
      const gap = preserveGaps && adjacent
        ? this.source.slice(end(old[match - 1]), start(old[match]))
        : markdown.slice(end(next[index - 1]), start(next[index])).replace(/\r?\n/g, eol);
      return gap + block;
    }).join("") + (blocks.length ? trailing : "");
    const expected = semanticKey(next);
    let result = join(true);
    // A heading can become a paragraph, requiring a blank line where none was
    // needed before. Retry with serializer boundaries, keeping authored blocks.
    if (semanticKey(this.parse(result).children) !== expected) result = join(false);
    // Context-sensitive Markdown (e.g. adjacent lists) must not change meaning.
    if (semanticKey(this.parse(result).children) !== expected) {
      throw new Error("This edit needs source mode to preserve Markdown structure.");
    }
    this.source = result;
    this.canonical = markdown;
    return result;
  }
}
