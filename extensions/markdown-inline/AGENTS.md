# Markdown Inline

- [vendor/marko/src/](vendor/marko/src/) contains the vendored editor library.
  Keep host integrations outside the generated directory. Building and testing
  this extension requires only its own checkout.
- [src/editor.ts](src/editor.ts) owns the VS Code bridge and document synchronization.
  Keep host messaging and reading preferences outside the copied library.
- Run `pnpm check`, then `pnpm test`. [tests/](tests/) owns browser checks.
- `pnpm build:webview` updates the packaged assets in `media/`.
