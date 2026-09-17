function editableFrontmatter(source) {
  const unchanged = {
    body: source,
    eol: source.includes("\r\n") ? "\r\n" : "\n",
    hasFrontmatter: false,
    prefix: "",
    raw: ""
  };
  // Only the very first physical line may open front matter. Never search
  // forward past prose, blank lines, or a Markdown/code separator.
  const opening = /^(?:\uFEFF)?---[ \t]*(\r?\n)/.exec(source);
  if (!opening) return unchanged;
  const start = opening[0].length;
  for (let lineStart = start; lineStart < source.length;) {
    const newline = source.indexOf("\n", lineStart);
    const end = newline < 0 ? source.length : newline;
    const line = source.slice(lineStart, end).replace(/\r$/, "");
    if (/^---[ \t]*$/.test(line)) {
      const prefixEnd = newline < 0 ? end : end + 1;
      return {
        body: source.slice(prefixEnd),
        eol: opening[1],
        hasFrontmatter: true,
        prefix: source.slice(0, prefixEnd),
        raw: source.slice(start, lineStart).replace(/\r?\n$/, "")
      };
    }
    if (newline < 0) break;
    lineStart = newline + 1;
  }
  return unchanged;
}

function splitFrontmatterPreservingSource(source) {
  const split = editableFrontmatter(source);
  return { prefix: split.prefix, body: split.body };
}

function joinPreservedFrontmatter(prefix, body) {
  return `${prefix}${body}`;
}

function preserveListSpacingJoin(_left, _right, parent) {
  if (
    (parent?.type === "list" || parent?.type === "listItem") &&
    typeof parent.spread === "string"
  ) {
    return parent.spread === "true" ? 1 : 0;
  }
  return undefined;
}

function cleanupMarkdown(source) {
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const text = source.split(/\r\n|\r|\n/).map(line => line.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
  return text.replace(/\n/g, eol) + eol;
}

module.exports = {
  cleanupMarkdown,
  editableFrontmatter,
  joinPreservedFrontmatter,
  preserveListSpacingJoin,
  splitFrontmatterPreservingSource
};
