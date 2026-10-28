import { DOMSerializer, Fragment, type Node as PMNode, Slice } from '@milkdown/kit/prose/model';
import { Selection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { animateBlocks, cancelBlockMotion, captureBlocks } from './block-motion';
import { type BlockGroup, blockSelectionKey, blockUnits, selectedUnits } from './block-selection';

export function moveBlockGroup(
  view: EditorView,
  group: BlockGroup,
  destination: number,
  snapshot?: ReturnType<typeof captureBlocks>,
) {
  if (!view.editable) return false;
  const units = blockUnits(view.state.doc, group.parent);
  const selected = selectedUnits(view.state.doc, group);
  if (!selected.length) return false;
  const last = selected[selected.length - 1];
  const from = selected[0].from,
    to = last.to;
  if (destination >= from && destination <= to) return false;
  if (!units.some((unit) => unit.from === destination) && units.at(-1)?.to !== destination)
    return false;
  const start = Math.min(from, destination),
    end = Math.max(to, destination);
  const fragment = Fragment.fromArray(selected.map((unit) => unit.node));
  const between = view.state.doc.slice(
    destination < from ? destination : to,
    destination < from ? from : destination,
  ).content;
  const replacement = destination < from ? fragment.append(between) : between.append(fragment);
  const newStart = destination < from ? destination : destination - (to - from);
  const tr = view.state.tr.replaceWith(start, end, replacement);
  tr.setMeta(blockSelectionKey, {
    parent: group.parent,
    anchor: newStart,
    head: newStart + fragment.size - last.node.nodeSize,
  });
  tr.setSelection(Selection.near(tr.doc.resolve(newStart + 1)));
  cancelBlockMotion(view);
  const before = snapshot ?? captureBlocks(view, group.parent);
  view.dispatch(tr.scrollIntoView());
  view.focus();
  animateBlocks(view, before, group.parent);
  return true;
}

const isList = (node: PMNode) => ['bullet_list', 'ordered_list'].includes(node.type.name);
const containerAt = (doc: PMNode, parent: number) => (parent === -1 ? doc : doc.nodeAt(parent));

// Selected blocks reshaped for another container: list items gain a list at the root, root blocks become list items.
export function blocksFor(doc: PMNode, group: BlockGroup, parent: number) {
  const selected = selectedUnits(doc, group),
    source = containerAt(doc, group.parent),
    target = containerAt(doc, parent);
  if (!selected.length || !source || !target) return null;
  if (parent === group.parent) return Fragment.fromArray(selected.map((unit) => unit.node));
  if (parent === -1)
    return Fragment.from(
      source.type.create(
        source.attrs,
        selected.map((unit) => unit.node),
      ),
    );
  const item = doc.type.schema.nodes.list_item,
    nodes: PMNode[] = [];
  for (const { node } of selected) {
    if (node.type === item) nodes.push(node);
    else if (isList(node))
      node.forEach((child) => {
        nodes.push(child);
      });
    else if (item?.validContent(Fragment.from(node))) nodes.push(item.create(null, node));
    else return null;
  }
  return Fragment.fromArray(nodes);
}

export function moveBlocksTo(
  view: EditorView,
  group: BlockGroup,
  parent: number,
  destination: number,
) {
  if (parent === group.parent) return moveBlockGroup(view, group, destination);
  const { doc } = view.state;
  const selected = selectedUnits(doc, group),
    source = containerAt(doc, group.parent);
  const fragment = blocksFor(doc, group, parent);
  if (!view.editable || !selected.length || !source || !fragment) return false;
  const from = selected[0].from,
    to = selected[selected.length - 1].to;
  if (destination >= from && destination <= to) return false;
  const tr = view.state.tr.insert(destination, fragment);
  const whole = group.parent !== -1 && selected.length === source.childCount;
  tr.delete(
    tr.mapping.map(whole ? group.parent : from),
    tr.mapping.map(whole ? group.parent + source.nodeSize : to),
  );
  const after = tr.mapping.slice(1);
  const wrapped = parent === -1 && group.parent !== -1;
  const start = after.map(destination) + (wrapped ? 1 : 0);
  const items = wrapped ? fragment.child(0).content : fragment;
  tr.setMeta(blockSelectionKey, {
    parent: wrapped ? start - 1 : parent === -1 ? -1 : tr.mapping.map(parent),
    anchor: start,
    head: start + items.size - items.child(items.childCount - 1).nodeSize,
  });
  tr.setSelection(Selection.near(tr.doc.resolve(start + 1)));
  cancelBlockMotion(view);
  const before = captureBlocks(view);
  view.dispatch(tr.scrollIntoView());
  view.focus();
  animateBlocks(view, before);
  return true;
}

export function selectedBlocksSlice(view: EditorView) {
  const { doc } = view.state,
    group = blockSelectionKey.getState(view.state);
  if (!group || !selectedUnits(doc, group).length) return null;
  const content = blocksFor(doc, group, -1);
  return content ? new Slice(content, 0, 0) : null;
}

export function serializeBlocks(view: EditorView, slice: Slice) {
  const text =
    view.someProp('clipboardTextSerializer', (serialize) => serialize(slice, view)) ??
    slice.content.textBetween(0, slice.content.size, '\n\n');
  const html = document.createElement('div');
  html.append(DOMSerializer.fromSchema(view.state.schema).serializeFragment(slice.content));
  return { text, html: html.innerHTML };
}

export function deleteSelectedBlocks(view: EditorView) {
  const { doc } = view.state,
    group = blockSelectionKey.getState(view.state);
  const selected = selectedUnits(doc, group),
    source = group && containerAt(doc, group.parent);
  if (!view.editable || !group || !selected.length || !source) return false;
  const whole = group.parent !== -1 && selected.length === source.childCount;
  const from = whole ? group.parent : selected[0].from,
    to = whole ? group.parent + source.nodeSize : selected[selected.length - 1].to;
  const tr =
    group.parent === -1 && selected.length === doc.childCount
      ? view.state.tr.replaceWith(0, doc.content.size, view.state.schema.nodes.paragraph.create())
      : view.state.tr.delete(from, to);
  tr.setMeta(blockSelectionKey, null);
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size))));
  view.dispatch(tr.scrollIntoView());
  view.focus();
  return true;
}

export function moveCurrentBlock(view: EditorView, direction: -1 | 1) {
  if (!view.editable) return false;
  const group = blockSelectionKey.getState(view.state);
  if (group) {
    const units = blockUnits(view.state.doc, group.parent);
    const selected = selectedUnits(view.state.doc, group);
    if (!selected.length) return false;
    const index =
      units.findIndex(
        (unit) =>
          unit.from === (direction < 0 ? selected[0].from : selected[selected.length - 1].from),
      ) + direction;
    return (
      Boolean(units[index]) &&
      moveBlockGroup(view, group, direction < 0 ? units[index].from : units[index].to)
    );
  }
  const { doc, selection } = view.state;
  const index = selection.$from.index(0);
  const target = index + direction;
  if (target < 0 || target >= doc.childCount) return false;
  const startIndex = Math.min(index, target);
  let start = 0;
  for (let i = 0; i < startIndex; i++) start += doc.child(i).nodeSize;
  const first = doc.child(startIndex),
    second = doc.child(startIndex + 1);
  const oldStart = start + (direction < 0 ? first.nodeSize : 0);
  const newStart = start + (direction > 0 ? second.nodeSize : 0);
  const tr = view.state.tr.replaceWith(start, start + first.nodeSize + second.nodeSize, [
    second,
    first,
  ]);
  tr.setSelection(Selection.near(tr.doc.resolve(newStart + selection.from - oldStart)));
  cancelBlockMotion(view);
  const before = captureBlocks(view);
  view.dispatch(tr.scrollIntoView());
  view.focus();
  animateBlocks(view, before);
  return true;
}
