// Reference-style links ([text][id], [id]), images (![alt][id]) and their
// definitions ([id]: url) stay reference-style. Milkdown's commonmark preset
// inlines references and drops definitions, which would rewrite the author's
// Markdown, so Marko replaces that plugin with this one.
import type { Ctx } from "@milkdown/kit/ctx";
import type { Mark, Node as ProseNode } from "@milkdown/kit/prose/model";
import { imageSchema, linkSchema } from "@milkdown/kit/preset/commonmark";
import { $nodeSchema, $remark } from "@milkdown/kit/utils";

type MarkdownNode = {
  type: string;
  children?: MarkdownNode[];
  data?: Record<string, unknown>;
  identifier?: string;
  label?: string | null;
  referenceType?: string;
  url?: string;
  title?: string | null;
  alt?: string | null;
};

/** What a reference was written as, plus the destination it resolved to when parsed. */
export interface ReferenceAttrs {
  identifier: string;
  label: string | null;
  referenceType: string;
  url: string;
  title: string | null;
}

function visit(node: MarkdownNode, run: (node: MarkdownNode) => void) {
  run(node);
  node.children?.forEach(child => visit(child, run));
}

/** Resolve each reference to its definition. As in CommonMark, the first definition wins. */
function resolveReferences() {
  return (root: unknown) => {
    const tree = root as MarkdownNode;
    const definitions = new Map<string, MarkdownNode>();
    visit(tree, node => {
      if (node.type === "definition" && !definitions.has(node.identifier!)) definitions.set(node.identifier!, node);
    });
    visit(tree, node => {
      if (node.type !== "linkReference" && node.type !== "imageReference") return;
      const definition = definitions.get(node.identifier!);
      node.data = {...node.data, url: definition?.url ?? "", title: definition?.title ?? null};
    });
  };
}

export const remarkResolveReferences = $remark("remarkResolveReferences", () => resolveReferences);

function referenceOf(node: MarkdownNode): ReferenceAttrs {
  return {
    identifier: node.identifier!,
    label: node.label ?? null,
    referenceType: node.referenceType!,
    url: String(node.data?.url ?? ""),
    title: (node.data?.title as string | null | undefined) ?? null,
  };
}

/** Write a reference back only while it still points at its definition's destination. */
function unchangedReference(reference: ReferenceAttrs | null, url: string, title: string | null) {
  return reference && reference.url === url && (reference.title ?? null) === (title || null) ? reference : null;
}

function referenceProps({identifier, label, referenceType}: ReferenceAttrs) {
  return {identifier, label, referenceType};
}

export const linkDefinitionSchema = $nodeSchema("link_definition", () => ({
  group: "block",
  atom: true,
  selectable: true,
  attrs: {
    identifier: {validate: "string"},
    label: {default: null, validate: "string|null"},
    url: {default: "", validate: "string"},
    title: {default: null, validate: "string|null"},
  },
  parseDOM: [{
    tag: "div[data-link-definition]",
    getAttrs: dom => {
      if (!(dom instanceof HTMLElement)) return false;
      return {
        identifier: dom.dataset.linkDefinition ?? "",
        label: dom.dataset.label ?? null,
        url: dom.dataset.url ?? "",
        title: dom.dataset.title ?? null,
      };
    },
  }],
  toDOM: (node: ProseNode) => {
    const {identifier, label, url, title} = node.attrs;
    return ["div", {
      class: "link-definition",
      "data-link-definition": identifier,
      "data-url": url,
      ...(label === null ? {} : {"data-label": label}),
      ...(title === null ? {} : {"data-title": title}),
    }, `[${label ?? identifier}]: ${url}${title === null ? "" : ` "${title}"`}`];
  },
  parseMarkdown: {
    match: node => node.type === "definition",
    runner: (state, node, type) => {
      state.addNode(type, {
        identifier: node.identifier as string,
        label: (node.label as string | null | undefined) ?? null,
        url: node.url as string,
        title: (node.title as string | null | undefined) ?? null,
      });
    },
  },
  toMarkdown: {
    match: node => node.type.name === "link_definition",
    runner: (state, node) => {
      const {identifier, label, url, title} = node.attrs;
      state.addNode("definition", undefined, undefined, {identifier, label, url, title});
    },
  },
}));

/** Teach the link mark and image node to read and write references. */
export function configureLinkReferences(ctx: Ctx) {
  ctx.update(linkSchema.key, factory => schemaCtx => {
    const spec = factory(schemaCtx);
    return {
      ...spec,
      attrs: {...spec.attrs, reference: {default: null}},
      toDOM: (mark: Mark, inline: boolean) => {
        const [tag, {reference: _, ...attrs}, ...rest] = spec.toDOM!(mark, inline) as [string, Record<string, unknown>];
        return [tag, attrs, ...rest];
      },
      parseMarkdown: {
        match: node => node.type === "link" || node.type === "linkReference",
        runner: (state, node, markType) => {
          if (node.type === "link") return spec.parseMarkdown!.runner(state, node, markType);
          const reference = referenceOf(node as MarkdownNode);
          state.openMark(markType, {href: reference.url, title: reference.title, reference});
          state.next(node.children);
          state.closeMark(markType);
        },
      },
      toMarkdown: {
        match: spec.toMarkdown!.match,
        runner: (state, mark, node) => {
          const reference = unchangedReference(mark.attrs.reference, mark.attrs.href, mark.attrs.title);
          if (!reference) return spec.toMarkdown!.runner(state, mark, node);
          state.withMark(mark, "linkReference", undefined, referenceProps(reference));
        },
      },
    };
  });

  ctx.update(imageSchema.key, factory => schemaCtx => {
    const spec = factory(schemaCtx);
    return {
      ...spec,
      attrs: {...spec.attrs, reference: {default: null}},
      toDOM: (node: ProseNode) => {
        const [tag, {reference: _, ...attrs}, ...rest] = spec.toDOM!(node) as [string, Record<string, unknown>];
        return [tag, attrs, ...rest];
      },
      parseMarkdown: {
        match: node => node.type === "image" || node.type === "imageReference",
        runner: (state, node, type) => {
          if (node.type === "image") return spec.parseMarkdown!.runner(state, node, type);
          const reference = referenceOf(node as MarkdownNode);
          state.addNode(type, {src: reference.url, alt: (node.alt as string | null) ?? "", title: reference.title ?? "", reference});
        },
      },
      toMarkdown: {
        match: spec.toMarkdown!.match,
        runner: (state, node) => {
          const reference = unchangedReference(node.attrs.reference, node.attrs.src, node.attrs.title);
          if (!reference) return spec.toMarkdown!.runner(state, node);
          state.addNode("imageReference", undefined, undefined, {...referenceProps(reference), alt: node.attrs.alt});
        },
      },
    };
  });
}

/** Keep consecutive definitions on consecutive lines, the way they are usually written. */
export function definitionJoin(left: { type?: string }, right: { type?: string }) {
  return left.type === "definition" && right.type === "definition" ? 0 : undefined;
}
