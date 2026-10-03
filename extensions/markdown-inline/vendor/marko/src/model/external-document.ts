import type { Node } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { DOCUMENT_ORIGIN } from './editor-transaction';

export function applyExternalDocument(view: Pick<EditorView, 'state' | 'dispatch'>, next: Node) {
  const previous = view.state.doc;
  const start = previous.content.findDiffStart(next.content);
  if (start === null) return;
  const end = previous.content.findDiffEnd(next.content)!;
  const overlap = start - Math.min(end.a, end.b);
  if (overlap > 0) { end.a += overlap; end.b += overlap; }
  view.dispatch(view.state.tr.replace(start, end.a, next.slice(start, end.b))
    .setMeta(DOCUMENT_ORIGIN, 'external').setMeta('addToHistory', false));
}
