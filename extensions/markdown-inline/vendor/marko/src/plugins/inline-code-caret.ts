import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet, type EditorView } from '@milkdown/kit/prose/view';
import type { Mark, MarkType } from '@milkdown/kit/prose/model';
import { codeEdgeAt, isInlineCodeMark, sameMarks, type CodeEdge } from '../model/inline-code-boundary';

// Each edge of inline code holds two caret positions, inside and outside the code,
// at the same document position. The side lives in stored marks: typing keeps it,
// arrows cross the edge with one extra press, and a click picks the side it landed on.

export type CodeSide = 'inside' | 'outside';
const SIDE = 'inline-code-side';
const key = new PluginKey('inline-code-caret');

const codeType = (state: EditorState): MarkType | undefined =>
  state.schema.marks.inlineCode || state.schema.marks.code_inline;

function edgeOf(state: EditorState): CodeEdge | null {
  const type = codeType(state);
  return type && state.selection.empty ? codeEdgeAt(state.selection.$from, type) : null;
}

export function codeSide(state: EditorState): CodeSide | null {
  const edge = edgeOf(state), type = codeType(state);
  if (!edge || !type) return null;
  const active = state.storedMarks ?? state.selection.$from.marks();
  return active.some(mark => isInlineCodeMark(mark, type)) ? 'inside' : 'outside';
}

function choose(tr: Transaction, edge: CodeEdge, side: CodeSide) {
  return tr.setStoredMarks([...(side === 'inside' ? edge.inside : edge.outside)]).setMeta(SIDE, side);
}

/** One arrow press across a code edge, without moving through the text. */
export function crossCodeEdge(state: EditorState, direction: 'left' | 'right'): Transaction | null {
  const edge = edgeOf(state), side = codeSide(state);
  if (!edge || !side) return null;
  const into = direction === 'right' ? !edge.end : edge.end;
  if (into === (side === 'inside')) return null;
  return choose(state.tr, edge, into ? 'inside' : 'outside');
}

/** The side a caret takes when it arrives at a code edge by itself: an edit keeps the side it was typed on,
 * an arrow keeps the side of the character it passed, and a jump lands outside. */
function arrivalSide(state: EditorState, previous: EditorState, docChanged: boolean): CodeSide {
  const type = codeType(state)!, { $from } = state.selection, head = $from.pos, before = previous.selection.head;
  const isCode = (marks: readonly Mark[] | undefined) => Boolean(marks?.some(mark => isInlineCodeMark(mark, type)));
  if (docChanged) return isCode(previous.storedMarks ?? previous.selection.$from.marks()) ? 'inside' : 'outside';
  if (head === before + 1) return isCode($from.nodeBefore?.marks) ? 'inside' : 'outside';
  if (head === before - 1) return isCode($from.nodeAfter?.marks) ? 'inside' : 'outside';
  return 'outside';
}

function codeRange(state: EditorState): { from: number; to: number } | null {
  const type = codeType(state), { $from } = state.selection;
  if (!type || !state.selection.empty) return null;
  const active = state.storedMarks ?? $from.marks();
  if (!active.some(mark => isInlineCodeMark(mark, type))) return null;
  const parent = $from.parent, start = $from.start(), isCode = (index: number) =>
    index >= 0 && index < parent.childCount && parent.child(index).marks.some(mark => isInlineCodeMark(mark, type));
  let index = $from.index();
  if (!isCode(index) || (codeEdgeAt($from, type)?.end ?? false)) index = $from.index() - 1;
  if (!isCode(index)) return null;
  let first = index, last = index;
  while (isCode(first - 1)) first--;
  while (isCode(last + 1)) last++;
  let from = start;
  for (let i = 0; i < first; i++) from += parent.child(i).nodeSize;
  let to = from;
  for (let i = first; i <= last; i++) to += parent.child(i).nodeSize;
  return { from, to };
}

/** The browser moves the caret before ProseMirror reads it, so quick arrow presses can see a stale head. */
function catchUp(view: EditorView) {
  const root = view.root as Document | (ShadowRoot & { getSelection?: () => Selection | null });
  const selection = root.getSelection ? root.getSelection() : document.getSelection();
  if (!view.state.selection.empty || !selection?.isCollapsed || !selection.focusNode || !view.dom.contains(selection.focusNode)) return;
  let pos: number;
  try { pos = view.posAtDOM(selection.focusNode, selection.focusOffset); } catch { return; }
  if (pos !== view.state.selection.head) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
}

export function inlineCodeCaretPlugin() {
  return new Plugin({
    key,
    props: {
      handleKeyDown(view, event) {
        if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
        catchUp(view);
        const tr = crossCodeEdge(view.state, event.key === 'ArrowLeft' ? 'left' : 'right');
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      },
      handleClick(view, pos, event) {
        const type = codeType(view.state);
        if (!type || event.shiftKey) return false;
        const edge = codeEdgeAt(view.state.doc.resolve(pos), type);
        if (!edge) return false;
        const onCode = event.target instanceof Element && Boolean(event.target.closest('code'));
        const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos));
        view.dispatch(choose(tr, edge, onCode ? 'inside' : 'outside'));
        return true;
      },
      decorations(state) {
        const range = codeRange(state);
        return range ? DecorationSet.create(state.doc, [Decoration.inline(range.from, range.to, { class: 'inline-code-caret' })]) : null;
      },
    },
    appendTransaction(transactions, previous, state) {
      if (!state.selection.empty || transactions.some(tr => tr.getMeta(SIDE) || tr.storedMarksSet)) return null;
      const docChanged = transactions.some(tr => tr.docChanged);
      if (!docChanged && !transactions.some(tr => tr.selectionSet)) return null;
      const edge = edgeOf(state);
      if (!edge) return null;
      const side = arrivalSide(state, previous, docChanged);
      const marks = side === 'inside' ? edge.inside : edge.outside;
      if (sameMarks(state.storedMarks ?? state.selection.$from.marks(), marks)) return null;
      return choose(state.tr, edge, side);
    },
  });
}

export const inlineCodeCaret = $prose(() => inlineCodeCaretPlugin());

/** Where to draw the caret, so it shows which side of a code edge it is on. */
export function caretCoords(view: EditorView): { left: number; top: number; bottom: number } {
  const state = view.state, head = state.selection.head, edge = edgeOf(state), side = codeSide(state);
  if (!edge || !side) return view.coordsAtPos(head);
  const inside = side === 'inside';
  const rect = view.coordsAtPos(head, edge.end === inside ? -1 : 1);
  if (inside) return rect;
  const { node } = view.domAtPos(head, edge.end ? -1 : 1);
  const code = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node as Element)?.closest('code');
  if (!code) return rect;
  const box = code.getBoundingClientRect();
  return { left: edge.end ? box.right + 1 : box.left - 3, top: rect.top, bottom: rect.bottom };
}
