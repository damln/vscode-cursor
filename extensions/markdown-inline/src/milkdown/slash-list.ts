import { FloatingPanel, positionMenu } from "./floating-panel";
import { bulletListSchema, listItemSchema, paragraphSchema } from "@milkdown/kit/preset/commonmark";
import { Fragment, type Node as ProseNode, type NodeType } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import type { Ctx } from "@milkdown/kit/ctx";

interface ListMenu { query: string }
const key = new PluginKey<ListMenu | null>("slash-list");

export function selectedParagraphs(state: EditorState) {
  const { $from, $to } = state.selection;
  if ($from.depth !== 1 || $to.depth !== 1) return null;
  const from = $from.before();
  const to = $to.parentOffset === 0 && $to.before() > from ? $to.before() : $to.after();
  const blocks: ProseNode[] = [];
  state.doc.nodesBetween(from, to, (node) => { blocks.push(node); return false; });
  return blocks.length && blocks.every(node => node.type.name === "paragraph")
    ? { from, to, blocks } : null;
}

export function splitListItems(blocks: ProseNode[], paragraph: NodeType, item: NodeType) {
  const items: ProseNode[] = [];
  for (const block of blocks) {
    let line: ProseNode[] = [];
    const flush = () => {
      items.push(item.create(null, paragraph.create(null, Fragment.fromArray(line))));
      line = [];
    };
    block.forEach(node => {
      if (node.isText) {
        node.text!.split(/\r\n|\r|\n/).forEach((part, index) => {
          if (index) flush();
          if (part) line.push(node.type.schema.text(part, node.marks));
        });
      } else if (["hardbreak", "hard_break"].includes(node.type.name)) flush();
      else line.push(node);
    });
    flush();
  }
  return items;
}

function typedQuery(state: EditorState) {
  const { empty, $from } = state.selection;
  if (!empty || !selectedParagraphs(state) || $from.parentOffset !== $from.parent.content.size || $from.marks().length) return null;
  const query = /(?:^|\s)\/(l[a-z]*)$/i.exec($from.parent.textContent)?.[1];
  return query && "list".startsWith(query.toLowerCase()) ? query : null;
}

export function convertSelectedParagraphsToList(ctx: Ctx, view: EditorView, removeSuffix = 0) {
  const range = selectedParagraphs(view.state);
  if (!range || !view.editable) return false;
  const blocks = [...range.blocks];
  if (removeSuffix) {
    const block = blocks[0];
    blocks[0] = block.copy(block.content.cut(0, block.content.size - removeSuffix));
  }
  const list = bulletListSchema.type(ctx).create(null,
    splitListItems(blocks, paragraphSchema.type(ctx), listItemSchema.type(ctx)));
  const tr = view.state.tr.replaceWith(range.from, range.to, list);
  tr.setSelection(TextSelection.near(tr.doc.resolve(range.from + 1)));
  view.dispatch(tr.setStoredMarks([]).setMeta(key, "dismiss").scrollIntoView());
  view.focus();
  return true;
}

export const slashList = $prose(ctx => {
  const execute = (view: EditorView) => {
    const menu = key.getState(view.state);
    return menu ? convertSelectedParagraphsToList(ctx, view, menu.query.length + 1) : false;
  };
  return new Plugin<ListMenu | null>({
    key,
    state: {
      init: () => null,
      apply(tr, menu, _old, state) {
        const meta = tr.getMeta(key);
        if (meta === "dismiss") return null;
        if (meta) return meta;
        const query = typedQuery(state);
        return query && (menu || tr.docChanged) ? { query } : null;
      },
    },
    props: {
      handleKeyDown(view, event) {
        const menu = key.getState(view.state);
        if (!menu || event.isComposing) return false;
        if (event.key === "Escape") {
          view.dispatch(view.state.tr.setMeta(key, "dismiss"));
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          return "list".startsWith(menu.query.toLowerCase()) ? execute(view) : false;
        }
        return event.key === "ArrowDown" || event.key === "ArrowUp";
      },
    },
    view(view) {
      const menu = document.createElement("div");
      menu.className = "inline-slash-menu";
      const panel = new FloatingPanel(menu, 2, () => {
        if (key.getState(view.state)) view.dispatch(view.state.tr.setMeta(key, "dismiss"));
      }, restore => { if (restore) view.focus(); });
      const button = document.createElement("button");
      button.type = "button";
      button.className = "inline-slash-option";
      button.textContent = "•  Transform to list";
      button.title = "Convert the selected paragraphs: one bullet per source line";
      button.addEventListener("mousedown", event => event.preventDefault());
      button.addEventListener("click", () => execute(view));
      menu.append(button);
      document.body.append(menu);
      const update = () => {
        if (!key.getState(view.state) || (!view.hasFocus() && !menu.contains(document.activeElement))) { panel.hide(); return; }
        if (!panel.show()) return;
        const query = key.getState(view.state)!.query;
        button.disabled = !"list".startsWith(query.toLowerCase());
        button.textContent = button.disabled ? "No matching command" : "•  Transform to list";
        positionMenu(menu, view.coordsAtPos(view.state.selection.from));
      };
      const dismiss = (event: Event) => {
        if (event.target instanceof Node && menu.contains(event.target)) return;
        if (key.getState(view.state)) view.dispatch(view.state.tr.setMeta(key, "dismiss"));
      };
      document.addEventListener("mousedown", dismiss);
      document.addEventListener("scroll", update, true);
      window.addEventListener("resize", update);
      view.dom.addEventListener("blur", update);
      view.dom.addEventListener("focus", update);
      return { update, destroy() {
        panel.destroy();
        document.removeEventListener("mousedown", dismiss);
        document.removeEventListener("scroll", update, true);
        window.removeEventListener("resize", update);
        view.dom.removeEventListener("blur", update);
        view.dom.removeEventListener("focus", update);
      } };
    },
  });
});
