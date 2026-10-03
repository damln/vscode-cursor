import type { MarkoCommand } from "../plugins/commands";

const FORMAT_SHORTCUTS: Record<string, { command: MarkoCommand; shift: boolean }> = {
  b: {command: "bold", shift: false},
  i: {command: "italic", shift: false},
  x: {command: "strikethrough", shift: true},
  "`": {command: "inlineCode", shift: false},
  k: {command: "link", shift: false},
};

export function formatShortcutForEvent(event: KeyboardEvent): MarkoCommand | null {
  if (event.repeat || event.altKey || (!event.metaKey && !event.ctrlKey)) return null;
  const shortcut = FORMAT_SHORTCUTS[event.key.toLowerCase()];
  if (!shortcut || event.shiftKey !== shortcut.shift) return null;
  return shortcut.command;
}
