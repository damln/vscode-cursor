import { captureBlocks, cancelBlockMotion } from './block-motion';
import { $prose } from '@milkdown/kit/utils';
import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { ICON_GRIP } from './icons';
import { blockSelectionKey, blockSelectionPlugin, blockUnits, selectedUnits, type BlockUnit, type BlockGroup } from './block-selection';
import { moveBlockGroup, moveCurrentBlock } from './block-movement';

export const blockSelection = $prose(() => blockSelectionPlugin());
export const blockHandle = $prose(() => new Plugin({view: view => new BlockControls(view)}));

class BlockControls {
  private abort = new AbortController();
  private handle = document.createElement('button');
  private toolbar = document.createElement('div');
  private count = document.createElement('span');
  private indicator = document.createElement('div');
  private rectangle = document.createElement('div');
  private preview = document.createElement('div');
  private hovered: BlockUnit | null = null;
  private label = document.createElement('span');
  private dragRects = new Map<number, DOMRect>();
  private dragScroll = 0;
  private previewNodes = new Map<HTMLElement, Animation>();
  private previewDestination: number | null = null;
  private rubber: {x: number; y: number; unit: BlockUnit} | null = null;
  private dragging: {group: BlockGroup; doc: EditorView['state']['doc']; y: number; destination: number | null} | null = null;
  private frame = 0;
  private scroller: HTMLElement;
  private up: HTMLButtonElement;
  private down: HTMLButtonElement;
  private previousDoc: EditorView['state']['doc'];

  constructor(private view: EditorView) {
    this.previousDoc = view.state.doc;
    this.scroller = view.dom.closest<HTMLElement>('#document-scroll')!;
    this.handle.className = 'block-group-handle';
    this.handle.type = 'button'; this.handle.draggable = true;
    this.handle.innerHTML = ICON_GRIP;
    this.label.className = 'block-type'; this.label.setAttribute('aria-hidden', 'true'); this.handle.append(this.label);
    this.handle.setAttribute('aria-label', 'Select block; Shift extends selection. Drag to move.');
    this.handle.dataset.toolbarHint = 'Click to select · Shift-click to extend · Drag to move';
    this.handle.hidden = true;
    this.toolbar.className = 'block-group-toolbar'; this.toolbar.setAttribute('role', 'group');
    this.toolbar.setAttribute('aria-label', 'Selected blocks'); this.toolbar.hidden = true;
    this.count.setAttribute('role', 'status'); this.count.setAttribute('aria-live', 'polite');
    this.toolbar.append(this.count);
    const hint = document.createElement('small'); hint.textContent = 'Shift-click another handle to select more';
    this.toolbar.append(hint);
    this.up = this.button('Move up', () => moveCurrentBlock(this.view, -1));
    this.down = this.button('Move down', () => moveCurrentBlock(this.view, 1));
    this.button('Cancel selection', () => {this.select(null); this.view.focus();});
    this.indicator.className = 'block-group-drop'; this.indicator.hidden = true;
    this.rectangle.className = 'block-group-rectangle'; this.rectangle.hidden = true;
    this.preview.className = 'block-group-preview';
    document.body.append(this.handle, this.toolbar, this.indicator, this.rectangle, this.preview);
    const options = {signal: this.abort.signal, capture: true};
    this.scroller.addEventListener('pointermove', this.pointerMove, options);
    this.scroller.addEventListener('pointerdown', this.pointerDown, options);
    document.addEventListener('pointerup', this.pointerUp, options);
    document.addEventListener('pointercancel', this.pointerUp, options);
    this.handle.addEventListener('click', event => {
      if (!this.hovered || !view.editable) return;
      const current = blockSelectionKey.getState(view.state);
      this.select({parent: this.hovered.parent,
        anchor: event.shiftKey && current?.parent === this.hovered.parent ? current.anchor : this.hovered.from,
        head: this.hovered.from}); view.focus();
    }, options);
    this.handle.addEventListener('dragstart', this.dragStart, options);
    document.addEventListener('dragover', this.dragOver, options);
    document.addEventListener('drop', this.drop, options);
    document.addEventListener('dragend', this.endDrag, options);
    window.addEventListener('blur', this.endDrag, options);
    window.addEventListener('keydown', event => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && ['ArrowUp', 'ArrowDown'].includes(event.key) && view.hasFocus()) {
        event.preventDefault(); moveCurrentBlock(view, event.key === 'ArrowUp' ? -1 : 1); return;
      }
      if (event.key === 'Escape' && this.rubber) this.pointerUp();
      if (event.key === 'Escape' && this.dragging) {event.preventDefault(); event.stopImmediatePropagation(); this.endDrag();}
      else if (event.key === 'Escape' && this.toolbar.contains(document.activeElement)) {this.select(null); view.focus();}
    }, options);
    this.scroller.addEventListener('scroll', () => {this.handle.hidden = true; if (this.dragging) this.locateDrop();}, options);
    window.addEventListener('resize', () => {this.handle.hidden = true; this.endDrag();}, options);
    const layout = new ResizeObserver(() => {this.handle.hidden = true; this.endDrag();});
    layout.observe(view.dom);
    this.abort.signal.addEventListener('abort', () => layout.disconnect(), {once: true});
  }
  private button(label: string, action: () => unknown) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', () => action(), {signal: this.abort.signal}); this.toolbar.append(button); return button;
  }
  private select(group: BlockGroup | null) {this.view.dispatch(this.view.state.tr.setMeta(blockSelectionKey, group));}
  private rect(unit: BlockUnit) {
    const cached = this.dragRects.get(unit.from);
    if (this.dragging && cached) return new DOMRect(cached.x, cached.y + this.dragScroll - this.scroller.scrollTop, cached.width, cached.height);
    const node = this.view.nodeDOM(unit.from);
    return node instanceof HTMLElement ? node.getBoundingClientRect() : null;
  }
  private marginUnit(x: number, y: number) {
    if (x < this.scroller.getBoundingClientRect().left + 18) return;
    const all = blockUnits(this.view.state.doc);
    this.view.state.doc.descendants((node, pos) => {
      if (['bullet_list', 'ordered_list'].includes(node.type.name)) all.push(...blockUnits(this.view.state.doc, pos));
    });
    return all.reverse().find(unit => {const rect = this.rect(unit); return rect && x >= rect.left - (unit.parent === -1 ? 64 : 36) && x < rect.left && y >= rect.top && y <= rect.bottom;});
  }
  private pointerMove = (event: PointerEvent) => {
    if (!this.view.editable || this.dragging || (event.buttons && !this.rubber)) return;
    if (this.rubber) {
      const {x, y, unit} = this.rubber;
      this.rectangle.hidden = false;
      Object.assign(this.rectangle.style, {left: Math.min(x, event.clientX) + 'px', top: Math.min(y, event.clientY) + 'px', width: Math.abs(event.clientX - x) + 'px', height: Math.abs(event.clientY - y) + 'px'});
      const units = blockUnits(this.view.state.doc, unit.parent);
      const end = units.find(candidate => {const rect = this.rect(candidate); return rect && event.clientY >= rect.top && event.clientY <= rect.bottom;});
      if (end) this.select({parent: unit.parent, anchor: unit.from, head: end.from});
      event.preventDefault(); return;
    }
    const unit = this.marginUnit(event.clientX, event.clientY) || blockUnits(this.view.state.doc).find(candidate => {
      const rect = this.rect(candidate); return rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    if (!unit) {this.handle.hidden = true; return;}
    this.showHandle(unit);
  };
  private showHandle(unit: BlockUnit) {
    this.hovered = unit;
    const rect = this.rect(unit)!;
    this.handle.hidden = false;
    const left = Math.max(this.scroller.getBoundingClientRect().left + 18, rect.left - this.handle.offsetWidth - 8);
    Object.assign(this.handle.style, {left: left + 'px', top: rect.top + 'px'});
    const names: Record<string, string> = {paragraph:'p', bullet_list:'ul', ordered_list:'ol', list_item:'li', blockquote:'quote', code_block:'code', table:'table', horizontal_rule:'hr', html:'html'};
    this.label.textContent = unit.node.type.name === 'heading' ? `h${unit.node.attrs.level}` : names[unit.node.type.name] || unit.node.type.name;
    this.handle.hidden = false;
  }
  private pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !this.view.editable) return;
    const unit = this.marginUnit(event.clientX, event.clientY);
    if (!unit) return;
    event.preventDefault(); event.stopPropagation();
    this.showHandle(unit);
    const current = blockSelectionKey.getState(this.view.state);
    const anchor = event.shiftKey && current?.parent === unit.parent ? current.anchor : unit.from;
    this.select({parent: unit.parent, anchor, head: unit.from});
    this.rubber = {x: event.clientX, y: event.clientY, unit: {...unit, from: anchor}};
    this.view.focus();
  };
  private pointerUp = () => {this.rubber = null; this.rectangle.hidden = true;};
  private dragStart = (event: DragEvent) => {
    if (!this.hovered || !event.dataTransfer || !this.view.editable) {event.preventDefault(); return;}
    let group = blockSelectionKey.getState(this.view.state);
    if (!selectedUnits(this.view.state.doc, group).some(unit => unit.from === this.hovered!.from && unit.parent === this.hovered!.parent)) {
      group = {parent: this.hovered.parent, anchor: this.hovered.from, head: this.hovered.from}; this.select(group);
    }
    cancelBlockMotion(this.view);
    this.dragRects.clear(); this.dragScroll = this.scroller.scrollTop;
    for (const unit of blockUnits(this.view.state.doc, group!.parent)) {const rect = this.rect(unit); if (rect) this.dragRects.set(unit.from, rect);}
    this.dragging = {group: group!, doc: this.view.state.doc, y: event.clientY, destination: null};
    this.view.dom.dataset.blockDragging = 'true';
    event.dataTransfer.setData('application/x-damln-block-group', 'move'); event.dataTransfer.effectAllowed = 'move';
    this.preview.textContent = this.count.textContent;
    event.dataTransfer.setDragImage(this.preview, 20, 15);
    this.frame = requestAnimationFrame(this.autoScroll);
  };
  private dragOver = (event: DragEvent) => {
    if (!this.dragging) return;
    const rect = this.scroller.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) {this.dragging.y = (rect.top + rect.bottom) / 2; this.dragging.destination = null; this.indicator.hidden = true; this.clearPreview(); return;}
    event.preventDefault(); event.stopImmediatePropagation();
    this.dragging.y = event.clientY; this.locateDrop();
    if (event.dataTransfer) event.dataTransfer.dropEffect = this.dragging.destination === null ? 'none' : 'move';
  };
  private locateDrop() {
    const drag = this.dragging; if (!drag) return;
    const selected = selectedUnits(this.view.state.doc, drag.group);
    const units = blockUnits(this.view.state.doc, drag.group.parent);
    let chosen: {unit: BlockUnit; boundary: number; y: number; distance: number} | undefined;
    for (const unit of units) {
      const rect = this.rect(unit); if (!rect) continue;
      for (const [boundary, y] of [[unit.from, rect.top], [unit.to, rect.bottom]]) {
        const distance = Math.abs(drag.y - y);
        if (!chosen || distance < chosen.distance) chosen = {unit, boundary, y, distance};
      }
    }
    if (!chosen || !selected.length || (chosen.boundary >= selected[0].from && chosen.boundary <= selected.at(-1)!.to)) {
      drag.destination = null; this.indicator.hidden = true; this.clearPreview(); return;
    }
    // Nested items stay within their list; a distant pointer cannot drop across parents.
    if (drag.group.parent >= 0) {
      const first = this.rect(units[0]), last = this.rect(units.at(-1)!);
      if (!first || !last || drag.y < first.top - 20 || drag.y > last.bottom + 20) {drag.destination = null; this.indicator.hidden = true; this.clearPreview(); return;}
    }
    drag.destination = chosen.boundary;
    this.previewOrder(units, selected, chosen.boundary);
    const rect = this.rect(chosen.unit)!;
    Object.assign(this.indicator.style, {left: rect.left + 'px', top: chosen.y + 'px', width: rect.width + 'px'});
    this.indicator.hidden = false;
  }
  private clearPreview() {
    for (const animation of this.previewNodes.values()) animation.cancel();
    this.previewNodes.clear(); this.previewDestination = null;
  }
  private previewOrder(units: BlockUnit[], selected: BlockUnit[], destination: number) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {this.clearPreview(); return;}
    if (this.previewDestination === destination) return;
    this.previewDestination = destination;
    const first = selected[0].from, end = selected.at(-1)!.to;
    const remaining = units.filter(unit => unit.from < first || unit.from >= end);
    const index = remaining.findIndex(unit => unit.from >= destination);
    remaining.splice(index < 0 ? remaining.length : index, 0, ...selected);
    const strides = new Map<number, number>();
    units.forEach((unit, i) => {
      const rect = this.dragRects.get(unit.from), next = this.dragRects.get(units[i+1]?.from);
      if (rect) strides.set(unit.from, next ? next.top - rect.top : rect.height);
    });
    let top = this.dragRects.get(units[0]?.from)?.top ?? 0;
    for (const unit of remaining) {
      const node = this.view.nodeDOM(unit.from), original = this.dragRects.get(unit.from);
      if (node instanceof HTMLElement && original) {
        const transform = getComputedStyle(node).transform;
        this.previewNodes.get(node)?.cancel();
        this.previewNodes.set(node, node.animate([{transform}, {transform: `translateY(${top-original.top}px)`}],
          {duration: 150, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards'}));
      }
      top += strides.get(unit.from) ?? 0;
    }
  }
  private autoScroll = () => {
    if (!this.dragging) return;
    const rect = this.scroller.getBoundingClientRect(), y = this.dragging.y;
    const speed = y < rect.top + 48 ? -Math.min(14, (rect.top + 48 - y) / 4) : y > rect.bottom - 48 ? Math.min(14, (y - rect.bottom + 48) / 4) : 0;
    if (speed) {this.scroller.scrollTop += speed; this.locateDrop();}
    this.frame = requestAnimationFrame(this.autoScroll);
  };
  private drop = (event: DragEvent) => {
    if (!this.dragging) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const {group, doc, destination} = this.dragging;
    const before = captureBlocks(this.view, group.parent);
    this.endDrag();
    if (destination !== null && this.view.state.doc === doc) moveBlockGroup(this.view, group, destination, before);
  };
  private endDrag = () => {
    this.clearPreview(); this.dragRects.clear();
    this.dragging = null; cancelAnimationFrame(this.frame); this.indicator.hidden = true;
    delete this.view.dom.dataset.blockDragging;
  };
  update(view: EditorView) {
    this.view = view;
    if (this.previousDoc !== view.state.doc) {
      cancelBlockMotion(view);
      this.hovered = null; this.handle.hidden = true; this.pointerUp(); this.previousDoc = view.state.doc;
    }
    if (this.dragging && (this.dragging.doc !== view.state.doc || !view.editable)) this.endDrag();
    const group = blockSelectionKey.getState(view.state);
    const selected = selectedUnits(view.state.doc, group);
    this.toolbar.hidden = !selected.length || !view.editable;
    this.count.textContent = `${selected.length} ${group?.parent === -1 ? 'block' : 'list item'}${selected.length === 1 ? '' : 's'}`;
    if (group && selected.length) {
      const units = blockUnits(view.state.doc, group.parent);
      this.up.disabled = selected[0].from === units[0].from;
      this.down.disabled = selected.at(-1)!.to === units.at(-1)!.to;
    }
    if (!view.editable) this.handle.hidden = true;
  }
  destroy() {cancelBlockMotion(this.view); this.endDrag(); this.abort.abort(); this.handle.remove(); this.toolbar.remove(); this.indicator.remove(); this.rectangle.remove(); this.preview.remove();}
}
