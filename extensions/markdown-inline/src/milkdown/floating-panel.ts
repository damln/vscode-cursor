import { TooltipProvider } from "@milkdown/kit/plugin/tooltip";
import type { Selection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";

let active: FloatingPanel | undefined;
const suppressTooltips = new Set<() => void>();

function escapePopup(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.isComposing || !active) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  // Freeze automatic toolbars before focus restoration can trigger an update.
  for (const suppress of suppressTooltips) suppress();
  active.escape();
}

export class FloatingPanel {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private opened = false;
  constructor(readonly element: HTMLElement, readonly priority = 1, private dismiss = () => {}, private onEscape?: (restoreFocus: boolean) => void) {
    element.classList.add('floating-panel');
    element.hidden = true;
    element.inert = true;
    element.dataset.show = 'false';
    element.setAttribute('aria-hidden', 'true');
  }
  show() {
    if (active && active !== this) {
      if (active.priority > this.priority) return false;
      active.hide();
    }
    clearTimeout(this.timer);
    active = this;
    window.addEventListener('keydown', escapePopup, true);
    this.opened = true;
    this.element.hidden = false;
    this.element.inert = false;
    this.element.setAttribute('aria-hidden', 'false');
    this.element.dataset.show = 'true';
    return true;
  }
  hide() {
    if (!this.opened) return;
    this.opened = false;
    if (active === this) {
      active = undefined;
      window.removeEventListener('keydown', escapePopup, true);
    }
    this.element.inert = true;
    this.element.setAttribute('aria-hidden', 'true');
    this.element.dataset.show = 'false';
    this.timer = setTimeout(() => { this.element.hidden = true; },
      matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 90);
    this.dismiss();
  }
  escape() {
    const restoreFocus = this.element.contains(document.activeElement);
    this.onEscape?.(restoreFocus);
    this.hide();
  }
  destroy() {
    this.hide(); clearTimeout(this.timer); this.element.remove();
  }
}

export function floatingTooltip(options: ConstructorParameters<typeof TooltipProvider>[0], priority = 1, dismiss?: () => void, onEscape?: (restoreFocus: boolean) => void) {
  let currentView: EditorView | undefined;
  let dismissedSelection: Selection | undefined;
  const suppress = () => { dismissedSelection = currentView?.state.selection; };
  suppressTooltips.add(suppress);
  const allowed = (view: EditorView) => {
    if (dismissedSelection?.eq(view.state.selection)) return false;
    dismissedSelection = undefined;
    return true;
  };
  const provider = new TooltipProvider({...options, root: document.body, shift: {padding: 8},
    shouldShow: view => allowed(view) && (options.shouldShow?.(view) ?? true),
  });
  const panel = new FloatingPanel(options.content, priority, dismiss, restore => {
    if (onEscape) onEscape(restore);
    else if (restore) currentView?.focus();
    provider.hide();
  });
  const show = provider.show, hide = provider.hide, destroy = provider.destroy, update = provider.update;
  provider.update = (...args) => { currentView = args[0]; update(...args); };
  // Also guard an already queued positioning callback after Escape.
  provider.show = (...args) => {
    const view = args[1] ?? currentView;
    if ((!view || allowed(view)) && panel.show()) show(...args);
  };
  provider.hide = () => { hide(); panel.hide(); };
  provider.destroy = () => { suppressTooltips.delete(suppress); destroy(); panel.destroy(); };
  // An explicit keyboard command or link click can reopen at the same caret.
  return Object.assign(provider, {reopen: () => { dismissedSelection = undefined; }});
}

export function toolbarPointer(element: HTMLElement): NonNullable<ConstructorParameters<typeof TooltipProvider>[0]["middleware"]>[number] {
  return {
    name: "toolbarPointer",
    fn({rects, x, placement}) {
      const center = rects.reference.x + rects.reference.width / 2 - x;
      element.style.setProperty("--toolbar-pointer-x", `${Math.max(24, Math.min(center, rects.floating.width - 24))}px`);
      element.dataset.pointerSide = placement.startsWith("top") ? "bottom" : "top";
      return {};
    },
  };
}

export function positionMenu(element: HTMLElement, anchor: DOMRect | {left: number; top: number; bottom: number}) {
  const bounds = element.getBoundingClientRect();
  element.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - bounds.width - 8))}px`;
  element.style.top = `${Math.max(8, anchor.bottom + bounds.height + 8 <= innerHeight
    ? anchor.bottom + 4 : anchor.top - bounds.height - 4)}px`;
}
