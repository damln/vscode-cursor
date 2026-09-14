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
  private handleMotion: Animation | null = null;
  private labelMotion: Animation | null = null;
  private hideHandleTimer = 0;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private dragRects = new Map<number, DOMRect>();
  private dragScroll = 0;
  private previewNodes = new Map<HTMLElement, Animation>();
  private previewDestination: number | null = null;
  private rubber: {x: number; y: number; currentX: number; currentY: number; scrollTop: number;
    parent: number; pointerId: number; active: boolean; previous: BlockGroup | null} | null = null;
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
    this.handle.setAttribute('aria-label', 'Select block. Drag to move selected blocks.');
    this.handle.hidden = true;
    this.toolbar.className = 'block-group-toolbar'; this.toolbar.setAttribute('role', 'group');
    this.toolbar.setAttribute('aria-label', 'Selected blocks'); this.toolbar.hidden = true;
    this.count.setAttribute('role', 'status'); this.count.setAttribute('aria-live', 'polite');
    this.toolbar.append(this.count);
    this.up = this.button('Move up', () => moveCurrentBlock(this.view, -1));
    this.down = this.button('Move down', () => moveCurrentBlock(this.view, 1));
    this.button('Cancel selection', () => {this.select(null); this.view.focus();});
    this.indicator.className = 'block-group-drop'; this.indicator.hidden = true;
    this.rectangle.className = 'block-group-rectangle'; this.rectangle.hidden = true;
    this.preview.className = 'block-group-preview';
    document.body.append(this.handle, this.toolbar, this.indicator, this.rectangle, this.preview);
    const options = {signal: this.abort.signal, capture: true};
    document.addEventListener('pointermove', this.pointerMove, options);
    this.scroller.addEventListener('pointerdown', this.pointerDown, options);
    document.addEventListener('pointerup', this.pointerUp, options);
    document.addEventListener('pointercancel', this.cancelArea, options);
    this.scroller.addEventListener('lostpointercapture', this.cancelArea, options);
    this.handle.addEventListener('click', () => {
      if (!this.hovered || !view.editable) return;
      this.select({parent: this.hovered.parent,
        anchor: this.hovered.from,
        head: this.hovered.from}); view.focus();
    }, options);
    this.handle.addEventListener('dragstart', this.dragStart, options);
    this.scroller.addEventListener('pointerleave', event => {
      if (event.relatedTarget !== this.handle && !this.dragging) this.hideHandle();
    }, options);
    this.handle.addEventListener('pointerleave', event => {
      if (!(event.relatedTarget instanceof Node && this.scroller.contains(event.relatedTarget)) && !this.dragging) this.hideHandle();
    }, options);
    this.reducedMotion.addEventListener('change', () => this.hideHandle(true), options);
    document.addEventListener('dragover', this.dragOver, options);
    document.addEventListener('drop', this.drop, options);
    document.addEventListener('dragend', this.endDrag, options);
    window.addEventListener('blur', this.endDrag, options);
    window.addEventListener('blur', this.cancelArea, options);
    window.addEventListener('keydown', event => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && ['ArrowUp', 'ArrowDown'].includes(event.key) && view.hasFocus()) {
        event.preventDefault(); moveCurrentBlock(view, event.key === 'ArrowUp' ? -1 : 1); return;
      }
      if (event.key === 'Escape' && this.rubber) {
        event.preventDefault(); event.stopImmediatePropagation(); this.cancelArea(); return;
      }
      if (event.key === 'Escape' && this.dragging) {event.preventDefault(); event.stopImmediatePropagation(); this.endDrag();}
      else if (event.key === 'Escape' && this.toolbar.contains(document.activeElement)) {this.select(null); view.focus();}
    }, options);
    this.scroller.addEventListener('scroll', () => {this.hideHandle(true); if (this.dragging) this.locateDrop();}, options);
    window.addEventListener('resize', () => {this.hideHandle(true); this.cancelArea(); this.endDrag();}, options);
    const layout = new ResizeObserver(() => {this.hideHandle(true); this.endDrag();});
    layout.observe(view.dom);
    this.abort.signal.addEventListener('abort', () => layout.disconnect(), {once: true});
  }
  private button(label: string, action: () => unknown) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
    button.addEventListener('click', () => action(), {signal: this.abort.signal}); this.toolbar.append(button); return button;
  }
  private select(group: BlockGroup | null) {
    const previous = blockSelectionKey.getState(this.view.state);
    if (previous?.parent === group?.parent && previous?.anchor === group?.anchor && previous?.head === group?.head) return;
    this.view.dispatch(this.view.state.tr.setMeta(blockSelectionKey, group));
  }
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
    if (!this.rubber && !(event.target instanceof Node && this.scroller.contains(event.target))) return;
    if (!this.view.editable || this.dragging || (event.buttons && !this.rubber)) return;
    if (this.rubber) {
      this.rubber.currentX = event.clientX; this.rubber.currentY = event.clientY;
      if (!this.rubber.active && Math.hypot(event.clientX - this.rubber.x, event.clientY - this.rubber.y) >= 4) {
        this.rubber.active = true; this.hideHandle(true);
        this.frame = requestAnimationFrame(this.autoScroll);
      }
      if (this.rubber.active) this.selectArea();
      event.preventDefault(); return;
    }
    const unit = this.marginUnit(event.clientX, event.clientY) || blockUnits(this.view.state.doc).find(candidate => {
      const rect = this.rect(candidate); return rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    if (!unit) {this.hideHandle(); return;}
    this.showHandle(unit);
  };
  private hideHandle(immediate = false) {
    if (!immediate && (this.handle.hidden || this.handle.disabled)) return;
    // A fading control is decorative: it must not select the previous block.
    this.handle.disabled = true;
    if (immediate || this.reducedMotion.matches) {
      window.clearTimeout(this.hideHandleTimer); this.hideHandleTimer = 0;
      this.handleMotion?.cancel(); this.labelMotion?.cancel();
      this.handle.hidden = true;
      return;
    }
    // Bridge the small margins between adjacent blocks without flickering.
    this.hideHandleTimer = window.setTimeout(() => {
      this.hideHandleTimer = 0;
      const opacity = getComputedStyle(this.handle).opacity;
      const transform = getComputedStyle(this.handle).transform;
      this.handleMotion?.cancel();
      this.handleMotion = this.handle.animate([{opacity, transform}, {opacity: 0, transform}],
        {duration: 100, easing: 'ease-out', fill: 'forwards'});
      this.handleMotion.onfinish = () => {this.handle.hidden = true;};
    }, 100);
  }
  private showHandle(unit: BlockUnit) {
    const rect = this.rect(unit); if (!rect) return;
    const visible = !this.handle.hidden;
    const previous = visible ? this.handle.getBoundingClientRect() : null;
    const opacity = visible ? getComputedStyle(this.handle).opacity : '0';
    window.clearTimeout(this.hideHandleTimer); this.hideHandleTimer = 0;
    const returning = this.handle.disabled;
    this.handle.disabled = false;
    this.hovered = unit;
    this.handle.hidden = false;
    const left = Math.max(this.scroller.getBoundingClientRect().left + 18, rect.left - this.handle.offsetWidth - 8);
    const moved = !this.handle.style.top || Math.abs(parseFloat(this.handle.style.left) - left) > .01
      || Math.abs(parseFloat(this.handle.style.top) - rect.top) > .01;
    if (moved || !visible || returning) {
      this.handleMotion?.cancel();
      Object.assign(this.handle.style, {left: left + 'px', top: rect.top + 'px'});
      if (!this.reducedMotion.matches) {
        this.handleMotion = this.handle.animate([
          {transform: previous ? `translate(${previous.left - left}px, ${previous.top - rect.top}px)` : 'translateX(-3px)', opacity},
          {transform: 'translate(0, 0)', opacity: 1},
        ], {duration: 140, easing: 'cubic-bezier(.2,.8,.2,1)'});
      }
    }
    const names: Record<string, string> = {paragraph:'p', bullet_list:'ul', ordered_list:'ol', list_item:'li', blockquote:'quote', code_block:'code', table:'table', horizontal_rule:'hr', html:'html'};
    const label = unit.node.type.name === 'heading' ? `h${unit.node.attrs.level}` : names[unit.node.type.name] || unit.node.type.name;
    if (this.label.textContent !== label) {
      this.labelMotion?.cancel();
      this.label.textContent = label;
      if (visible && !this.reducedMotion.matches) {
        this.labelMotion = this.label.animate([{opacity: 0}, {opacity: .7}], {duration: 120, easing: 'ease-out'});
      }
    }
  }
  private pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !this.view.editable) return;
    const unit = this.marginUnit(event.clientX, event.clientY);
    const target = event.target;
    const blank = target === this.scroller || target === this.view.dom || target === this.view.dom.parentElement ||
      target === document.getElementById('editor');
    if (!unit && (!blank || event.clientY < this.view.dom.getBoundingClientRect().top - 12 ||
        event.clientX < this.scroller.getBoundingClientRect().left + 18)) return;
    event.preventDefault(); event.stopPropagation();
    const previous = blockSelectionKey.getState(this.view.state) ?? null;
    if (unit) {this.showHandle(unit); this.select({parent: unit.parent, anchor: unit.from, head: unit.from});}
    else this.select(null);
    this.rubber = {x: event.clientX, y: event.clientY, currentX: event.clientX, currentY: event.clientY,
      scrollTop: this.scroller.scrollTop, parent: unit?.parent ?? -1, pointerId: event.pointerId, active: false, previous};
    this.scroller.setPointerCapture(event.pointerId);
    this.view.focus();
  };
  private selectArea() {
    const area = this.rubber; if (!area?.active) return;
    const bounds = this.scroller.getBoundingClientRect();
    const startY = area.y + area.scrollTop - this.scroller.scrollTop;
    const endX = Math.max(bounds.left, Math.min(bounds.right, area.currentX));
    const endY = Math.max(bounds.top, Math.min(bounds.bottom, area.currentY));
    const left = Math.min(area.x, endX), right = Math.max(area.x, endX);
    const top = Math.min(startY, endY), bottom = Math.max(startY, endY);
    this.rectangle.hidden = false;
    Object.assign(this.rectangle.style, {left: left + 'px', top: Math.max(bounds.top, top) + 'px',
      width: right - left + 'px', height: Math.max(0, Math.min(bounds.bottom, bottom) - Math.max(bounds.top, top)) + 'px'});
    const units = blockUnits(this.view.state.doc, area.parent).filter(unit => {
      const rect = this.rect(unit);
      return rect && rect.bottom > top && rect.top < bottom &&
        rect.right + 8 >= left && rect.left - (area.parent === -1 ? 64 : 36) <= right;
    });
    this.select(units.length ? {parent: area.parent, anchor: units[0].from, head: units.at(-1)!.from} : null);
  }
  private pointerUp = () => {
    if (this.rubber) {
      if (this.scroller.hasPointerCapture(this.rubber.pointerId)) this.scroller.releasePointerCapture(this.rubber.pointerId);
      cancelAnimationFrame(this.frame); this.rubber = null;
    }
    this.rectangle.hidden = true;
  };
  private cancelArea = () => {
    if (!this.rubber) return;
    const previous = this.rubber.previous; this.pointerUp(); this.select(previous);
  };
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
    if (!this.dragging && !this.rubber?.active) return;
    const rect = this.scroller.getBoundingClientRect(), y = this.dragging?.y ?? this.rubber!.currentY;
    const speed = y < rect.top + 48 ? -Math.min(14, (rect.top + 48 - y) / 4) : y > rect.bottom - 48 ? Math.min(14, (y - rect.bottom + 48) / 4) : 0;
    if (speed) {
      this.scroller.scrollTop += speed;
      if (this.dragging) this.locateDrop(); else this.selectArea();
    }
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
      this.hovered = null; this.hideHandle(true); this.pointerUp(); this.previousDoc = view.state.doc;
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
    if (!view.editable) this.hideHandle(true);
  }
  destroy() {this.pointerUp(); this.hideHandle(true); cancelBlockMotion(this.view); this.endDrag(); this.abort.abort(); this.handle.remove(); this.toolbar.remove(); this.indicator.remove(); this.rectangle.remove(); this.preview.remove();}
}
