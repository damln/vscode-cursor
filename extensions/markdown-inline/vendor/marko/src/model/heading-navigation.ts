import type { EditorView } from '@milkdown/kit/prose/view';
import type { Node } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import { scopeOf } from '../scope';

/** GitHub-style heading slugs, unique within one document. */
export function headingIds(titles: string[]) {
  const used = new Set<string>();
  return titles.map(title => {
    const base = title.toLowerCase().trim().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
    let id = base, suffix = 0;
    while (used.has(id)) id = `${base}-${++suffix}`;
    used.add(id);
    return id;
  });
}

export function headingIndex(doc: Node) {
  const headings: {text: string; pos: number; level: number; id: string}[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') headings.push({text: node.textContent, pos, level: node.attrs.level, id: ''});
  });
  const ids: string[] = headingIds(headings.map(heading => heading.text));
  headings.forEach((heading, index) => {heading.id = ids[index];});
  return headings;
}

const scrolling = new WeakMap<HTMLElement, () => void>();
export function cancelHeadingScroll(scroller: HTMLElement) {scrolling.get(scroller)?.();}
export function scrollToHeading(view: EditorView, pos: number) {
  const element = view.nodeDOM(pos), scroller = scopeOf(view).surface;
  if (!(element instanceof HTMLElement)) return false;
  if (scroller.scrollHeight <= scroller.clientHeight) {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)));
    view.focus(); element.scrollIntoView({block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    return true;
  }
  cancelHeadingScroll(scroller);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)));
  view.focus();
  const start = scroller.scrollTop;
  const target = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight,
    start + element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16));
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {scroller.scrollTop = target; return true;}
  const abort = new AbortController(); let frame = 0; const began = performance.now();
  const cancel = () => {cancelAnimationFrame(frame); abort.abort(); scrolling.delete(scroller);};
  scrolling.set(scroller, cancel);
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
    window.addEventListener(event, cancel, {signal: abort.signal, capture: true, passive: true});
  const tick = (now: number) => {
    const progress = Math.min(1, (now - began) / 200);
    scroller.scrollTop = start + (target - start) * (1 - (1 - progress) ** 3);
    if (progress < 1) frame = requestAnimationFrame(tick); else cancel();
  };
  frame = requestAnimationFrame(tick);
  return true;
}
export function navigateHeading(view: EditorView, fragment: string) {
  const heading = headingIndex(view.state.doc).find(heading => heading.id === fragment.toLowerCase());
  return heading ? scrollToHeading(view, heading.pos) : false;
}
