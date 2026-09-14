import { $prose } from '@milkdown/kit/utils';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import { CellSelection } from '@milkdown/kit/prose/tables';

// Chromium may deliver the next key before its asynchronous selectionchange.
// Reconcile a completed text click without replacing node or table selections.
export const caretSync = $prose(() => new Plugin({
  props: {handleDOMEvents: {mouseup(view, event) {
    if (!view.editable || view.composing || event.button !== 0 || view.state.selection instanceof CellSelection) return false;
    if (event.target instanceof Element && event.target.closest('[contenteditable="false"], hr, img')) return false;
    const selection = view.dom.ownerDocument.getSelection();
    if (!selection?.anchorNode || !selection.focusNode ||
        !view.dom.contains(selection.anchorNode) || !view.dom.contains(selection.focusNode)) return false;
    try {
      const anchor = view.state.doc.resolve(view.posAtDOM(selection.anchorNode, selection.anchorOffset));
      const head = view.state.doc.resolve(view.posAtDOM(selection.focusNode, selection.focusOffset));
      if (anchor.parent.inlineContent && head.parent.inlineContent) {
        const next = TextSelection.between(anchor, head);
        if (!next.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(next).setMeta('pointer', true));
      }
    } catch { /* Detached DOM from an external update has no live caret to map. */ }
    return false;
  }}},
}));
