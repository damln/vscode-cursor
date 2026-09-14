# Damln VS Code extensions

Five independent extensions. Install only the ones you want. No profile replacement,
settings or keybindings file edits, font installation, remote setup, or workbench patches.

| Extension | Purpose | Minimum VS Code |
| --- | --- | --- |
| [Markdown Inline](extensions/markdown-inline/) | Visual Markdown, tables, Mermaid, frontmatter and six editor themes | 1.128.0 |
| [HTML Preview](extensions/html-preview/) | Preview HTML and its assets | 1.135.0 |
| [File Actions](extensions/file-actions/) | Copy content, file path or parent path from editor titles | 1.135.0 |
| [Jump](extensions/jump/) | Keyboard navigation to word boundaries | 1.74.0 |
| [Minimal Theme](extensions/minimal-theme/) | Optional dark VS Code color theme | 1.136.0 |

Cursor works only when its embedded VS Code version meets the chosen extension's
minimum. See each package manifest for the compatibility requirement.

## Install and uninstall

Download or clone this repository. In VS Code run **Extensions: Install from VSIX…**
and choose the desired file in [dist/](dist/). Uninstall it from the Extensions view.
Each extension works without the other four. File Actions avoids duplicating the
copy buttons already provided inside Markdown Inline.

With Python 3.10+ and your editor CLI on PATH, from this directory:

```sh
python3 scripts/manage_extensions.py list
python3 scripts/manage_extensions.py install markdown-inline
python3 scripts/manage_extensions.py uninstall markdown-inline
# Several, or all five, only when explicitly requested:
python3 scripts/manage_extensions.py install file-actions jump
python3 scripts/manage_extensions.py install --all
python3 scripts/manage_extensions.py uninstall --all
# Optional Cursor / named profile:
python3 scripts/manage_extensions.py install markdown-inline --code cursor --profile Writing
```

The helper verifies package SHA-256 checksums before installation and invokes the
standard editor CLI. It does not remove unrelated extensions or change settings.
It does not connect to SSH hosts. If you installed Jump on a remote extension host,
uninstall that remote copy using the Extensions view while connected to that host.

Uninstallation removes the extension's contributed commands, menus and shortcuts.
It does not delete your documents. Save edits before uninstalling an editor.
VS Code may retain extension preferences or recovery data in its own storage;
this installer deliberately does not erase it. User-selected editor associations
and themes belong to your settings: remove those entries or choose a replacement
when uninstalling. Nothing tries to reset your other preferences.

## Optional settings

No settings below are required or applied by the installer. Merge only the entries
you want into **Preferences: Open User Settings (JSON)**; keep your existing settings.

```jsonc
{
  // Choose the VS Code theme (independent of Markdown Inline's palette selector).
  "workbench.colorTheme": "Damln Minimal",

  // Optional editor defaults. Markdown Inline already contributes itself as a
  // default candidate for *.md; use "default" here to prefer the text editor.
  "workbench.editorAssociations": {
    "*.md": "damln.markdownInline",
    "*.html": "damln.htmlPreview"
  },
  // Keep Markdown comparisons in the native source diff editor.
  "workbench.diffEditorAssociations": { "*.md": "default" },

  // Optional autosave and source-editor display preferences.
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 1000,
  "editor.cursorSmoothCaretAnimation": "on",
  "editor.smoothScrolling": true,
  "editor.colorDecorators": true,
  "[markdown]": { "editor.wordWrap": "on" },

  // Jump's own settings. Keyboard Shortcuts lets you remap its bindings.
  "jump.primaryCharset": "acdefijklmnopqrsvwxz",
  "jump.display.backgroundColor": "#004455",
  "jump.display.color": "#0af0c1"
}
```

Markdown Inline's palette, width and font size are changed in its toolbar and
stored by the extension; they never rewrite Markdown or global editor settings.
Minimal Theme does not hide Outline, Timeline, or other views. Hide views manually
through VS Code's view menus if desired. No Git/SCM settings are applied.

[JetBrains Mono NL fonts](fonts/) are optional and licensed under the included OFL.
If you install them yourself, you can set `editor.fontFamily` to
`"JetBrains Mono NL, monospace"`. No installer here manages system fonts.

## Privacy and content behavior

This repository contains extension source, tests, current packages and redistributable
fonts. Personal profiles, trusted-domain overrides, SSH configuration, deployment
scripts, old packages, local editor state and the original workspace's Git history
are excluded. The package hashes are recorded in [extensions.lock.json](extensions.lock.json).

There is no bundled credential or telemetry integration. External Markdown images
can still contact their image hosts. HTML Preview deliberately runs authored scripts
and can load remote resources; use it only for HTML you trust. It is unavailable
in untrusted workspaces. Mermaid renders locally.

**Improve text** is an optional integration with an external workspace CLI, not
included here. It stays unavailable without that tool and a trusted local workspace.
When explicitly invoked with that tool installed, document text may be sent to its
configured AI provider. Ordinary Markdown editing does not require an AI service.

## Source and builds

The original layout is preserved: `extensions/`, `scripts/`, `tests/`, `fonts/`,
`release/` and `dist/`. Only the five local extensions are in the exported lockfile.

For Markdown Inline, install Docker and Python, then run:

```sh
python3 scripts/build_markdown_inline.py
```

This uses the pinned Node/Corepack/pnpm versions in [config/versions.json](config/versions.json),
runs type checks and the full Markdown/host test suite, then builds a VSIX.
Dependency audit records are bound to their lockfile hashes in
[release/security-audits.json](release/security-audits.json). For a fresh registry
check, run `pnpm audit --prod --audit-level high` in Markdown Inline and
`npm audit --omit=dev --audit-level=high` in Jump after installing dependencies.

For the extensions without bundled webview dependencies:

```sh
python3 scripts/build_extension.py minimal-theme
python3 scripts/build_extension.py html-preview
python3 scripts/build_extension.py file-actions
# Jump requires Node/npm on PATH and compiles its TypeScript source:
python3 scripts/build_jump.py
```

These three simple builds and Jump print the new package path. Install that VSIX
directly after a local rebuild; the helper's lockfile intentionally trusts only the
published checksums. Browser test harnesses live beside the Markdown source and
accept a separately installed Playwright module and Chromium executable.

## Licenses

This repository is private for now. Original extensions currently marked
`UNLICENSED` have not been granted an open-source license. Jump retains its MIT
license and [upstream attribution](extensions/jump/UPSTREAM.json); fonts retain
OFL. Bundled libraries keep their license notices. A public release needs an
explicit license decision for the original code.
