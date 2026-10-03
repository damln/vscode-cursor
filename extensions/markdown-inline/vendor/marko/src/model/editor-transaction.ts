import { ReplaceStep } from '@milkdown/kit/prose/transform';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Transaction } from '@milkdown/kit/prose/state';
import type { Node } from '@milkdown/kit/prose/model';

export const DOCUMENT_ORIGIN = 'markdown-inline-origin';

export function applyEditorTransaction(
  view: Pick<EditorView, 'state' | 'updateState'>,
  transaction: Transaction,
  changed: (doc: Node, previous: Node) => void,
) {
  const previous = view.state.doc;
  const result = view.state.applyTransaction(transaction);
  view.updateState(result.state);
  if (transaction.getMeta(DOCUMENT_ORIGIN) === 'external') return;
  if (result.transactions.some(item => item.docChanged) && !result.state.doc.eq(previous)) {
    changed(result.state.doc, previous);
  }
}

export function isTypingTransaction(transaction: Transaction): boolean {
  const step = transaction.steps[0];
  return transaction.steps.length === 1 && step instanceof ReplaceStep &&
    step.to - step.from <= 1 && step.slice.openStart === 0 && step.slice.openEnd === 0 &&
    (step.slice.content.size === 0 || (step.slice.content.childCount === 1 &&
      step.slice.content.firstChild!.isText && step.slice.content.size <= 2));
}
