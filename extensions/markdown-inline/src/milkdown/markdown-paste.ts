import { SourceMarkdown } from "../lib/source-markdown";
import { parserCtx, schemaCtx, serializerCtx, remarkCtx, remarkPluginsCtx } from '@milkdown/kit/core';
import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { DOMParser, DOMSerializer, Fragment, Slice } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import { isTextOnlySlice } from '@milkdown/prose';
import { editableFrontmatter } from '../../markdown-model';

export function pastePlainText(view: EditorView, text: string) {
  if (!view.editable || !text) return false;
  const normalized = text.replace(/\r\n?/g, '\n');
  const tr = view.state.tr;
  if (view.state.selection.$from.parent.type.spec.code || !normalized.includes('\n')) tr.insertText(normalized);
  else {
    const {schema} = view.state;
    const paragraphs = normalized.split('\n').map(line => schema.nodes.paragraph.create(null, line ? schema.text(line) : null));
    tr.replaceSelection(new Slice(Fragment.fromArray(paragraphs), 1, 1));
  }
  view.dispatch(tr.setMeta('paste', true).scrollIntoView()); view.focus();
  return true;
}

export function pasteFormat(text: string, html: string, sourceMetadata: string, inCode: boolean) {
  if (inCode || editableFrontmatter(text).prefix) return 'plain';
  if (sourceMetadata) {
    try {
      const mode = JSON.parse(sourceMetadata)?.mode;
      if (mode === 'markdown' || mode === 'md') return 'markdown';
      if (typeof mode === 'string' && mode) return 'code';
    } catch { return 'plain'; }
  }
  return html ? 'html' : 'markdown';
}

export const markdownPastePlugin = $prose(ctx => new Plugin({
  key: new PluginKey('markdown-paste'),
  props: {
    handlePaste(view, event) {
      if (!view.editable || !event.clipboardData) return false;
      const data = event.clipboardData;
      const text = data.getData('text/plain');
      const format = pasteFormat(text, data.getData('text/html'), data.getData('vscode-editor-data'),
        Boolean(view.state.selection.$from.parent.type.spec.code));
      if (format === 'plain') return pastePlainText(view, text);
      if (format === 'html' || format === 'code' || !text) return false;
      const parsed = ctx.get(parserCtx)(text);
      if (!parsed) return pastePlainText(view, text);
      const remark = ctx.get(remarkCtx)();
      for (const entry of ctx.get(remarkPluginsCtx)) remark.use(entry.plugin, entry.options);
      if (!new SourceMarkdown(text, ctx.get(serializerCtx)(parsed), value => remark.parse(value)).supported) {
        return pastePlainText(view, text);
      }
      const schema = ctx.get(schemaCtx);
      const dom = DOMSerializer.fromSchema(schema).serializeFragment(parsed.content);
      const slice = DOMParser.fromSchema(schema).parseSlice(dom);
      const node = isTextOnlySlice(slice);
      const tr = view.state.tr;
      if (node) tr.replaceSelectionWith(node, true);
      else tr.replaceSelection(slice);
      view.dispatch(tr.setMeta('paste', true).scrollIntoView());
      event.preventDefault();
      return true;
    },
  },
}));
