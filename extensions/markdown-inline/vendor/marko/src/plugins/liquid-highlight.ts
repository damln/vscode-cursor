import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

const LIQUID_BLOCK = /\{%-?[\s\S]*?-?%\}/g;
const LIQUID_OUTPUT = /\{\{-?[\s\S]*?-?\}\}/g;

function findLiquidDecorations(doc: ProseNode): Decoration[] {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = node.text || '';
    for (const regex of [LIQUID_BLOCK, LIQUID_OUTPUT]) {
      for (const match of text.matchAll(regex)) {
        const from = pos + match.index;
        const to = from + match[0].length;
        const className = regex === LIQUID_BLOCK ? 'liquid-tag-inline' : 'liquid-output-inline';
        decorations.push(Decoration.inline(from, to, { class: className }));
      }
    }
  });
  return decorations;
}

const liquidKey = new PluginKey('liquid-highlight');

export const liquidHighlight = $prose(
  () =>
    new Plugin({
      key: liquidKey,
      state: {
        init(_, state) {
          return DecorationSet.create(state.doc, findLiquidDecorations(state.doc));
        },
        apply(tr, oldSet) {
          if (tr.docChanged) {
            return DecorationSet.create(tr.doc, findLiquidDecorations(tr.doc));
          }
          return oldSet;
        },
      },
      props: {
        decorations(state) {
          return liquidKey.getState(state);
        },
      },
    }),
);
