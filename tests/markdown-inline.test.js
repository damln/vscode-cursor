const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const manifest = require("../extensions/markdown-inline/package.json");
const { matchesCodeBlockCommand } = require("../extensions/markdown-inline/slash-command");

test("slash command accepts code block prefixes and leaves ordinary slashes alone", () => {
  for (const value of ["/", "/c", "/code", "/code block", "/CODE"]) {
    assert.equal(matchesCodeBlockCommand(value), true, value);
  }
  for (const value of ["", "a /", "/tmp/file", "https://example.com", "//", "/quote", "/code\n"]) {
    assert.equal(matchesCodeBlockCommand(value), false, value);
  }
});

test("disables width alignment in the inline editor's GFM serializer", () => {
  const setup = fs.readFileSync(
    path.join(__dirname, "../extensions/markdown-inline/src/milkdown/editor-setup.ts"), "utf8"
  );
  assert.match(setup, /ctx\.update\(remarkGFMPlugin\.options\.key,[\s\S]*?tablePipeAlign: false/);
});

test("provides bottom scroll space through layout instead of document content", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../extensions/markdown-inline/src/editor.css"), "utf8"
  );
  const editorRule = css.match(/\.milkdown\s*\{([^}]+)\}/)[1];
  assert.match(editorRule, /padding:\s*1\.5rem 2rem 300px var\(--editor-inset-start\);/);
});

const {
  documentPayload,
  parseEditorMessage,
  shouldApplyDocumentEdit
} = require("../extensions/markdown-inline/document-sync");
const {
  outsideMarksAtInlineCodeBoundary,
  sameMarks
} = require("../extensions/markdown-inline/inline-code-boundary");
const {
  contiguousMarkedRange
} = require("../extensions/markdown-inline/link-range");
const {
  formatShortcutForEvent
} = require("../extensions/markdown-inline/format-shortcut");
const {
  linkClickAction
} = require("../extensions/markdown-inline/link-click");
const {
  createJumpCodeSet
} = require("../extensions/markdown-inline/jump-model");
const {
  normalizeHexColor
} = require("../extensions/markdown-inline/color-preview");
const {
  shouldShowTableToolbar,
  tableToolbarActionMode
} = require("../extensions/markdown-inline/toolbar-visibility");

function mark(type, attrs = {}) {
  return {
    type,
    attrs,
    eq(other) {
      return other?.type === type && JSON.stringify(other.attrs) === JSON.stringify(attrs);
    }
  };
}

test("recognizes CSS hex colors for inline previews", () => {
  assert.equal(normalizeHexColor("#fff"), "#fff");
  assert.equal(normalizeHexColor(" #FFc300 "), "#ffc300");
  assert.equal(normalizeHexColor("\u200b#0f766e\ufeff"), "#0f766e");
  assert.equal(normalizeHexColor("#0f766e80"), "#0f766e80");
  assert.equal(normalizeHexColor("#12"), null);
  assert.equal(normalizeHexColor("#fffff"), null);
  assert.equal(normalizeHexColor("color: #fff"), null);
  assert.equal(normalizeHexColor("#gggggg"), null);
});

test("accepts ready, raw, copy, theme, and versioned edit messages", () => {
  assert.deepEqual(parseEditorMessage({ type: "ready", session: "test" }), { type: "ready", session: "test" });
  assert.deepEqual(parseEditorMessage({ type: "openRaw" }), { type: "openRaw" });
  assert.deepEqual(parseEditorMessage({ type: "copyDocument" }), {
    type: "copyDocument"
  });
  assert.deepEqual(parseEditorMessage({ type: "copyPath" }), {
    type: "copyPath"
  });
  assert.deepEqual(parseEditorMessage({ type: "copyFolderPath", path: "/untrusted" }), {
    type: "copyFolderPath"
  });
  assert.deepEqual(parseEditorMessage({ type: "setTheme", theme: "light" }), {
    type: "setTheme",
    theme: "light"
  });
  assert.deepEqual(
    parseEditorMessage({ type: "openExternal", href: "https://example.com/docs" }),
    { type: "openExternal", href: "https://example.com/docs" }
  );
  assert.deepEqual(
    parseEditorMessage({ type: "edit", requestId: "test:1", version: 4, text: "# Edited" }),
    { type: "edit", requestId: "test:1", version: 4, text: "# Edited" }
  );
});

test("rejects malformed and untrusted messages", () => {
  assert.equal(parseEditorMessage(null), null);
  assert.equal(parseEditorMessage({ type: "edit", version: -1, text: "bad" }), null);
  assert.equal(parseEditorMessage({ type: "edit", version: 1, text: 12 }), null);
  assert.equal(parseEditorMessage({ type: "unknown" }), null);
  assert.equal(parseEditorMessage({ type: "setTheme", theme: "sepia" }), null);
  assert.equal(parseEditorMessage({ type: "openExternal", href: "javascript:alert(1)" }), null);
});

test("recognizes empty and CRLF frontmatter without touching body bytes", () => {
  const { editableFrontmatter } = require(
    "../extensions/markdown-inline/markdown-model"
  );
  assert.deepEqual(editableFrontmatter("---\n---\nBody\n"), {
    body: "Body\n",
    eol: "\n",
    hasFrontmatter: true,
    prefix: "---\n---\n",
    raw: ""
  });
  assert.equal(
    editableFrontmatter("---\r\ntitle: Exact\r\n---\r\nBody\r\n").raw,
    "title: Exact"
  );
});

test("preserves frontmatter bytes outside the editable Markdown body", () => {
  const {
    joinPreservedFrontmatter,
    splitFrontmatterPreservingSource
  } = require("../extensions/markdown-inline/markdown-model");
  const source = "---\r\ntitle: Exact\r\ntags: [one, two]\r\n---\r\n# Body\r\n";
  const split = splitFrontmatterPreservingSource(source);

  assert.equal(split.prefix, "---\r\ntitle: Exact\r\ntags: [one, two]\r\n---\r\n");
  assert.equal(split.body, "# Body\r\n");
  assert.equal(joinPreservedFrontmatter(split.prefix, split.body), source);
});

test("does not mistake normal or unterminated Markdown for frontmatter", () => {
  const { splitFrontmatterPreservingSource } = require(
    "../extensions/markdown-inline/markdown-model"
  );
  assert.deepEqual(splitFrontmatterPreservingSource("# Body\n"), {
    prefix: "",
    body: "# Body\n"
  });
  assert.deepEqual(splitFrontmatterPreservingSource("---\ntitle: Open\n# Body\n"), {
    prefix: "",
    body: "---\ntitle: Open\n# Body\n"
  });
});

test("applies only byte-changing document edits", () => {
  assert.equal(shouldApplyDocumentEdit("# Current\n", "# Edited\n"), true);
  assert.equal(shouldApplyDocumentEdit("", "\n"), true);
  assert.equal(shouldApplyDocumentEdit("# Same\n", "# Same\n"), false);
});

test("recognizes every supported formatting shortcut exactly once", () => {
  const event = (key, options = {}) => ({
    key,
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    ...options
  });

  assert.equal(formatShortcutForEvent(event("b")), "toggleBold");
  assert.equal(formatShortcutForEvent(event("I")), "toggleItalic");
  assert.equal(
    formatShortcutForEvent(event("x", { shiftKey: true })),
    "toggleStrikethrough"
  );
  assert.equal(formatShortcutForEvent(event("`")), "toggleInlineCode");
  assert.equal(formatShortcutForEvent(event("k")), "addLink");
  assert.equal(
    formatShortcutForEvent(event("b", { metaKey: false, ctrlKey: true })),
    "toggleBold"
  );
});

test("ignores incomplete, modified, and repeated formatting shortcuts", () => {
  const base = {
    key: "b",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false
  };

  assert.equal(formatShortcutForEvent(base), null);
  assert.equal(formatShortcutForEvent({ ...base, metaKey: true, altKey: true }), null);
  assert.equal(formatShortcutForEvent({ ...base, metaKey: true, shiftKey: true }), null);
  assert.equal(formatShortcutForEvent({ ...base, metaKey: true, repeat: true }), null);
});

test("edits links on click and opens them only with Shift", () => {
  assert.equal(linkClickAction({ button: 0, shiftKey: false }), "edit");
  assert.equal(linkClickAction({ button: 0, shiftKey: true }), "open");
  assert.equal(linkClickAction({ button: 1, shiftKey: true }), null);
});

test("captures link clicks before the editable surface can navigate", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../extensions/markdown-inline/src/editor.ts"),
    "utf8"
  );
  const clickHandler = source.match(
    /root\.addEventListener\(\s*"click",([\s\S]*?)\n\);/
  )?.[1] || "";

  assert.match(clickHandler, /event\.preventDefault\(\)/);
  assert.match(clickHandler, /event\.stopPropagation\(\)/);
  assert.match(clickHandler, /moveCursorIntoLink\(event, anchor\)/);
  assert.match(clickHandler, /\n\s*true\s*$/);
});

test("enables VS Code's native find widget for the inline custom editor", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../extensions/markdown-inline/extension.js"),
    "utf8"
  );

  assert.match(source, /webviewOptions:\s*Object\.freeze\(\{ enableFindWidget: true \}\)/);
  assert.match(source, /registerCustomEditorProvider\([\s\S]*CUSTOM_EDITOR_OPTIONS/);
});

test("gives the link popup priority over table controls", () => {
  assert.equal(
    shouldShowTableToolbar({ editable: true, inTable: true, linkAtCursor: false }),
    true
  );
  assert.equal(
    shouldShowTableToolbar({ editable: true, inTable: true, linkAtCursor: true }),
    false
  );
  assert.equal(
    shouldShowTableToolbar({ editable: false, inTable: true, linkAtCursor: false }),
    false
  );
  assert.equal(
    shouldShowTableToolbar({ editable: true, inTable: false, linkAtCursor: false }),
    false
  );
});

test("shows only column actions on the header row and row actions elsewhere", () => {
  assert.equal(tableToolbarActionMode(0), "column");
  assert.equal(tableToolbarActionMode(1), "row");
  assert.equal(tableToolbarActionMode(12), "row");
});

test("preserves tight and loose list spacing during Markdown serialization", () => {
  const { preserveListSpacingJoin } = require(
    "../extensions/markdown-inline/markdown-model"
  );
  const item = { type: "listItem" };

  assert.equal(
    preserveListSpacingJoin(item, item, { type: "list", spread: "false" }),
    0
  );
  assert.equal(
    preserveListSpacingJoin(item, item, { type: "list", spread: "true" }),
    1
  );
  assert.equal(
    preserveListSpacingJoin(
      { type: "paragraph" },
      { type: "paragraph" },
      { type: "listItem", spread: "false" }
    ),
    0
  );
  assert.equal(
    preserveListSpacingJoin(item, item, { type: "root" }),
    undefined
  );
});

test("uses compact accessible icon controls for contextual table actions", () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "../extensions/markdown-inline/src/milkdown/table-toolbar.ts"
    ),
    "utf8"
  );
  const css = fs.readFileSync(
    path.join(__dirname, "../extensions/markdown-inline/src/editor.css"),
    "utf8"
  );

  assert.match(source, /dataset\.tableActions = "row"/);
  assert.match(source, /dataset\.tableActions = "column"/);
  assert.match(source, /title: action\.label/);
  assert.match(css, /\.tb-table-btn\s*\{[^}]*width:\s*26px;/s);
});

test("keeps blockquotes on the document surface with compact vertical padding", () => {
  const css = fs.readFileSync(
    path.join(__dirname, "../extensions/markdown-inline/src/editor.css"),
    "utf8"
  );
  const blockquoteRule = css.match(/\.milkdown blockquote \{([^}]+)\}/)?.[1] || "";

  assert.match(blockquoteRule, /background:\s*transparent;/);
  assert.match(blockquoteRule, /padding:\s*0\.3em 0 0\.3em 1em;/);
});

test("keeps every formatting shortcut scoped to the inline editor", () => {
  const formattingCommands = new Set([
    "damlnMarkdownInline.toggleBold",
    "damlnMarkdownInline.toggleItalic",
    "damlnMarkdownInline.toggleStrikethrough",
    "damlnMarkdownInline.toggleInlineCode",
    "damlnMarkdownInline.addLink"
  ]);
  assert.deepEqual(
    manifest.contributes.keybindings
      .filter(({ command }) => formattingCommands.has(command))
      .map(({ command, key, mac, when }) => ({ command, key, mac, when })),
    [
      {
        command: "damlnMarkdownInline.toggleBold",
        key: "ctrl+b",
        mac: "cmd+b",
        when: "activeCustomEditorId == damln.markdownInline"
      },
      {
        command: "damlnMarkdownInline.toggleItalic",
        key: "ctrl+i",
        mac: "cmd+i",
        when: "activeCustomEditorId == damln.markdownInline"
      },
      {
        command: "damlnMarkdownInline.toggleStrikethrough",
        key: "ctrl+shift+x",
        mac: "cmd+shift+x",
        when: "activeCustomEditorId == damln.markdownInline"
      },
      {
        command: "damlnMarkdownInline.toggleInlineCode",
        key: "ctrl+`",
        mac: "cmd+`",
        when: "activeCustomEditorId == damln.markdownInline"
      },
      {
        command: "damlnMarkdownInline.addLink",
        key: "ctrl+k",
        mac: "cmd+k",
        when: "activeCustomEditorId == damln.markdownInline"
      }
    ]
  );
});

test("uses the native Jump code order and chords in the inline editor", () => {
  const jumpCommands = new Set([
    "damlnMarkdownInline.jumpToStart",
    "damlnMarkdownInline.jumpToEnd",
    "damlnMarkdownInline.selectToStart",
    "damlnMarkdownInline.selectToEnd"
  ]);
  assert.deepEqual(createJumpCodeSet().slice(0, 7), [
    "aa",
    "ac",
    "ca",
    "ad",
    "cc",
    "da",
    "ae"
  ]);
  assert.deepEqual(
    manifest.contributes.keybindings
      .filter(({ command }) => jumpCommands.has(command))
      .map(({ command, key, when }) => ({ command, key, when })),
    [
      {
        command: "damlnMarkdownInline.jumpToStart",
        key: "alt+q alt+q",
        when: "activeCustomEditorId == damln.markdownInline"
      },
      {
        command: "damlnMarkdownInline.jumpToEnd",
        key: "alt+q alt+w",
        when: "activeCustomEditorId == damln.markdownInline"
      },
      {
        command: "damlnMarkdownInline.selectToStart",
        key: "alt+q alt+e",
        when: "activeCustomEditorId == damln.markdownInline"
      },
      {
        command: "damlnMarkdownInline.selectToEnd",
        key: "alt+q alt+r",
        when: "activeCustomEditorId == damln.markdownInline"
      }
    ]
  );
});

test("creates a complete document payload", () => {
  const document = { version: 7, getText: () => "# Current\n" };
  assert.deepEqual(documentPayload(document), {
    type: "update",
    version: 7,
    text: "# Current\n",
    dirty: false
  });
});

test("places both inline-code boundaries on the non-code side", () => {
  const codeType = { name: "inlineCode" };
  const strongType = { name: "strong" };
  const code = mark(codeType);
  const strong = mark(strongType);

  assert.deepEqual(
    outsideMarksAtInlineCodeBoundary(
      { nodeBefore: { marks: [code] }, nodeAfter: { marks: [strong] } },
      codeType
    ),
    [strong]
  );
  assert.deepEqual(
    outsideMarksAtInlineCodeBoundary(
      { nodeBefore: { marks: [strong] }, nodeAfter: { marks: [code] } },
      codeType
    ),
    [strong]
  );
});

test("exits inline code while preserving combined marks at paragraph edges", () => {
  const codeType = { name: "inlineCode" };
  const strong = mark({ name: "strong" });
  const link = mark({ name: "link" }, { href: "https://example.com" });
  const code = mark(codeType);

  const marks = outsideMarksAtInlineCodeBoundary(
    { nodeBefore: { marks: [strong, link, code] }, nodeAfter: null },
    codeType
  );

  assert.equal(sameMarks(marks, [strong, link]), true);
});

test("does not alter marks away from an inline-code boundary", () => {
  const codeType = { name: "inlineCode" };
  const code = mark(codeType);

  assert.equal(
    outsideMarksAtInlineCodeBoundary(
      { nodeBefore: { marks: [code] }, nodeAfter: { marks: [code] } },
      codeType
    ),
    null
  );
  assert.equal(
    outsideMarksAtInlineCodeBoundary(
      { nodeBefore: { marks: [] }, nodeAfter: { marks: [] } },
      codeType
    ),
    null
  );
});

test("limits link editing to the contiguous link under the cursor", () => {
  const linked = { marks: ["same-link"], nodeSize: 3 };
  const plain = { marks: [], nodeSize: 2 };
  const children = [linked, plain, linked];
  const parent = {
    forEach(callback) {
      let offset = 0;
      for (const child of children) {
        callback(child, offset);
        offset += child.nodeSize;
      }
    }
  };

  assert.deepEqual(
    contiguousMarkedRange(parent, 10, 16, child => child.marks.includes("same-link")),
    { from: 15, to: 18 }
  );
});

test('slash menu offers tables alongside code and filters complete or partial commands', () => {
  const { matchingSlashCommands } = require('../extensions/markdown-inline/slash-command');
  assert.deepEqual(matchingSlashCommands('/'), ['code', 'table']);
  for (const text of ['/t', '/tab', '/table', '/TABLE']) assert.deepEqual(matchingSlashCommands(text), ['table']);
  assert.deepEqual(matchingSlashCommands('/code'), ['code']);
  for (const text of ['/tables', 'text /table', '/table/path', '/table\n', '/ list']) assert.deepEqual(matchingSlashCommands(text), []);
});
