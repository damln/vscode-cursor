# Damln Markdown Inline

A visual Markdown editor built with Milkdown. VS Code's text document remains
the source of truth for saves, undo and external changes.

Install the VSIX through **Extensions: Install from VSIX**, then choose
**Reopen Editor With… → Markdown Inline**. Use **Edit source** to return to the
native editor. The supported VS Code API version is declared in
[package.json](package.json); Cursor support is limited to its compatible
classic IDE window.

Install [Damln File Actions](../file-actions/) for content and workspace-relative
path copying in VS Code’s editor title bar. Copying waits for pending visual edits.

Run **Markdown Inline: New Markdown** from the Command Palette to create an
empty note in the workspace root and open it inline. Names use local time:
`YYYY-MM-DD-HHhmm-note-1.md`, then `-note-2.md`, `-note-3.md` if occupied.
With multiple workspace folders, choose the destination root.
Opening a document focuses its first editable position so you can type immediately.

Edit Markdown, front matter, tables and Mermaid diagrams inline. Use `/code`
for a code block, `/table` for a table, `/list` for a list, and Shift+click to follow a link.
Select text and type `/` to search formatting and block actions. Use ↑/↓ to
choose, Enter or Tab to apply, and Escape to cancel without changing the text.
Unsupported syntax remains editable in source mode. If an edit conflicts,
use **Compare retained draft** to inspect both versions, then **Restore retained
draft** to confirm restoring and saving your work. Restoration and discarding
both create recovery backups before replacing anything.

Use the **palette** button to choose among ten light and dark editor themes.
The centered picker previews each palette and remembers your choice across files.

Use **Width** and the adjacent **font-size** control to adjust the reading layout.
Text size ranges from 10 to 36 pixels; Reset restores 17 pixels. These choices
are remembered across files and never change the Markdown source.

Drag from empty space beside or between blocks to select an area, then drag a
selected handle to move the highlighted blocks together. Escape cancels the
selection. Ordinary text selection remains available inside blocks.

The left gutter compares the current document, including unsaved edits, with
Git HEAD: green marks additions, orange marks edits, and red triangles mark
deletions. Markers follow rendered blocks and metadata, with source-line counts
on hover. This uses the built-in Git extension's read-only API; when that API
or a repository is unavailable, no Git markers are shown.

Frontmatter fields grow with their content without internal scrollbars. Hex
colors show a swatch, including transparency; click a swatch to select its
value for editing. YAML mode also shows a compact color palette.

**Improve text** requires the workspace's text-improver CLI and a trusted local
file; it is unavailable for Remote SSH files. See
[text-improver.js](text-improver.js) for integration requirements.

## Source map

- [extension.js](extension.js): VS Code integration and webview boundary.
- [src/editor.ts](src/editor.ts) and [src/milkdown/](src/milkdown/): visual editor.
- [src/frontmatter-editor.ts](src/frontmatter-editor.ts): metadata editing.
- [document-sync.js](document-sync.js) and [draft-store.js](draft-store.js): synchronization and recovery.
- [package.json](package.json): compatibility, dependencies, commands and checks.
- [tests/](tests/) and [shared tests](../../tests/): browser and extension checks.

From the parent VS Code setup directory, build and check the packaged extension:

```sh
python3 scripts/build_markdown_inline.py
```

Keep document preservation, conflict recovery and webview security intact when
changing the editor. Mermaid renders locally with inert diagrams; authored
Markdown remains authoritative. See [Mermaid notices](MERMAID-LICENSE.md).
