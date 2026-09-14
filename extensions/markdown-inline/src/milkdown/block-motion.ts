import type { EditorView } from '@milkdown/kit/prose/view';
import type { Node as PMNode } from '@milkdown/kit/prose/model';
import { blockUnits } from './block-selection';

const running = new WeakMap<EditorView, () => void>();
export const cancelBlockMotion = (view: EditorView) => running.get(view)?.();
export function captureBlocks(view: EditorView, parent = -1) {
  const positions = new Map<PMNode, {left: number; top: number}>();
  if (!view.dom) return positions;
  const scroll = view.dom.closest('#document-scroll')?.scrollTop || 0;
  for (const unit of blockUnits(view.state.doc, parent)) {
    const element = view.nodeDOM(unit.from);
    if (element instanceof HTMLElement) {
      const rect = element.getBoundingClientRect();
      positions.set(unit.node, {left: rect.left, top: rect.top + scroll});
    }
  }
  return positions;
}
export function animateBlocks(view: EditorView, before: ReturnType<typeof captureBlocks>, parent = -1) {
  cancelBlockMotion(view);
  if (!view.dom || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const after = captureBlocks(view, parent), animations: Animation[] = [];
  for (const unit of blockUnits(view.state.doc, parent)) {
    const old = before.get(unit.node), next = after.get(unit.node), element = view.nodeDOM(unit.from);
    if (!old || !next || !(element instanceof HTMLElement)) continue;
    const x = old.left - next.left, y = old.top - next.top;
    if (Math.abs(x) + Math.abs(y) < 1) continue;
    animations.push(element.animate([{transform: `translate(${x}px, ${y}px)`}, {transform: 'translate(0, 0)'}], {duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)'}));
  }
  if (!animations.length) return;
  view.dom.dataset.blockMotion = 'true';
  view.dom.dispatchEvent(new Event('block-motion'));
  const clear = () => {
    animations.forEach(animation => animation.cancel());
    if (running.get(view) !== clear) return;
    running.delete(view); delete view.dom.dataset.blockMotion;
    view.dom.dispatchEvent(new Event('block-motion'));
  };
  running.set(view, clear);
  void Promise.allSettled(animations.map(animation => animation.finished)).then(clear);
}
