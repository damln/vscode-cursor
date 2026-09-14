import type { EditorState } from '@milkdown/kit/prose/state';

/** A mark is active at the caret, or when every selected inline node has it. */
export function isInlineMarkActive(state: EditorState, markName: string): boolean {
  const mark = state.schema.marks[markName];
  if (!mark) return false;
  const {selection} = state;
  if (selection.empty) {
    return !!mark.isInSet(state.storedMarks ?? selection.$from.marks());
  }
  let found = false, allMarked = true;
  // Cell selections have separate ranges. A single from/to span also includes
  // unselected cells between the first and last selected cells in a column.
  for (const {$from, $to} of selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, node => {
      if (!node.isInline) return;
      found = true;
      if (!mark.isInSet(node.marks)) allMarked = false;
    });
  }
  return found && allMarked;
}
