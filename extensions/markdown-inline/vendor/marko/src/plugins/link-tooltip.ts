import type { Ctx } from '@milkdown/kit/ctx';
import { tooltipFactory } from '@milkdown/kit/plugin/tooltip';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { EditorState } from '@milkdown/kit/prose/state';
import { StepMap } from '@milkdown/kit/prose/transform';
import type { EditorView } from '@milkdown/kit/prose/view';
import { contiguousMarkedRange } from '../model/link-range';
import { scopeOf } from '../scope';
import { floatingTooltip, toolbarPointer } from './floating-panel';

export const linkTooltip = tooltipFactory('link-tooltip');
/** Time to move the pointer between a link and its panel before the panel closes. */
const HOVER_GRACE_MS = 400;
const editors = new WeakMap<EditorView, () => void>();
const openPanels = new WeakSet<EditorView>();
export const openLinkEditor = (view: EditorView) => editors.get(view)?.();
export const isLinkPanelOpen = (view: EditorView) => openPanels.has(view);

export function findLinkAtCursor(
  state: EditorState,
): { href: string; from: number; to: number } | null {
  const { selection, schema } = state;
  if (!selection.empty || !schema.marks.link) return null;
  const { $from } = selection;
  const mark = $from.marks().find((m) => m.type === schema.marks.link);
  if (!mark) return null;
  const range = contiguousMarkedRange($from.parent, $from.start(), $from.pos, (child: ProseNode) =>
    child.marks.some((m) => m.eq(mark)),
  );
  return range ? { href: mark.attrs.href || '', ...range } : null;
}

function mapEditedRange(
  previous: ProseNode,
  next: ProseNode,
  from: number,
  to: number,
): { from: number; to: number } | null {
  const start = previous.content.findDiffStart(next.content);
  const end = previous.content.findDiffEnd(next.content);
  if (start === null || !end) return { from, to };
  const overlap = start - Math.min(end.a, end.b);
  if (overlap > 0) {
    end.a += overlap;
    end.b += overlap;
  }
  if (start < to && end.a > from) return null;
  const map = new StepMap([start, end.a - start, end.b - start]);
  return { from: map.map(from, 1), to: map.map(to, -1) };
}

export function configureLinkTooltip(ctx: Ctx) {
  ctx.set(linkTooltip.key, {
    view(view) {
      const el = document.createElement('div');
      el.className = 'milkdown-link-tooltip';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'Link');
      const preview = document.createElement('div');
      preview.className = 'link-tooltip-display';
      const url = document.createElement('span');
      url.className = 'link-tooltip-url';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'link-tooltip-btn';
      open.textContent = 'Open';
      open.title = 'Open in the browser';
      open.addEventListener('mousedown', (e) => e.preventDefault());
      open.addEventListener('click', () => {
        close();
        scopeOf(view).host.openLink(href);
      });
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'link-tooltip-btn';
      copy.textContent = 'Copy';
      copy.title = 'Copy the link';
      let copyReset: ReturnType<typeof setTimeout> | undefined;
      copy.addEventListener('mousedown', (e) => e.preventDefault());
      copy.addEventListener('click', () => {
        clearTimeout(copyReset);
        scopeOf(view)
          .host.copyText(href, new AbortController().signal)
          .then(() => {
            copy.textContent = 'Copied';
            copyReset = setTimeout(() => (copy.textContent = 'Copy'), 1200);
          })
          .catch(() => {
            copy.textContent = 'Copy failed';
            copyReset = setTimeout(() => (copy.textContent = 'Copy'), 1200);
          });
      });
      preview.append(url, copy, open);
      const form = document.createElement('div');
      form.className = 'link-tooltip-edit';
      const input = document.createElement('input');
      input.className = 'link-tooltip-input';
      input.placeholder = 'URL or path';
      input.setAttribute('aria-label', 'Link destination');
      form.append(input);
      el.append(preview, form);
      let mode: 'closed' | 'preview' | 'editing' = 'closed';
      let from = 0,
        to = 0,
        href = '';
      let hoverTimer: ReturnType<typeof setTimeout> | undefined;
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      let anchor: HTMLAnchorElement | null = null;
      const provider = floatingTooltip(
        view,
        {
          content: el,
          offset: 9,
          debounce: 0,
          middleware: [toolbarPointer(el)],
          shouldShow: () => mode !== 'closed',
        },
        3,
        () => close(),
        (restore) => close(restore),
      );
      provider.update(view);

      function close(restore = false) {
        clearTimeout(hoverTimer);
        clearTimeout(closeTimer);
        if (mode === 'closed') return;
        mode = 'closed';
        openPanels.delete(view);
        provider.hide();
        if (restore) view.focus();
      }
      function show(next: 'preview' | 'editing') {
        provider.reopen();
        mode = next;
        openPanels.add(view);
        preview.hidden = next !== 'preview';
        form.hidden = next !== 'editing';
        url.textContent = href;
        url.title = href;
        el.dataset.mode = next;
        provider.update(view);
      }
      function edit() {
        clearTimeout(hoverTimer);
        clearTimeout(closeTimer);
        const link = findLinkAtCursor(view.state);
        from = link?.from ?? view.state.selection.from;
        to = link?.to ?? view.state.selection.to;
        href = link?.href ?? '';
        input.value = href;
        remove.hidden = !link;
        show('editing');
        input.focus();
        input.select();
      }
      editors.set(view, edit);
      function button(label: string, action: () => void) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'link-tooltip-btn';
        button.textContent = label;
        button.addEventListener('mousedown', (e) => e.preventDefault());
        button.addEventListener('click', action);
        form.append(button);
        return button;
      }
      function apply() {
        const value = input.value.trim();
        if (!value) {
          input.setCustomValidity('Enter a URL or path.');
          input.reportValidity();
          return;
        }
        const tr = view.state.tr;
        const link = view.state.schema.marks.link;
        if (from === to)
          tr.insertText(value, from).addMark(
            from,
            from + value.length,
            link.create({ href: value }),
          );
        else tr.removeMark(from, to, link).addMark(from, to, link.create({ href: value }));
        close();
        view.dispatch(tr);
        view.focus();
      }
      button('Apply', apply);
      const remove = button('Remove', () => {
        close();
        view.dispatch(view.state.tr.removeMark(from, to, view.state.schema.marks.link));
        view.focus();
      });
      button('Open', () => scopeOf(view).host.openLink(input.value.trim()));
      button('Copy', () =>
        scopeOf(view)
          .host.copyText(input.value, new AbortController().signal)
          .catch(() => {
            input.setCustomValidity('Could not copy the link.');
            input.reportValidity();
          }),
      );
      button('Close', () => close(true));
      input.addEventListener('input', () => input.setCustomValidity(''));
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close(true);
        }
        if (e.key === 'Enter' && e.target === input) {
          e.preventDefault();
          apply();
        }
      });
      const outside = (event: Event) => {
        if (event.target instanceof Node && !el.contains(event.target)) close();
      };
      const hover = (event: MouseEvent) => {
        if (mode === 'editing') return;
        const next =
          event.target instanceof Element
            ? event.target.closest<HTMLAnchorElement>('a[href]')
            : null;
        if (next === anchor) return;
        clearTimeout(hoverTimer);
        clearTimeout(closeTimer);
        anchor = next;
        if (!next) {
          closeSoon();
          return;
        }
        hoverTimer = setTimeout(() => {
          const start = view.posAtDOM(next, 0);
          from = start;
          to = view.posAtDOM(next, next.childNodes.length);
          href = next.getAttribute('href') || '';
          show('preview');
          provider.show({ getBoundingClientRect: () => next.getBoundingClientRect() }, view);
        }, 250);
      };
      function closeSoon() {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(() => close(), HOVER_GRACE_MS);
      }
      const enter = () => clearTimeout(closeTimer);
      const leave = () => {
        if (mode === 'preview') closeSoon();
      };
      el.addEventListener('mouseenter', enter);
      el.addEventListener('mouseleave', leave);
      view.dom.addEventListener('mouseover', hover);
      view.dom.addEventListener('mouseleave', leave);
      const escapePreview = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && mode === 'preview') {
          event.preventDefault();
          close();
        }
      };
      document.addEventListener('keydown', escapePreview);
      document.addEventListener('mousedown', outside);
      return {
        update(nextView, previous) {
          if (nextView !== view) {
            editors.delete(view);
            editors.set(nextView, edit);
          }
          view = nextView;
          if (mode === 'editing' && !previous.doc.eq(view.state.doc)) {
            const range = mapEditedRange(previous.doc, view.state.doc, from, to);
            if (!range) {
              close();
              return;
            }
            from = range.from;
            to = range.to;
          }
          provider.update(view);
        },
        destroy() {
          close();
          provider.destroy();
          el.remove();
          editors.delete(view);
          openPanels.delete(view);
          document.removeEventListener('keydown', escapePreview);
          document.removeEventListener('mousedown', outside);
          view.dom.removeEventListener('mouseover', hover);
          view.dom.removeEventListener('mouseleave', leave);
        },
      };
    },
  });
}
