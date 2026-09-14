import { $prose } from '@milkdown/kit/utils';
import { Plugin } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { headingIndex, scrollToHeading, cancelHeadingScroll } from '../lib/heading-navigation';
import { FloatingPanel } from './floating-panel';

export const contentsRail = $prose(() => new Plugin({view: view => new Contents(view)}));
class Contents {
  private abort = new AbortController();
  private trigger = document.createElement('button');
  private panel = document.createElement('nav');
  private floating: FloatingPanel;
  private scroller: HTMLElement;
  private headings: ReturnType<typeof headingIndex> = [];
  private doc: EditorView['state']['doc'] | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private frame = 0;
  private observer: ResizeObserver;
  constructor(private view: EditorView) {
    this.scroller = view.dom.closest<HTMLElement>('#document-scroll')!;
    this.trigger.className = 'contents-trigger'; this.trigger.type = 'button';
    this.trigger.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 5h16M4 10h10M4 15h16M4 20h10"/></svg><span>Contents</span>';
    this.trigger.setAttribute('aria-label', 'Table of contents'); this.trigger.setAttribute('aria-expanded', 'false');
    this.panel.className = 'contents-panel'; this.panel.setAttribute('aria-label', 'Table of contents');
    this.floating = new FloatingPanel(this.panel, 1, () => this.trigger.setAttribute('aria-expanded', 'false'), restore => {
      this.close();
      if (restore) this.trigger.focus();
      clearTimeout(this.timer);
    });
    document.getElementById('contents-slot')!.append(this.trigger);
    document.body.append(this.panel);
    const options = {signal: this.abort.signal};
    this.trigger.addEventListener('focus', () => {clearTimeout(this.timer); this.timer = setTimeout(() => this.open(), 220);}, options);
    this.trigger.addEventListener('click', () => this.panel.dataset.show === 'true' ? this.close() : this.open(true), options);
    for (const element of [this.trigger, this.panel]) {
      element.addEventListener('pointerenter', event => {
        clearTimeout(this.timer);
        if (event.pointerType !== 'touch') this.timer = setTimeout(() => this.open(), 220);
      }, options);
      element.addEventListener('pointerleave', () => {
        clearTimeout(this.timer); this.timer = setTimeout(() => {
          if (!this.panel.contains(document.activeElement)) this.close();
        }, 120);
      }, options);
      element.addEventListener('keydown', event => {
        if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); this.close(); this.trigger.focus(); clearTimeout(this.timer);}
        if (element === this.trigger && event.key === 'ArrowDown') {event.preventDefault(); this.open(true);}
      }, options);
    }
    this.panel.addEventListener('keydown', event => {
      const buttons = Array.from(this.panel.querySelectorAll('button'));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : event.key === 'ArrowDown' ? Math.min(buttons.length-1,index+1) : event.key === 'ArrowUp' ? Math.max(0,index-1) : -1;
      if (next >= 0) {event.preventDefault(); buttons[next]?.focus();}
    }, options);
    document.addEventListener('pointerdown', event => {
      if (!this.panel.contains(event.target as Node) && !this.trigger.contains(event.target as Node)) this.close();
    }, options);
    document.addEventListener('focusin', event => {
      if (!this.panel.contains(event.target as Node) && event.target !== this.trigger) this.close();
    }, options);
    this.scroller.addEventListener('scroll', () => {
      if (!this.frame) this.frame = requestAnimationFrame(() => {this.frame = 0; this.active();});
    }, options);
    window.addEventListener('resize', () => this.close(), options);
    this.observer = new ResizeObserver(() => {this.trigger.hidden = !view.dom.getClientRects().length; if (this.trigger.hidden) this.close();});
    this.observer.observe(view.dom);
    this.update(view);
  }
  private open(focus = false) {
    clearTimeout(this.timer);
    if (this.trigger.hidden || !this.floating.show()) return;
    this.trigger.setAttribute('aria-expanded', 'true'); this.active();
    const rect = this.trigger.getBoundingClientRect();
    this.panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth-248))}px`;
    this.panel.style.top = `${Math.max(8, Math.min(rect.bottom+6, innerHeight-this.panel.offsetHeight-8))}px`;
    if (focus) this.panel.querySelector<HTMLButtonElement>('[aria-current], button')?.focus();
  }
  private close() {clearTimeout(this.timer); this.floating.hide();}
  private active() {
    const top = this.scroller.getBoundingClientRect().top + 32;
    let index = 0;
    this.headings.forEach((heading, i) => {
      const element = this.view.nodeDOM(heading.pos);
      if (element instanceof HTMLElement && element.getBoundingClientRect().top <= top) index = i;
    });
    this.panel.querySelectorAll('button').forEach((button, i) => {
      if (i === index) button.setAttribute('aria-current', 'location'); else button.removeAttribute('aria-current');
    });
  }
  update(view: EditorView) {
    this.view = view;
    if (view.state.doc === this.doc) return;
    cancelHeadingScroll(this.scroller); this.doc = view.state.doc;
    this.headings = headingIndex(this.doc).filter(heading => heading.level <= 4);
    this.panel.replaceChildren();
    const title = document.createElement('strong'); title.textContent = 'Contents'; this.panel.append(title);
    if (!this.headings.length) {
      const empty = document.createElement('p'); empty.textContent = 'Add a heading to navigate this document.'; this.panel.append(empty);
    }
    for (const heading of this.headings) {
      const button = document.createElement('button'); button.type = 'button';
      const title = document.createElement('span'); title.className = 'contents-title'; title.textContent = heading.text || 'Untitled heading';
      const level = document.createElement('span'); level.className = 'contents-level'; level.textContent = `H${heading.level}`; level.setAttribute('aria-hidden', 'true');
      button.append(title, level);
      button.setAttribute('aria-label', `${title.textContent}, heading level ${heading.level}`);
      button.title = title.textContent; button.dataset.headingId = heading.id; button.style.paddingInlineStart = `${8+(heading.level-1)*12}px`;
      button.addEventListener('click', () => {this.close(); scrollToHeading(this.view, heading.pos);});
      this.panel.append(button);
    }
    this.active();
  }
  destroy() {this.close(); this.abort.abort(); this.observer.disconnect(); cancelAnimationFrame(this.frame); cancelHeadingScroll(this.scroller); this.trigger.remove(); this.floating.destroy();}
}
