const FORMAT_SHORTCUTS = Object.freeze({
  b: { command: "toggleBold", shift: false },
  i: { command: "toggleItalic", shift: false },
  x: { command: "toggleStrikethrough", shift: true },
  "`": { command: "toggleInlineCode", shift: false },
  k: { command: "addLink", shift: false }
});

function formatShortcutForEvent(event) {
  if (
    event.repeat ||
    event.altKey ||
    (!event.metaKey && !event.ctrlKey)
  ) {
    return null;
  }
  const shortcut = FORMAT_SHORTCUTS[String(event.key).toLowerCase()];
  if (!shortcut || Boolean(event.shiftKey) !== shortcut.shift) {
    return null;
  }
  return shortcut.command;
}

module.exports = { formatShortcutForEvent };
