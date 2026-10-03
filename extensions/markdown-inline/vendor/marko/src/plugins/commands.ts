import type { Ctx } from "@milkdown/kit/ctx";
import { commandsCtx, editorViewCtx } from "@milkdown/kit/core";
import { toggleEmphasisCommand, toggleInlineCodeCommand, toggleStrongCommand } from "@milkdown/kit/preset/commonmark";
import { toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { openLinkEditor } from "./link-tooltip";
import { focusToolbar } from "./toolbar";
import { moveCurrentBlock } from "./block-movement";

export const MARKO_COMMANDS = [
  "bold", "italic", "strikethrough", "inlineCode", "link", "focusToolbar", "moveBlockUp", "moveBlockDown",
] as const;
export type MarkoCommand = (typeof MARKO_COMMANDS)[number];

// Milkdown assigns command keys when the editor starts, so resolve them per call.
const MARKS = {
  bold: toggleStrongCommand,
  italic: toggleEmphasisCommand,
  strikethrough: toggleStrikethroughCommand,
  inlineCode: toggleInlineCodeCommand,
} as const;

export function runCommand(ctx: Ctx, command: MarkoCommand): boolean {
  const view = ctx.get(editorViewCtx);
  if (!view.editable && command !== "focusToolbar") return false;
  switch (command) {
    case "link": openLinkEditor(view); return true;
    case "focusToolbar": focusToolbar(view); return true;
    case "moveBlockUp": return moveCurrentBlock(view, -1) !== false;
    case "moveBlockDown": return moveCurrentBlock(view, 1) !== false;
    default: {
      const done = ctx.get(commandsCtx).call(MARKS[command].key);
      view.focus();
      return done;
    }
  }
}
