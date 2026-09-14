import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { FloatingPanel, positionMenu } from "./floating-panel";
import { formattingActions } from "./formatting-actions";
import { isInTable } from "./toolbar-dom";
import { convertSelectedParagraphsToList } from "./slash-list";

const key = new PluginKey<boolean>("selection-slash");

export function canFormatSelection(state: EditorState) {
  const selection = state.selection;
  if (!(selection instanceof TextSelection) || selection.empty) return false;
  let code = false;
  state.doc.nodesBetween(selection.from, selection.to, node => {
    if (node.type.spec.code) code = true;
    return !code;
  });
  return !code;
}

export const selectionSlash = $prose(ctx => {
  return new Plugin<boolean>({
    key,
    state: {
      init: () => false,
      apply(tr, opened) {
        const meta = tr.getMeta(key);
        if (typeof meta === "boolean") return meta;
        return tr.docChanged || tr.selectionSet ? false : opened;
      },
    },
    props: {
      handleKeyDown(view, event) {
        if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || view.composing ||
            !view.editable || !canFormatSelection(view.state)) return false;
        view.dispatch(view.state.tr.setMeta(key, true));
        return true;
      },
      handleTextInput(view, _from, _to, text) {
        if (text !== "/" || view.composing || !view.editable || !canFormatSelection(view.state)) return false;
        view.dispatch(view.state.tr.setMeta(key, true));
        return true;
      },
      decorations(state) {
        if (!key.getState(state)) return null;
        return DecorationSet.create(state.doc, [Decoration.inline(state.selection.from, state.selection.to,
          {class: "slash-format-selection"})]);
      },
    },
    view(view) {
      const commands = formattingActions(ctx);
      const menu = document.createElement("div");
      menu.className = "inline-slash-menu selection-slash-menu";
      menu.setAttribute("role", "dialog");
      menu.setAttribute("aria-label", "Format selected text");
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Format selection…";
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-label", "Filter formatting commands");
      input.setAttribute("aria-autocomplete", "list");
      input.setAttribute("aria-expanded", "true");
      input.autocomplete = "off";
      const list = document.createElement("div");
      list.id = "selection-actions-" + crypto.randomUUID();
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", "Formatting commands");
      input.setAttribute("aria-controls", list.id);
      const empty = document.createElement("div");
      empty.className = "selection-slash-empty";
      empty.setAttribute("role", "status");
      empty.textContent = "No matching commands";
      menu.append(input, list, empty);
      document.body.append(menu);
      let opened = false, selected = 0;
      let matches = commands;
      const abort = new AbortController(), events = {signal: abort.signal};
      const close = (restore = false) => {
        if (key.getState(view.state)) view.dispatch(view.state.tr.setMeta(key, false));
        if (restore) view.focus();
      };
      const panel = new FloatingPanel(menu, 2, () => close(), restore => { if (restore) view.focus(); });
      const position = () => positionMenu(menu, view.coordsAtPos(view.state.selection.from));
      const highlight = () => {
        for (const [index, child] of Array.from(list.children).entries()) {
          child.setAttribute("aria-selected", String(index === selected));
        }
        const option = list.children[selected] as HTMLElement | undefined;
        if (option) {
          input.setAttribute("aria-activedescendant", option.id);
          option.scrollIntoView({block: "nearest"});
        } else input.removeAttribute("aria-activedescendant");
      };
      const execute = () => {
        const command = matches[selected];
        if (!command || !key.getState(view.state) || !view.editable) return;
        close();
        view.focus();
        if (command.id === "bullet" && convertSelectedParagraphsToList(ctx, view)) return;
        command.action();
      };
      const render = () => {
        const query = input.value.trim().toLowerCase().replace(/^\//, "");
        const inTable = isInTable(view.state);
        matches = commands.filter(command =>
          (!inTable || command.group === "inline") &&
          (command.id !== "link" || view.state.selection.$from.sameParent(view.state.selection.$to)) &&
          query.split(/\s+/).every(word =>
            (command.name + " " + command.id + " " + (command.keywords || "")).toLowerCase().split(/\s+/).some(token => token.startsWith(word))));
        selected = 0;
        list.replaceChildren(...matches.map((command, index) => {
          const option = document.createElement("div");
          option.id = list.id + "-" + command.id;
          option.className = "inline-slash-option";
          option.setAttribute("role", "option");
          const label = document.createElement("span");
          label.textContent = command.name;
          const active = document.createElement("span");
          active.className = "selection-slash-active";
          active.textContent = command.active?.(view.state) ? "Active" : "";
          option.append(label, active);
          option.addEventListener("pointermove", () => {selected = index; highlight();});
          option.addEventListener("mousedown", event => event.preventDefault());
          option.addEventListener("click", () => {selected = index; execute();});
          return option;
        }));
        empty.hidden = matches.length > 0;
        position();
        highlight();
      };
      input.addEventListener("input", render, events);
      input.addEventListener("keydown", event => {
        if (event.isComposing) return;
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault(); execute();
        } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (!matches.length) return;
          if (event.key === "Home") selected = 0;
          else if (event.key === "End") selected = matches.length - 1;
          else selected = (selected + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
          highlight();
        } else if (event.key === "Backspace" && !input.value) {
          event.preventDefault(); close(true);
        }
      }, events);
      document.addEventListener("mousedown", event => {
        if (!menu.contains(event.target as Node)) close();
      }, events);
      document.addEventListener("focusin", event => {
        if (opened && !menu.contains(event.target as Node)) close();
      }, events);
      document.addEventListener("scroll", () => {if (opened) position();}, {...events, capture: true});
      window.addEventListener("resize", () => {if (opened) position();}, events);
      return {
        update(nextView) {
          view = nextView;
          if (!key.getState(view.state) || !view.editable) {opened = false; panel.hide(); return;}
          if (opened) return;
          opened = true;
          input.value = "";
          if (!panel.show()) {close(); return;}
          render();
          input.focus({preventScroll: true});
        },
        destroy() {abort.abort(); panel.destroy();},
      };
    },
  });
});
