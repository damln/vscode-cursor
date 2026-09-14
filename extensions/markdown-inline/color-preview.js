const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function normalizeHexColor(value) {
  // ProseMirror may place zero-width cursor sentinels inside inline marks.
  // Ignore those editor-only characters without accepting additional visible text.
  const color = String(value).replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  return HEX_COLOR.test(color) ? color.toLowerCase() : null;
}

function findHexColors(value) {
  // Match visible color tokens, not fragments of longer identifiers or URLs.
  const pattern = /(?<![\p{L}\p{N}_\/#?=&%-])#(?:[0-9a-f][\u200B-\u200D\uFEFF]*){3,8}(?![\p{L}\p{N}_-])/giu;
  return Array.from(String(value).matchAll(pattern)).flatMap(match => {
    const color = normalizeHexColor(match[0]);
    return color ? [{from: match.index, to: match.index + match[0].length, color}] : [];
  });
}

module.exports = { normalizeHexColor, findHexColors };
