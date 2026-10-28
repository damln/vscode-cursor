import type { ResolvedPos } from '@milkdown/kit/prose/model';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { CellSelection } from '@milkdown/kit/prose/tables';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';

function syncTextSelection(view: EditorView, anchor: ResolvedPos, head: ResolvedPos) {
  if (!anchor.parent.inlineContent || !head.parent.inlineContent) return;
  const next = TextSelection.between(anchor, head);
  if (!next.eq(view.state.selection))
    view.dispatch(view.state.tr.setSelection(next).setMeta('pointer', true));
}

// Chromium may deliver the next key before its asynchronous selectionchange.
// Reconcile a completed text click without replacing node or table selections.
export const caretSync = $prose(
  () =>
    new Plugin({
      props: {
        handleDOMEvents: {
          mouseup(view, event) {
            if (
              !view.editable ||
              view.composing ||
              event.button !== 0 ||
              view.state.selection instanceof CellSelection
            )
              return false;
            if (
              event.target instanceof Element &&
              event.target.closest('[contenteditable="false"], hr, img')
            )
              return false;
            const selection = view.dom.ownerDocument.getSelection();
            if (
              !selection?.anchorNode ||
              !selection.focusNode ||
              !view.dom.contains(selection.anchorNode) ||
              !view.dom.contains(selection.focusNode)
            )
              return false;
            try {
              const anchor = view.state.doc.resolve(
                view.posAtDOM(selection.anchorNode, selection.anchorOffset),
              );
              const head = view.state.doc.resolve(
                view.posAtDOM(selection.focusNode, selection.focusOffset),
              );
              syncTextSelection(view, anchor, head);
            } catch {
              /* Detached DOM from an external update has no live caret to map. */
            }
            return false;
          },
        },
      },
    }),
);
