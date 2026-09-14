import { floatingTooltip } from "./floating-panel";
import { tooltipFactory } from "@milkdown/kit/plugin/tooltip";
import type { Ctx } from "@milkdown/kit/ctx";
import { type EditorState } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { StepMap } from "@milkdown/kit/prose/transform";
import { contiguousMarkedRange } from "../../link-range.js";

export const linkTooltip = tooltipFactory("link-tooltip");
let openEditor: (() => void) | undefined;
let panelOpen = false;
export const openLinkEditor = () => openEditor?.();
export const isLinkPanelOpen = () => panelOpen;

export function findLinkAtCursor(state: EditorState): { href: string; from: number; to: number } | null {
  const { selection, schema } = state;
  if (!selection.empty || !schema.marks.link) return null;
  const { $from } = selection;
  const mark = $from.marks().find(m => m.type === schema.marks.link);
  if (!mark) return null;
  const range = contiguousMarkedRange($from.parent, $from.start(), $from.pos,
    (child: ProseNode) => child.marks.some(m => m.eq(mark)));
  return range ? { href: mark.attrs.href || "", ...range } : null;
}

export function configureLinkTooltip(ctx: Ctx) {
  ctx.set(linkTooltip.key, {
    view(view) {
      const el = document.createElement("div");
      el.className = "milkdown-link-tooltip";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-label", "Link");
      const preview = document.createElement("span");
      preview.className = "link-tooltip-url";
      const form = document.createElement("div");
      form.className = "link-tooltip-edit";
      const input = document.createElement("input");
      input.className = "link-tooltip-input";
      input.placeholder = "URL or path";
      input.setAttribute("aria-label", "Link destination");
      form.append(input);
      el.append(preview, form);
      let mode: "closed" | "preview" | "editing" = "closed";
      let from = 0, to = 0, href = "";
      let hoverTimer: ReturnType<typeof setTimeout> | undefined;
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      let anchor: HTMLAnchorElement | null = null;
      let dismissed = false;
      const provider = floatingTooltip({content: el, root: document.body, offset: 8, debounce: 0,
        shouldShow: () => mode !== "closed"}, 3, () => close(), restore => close(restore));
      provider.update(view);

      function close(restore = false) {
        clearTimeout(hoverTimer); clearTimeout(closeTimer);
        if (mode === "closed") return;
        dismissed = true;
        mode = "closed"; panelOpen = false;
        provider.hide();
        if (restore) view.focus();
      }
      function show(next: "preview" | "editing") {
        provider.reopen();
        mode = next; panelOpen = true;
        preview.hidden = next !== "preview";
        form.hidden = next !== "editing";
        preview.textContent = href;
        el.dataset.mode = next;
        provider.update(view);
      }
      function edit() {
        clearTimeout(hoverTimer); clearTimeout(closeTimer);
        const link = findLinkAtCursor(view.state);
        from = link?.from ?? view.state.selection.from;
        to = link?.to ?? view.state.selection.to;
        href = link?.href ?? "";
        input.value = href;
        remove.hidden = !link;
        show("editing");
        input.focus(); input.select();
      }
      openEditor = edit;
      function button(label: string, action: () => void) {
        const button = document.createElement("button");
        button.type = "button"; button.className = "link-tooltip-btn"; button.textContent = label;
        button.addEventListener("mousedown", e => e.preventDefault());
        button.addEventListener("click", action);
        form.append(button);
        return button;
      }
      function apply() {
        const value = input.value.trim();
        if (!value) { input.setCustomValidity("Enter a URL or path."); input.reportValidity(); return; }
        const tr = view.state.tr;
        const link = view.state.schema.marks.link;
        if (from === to) tr.insertText(value, from).addMark(from, from + value.length, link.create({href: value}));
        else tr.removeMark(from, to, link).addMark(from, to, link.create({href: value}));
        close(); view.dispatch(tr); view.focus();
      }
      button("Apply", apply);
      const remove = button("Remove", () => {
        close(); view.dispatch(view.state.tr.removeMark(from, to, view.state.schema.marks.link)); view.focus();
      });
      button("Open", () => window.dispatchEvent(new CustomEvent("damln-open-link", {detail: input.value.trim()})));
      button("Copy", () => navigator.clipboard.writeText(input.value).catch(() => {
        input.setCustomValidity("Could not copy the link."); input.reportValidity();
      }));
      button("Close", () => close(true));
      input.addEventListener("input", () => input.setCustomValidity(""));
      el.addEventListener("keydown", e => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
        if (e.key === "Enter" && e.target === input) { e.preventDefault(); apply(); }
      });
      const outside = (event: Event) => {
        if (event.target instanceof Node && !el.contains(event.target)) close();
      };
      const hover = (event: MouseEvent) => {
        if (mode === "editing") return;
        const next = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
        if (next === anchor) return;
        clearTimeout(hoverTimer); clearTimeout(closeTimer);
        anchor = next;
        if (!next) { closeTimer = setTimeout(() => close(), 150); return; }
        if (dismissed) return;
        hoverTimer = setTimeout(() => {
          const start = view.posAtDOM(next, 0);
          from = start; to = view.posAtDOM(next, next.childNodes.length);
          href = next.getAttribute("href") || "";
          show("preview");
          provider.show({getBoundingClientRect: () => next.getBoundingClientRect()}, view);
        }, 250);
      };
      const enter = () => clearTimeout(closeTimer);
      const leave = () => { if (mode === "preview") closeTimer = setTimeout(() => close(), 150); };
      el.addEventListener("mouseenter", enter); el.addEventListener("mouseleave", leave);
      view.dom.addEventListener("mouseover", hover); view.dom.addEventListener("mouseleave", leave);
      const escapePreview = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && mode === 'preview') { event.preventDefault(); close(); }
      };
      document.addEventListener("keydown", escapePreview);
      document.addEventListener("mousedown", outside);
      return {
        update(nextView, previous) {
          view = nextView;
          if (mode === "editing" && !previous.doc.eq(view.state.doc)) {
            const start = previous.doc.content.findDiffStart(view.state.doc.content);
            const end = previous.doc.content.findDiffEnd(view.state.doc.content);
            if (start !== null && end) {
              const overlap = start - Math.min(end.a, end.b);
              if (overlap > 0) { end.a += overlap; end.b += overlap; }
              if (start < to && end.a > from) { close(); return; }
              const map = new StepMap([start, end.a - start, end.b - start]);
              from = map.map(from, 1); to = map.map(to, -1);
            }
          }
          provider.update(view);
        },
        destroy() {
          close(); provider.destroy(); el.remove();
          if (openEditor === edit) openEditor = undefined;
          document.removeEventListener("keydown", escapePreview);
          document.removeEventListener("mousedown", outside);
          view.dom.removeEventListener("mouseover", hover); view.dom.removeEventListener("mouseleave", leave);
        },
      };
    },
  });
}
