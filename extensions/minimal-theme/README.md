# Damln Minimal Theme

Two quiet native VS Code themes: **Damln Minimal** (charcoal, the original dark theme)
and **Damln Minimal Light** (soft white, slate ink). Both use restrained blue accents,
semantic highlighting and coordinated terminal colors.

Install this extension alone, then run **Preferences: Color Theme** to choose either.
Installation never changes your selected theme or settings. There is no startup code,
layout automation, workbench patch or dependency on another extension.

To remove it, select another theme and uninstall through Extensions.
Requires VS Code 1.100.0+ or a compatible Cursor classic IDE.

Original theme definitions and yellow-and-black SVG artwork: [MIT](LICENSE).

## Optional HTML browser default

VS Code’s native Integrated Browser can open local HTML without an extension.
On VS Code versions offering the browser editor, optionally merge these entries
into your existing User Settings. The theme does not apply them:

```json
"workbench.editorAssociations": {
  "*.html": "workbench.editor.browser",
  "*.htm": "workbench.editor.browser"
}
```

You can also choose **Reopen Editor With → Configure default editor → Integrated Browser**.
Use `"default"` to restore the source editor. Older editors and forks may not offer
the native browser; leave their HTML associations unchanged.
