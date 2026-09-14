function linkClickAction(event) {
  if (event.button !== 0) {
    return null;
  }
  return event.shiftKey ? "open" : "edit";
}

module.exports = { linkClickAction };
