import type { EditorState } from "@milkdown/kit/prose/state";
import { isInlineMarkActive } from "./formatting-state";
import type { Ctx } from "@milkdown/kit/ctx";
import { commandsCtx } from "@milkdown/kit/core";
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
} from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";

export interface ToolbarButtonSpec {
  label: string;
  icon?: string;
  className: string;
  title?: string;
  tabIndex?: number;
  dataset?: Record<string, string>;
  /** Mark this button toggles, for active-state highlighting. */
  markName?: string;
  action: () => void;
}

/** Preserve the editing selection on pointer down; activate once through click. */
export function createToolbarButton(spec: ToolbarButtonSpec): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = spec.className;
  if (spec.icon !== undefined) {
    button.innerHTML = spec.icon;
  } else {
    button.textContent = spec.label;
  }
  button.setAttribute("aria-label", spec.title ?? spec.label);
  button.dataset.toolbarHint = spec.title ?? spec.label;
  button.type = "button";
  button.tabIndex = 0;
  if (spec.markName) {
    button.dataset.mark = spec.markName;
    button.setAttribute("aria-pressed", "false");
  }
  if (spec.dataset) Object.assign(button.dataset, spec.dataset);
  button.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });
  button.addEventListener("click", spec.action);
  return button;
}

/** Refresh both visual and accessible states, including stored typing marks. */
export function updateInlineFormatState(toolbar: HTMLElement, state: EditorState) {
  toolbar.querySelectorAll<HTMLButtonElement>('button[data-mark]').forEach(button => {
    const active = isInlineMarkActive(state, button.dataset.mark!);
    button.classList.toggle('tb-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

export function createToolbarSeparator(): HTMLDivElement {
  const separator = document.createElement("div");
  separator.className = "tb-separator";
  separator.setAttribute("role", "separator");
  return separator;
}

/** Bold / italic / strikethrough / inline code, shared by every toolbar. */
export function inlineFormatButtons(ctx: Ctx): ToolbarButtonSpec[] {
  return [
    {
      label: "B",
      className: "tb-btn tb-bold",
      title: /Mac|iPhone|iPad/.test(navigator.platform) ? "Bold (⌘B)" : "Bold (Ctrl+B)",
      tabIndex: -1,
      markName: "strong",
      action: () => ctx.get(commandsCtx).call(toggleStrongCommand.key),
    },
    {
      label: "I",
      className: "tb-btn tb-italic",
      title: /Mac|iPhone|iPad/.test(navigator.platform) ? "Italic (⌘I)" : "Italic (Ctrl+I)",
      tabIndex: -1,
      markName: "emphasis",
      action: () => ctx.get(commandsCtx).call(toggleEmphasisCommand.key),
    },
    {
      label: "S",
      className: "tb-btn tb-strike",
      title: "Strikethrough",
      tabIndex: -1,
      markName: "strike_through",
      action: () => ctx.get(commandsCtx).call(toggleStrikethroughCommand.key),
    },
    {
      label: "</>",
      className: "tb-btn tb-code",
      title: "Inline code",
      tabIndex: -1,
      markName: "inlineCode",
      action: () => ctx.get(commandsCtx).call(toggleInlineCodeCommand.key),
    },
  ];
}

/** True when the selection sits anywhere inside a table node. */
export function isInTable(state: {
  selection: { $from: { depth: number; node: (d: number) => { type: { name: string } } } };
}): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === "table") return true;
  }
  return false;
}

export function toolbarKeyboard(el: HTMLElement, escape: () => void) {
  el.addEventListener("keydown", event => {
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"))
      .filter(button => button.checkVisibility());
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let target: HTMLButtonElement | undefined;
    if (event.key === "ArrowRight") target = buttons[(index + 1) % buttons.length];
    if (event.key === "ArrowLeft") target = buttons[(index - 1 + buttons.length) % buttons.length];
    if (event.key === "Home") target = buttons[0];
    if (event.key === "End") target = buttons.at(-1);
    if (target) { event.preventDefault(); target.focus(); }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); escape(); }
  });
}
