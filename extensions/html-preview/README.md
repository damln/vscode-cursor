# Damln HTML Preview

This extension offers a preview for `.html` files using the
supported VS Code custom editor API. The editor title contains an Edit HTML
Source action, and an HTML source editor contains an Open HTML Preview action.

Relative CSS, JavaScript, image, font, and media resources are resolved from the
HTML file directory. The preview refreshes when the underlying text document
changes. Because this is a UI extension, the same installed extension handles
local files and documents opened through Remote SSH.

The preview runs authored JavaScript and can load remote resources. Only preview
HTML you trust. It does not change editor associations or user settings. Use
**Reopen Editor With… → Configure default editor** to opt in to HTML Preview.
