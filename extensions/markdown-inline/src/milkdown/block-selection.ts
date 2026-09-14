import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';

export interface BlockGroup { parent: number; anchor: number; head: number }
export interface BlockUnit { parent: number; from: number; to: number; node: PMNode }
export const blockSelectionKey = new PluginKey<BlockGroup | null>('block-group');

// Root blocks are whole units. Inside a list, only sibling list items form a group.
export function blockUnits(doc: PMNode, parent = -1): BlockUnit[] {
  const node = parent === -1 ? doc : doc.nodeAt(parent);
  if (!node || (parent !== -1 && !['bullet_list', 'ordered_list'].includes(node.type.name))) return [];
  const units: BlockUnit[] = [];
  node.forEach((child, offset) => {
    const from = parent + 1 + offset;
    units.push({parent, from, to: from + child.nodeSize, node: child});
  });
  return units;
}
export function selectedUnits(doc: PMNode, group: BlockGroup | null | undefined): BlockUnit[] {
  if (!group) return [];
  const units = blockUnits(doc, group.parent);
  const a = units.findIndex(unit => unit.from === group.anchor);
  const b = units.findIndex(unit => unit.from === group.head);
  return a < 0 || b < 0 ? [] : units.slice(Math.min(a, b), Math.max(a, b) + 1);
}
export function blockSelectionPlugin() {
  return new Plugin<BlockGroup | null>({
    key: blockSelectionKey,
    state: {
      init: () => null,
      apply(tr, value) {
        const explicit = tr.getMeta(blockSelectionKey);
        if (explicit !== undefined) return explicit;
        if (!value || !tr.docChanged) return value;
        const anchor = tr.mapping.mapResult(value.anchor, 1);
        const head = tr.mapping.mapResult(value.head, 1);
        if (anchor.deleted || head.deleted) return null;
        const mapped = {parent: value.parent < 0 ? -1 : tr.mapping.map(value.parent, 1), anchor: anchor.pos, head: head.pos};
        return selectedUnits(tr.doc, mapped).length ? mapped : null;
      },
    },
    props: {
      decorations(state) {
        return DecorationSet.create(state.doc, selectedUnits(state.doc, blockSelectionKey.getState(state)).map(unit =>
          Decoration.node(unit.from, unit.to, {class: 'block-group-selected', 'data-block-selected': 'true'})));
      },
      handleKeyDown(view, event) {
        const group = blockSelectionKey.getState(view.state);
        if (!group) return false;
        if (event.key === 'Escape') {
          view.dispatch(view.state.tr.setMeta(blockSelectionKey, null)); return true;
        }
        if (event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
          const units = blockUnits(view.state.doc, group.parent);
          const index = units.findIndex(unit => unit.from === group.head) + (event.key === 'ArrowUp' ? -1 : 1);
          if (units[index]) view.dispatch(view.state.tr.setMeta(blockSelectionKey, {...group, head: units[index].from}));
          return true;
        }
        if (!['Shift', 'Control', 'Meta', 'Alt'].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
          view.dispatch(view.state.tr.setMeta(blockSelectionKey, null));
        }
        return false;
      },
      handleDOMEvents: {mousedown(view) {
        if (blockSelectionKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(blockSelectionKey, null));
        return false;
      }},
    },
  });
}
