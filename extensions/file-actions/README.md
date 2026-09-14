# Damln File Actions

Hover over the editor title-bar icons for explanations:

- Copy full file content, including unsaved text.
- Copy the file path relative to its workspace folder.
- Copy the parent folder path relative to its workspace folder (`.` at the root).

Outside a workspace, paths are absolute. Works with Markdown Inline and HTML
Preview; Markdown visual edits synchronize before copying. A sync error leaves
the clipboard unchanged. Binary files support paths only; save dirty notebooks
before copying their serialized content.

Install or remove this extension independently; it does not change settings.
See [package.json](package.json) for commands and editor integration.
