# Damln HTML Preview

A Command Palette shortcut to **Open HTML in Integrated Browser**, using VS Code's
built-in browser. Requires VS Code desktop 1.121+ with that feature available;
Cursor compatibility depends on whether its build includes the native browser.

VS Code supplies the globe button and **Open in Integrated Browser** context menu
for local `.html` and `.htm` files. Navigation, history, zoom, reload and DevTools
belong to the native browser. This extension adds no custom editor, webview,
injected HTML, server or settings changes. It is optional if you use the native action.

The shortcut offers **Save and open** for unsaved HTML. For Remote SSH sites, open
a forwarded HTTP URL in the browser instead of a remote filesystem path.

To open local HTML in the browser by default, use **Reopen Editor With… →
Configure default editor → Integrated Browser** on versions offering that option.
Remove any old `damln.htmlPreview` editor association when upgrading from 0.3.

Install File Actions separately for **Open HTML in external default browser**,
shown with an external-link arrow.
