import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node } from "@milkdown/kit/prose/model";
import { findHexColors } from "../../color-preview";

const colorPreviewKey = new PluginKey("inline-color-preview");

function findColorPreviews(doc: Node): Decoration[] {
  const decorations: Decoration[] = [];

  doc.descendants((node, position) => {
    if (!node.isTextblock) return;
    // Keep model offsets across formatting marks, and stop tokens at inline atoms.
    let text = '';
    node.forEach(child => {text += child.isText ? child.text : '\uFFFC'.repeat(child.nodeSize);});
    for (const {from, color} of findHexColors(text)) {
      decorations.push(Decoration.widget(position + 1 + from, () => {
        const swatch = document.createElement('span');
        swatch.className = 'inline-color-preview';
        swatch.style.backgroundColor = color;
        swatch.contentEditable = 'false';
        swatch.setAttribute('aria-hidden', 'true');
        return swatch;
      }, {side: -1, key: `${position + 1 + from}:${color}`}));
    }
    return false;
  });

  return decorations;
}

export const colorPreview = $prose(() =>
  new Plugin({
    key: colorPreviewKey,
    state: {
      init(_, state) {
        return DecorationSet.create(state.doc, findColorPreviews(state.doc));
      },
      apply(transaction, previous) {
        if (!transaction.docChanged) return previous;
        return DecorationSet.create(
          transaction.doc,
          findColorPreviews(transaction.doc)
        );
      },
    },
    props: {
      decorations(state) {
        return colorPreviewKey.getState(state);
      },
    },
  })
);
