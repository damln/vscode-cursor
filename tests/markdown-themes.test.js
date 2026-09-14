const assert = require("node:assert/strict");
const test = require("node:test");
const { THEMES, findTheme, isInlineTheme } = require("../extensions/markdown-inline/themes");
const { parseEditorMessage } = require("../extensions/markdown-inline/document-sync");

const luminance = hex => {
  const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};
const contrast = (a, b) => {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (high + .05) / (low + .05);
};

test("six distinct themes retain readable body text, secondary text and links", () => {
  assert.equal(new Set(THEMES.map(theme => theme.id)).size, 6);
  for (const mode of ["light", "dark"]) assert.equal(THEMES.filter(theme => theme.mode === mode).length, 3);
  for (const theme of THEMES) {
    const [page, foreground, secondary, , , code, floating, accent] = theme.colors;
    for (const background of [page, floating]) {
      for (const color of [foreground, secondary, accent]) {
        assert.ok(contrast(color, background) >= 4.5, theme.name + ": " + color + " on " + background);
      }
    }
    assert.ok(contrast(foreground, code) >= 4.5);
    assert.deepEqual(parseEditorMessage({type: "setTheme", theme: theme.id}), {type: "setTheme", theme: theme.id});
  }
});

test("legacy choices migrate and arbitrary CSS is never accepted as a theme", () => {
  assert.equal(findTheme("light").id, "linen");
  assert.equal(findTheme("dark").id, "charcoal");
  assert.equal(findTheme("auto", true).id, "linen");
  assert.equal(findTheme("auto", false).id, "charcoal");
  for (const value of [null, {}, "sepia", '"><style>body{display:none}']) {
    assert.equal(isInlineTheme(value), false);
    assert.equal(parseEditorMessage({type: "setTheme", theme: value}), null);
  }
});
