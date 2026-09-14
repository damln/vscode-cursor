import { smoothCaret } from './smooth-caret';
import { actionHints } from './action-hints';
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Transaction } from "@milkdown/kit/prose/state";
import type { Editor } from "@milkdown/kit/core";
import {
  defaultValueCtx,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import { NO_AUTOCORRECT_ATTRS } from "@/lib/autocorrect";
import { commonmark, remarkPreserveEmptyLinePlugin } from "@milkdown/kit/preset/commonmark";
import { gfm, remarkGFMPlugin } from "@milkdown/kit/preset/gfm";
import { clipboard } from "@milkdown/plugin-clipboard";
import { indent } from "@milkdown/plugin-indent";
import { applyEditorTransaction, isTypingTransaction } from '../lib/editor-transaction';
import { trailing } from "@milkdown/plugin-trailing";
import { prism, prismConfig } from "@milkdown/plugin-prism";
import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { refractor } from "refractor";

// Extra language imports
import elixirLang from "refractor/lang/elixir";
import erbLang from "refractor/lang/erb";
import dockerLang from "refractor/lang/docker";
import tomlLang from "refractor/lang/toml";
import httpLang from "refractor/lang/http";

// Register extra languages
try { refractor.register(elixirLang); } catch {}
try { refractor.register(erbLang); } catch {}
try { refractor.register(dockerLang); } catch {}
try { refractor.register(tomlLang); } catch {}
try { refractor.register(httpLang); } catch {}

// Register aliases
try { refractor.alias("bash", ["shell", "zsh"]); } catch {}
try { refractor.alias("markup", ["html", "xml", "svg"]); } catch {}
try { refractor.alias("elixir", ["ex", "exs", "heex", "eex"]); } catch {}
try { refractor.alias("css", ["tailwind"]); } catch {}

// Fix: remove table tokenization from markdown grammar to prevent
// pipe tables from breaking inside ```markdown code blocks
try {
  const prismInstance = (refractor as any).Prism || (refractor as any).data?.Prism;
  if (prismInstance?.languages?.markdown?.table) {
    delete prismInstance.languages.markdown.table;
  }
} catch {}

// Plugins
import {
  selectionToolbar,
  configureSelectionToolbar,
  focusToolbar,
} from "./toolbar";
import { tableToolbar, configureTableToolbar } from "./table-toolbar";
import { linkTooltip, configureLinkTooltip } from "./link-tooltip";
import { linkBoundaryPlugin } from "./link-boundary";
import { blockSelection, blockHandle } from "./block-handle";
import { caretSync } from "./caret-sync";
import { imageView } from "./image";
import { contentsRail } from "./contents";
import { taskListView } from "./task-list";
import { liquidHighlight } from "./liquid-highlight";
import { htmlEditableView } from "./html-editable";
import { codeBlockLangView } from "./code-lang";
import { markdownPastePlugin } from "./markdown-paste";
import { searchHighlightPlugin } from "./search-highlight";
import { colorPreview } from "./color-preview";
import { slashCommand } from "./slash-command";
import { slashList } from "./slash-list";
import { selectionSlash } from "./selection-slash";
import {
  isInlineCodeMark,
  outsideMarksAtInlineCodeBoundary,
  sameMarks,
} from "../../inline-code-boundary.js";
import { formatShortcutForEvent } from "../../format-shortcut.js";
import { preserveListSpacingJoin } from "../../markdown-model.js";

const formatShortcutGuard = $prose(
  () =>
    new Plugin({
      key: new PluginKey("format-shortcut-guard"),
      props: {
        handleKeyDown(_view, event) {
          if (!formatShortcutForEvent(event)) {
            return false;
          }
          event.preventDefault();
          return true;
        },
      },
    })
);

// Keep a cursor at either edge of inline code on the non-code side. This
// covers mouse selection, arrows, typing, deletion and combined marks.
const exitInlineCodeKey = new PluginKey("exit-inline-code");
const exitInlineCodePlugin = $prose(
  () =>
    new Plugin({
      key: exitInlineCodeKey,
      props: {
        handleKeyDown(view, event) {
          if (
            (event.key !== "Backspace" && event.key !== "Delete") ||
            !view.state.selection.empty
          ) {
            return false;
          }
          const codeMark =
            view.state.schema.marks.inlineCode || view.state.schema.marks.code_inline;
          if (!codeMark) return false;
          const { $from } = view.state.selection;
          const outsideMarks = outsideMarksAtInlineCodeBoundary($from, codeMark);
          if (outsideMarks === null) return false;
          const activeMarks = view.state.storedMarks ?? $from.marks();
          if (!sameMarks(activeMarks, outsideMarks)) {
            view.dispatch(view.state.tr.setStoredMarks(outsideMarks));
          }
          return false;
        },
        handleTextInput(view, from, to, text) {
          if (from !== to || !view.state.selection.empty) return false;
          const codeMark =
            view.state.schema.marks.inlineCode || view.state.schema.marks.code_inline;
          if (!codeMark) return false;
          const cursor = view.state.doc.resolve(from);
          const outsideMarks = outsideMarksAtInlineCodeBoundary(cursor, codeMark);
          if (outsideMarks === null) return false;
          const explicitlyActiveCode = view.state.storedMarks?.some((mark) =>
            isInlineCodeMark(mark, codeMark)
          );
          if (explicitlyActiveCode && text !== " ") return false;
          const activeMarks = view.state.storedMarks ?? cursor.marks();
          if (sameMarks(activeMarks, outsideMarks)) return false;

          const transaction = view.state.tr
            .setStoredMarks(outsideMarks)
            .insertText(text, from, to)
            .scrollIntoView();
          view.dispatch(transaction);
          return true;
        },
      },
      appendTransaction(transactions, _oldState, newState) {
        if (
          !newState.selection.empty ||
          !transactions.some(
            transaction => transaction.selectionSet && !transaction.docChanged
          )
        ) {
          return null;
        }
        const codeMark =
          newState.schema.marks.inlineCode || newState.schema.marks.code_inline;
        if (!codeMark) return null;
        const { $from } = newState.selection;
        const outsideMarks = outsideMarksAtInlineCodeBoundary($from, codeMark);
        if (outsideMarks === null) return null;
        const activeMarks = newState.storedMarks ?? $from.marks();
        if (sameMarks(activeMarks, outsideMarks)) return null;
        return newState.tr.setStoredMarks(outsideMarks);
      },
    })
);

export interface EditorConfig {
  markdown: string;
  onChange: (markdown: string, previousMarkdown: string, typing: boolean) => void;
}

export function getEditorPlugins() {
  return [
    caretSync,
    smoothCaret,
    actionHints,
    formatShortcutGuard,
    slashCommand,
    selectionSlash,
    slashList,
    // Empty paragraphs, including table cells, must not become synthetic <br /> tags.
    commonmark.filter(plugin => !remarkPreserveEmptyLinePlugin.includes(plugin)),
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
    blockSelection,
    blockHandle,
    contentsRail,
    imageView,
    taskListView,
    liquidHighlight,
    htmlEditableView,
    codeBlockLangView,
    exitInlineCodePlugin,
    searchHighlightPlugin,
    colorPreview,
  ];
}

export function configureEditor(
  editor: Editor,
  config: EditorConfig
) {
  return editor
    .config((ctx) => {
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
          ...(typeof prev.attributes === "function" ? {} : prev.attributes),
          ...NO_AUTOCORRECT_ATTRS,
        },
      }));

      // Use --- for horizontal rules instead of ***
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({
        ...prev,
        rule: "-" as const,
        join: [...(prev.join ?? []), preserveListSpacingJoin],
      }));

      ctx.set(prismConfig.key, {
        configureRefractor: () => refractor as any,
      });

      configureSelectionToolbar(ctx);
      configureTableToolbar(ctx);
      configureLinkTooltip(ctx);
    });
}

export { focusToolbar };
