import type { Ctx } from "@milkdown/kit/ctx";
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import { wrapInBulletListCommand, wrapInOrderedListCommand, wrapInBlockquoteCommand, turnIntoTextCommand, wrapInHeadingCommand } from "@milkdown/kit/preset/commonmark";
import type { EditorState } from "@milkdown/kit/prose/state";
import { inlineFormatButtons, type ToolbarButtonSpec } from "./toolbar-dom";
import { isInlineMarkActive } from "./formatting-state";
import { isTaskListActive, toggleTaskList } from "./task-list";
import { openLinkEditor } from "./link-tooltip";
import { moveCurrentBlock } from "./block-movement";
import { ICON_MOVE_UP, ICON_MOVE_DOWN } from "./icons";

export interface FormattingAction extends ToolbarButtonSpec {
  id: string;
  name: string;
  keywords?: string;
  group: "inline" | "block" | "list" | "move";
  active?: (state: EditorState) => boolean;
}

export function formattingActions(ctx: Ctx): FormattingAction[] {
  const inlineNames = ["Bold", "Italic", "Strikethrough", "Inline code"];
  return [
    ...inlineFormatButtons(ctx).map((spec, index): FormattingAction => ({
      ...spec, id: spec.markName!, name: inlineNames[index], group: "inline",
      active: state => isInlineMarkActive(state, spec.markName!),
    })),
    {id: "link", name: "Link", label: "Link", title: "Add or edit link", className: "tb-btn tb-link-btn", group: "inline", markName: "link", action: () => openLinkEditor()},
    ...[1, 2, 3, 4].map((level): FormattingAction => ({
      id: "h" + level, name: "Heading " + level, keywords: "h" + level, label: "H" + level, title: "Heading " + level,
      className: "tb-btn", group: "block", dataset: {blockType: "heading", level: String(level)},
      active: state => state.selection.$from.parent.type.name === "heading" && state.selection.$from.parent.attrs.level === level,
      action: () => ctx.get(commandsCtx).call(wrapInHeadingCommand.key, level),
    })),
    {id: "paragraph", name: "Paragraph", keywords: "normal text", label: "¶", title: "Paragraph", className: "tb-btn", group: "block",
      active: state => state.selection.$from.parent.type.name === "paragraph",
      action: () => ctx.get(commandsCtx).call(turnIntoTextCommand.key)},
    {id: "bullet", name: "Bullet list", keywords: "list unordered", label: "•", title: "Bullet list", className: "tb-btn tb-list", group: "list",
      action: () => ctx.get(commandsCtx).call(wrapInBulletListCommand.key)},
    {id: "ordered", name: "Ordered list", keywords: "numbered", label: "1.", title: "Ordered list", className: "tb-btn tb-list", group: "list",
      action: () => ctx.get(commandsCtx).call(wrapInOrderedListCommand.key)},
    {id: "task", name: "Task list", keywords: "checkbox todo", label: "[x]", title: "Task list", className: "tb-btn tb-task", group: "list",
      active: isTaskListActive,
      action: () => {
        const view = ctx.get(editorViewCtx);
        if (toggleTaskList(view.state, tr => view.dispatch(tr))) return;
        ctx.get(commandsCtx).call(wrapInBulletListCommand.key);
        toggleTaskList(view.state, tr => view.dispatch(tr));
      }},
    {id: "quote", name: "Blockquote", keywords: "quote", label: ">", title: "Blockquote", className: "tb-btn tb-quote", group: "list",
      action: () => ctx.get(commandsCtx).call(wrapInBlockquoteCommand.key)},
    ...([-1, 1] as const).map((direction): FormattingAction => ({
      id: direction < 0 ? "up" : "down", name: direction < 0 ? "Move up" : "Move down", label: direction < 0 ? "Move up" : "Move down",
      title: direction < 0 ? "Move block up" : "Move block down", className: "tb-btn", group: "move",
      icon: direction < 0 ? ICON_MOVE_UP : ICON_MOVE_DOWN,
      action: () => moveCurrentBlock(ctx.get(editorViewCtx), direction),
    })),
  ];
}
