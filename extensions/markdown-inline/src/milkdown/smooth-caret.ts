import { $prose } from '@milkdown/kit/utils';
import { Plugin, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

export const smoothCaret = $prose(() => new Plugin({view: view => new SmoothCaret(view)}));
class SmoothCaret {
  private abort = new AbortController();
  private caret = document.createElement('span');
  private line = document.createElement('span');
  private frame = 0;
  private blink: ReturnType<typeof setTimeout> | undefined;
  private animateNext = false;
  private previous: {x: number; y: number} | null = null;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private contrast = matchMedia('(forced-colors: active)');
  private observer: ResizeObserver;
  constructor(private view: EditorView) {
    this.caret.className = 'smooth-editor-caret'; this.caret.setAttribute('aria-hidden', 'true'); this.caret.hidden = true;
    this.caret.append(this.line); document.body.append(this.caret);
    const options = {signal: this.abort.signal};
    document.addEventListener('selectionchange', () => this.schedule(), options);
    document.addEventListener('focusin', () => this.schedule(false), options);
    document.addEventListener('focusout', () => this.hide(), options);
    view.dom.addEventListener('compositionstart', () => this.hide(), options);
    view.dom.addEventListener('compositionend', () => this.schedule(false), options);
    view.dom.addEventListener('block-motion', () => this.schedule(false), options);
    view.dom.addEventListener('dragstart', () => this.hide(), options);
    document.addEventListener('scroll', () => this.schedule(false), {...options, capture: true});
    window.addEventListener('resize', () => this.schedule(false), options);
    window.addEventListener('blur', () => this.hide(), options);
    window.addEventListener('focus', () => this.schedule(false), options);
    this.reduced.addEventListener('change', () => this.schedule(false), options);
    this.contrast.addEventListener('change', () => this.schedule(false), options);
    this.observer = new ResizeObserver(() => this.schedule(false)); this.observer.observe(view.dom);
  }
  private schedule(animate = true) {
    if (!this.frame) this.animateNext = animate; else this.animateNext &&= animate;
    if (!this.frame) this.frame = requestAnimationFrame(() => {this.frame = 0; this.paint();});
  }
  private hide() {
    this.caret.hidden = true; delete this.view.dom.dataset.smoothCaret; this.previous = null; clearTimeout(this.blink);
  }
  private paint() {
    const view = this.view, selection = view.state.selection;
    if (!document.hasFocus() || !view.hasFocus() || !view.editable || view.composing || this.reduced.matches || this.contrast.matches ||
        view.dom.dataset.blockMotion || view.dom.dataset.blockDragging || !(selection instanceof TextSelection) || !selection.empty) {this.hide(); return;}
    const native = document.getSelection();
    if (!native?.isCollapsed || !native.anchorNode || !view.dom.contains(native.anchorNode)) {this.hide(); return;}
    try {
      const rect = view.coordsAtPos(selection.head), viewport = view.dom.closest('#document-scroll')!.getBoundingClientRect();
      const top = Math.max(rect.top, viewport.top), bottom = Math.min(rect.bottom, viewport.bottom);
      if (bottom <= top || rect.left < viewport.left || rect.left > viewport.right || !Number.isFinite(rect.left + top + bottom)) {this.hide(); return;}
      const animate = this.animateNext && this.previous && Math.abs(this.previous.y-top) < viewport.height;
      this.caret.style.transition = animate ? 'transform 110ms cubic-bezier(.2,.8,.2,1)' : 'none';
      this.caret.style.transform = `translate(${rect.left}px, ${top}px)`;
      this.caret.style.height = `${bottom-top}px`;
      this.caret.hidden = false; view.dom.dataset.smoothCaret = 'true'; this.previous = {x: rect.left, y: top};
      clearTimeout(this.blink); this.line.style.animation = 'none';
      this.blink = setTimeout(() => this.line.style.removeProperty('animation'), 450);
    } catch {this.hide();}
  }
  update(view: EditorView, previous: EditorView['state']) {this.view = view; this.schedule(view.state.doc === previous.doc);}
  destroy() {this.hide(); this.abort.abort(); this.observer.disconnect(); cancelAnimationFrame(this.frame); this.caret.remove();}
}
