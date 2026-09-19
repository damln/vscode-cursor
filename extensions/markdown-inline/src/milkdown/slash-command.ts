import { slashMenuView } from "./floating-panel";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { createTable } from "@milkdown/kit/preset/gfm";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { matchingSlashCommands } from "../../slash-command";

const slashKey = new PluginKey<{selected: string} | null>("inline-slash-command");

function availableCommands(state: EditorState): string[] {
  const { empty, $from } = state.selection;
  return empty && $from.depth === 1 &&
    $from.parent.type.name === "paragraph" &&
    $from.parentOffset === $from.parent.content.size &&
    !$from.parent.firstChild?.marks.length
    ? matchingSlashCommands($from.parent.textContent) : [];
}

export const slashCommand = $prose(ctx => {
  function execute(view: EditorView, id = slashKey.getState(view.state)?.selected) {
    if (!view.editable || !id || !slashKey.getState(view.state) || !availableCommands(view.state).includes(id)) return false;
    const { $from } = view.state.selection;
    const start = $from.before();
    const node = id === 'table' ? createTable(ctx, 2, 2) : codeBlockSchema.type(ctx).create();
    const transaction = view.state.tr.replaceWith(start, $from.after(), node);
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(start + 1)));
    view.dispatch(transaction.setStoredMarks([]).setMeta(slashKey, "dismiss").scrollIntoView());
    view.focus();
    return true;
  }

  function handleKey(view: EditorView, event: KeyboardEvent) {
    const menu = slashKey.getState(view.state);
    if (!menu || !view.editable || event.isComposing) return false;
    if (event.key === "Escape") {
      view.dispatch(view.state.tr.setMeta(slashKey, "dismiss")); return true;
    }
    if (event.key === "Enter" || event.key === "Tab") return execute(view);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const matches = availableCommands(view.state);
      const index = matches.indexOf(menu.selected);
      const selected = matches[(index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length];
      view.dispatch(view.state.tr.setMeta(slashKey, {selected})); return true;
    }
    return false;
  }

  return new Plugin<{selected: string} | null>({
    key: slashKey,
    state: {
      init: () => null,
      apply(transaction, menu, _oldState, state) {
        const meta = transaction.getMeta(slashKey);
        if (meta === "dismiss") return null;
        const matches = availableCommands(state);
        if (!matches.length || (!transaction.docChanged && !menu)) return null;
        const selected = meta?.selected ?? menu?.selected;
        return {selected: matches.includes(selected) ? selected : matches[0]};
      },
    },
    props: {handleKeyDown: handleKey},
    view(view) {
      const menu = document.createElement("div");
      menu.className = "inline-slash-menu";
      menu.dataset.commandMenu = 'true';
      menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Insert block');
      const dismissMenu = () => {
        if (slashKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(slashKey, "dismiss"));
      };
      const buttons = new Map<string, HTMLButtonElement>();
      for (const command of [
        {id: 'code', label: 'Code block', icon: '&lt;/&gt;'},
        {id: 'table', label: 'Table', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M12 4v16"/></svg>'},
      ]) {
        const button = document.createElement("button");
        button.type = "button"; button.className = "inline-slash-option";
        button.setAttribute('role', 'menuitem');
        button.setAttribute("aria-label", `Insert ${command.label.toLowerCase()}`);
        button.innerHTML = `<span aria-hidden="true">${command.icon}</span><span>${command.label}</span><kbd>↵</kbd>`;
        if (command.id === 'table') button.title = '2 columns, a header row and one body row';
        button.addEventListener("mousedown", event => event.preventDefault());
        button.addEventListener("click", () => execute(view, command.id));
        const select = () => {
          if (slashKey.getState(view.state)?.selected !== command.id) view.dispatch(view.state.tr.setMeta(slashKey, {selected: command.id}));
        };
        button.addEventListener('pointermove', select); button.addEventListener('focus', select);
        buttons.set(command.id, button);
      }
      menu.addEventListener('keydown', event => {
        if (handleKey(view, event)) {
          event.preventDefault(); event.stopPropagation();
          if (event.key.startsWith('Arrow')) buttons.get(slashKey.getState(view.state)?.selected ?? '')?.focus();
        }
      });
      let rendered = '';
      const menuView = slashMenuView(view, menu, dismissMenu, panel => {
        const state = slashKey.getState(view.state);
        if (!state || !view.editable || menuView.hidden()) { panel.hide(); return; }
        const matches = availableCommands(view.state);
        const key = matches.join(',');
        if (rendered !== key) {menu.replaceChildren(...matches.map(id => buttons.get(id)!)); rendered = key;}
        for (const [id, button] of buttons) {
          button.dataset.active = String(id === state.selected);
          button.tabIndex = id === state.selected ? 0 : -1;
        }
        if (panel.show()) menuView.position();
      });
      const update = menuView.update;
      const blur = () => queueMicrotask(update);
      view.dom.addEventListener("blur", blur);
      view.dom.addEventListener("focus", update);
      return {
        update,
        destroy() {
          menuView.destroy();
          view.dom.removeEventListener("blur", blur);
          view.dom.removeEventListener("focus", update);
        },
      };
    },
  });
});
