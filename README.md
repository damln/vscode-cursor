# Damln VS Code extensions

Four independent extensions for **VS Code 1.100.0+** and compatible Cursor classic IDE versions.
Install only what you need. No profile replacement,
automatic settings changes, font installation, remote setup or workbench patches.

| Extension | Purpose |
| --- | --- |
| [Markdown Inline](extensions/markdown-inline/) | Visual Markdown, tables, Mermaid, frontmatter and ten themes |
| [File Actions](extensions/file-actions/) | Copy content and paths; open HTML in your browser |
| [Jump](extensions/jump/) | Keyboard navigation to word boundaries |
| [Minimal Theme](extensions/minimal-theme/) | Optional dark and light VS Code themes |

## Install or uninstall

Run **Extensions: Install from VSIX…** and select a package from [dist/](dist/).
Remove it through the Extensions view. Alternatively, with Python 3.10+ and your
editor CLI on PATH:

```sh
python3 scripts/manage_extensions.py list
python3 scripts/manage_extensions.py install markdown-inline
python3 scripts/manage_extensions.py uninstall markdown-inline
python3 scripts/manage_extensions.py install file-actions jump
python3 scripts/manage_extensions.py install --all
python3 scripts/manage_extensions.py uninstall --all
# Optional editor and profile:
python3 scripts/manage_extensions.py install markdown-inline --code cursor --profile Writing
```

The helper verifies [package checksums](extensions.lock.json) and manages only
selected extensions. Save edits before uninstalling. Documents and unrelated
settings remain untouched; VS Code may retain extension preferences and recovery
backups. Remove any editor associations you added manually when uninstalling.
Remote copies, such as Jump installed through SSH, must be removed from that
host's Extensions view while connected.

## Optional settings

Nothing below is applied automatically. Merge only what you want into
**Preferences: Open User Settings (JSON)**:

```jsonc
{
  "workbench.colorTheme": "Damln Minimal",
  "workbench.editorAssociations": {
    "*.md": "damln.markdownInline" // Use "default" for the source editor.
  },
  "workbench.diffEditorAssociations": { "*.md": "default" },
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 1000,
  "[markdown]": { "editor.wordWrap": "on" }
}
```

Markdown Inline already offers itself as the default Markdown editor. Its toolbar
controls palette, width and font size without changing file content. Jump exposes
`jump.primaryCharset`, `jump.display.backgroundColor` and `jump.display.color`;
remap shortcuts in **Keyboard Shortcuts**. Optional source-editor settings include
`editor.smoothScrolling`, `editor.colorDecorators` and `editor.fontFamily`.
[JetBrains Mono NL](fonts/) can be installed manually; fonts are never auto-installed.

For local HTML, VS Code’s native Integrated Browser needs no extension. On versions
offering it, choose **Reopen Editor With → Configure default editor → Integrated Browser**.
See the [optional HTML settings](extensions/minimal-theme/README.md#optional-html-browser-default).
Uninstall the retired `damln.html-preview` extension and replace any old
`damln.htmlPreview` editor association. File Actions retains external-browser opening.

## Privacy and builds

Personal profiles, SSH setup, trusted-domain overrides, old packages and workspace
history are excluded. Markdown images can contact their hosts.
Mermaid renders locally. **Improve text** requires an external CLI, absent here;
when explicitly used, that CLI may send document text to its AI provider.

Source stays in `extensions/`, with shared `tests/` and build `scripts/`.
Run `python3 scripts/build_markdown_inline.py` with Docker to type-check, test and
package Markdown using [pinned tools](config/versions.json). Other builds:
`python3 scripts/build_extension.py minimal-theme` (also `file-actions`), and `python3 scripts/build_jump.py` (requires Node/npm).
Install rebuilt VSIXs directly; the helper trusts published checksums only.
Production audits are [bound to lockfile hashes](release/security-audits.json).
For fresh checks, run `pnpm audit --prod --audit-level high` in Markdown Inline
or `npm audit --omit=dev --audit-level=high` in Jump after installing dependencies.

## Licenses

The three original extensions and their SVG artwork use [MIT](LICENSE). Jump retains [MIT and upstream attribution](extensions/jump/UPSTREAM.json),
fonts retain OFL, and bundled libraries retain their notices.
