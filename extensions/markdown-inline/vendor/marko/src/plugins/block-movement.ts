import { captureBlocks, animateBlocks, cancelBlockMotion } from './block-motion';
import type { EditorView } from '@milkdown/kit/prose/view';
import { Fragment } from '@milkdown/kit/prose/model';
import { Selection } from '@milkdown/kit/prose/state';
import { blockSelectionKey, blockUnits, selectedUnits, type BlockGroup } from './block-selection';

export function moveBlockGroup(view: EditorView, group: BlockGroup, destination: number, snapshot?: ReturnType<typeof captureBlocks>) {
  if (!view.editable) return false;
  const units = blockUnits(view.state.doc, group.parent);
  const selected = selectedUnits(view.state.doc, group);
  if (!selected.length) return false;
  const from = selected[0].from, to = selected.at(-1)!.to;
  if (destination >= from && destination <= to) return false;
  if (!units.some(unit => unit.from === destination) && units.at(-1)?.to !== destination) return false;
  const start = Math.min(from, destination), end = Math.max(to, destination);
  const fragment = Fragment.fromArray(selected.map(unit => unit.node));
  const between = view.state.doc.slice(destination < from ? destination : to, destination < from ? from : destination).content;
  const replacement = destination < from ? fragment.append(between) : between.append(fragment);
  const newStart = destination < from ? destination : destination - (to - from);
  const tr = view.state.tr.replaceWith(start, end, replacement);
  tr.setMeta(blockSelectionKey, {parent: group.parent, anchor: newStart, head: newStart + fragment.size - selected.at(-1)!.node.nodeSize});
  tr.setSelection(Selection.near(tr.doc.resolve(newStart + 1)));
  cancelBlockMotion(view);
  const before = snapshot ?? captureBlocks(view, group.parent);
  view.dispatch(tr.scrollIntoView()); view.focus();
  animateBlocks(view, before, group.parent);
  return true;
}

export function moveCurrentBlock(view: EditorView, direction: -1 | 1) {
  if (!view.editable) return false;
  const group = blockSelectionKey.getState(view.state);
  if (group) {
    const units = blockUnits(view.state.doc, group.parent);
    const selected = selectedUnits(view.state.doc, group);
    if (!selected.length) return false;
    const index = units.findIndex(unit => unit.from === (direction < 0 ? selected[0].from : selected.at(-1)!.from)) + direction;
    return Boolean(units[index]) && moveBlockGroup(view, group, direction < 0 ? units[index].from : units[index].to);
  }
  const {doc, selection} = view.state;
  const index = selection.$from.index(0);
  const target = index + direction;
  if (target < 0 || target >= doc.childCount) return false;
  const startIndex = Math.min(index, target);
  let start = 0;
  for (let i = 0; i < startIndex; i++) start += doc.child(i).nodeSize;
  const first = doc.child(startIndex), second = doc.child(startIndex + 1);
  const oldStart = start + (direction < 0 ? first.nodeSize : 0);
  const newStart = start + (direction > 0 ? second.nodeSize : 0);
  const tr = view.state.tr.replaceWith(start, start + first.nodeSize + second.nodeSize, [second, first]);
  tr.setSelection(Selection.near(tr.doc.resolve(newStart + selection.from - oldStart)));
  cancelBlockMotion(view);
  const before = captureBlocks(view);
  view.dispatch(tr.scrollIntoView()); view.focus();
  animateBlocks(view, before);
  return true;
}
