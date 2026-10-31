import type { Editor } from '@milkdown/kit/core';
import {
  defaultValueCtx,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  serializerCtx,
} from '@milkdown/kit/core';
import {
  bulletListSchema,
  commonmark,
  hardbreakClearMarkPlugin,
  insertHrInputRule,
  listItemSchema,
  orderedListSchema,
  remarkInlineLinkPlugin,
  remarkPreserveEmptyLinePlugin,
} from '@milkdown/kit/preset/commonmark';
import { extendListItemSchemaForTask, gfm, remarkGFMPlugin } from '@milkdown/kit/preset/gfm';
import type { Transaction } from '@milkdown/kit/prose/state';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { $prose } from '@milkdown/kit/utils';
import { clipboard } from '@milkdown/plugin-clipboard';
import { indent } from '@milkdown/plugin-indent';
import { prism, prismConfig } from '@milkdown/plugin-prism';
import { trailing } from '@milkdown/plugin-trailing';
import { refractor } from 'refractor';
import dockerLang from 'refractor/lang/docker';
// Extra language imports
import elixirLang from 'refractor/lang/elixir';
import erbLang from 'refractor/lang/erb';
import httpLang from 'refractor/lang/http';
import tomlLang from 'refractor/lang/toml';
import { NO_AUTOCORRECT_ATTRS } from '../model/autocorrect';
import { applyEditorTransaction, isTypingTransaction } from '../model/editor-transaction';
import { actionHints } from './action-hints';
import { smoothCaret } from './smooth-caret';

// Register extra languages
try {
  refractor.register(elixirLang);
} catch {}
try {
  refractor.register(erbLang);
} catch {}
try {
  refractor.register(dockerLang);
} catch {}
try {
  refractor.register(tomlLang);
} catch {}
try {
  refractor.register(httpLang);
} catch {}

// Register aliases
try {
  refractor.alias('bash', ['shell', 'zsh']);
} catch {}
try {
  refractor.alias('markup', ['html', 'xml', 'svg']);
} catch {}
try {
  refractor.alias('elixir', ['ex', 'exs', 'heex', 'eex']);
} catch {}
try {
  refractor.alias('css', ['tailwind']);
} catch {}

// Fix: remove table tokenization from markdown grammar to prevent
// pipe tables from breaking inside ```markdown code blocks
try {
  // biome-ignore lint/suspicious/noExplicitAny: refractor does not type its internal Prism instance
  const prismInstance = (refractor as any).Prism || (refractor as any).data?.Prism;
  if (prismInstance?.languages?.markdown?.table) {
    delete prismInstance.languages.markdown.table;
  }
} catch {}

import { history } from '@milkdown/kit/plugin/history';
import { relaxEscapes } from '../model/escapes';
import { formatShortcutForEvent } from '../model/format-shortcut';
import { escapeHtmlText } from '../model/html';
import { preserveListSpacingJoin } from '../model/markdown-model';
import { blockHandle, blockSelection } from './block-handle';
import { caretSync } from './caret-sync';
import { codeBlockLangView } from './code-lang';
import { colorPreview } from './color-preview';
import { runCommand } from './commands';
import { contentsRail } from './contents';
import { hrOnEnter } from './hr-input';
import { htmlEditableView } from './html-editable';
import { htmlBoundaryInput, htmlTagInputRule } from './html-input';
import { imageView } from './image';
import { inlineCodeCaret } from './inline-code-caret';
import { linkBoundaryPlugin } from './link-boundary';
import {
  configureLinkReferences,
  definitionJoin,
  linkDefinitionSchema,
  remarkResolveReferences,
} from './link-reference';
import { configureLinkTooltip, linkTooltip } from './link-tooltip';
import { liquidHighlight } from './liquid-highlight';
import { markdownPastePlugin } from './markdown-paste';
import { remarkPlainParentheses } from './parentheses';
import { selectionSlash } from './selection-slash';
import { type SlashCommand, slashCommand } from './slash-command';
import { slashList } from './slash-list';
import { configureTableToolbar, tableToolbar } from './table-toolbar';
import { taskListView } from './task-list';
// Plugins
import { configureSelectionToolbar, selectionToolbar } from './toolbar';

// Soft breaks serialize as a plain newline and round-trip through Milkdown's
// existing inline-break parser. Explicit Markdown hard breaks stay unchanged.
const preserveBreakAttributes = $prose(
  () =>
    new Plugin({
      key: new PluginKey('preserve-break-attributes'),
      appendTransaction(transactions, _old, state) {
        if (!transactions.some((transaction) => transaction.docChanged)) return null;
        const tr = state.tr;
        state.doc.descendants((node, pos) => {
          if (node.type.name === 'hardbreak' && node.marks.length) {
            tr.setNodeMarkup(pos, undefined, node.attrs, []);
          }
        });
        return tr.docChanged ? tr : null;
      },
    }),
);

const softBreakShortcut = $prose(
  () =>
    new Plugin({
      key: new PluginKey('soft-break-shortcut'),
      props: {
        handleKeyDown(view, event) {
          if (
            event.key !== 'Enter' ||
            !event.shiftKey ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey
          )
            return false;
          const { selection, schema, tr } = view.state;
          if (!(selection instanceof TextSelection) || selection.$from.parent.type.spec.code)
            return false;
          const type = schema.nodes.hardbreak;
          if (
            !type ||
            !selection.$from.parent.canReplaceWith(
              selection.$from.index(),
              selection.$from.index(),
              type,
            )
          )
            return false;
          view.dispatch(
            tr
              .setMeta('hardbreak', true)
              .replaceSelectionWith(type.create({ isInline: true }), false)
              .scrollIntoView(),
          );
          return true;
        },
      },
    }),
);

// Formatting shortcuts run Marko's commands before Milkdown's own keymaps,
// so every host gets the same bindings (Cmd/Ctrl+B, I, Shift+X, `, K).
const formatShortcuts = $prose(
  (ctx) =>
    new Plugin({
      key: new PluginKey('format-shortcuts'),
      props: {
        handleKeyDown(_view, event) {
          const command = formatShortcutForEvent(event);
          if (!command) return false;
          event.preventDefault();
          runCommand(ctx, command);
          return true;
        },
      },
    }),
);

export interface EditorConfig {
  markdown: string;
  spellcheck: boolean;
  onChange: (markdown: string, previousMarkdown: string, typing: boolean) => void;
}

export interface PluginOptions {
  blockHandles: boolean;
  contents: boolean;
  /** Keep undo history in the editor. Disable when the host owns undo. */
  history: boolean;
  /** Host commands added to the `/` menu. */
  slashCommands?: readonly SlashCommand[];
}

export function getEditorPlugins(options: PluginOptions) {
  return [
    ...(options.history ? [history] : []),
    caretSync,
    smoothCaret,
    actionHints,
    formatShortcuts,
    softBreakShortcut,
    hrOnEnter,
    preserveBreakAttributes,
    slashCommand(options.slashCommands),
    selectionSlash,
    slashList,
    // Empty paragraphs, including table cells, must not become synthetic <br /> tags.
    // Reference links keep their reference style instead of being inlined.
    commonmark.filter(
      (plugin) =>
        plugin !== hardbreakClearMarkPlugin &&
        plugin !== insertHrInputRule &&
        ![...remarkPreserveEmptyLinePlugin, ...remarkInlineLinkPlugin].includes(plugin),
    ),
    remarkResolveReferences,
    remarkPlainParentheses,
    linkDefinitionSchema,
    gfm,
    markdownPastePlugin,
    clipboard,
    indent,
    trailing,
    prism,
    selectionToolbar,
    tableToolbar,
    linkTooltip,
    linkBoundaryPlugin,
    ...(options.blockHandles ? [blockSelection, blockHandle] : []),
    ...(options.contents ? [contentsRail] : []),
    imageView,
    taskListView,
    liquidHighlight,
    htmlEditableView,
    htmlTagInputRule,
    htmlBoundaryInput,
    codeBlockLangView,
    inlineCodeCaret,
    colorPreview,
  ];
}

export function configureEditor(editor: Editor, config: EditorConfig) {
  return editor.config((ctx) => {
    ctx.set(defaultValueCtx, config.markdown);
    ctx.update(remarkGFMPlugin.options.key, (prev) => ({
      ...prev,
      tablePipeAlign: false,
    }));

    // No macOS autocorrect / substitution inside the document
    ctx.update(editorViewOptionsCtx, (prev) => ({
      ...prev,
      dispatchTransaction(this: EditorView, transaction: Transaction) {
        applyEditorTransaction(this, transaction, (doc, previous) => {
          const serialize = ctx.get(serializerCtx);
          config.onChange(serialize(doc), serialize(previous), isTypingTransaction(transaction));
        });
      },
      attributes: {
        ...(typeof prev.attributes === 'function' ? {} : prev.attributes),
        ...NO_AUTOCORRECT_ATTRS,
        spellcheck: String(config.spellcheck),
      },
    }));

    // Use --- for horizontal rules instead of ***
    ctx.update(remarkStringifyOptionsCtx, (prev) => ({
      ...prev,
      rule: '-' as const,
      join: [...(prev.join ?? []), preserveListSpacingJoin, definitionJoin],
      handlers: {
        ...prev.handlers,
        text: (node, parent, state, info) =>
          // biome-ignore lint/style/noNonNullAssertion: Milkdown's default stringify options define the text handler
          escapeHtmlText(relaxEscapes(prev.handlers!.text!(node, parent, state, info), node.value)),
      },
    }));

    // Milkdown 7.21 declares list `spread` as boolean but parses it as "true"/"false",
    // and prosemirror-model 1.25.12+ rejects that. Accept both whatever version the host resolves.
    for (const schema of [
      bulletListSchema,
      orderedListSchema,
      listItemSchema,
      extendListItemSchemaForTask,
    ]) {
      ctx.update(schema.key, (factory) => (schemaCtx) => {
        const spec = factory(schemaCtx);
        return {
          ...spec,
          attrs: { ...spec.attrs, spread: { ...spec.attrs?.spread, validate: 'boolean|string' } },
        };
      });
    }

    configureLinkReferences(ctx);

    ctx.set(prismConfig.key, {
      // biome-ignore lint/suspicious/noExplicitAny: plugin-prism types refractor 5, Marko pins refractor 4
      configureRefractor: () => refractor as any,
    });

    configureSelectionToolbar(ctx);
    configureTableToolbar(ctx);
    configureLinkTooltip(ctx);
  });
}
