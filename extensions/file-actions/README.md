# Damln File Actions

Hover over the editor title-bar icons for explanations:

- Copy full file content, including unsaved text.
- Copy the file path relative to its workspace folder.
- Copy the parent folder path relative to its workspace folder (`.` at the root).

Outside a workspace, paths are absolute. Works with Markdown Inline and
other file editors; Markdown visual edits synchronize before copying. A sync error leaves
the clipboard unchanged. Binary files support paths only; save dirty notebooks
before copying their serialized content.

Install or remove this extension independently; it does not change settings.
See [package.json](package.json) for commands and editor integration.

## Edit HTML source

Click the **Edit HTML source** (`</>`) title-bar icon to open an HTML file in
VS Code's editable text editor, including when it normally opens in the Integrated
Browser. The action is also in the Explorer context menu and Command Palette.
Your default HTML association and unsaved edits are preserved.

## Open HTML in external default browser

Local `.html` and `.htm` files get an external-link arrow action in the editor title,
Explorer context menu and Command Palette. Unsaved HTML offers **Save and open** first.

The action starts a read-only HTTP preview bound to `127.0.0.1` on a random port,
then uses VS Code's standard external-browser API. This opens a browser even when
HTML files are associated with a text editor. Relative pages and assets load from
the file's workspace, or its parent directory when outside a workspace.

The server starts only on demand and stops when the extension's window closes.
URLs include an unguessable token; hidden files, unsupported file types, writes
and paths outside the root (including symlinks) are blocked. Root-relative site
URLs require a project development server. No files or settings are rewritten.
A trusted workspace is required to run HTML. For Remote SSH files, use your
project's forwarded HTTP URL; a local browser cannot open a remote filesystem path.
