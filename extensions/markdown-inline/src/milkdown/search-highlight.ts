import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";

export const searchPluginKey = new PluginKey("search-highlight");

export interface SearchState {
  query: string;
  matches: { from: number; to: number }[];
  activeIndex: number;
  decorations: DecorationSet;
}

function findMatches(doc: any, query: string): { from: number; to: number }[] {
  if (!query) return [];
  const results: { from: number; to: number }[] = [];
  const lowerQuery = query.toLowerCase();

  doc.descendants((node: any, pos: number) => {
    if (!node.isText) return;
    const text = node.text || "";
    const lowerText = text.toLowerCase();
    let idx = 0;
    while (idx < lowerText.length) {
      const found = lowerText.indexOf(lowerQuery, idx);
      if (found === -1) break;
      results.push({ from: pos + found, to: pos + found + query.length });
      idx = found + 1;
    }
  });

  return results;
}

function buildDecorations(
  doc: any,
  matches: { from: number; to: number }[],
  activeIndex: number
): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;

  const decorations = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === activeIndex ? "search-match search-match-active" : "search-match",
    })
  );

  return DecorationSet.create(doc, decorations);
}

export const searchHighlightPlugin = $prose(
  () =>
    new Plugin({
      key: searchPluginKey,
      state: {
        init(): SearchState {
          return {
            query: "",
            matches: [],
            activeIndex: -1,
            decorations: DecorationSet.empty,
          };
        },
        apply(tr, prev): SearchState {
          const meta = tr.getMeta(searchPluginKey);
          if (meta) {
            const query: string = meta.query ?? prev.query;
            const activeIndex: number = meta.activeIndex ?? prev.activeIndex;
            const matches = meta.query !== undefined ? findMatches(tr.doc, query) : prev.matches;
            const clampedIndex = matches.length > 0
              ? Math.max(0, Math.min(activeIndex, matches.length - 1))
              : -1;
            const decorations = buildDecorations(tr.doc, matches, clampedIndex);
            return { query, matches, activeIndex: clampedIndex, decorations };
          }
          // On doc change, rebuild matches with current query
          if (tr.docChanged && prev.query) {
            const matches = findMatches(tr.doc, prev.query);
            const clampedIndex = matches.length > 0
              ? Math.min(prev.activeIndex, matches.length - 1)
              : -1;
            const decorations = buildDecorations(tr.doc, matches, clampedIndex);
            return { ...prev, matches, activeIndex: clampedIndex, decorations };
          }
          return prev;
        },
      },
      props: {
        decorations(state) {
          return (this as any).getState(state)?.decorations ?? DecorationSet.empty;
        },
      },
    })
);
