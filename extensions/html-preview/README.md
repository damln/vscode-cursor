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

Relative links to `.html` and `.htm` pages open that file in HTML Preview. Anchor
links scroll within the page; links to other local files use their normal editor.
HTTP(S) and email links open externally. Navigation stays within the preview's
resource folders and preserves Remote SSH document URIs.

For a full browser with an address bar and browser history, recent VS Code versions
also offer **Open in Integrated Browser** in the file's context menu. HTML Preview
keeps the VS Code 1.100.0+ baseline and does not depend on that newer feature.

Install File Actions separately for **Open HTML in default browser**.
