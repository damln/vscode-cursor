const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function normalizeHexColor(value: unknown) {
  // ProseMirror may place zero-width cursor sentinels inside inline marks.
  const color = String(value).replace(/[​-‍﻿]/g, "").trim();
  return HEX_COLOR.test(color) ? color.toLowerCase() : null;
}

/** Visible color tokens, never fragments of longer identifiers or URLs. */
export function findHexColors(value: unknown) {
  const pattern = /(?<![\p{L}\p{N}_\/#?=&%-])#(?:[0-9a-f][​-‍﻿]*){3,8}(?![\p{L}\p{N}_-])/giu;
  return Array.from(String(value).matchAll(pattern)).flatMap(match => {
    const color = normalizeHexColor(match[0]);
    return color ? [{from: match.index, to: match.index + match[0].length, color}] : [];
  });
}
