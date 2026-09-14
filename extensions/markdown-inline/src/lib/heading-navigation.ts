import type { EditorView } from '@milkdown/kit/prose/view';
import type { Node } from '@milkdown/kit/prose/model';
import { TextSelection } from '@milkdown/kit/prose/state';
import { headingIds } from '../../link-destination.js';

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
  const element = view.nodeDOM(pos), scroller = view.dom.closest<HTMLElement>('#document-scroll');
  if (!(element instanceof HTMLElement) || !scroller) return false;
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
