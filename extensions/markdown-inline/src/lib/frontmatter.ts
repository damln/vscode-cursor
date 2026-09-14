import { editableFrontmatter } from "../../markdown-model";
import { CST, isMap, isNode, isScalar, parseDocument, stringify, visit, type Node } from "yaml";

export interface MetadataField {
  path: string[];
  label: string;
  value: string;
  editable: boolean;
  type: string;
}

export class Frontmatter {
  readonly document;
  constructor(readonly raw: string) {
    this.document = parseDocument(raw, { keepSourceTokens: true, prettyErrors: true });
  }
  get error() {
    return [...this.document.errors, ...this.document.warnings].map(error => error.message).join("\n");
  }
  fields(): MetadataField[] {
    const fields: MetadataField[] = [];
    if (this.error) return fields;
    const visit = (node: Node | null, path: string[]) => {
      if (isMap(node)) {
        for (const pair of node.items) {
          if (!isScalar(pair.key) || typeof pair.key.value !== "string") continue;
          const next = [...path, pair.key.value];
          if (isMap(pair.value) && !pair.value.anchor && !pair.value.tag) visit(pair.value, next);
          else {
            const scalar = isScalar(pair.value) ? pair.value : null;
            fields.push({ path: next, label: next.map(key => key.includes('.') ? JSON.stringify(key) : key).join('.'),
              value: scalar && typeof scalar.value === 'string' ? scalar.value :
                isNode(pair.value) && pair.value.range ? this.raw.slice(pair.value.range[0], pair.value.range[1]).trimEnd() : 'null',
              editable: Boolean(scalar && typeof scalar.value === 'string' && !scalar.anchor && !scalar.tag),
              type: scalar ? (scalar.value === null ? 'null' : typeof scalar.value) : 'YAML',
            });
          }
        }
      }
    };
    visit(this.document.contents, []);
    return fields;
  }
  editString(path: string[], value: string): string {
    if (this.error) throw new Error(this.error);
    const node = this.document.getIn(path, true);
    if (!isScalar(node) || typeof node.value !== 'string' || node.anchor || node.tag || !node.range) {
      throw new Error('Edit this value in YAML source to preserve its type.');
    }
    const [start, end] = node.range;
    const original = this.raw.slice(start, end);
    const eol = this.raw.includes('\r\n') ? '\r\n' : '\n';
    return this.raw.slice(0, start) + JSON.stringify(value) +
      (original.endsWith('\n') ? eol : '') + this.raw.slice(end);
  }
  addString(name: string, value: string): string {
    if (this.error) throw new Error(this.error);
    const key = name.trim();
    if (!key) throw new Error('Enter a field name.');
    const root = this.document.contents;
    if (root !== null && !isMap(root)) throw new Error('Use a YAML mapping before adding fields.');
    if (isMap(root) && root.has(key)) throw new Error(`A field named “${key}” already exists.`);
    const eol = this.raw.includes('\r\n') ? '\r\n' : '\n';
    let next: string;
    if (isMap(root) && root.srcToken?.type === 'flow-collection') {
      const token = root.srcToken;
      const closing = token.end.find(item => item.type === 'flow-map-end');
      if (!closing) throw new Error('Close the YAML mapping before adding fields.');
      const last = token.items.at(-1);
      const trailingComma = last && !last.key && last.start.some(item => item.type === 'comma');
      const comma = root.items.length && !trailingComma ? ',' : '';
      const pair = `${comma} ${JSON.stringify(key)}: ${JSON.stringify(value)}`;
      next = this.raw.slice(0, closing.offset) + pair + this.raw.slice(closing.offset);
    } else {
      const pair = stringify(new Map([[key, value]]), {lineWidth: 0}).replace(/\r?\n/g, eol);
      next = this.raw + (this.raw && !this.raw.endsWith('\n') ? eol : '') + pair;
    }
    const parsed = new Frontmatter(next);
    const added = parsed.document.get(key, true);
    if (parsed.error || !isScalar(added) || added.value !== value) {
      throw new Error('Edit this header in YAML to preserve its structure.');
    }
    return next;
  }
  removeField(path: string[]): string {
    if (this.error) throw new Error(this.error);
    const parent = path.length > 1 ? this.document.getIn(path.slice(0, -1), true) : this.document.contents;
    if (!isMap(parent) || !parent.srcToken) throw new Error('Edit this field in YAML source.');
    const index = parent.items.findIndex(pair => isScalar(pair.key) && pair.key.value === path.at(-1));
    if (index < 0) throw new Error('This field no longer exists.');
    const token = structuredClone(parent.srcToken);
    if (token.type !== 'block-map' && token.type !== 'flow-collection') {
      throw new Error('Edit this field in YAML source to preserve its layout.');
    }
    let start: number, end: number, replacement = '';
    if (token.type === 'flow-collection') {
      start = token.offset; end = start + CST.stringify(token).length;
      token.items.splice(index, 1);
      if (index === 0 && token.items[0]) {
        token.items[0].start = token.items[0].start.filter(item => item.type !== 'comma');
      }
      replacement = CST.stringify(token);
    } else {
      const item = token.items[index];
      if (!item?.key) throw new Error('Edit this field in YAML source.');
      start = this.raw.lastIndexOf('\n', item.key.offset - 1) + 1;
      if (!/^[ \t]*$/.test(this.raw.slice(start, item.key.offset))) {
        throw new Error('Edit this field in YAML source to preserve its layout.');
      }
      end = item.key.offset + CST.stringify({...token, items: [{...item, start: []}]}).length;
      if (parent.items.length === 1 && path.length > 1) {
        replacement = this.raw.slice(start, item.key.offset) + '{}' + (this.raw.slice(start, end).endsWith('\n') ? (this.raw.includes('\r\n') ? '\r\n' : '\n') : '');
      }
    }
    const next = this.raw.slice(0, start) + replacement + this.raw.slice(end);
    const parsed = parseDocument(next, {keepSourceTokens: true});
    if (parsed.errors.length) throw new Error('Edit this field in YAML source to preserve its structure.');
    visit(parsed, { Alias(_key, node) {
      if (!node.resolve(parsed)) throw new Error('This field is used by a YAML alias. Remove that reference in YAML first.');
    }});
    return next;
  }
}

export function metadataEnvelope(prefix: string, eol: string) {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(prefix)?.[0] ?? `---${eol}`;
  const closing = /---[ \t]*(?:\r?\n|$)$/.exec(prefix)?.[0] ?? `---${eol}`;
  return {
    raw: prefix ? prefix.slice(opening.length, prefix.length - closing.length) : '',
    join: (raw: string) => opening + raw.replace(/\r?\n/g, eol) + (raw && !raw.endsWith('\n') ? eol : '') + closing,
  };
}

/** A delimiter pair alone does not make ordinary prose into metadata. */
export function documentFrontmatter(source: string) {
  const candidate = editableFrontmatter(source);
  if (!candidate.hasFrontmatter) return candidate;
  const parsed = parseDocument(candidate.raw, {keepSourceTokens: true});
  // Preserve malformed YAML for repair and allow deliberately empty headers.
  // A valid scalar or sequence is document content, not key/value metadata.
  if (isMap(parsed.contents) || parsed.errors.length || parsed.contents === null) return candidate;
  return {body: source, eol: candidate.eol, hasFrontmatter: false, prefix: '', raw: ''};
}
