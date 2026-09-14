import { floatingTooltip, toolbarPointer } from "./floating-panel";
import { tooltipFactory } from "@milkdown/kit/plugin/tooltip";
import type { Ctx } from "@milkdown/kit/ctx";
import { editorViewCtx, commandsCtx } from "@milkdown/kit/core";
import {
  addColAfterCommand,
  addColBeforeCommand,
  addRowAfterCommand,
  addRowBeforeCommand,
} from "@milkdown/kit/preset/gfm";
import {
  createToolbarButton,
  toolbarKeyboard,
  createToolbarSeparator,
  inlineFormatButtons,
  updateInlineFormatState,
  isInTable,
} from "./toolbar-dom";
import {
  CellSelection,
  deleteColumn,
  deleteRow,
  moveTableColumn,
  moveTableRow,
  selectedRect,
} from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { isLinkPanelOpen, openLinkEditor } from "./link-tooltip";
import {
  shouldShowTableToolbar,
  tableToolbarActionMode,
} from "../../toolbar-visibility";
import {
  ICON_ADD_COLUMN_LEFT,
  ICON_ADD_COLUMN_RIGHT,
  ICON_ADD_ROW_ABOVE,
  ICON_ADD_ROW_BELOW,
  ICON_DELETE_COLUMN,
  ICON_DELETE_ROW,
  ICON_MOVE_DOWN,
  ICON_MOVE_LEFT,
  ICON_MOVE_RIGHT,
  ICON_MOVE_UP,
} from "./icons";

let focusTable: (() => boolean) | undefined;
export const focusTableToolbar = () => focusTable?.() ?? false;
export const tableToolbar = tooltipFactory("table-toolbar");

function moveRow(view: EditorView, direction: "up" | "down") {
  const rect = selectedRect(view.state);
  const target = direction === "up" ? rect.top - 1 : rect.top + 1;
  if (rect.top === 0 || target < 1 || target >= rect.map.height) return;
  moveTableRow({ from: rect.top, to: target, select: false })(
    view.state,
    view.dispatch
  );
}

function moveColumn(view: EditorView, direction: "left" | "right") {
  const rect = selectedRect(view.state);
  const target = direction === "left" ? rect.left - 1 : rect.left + 1;
  if (target < 0 || target >= rect.map.width) return;
  moveTableColumn({ from: rect.left, to: target, select: false })(
    view.state,
    view.dispatch
  );
}

interface TableAction {
  label: string;
  icon: string;
  danger?: boolean;
  handler: () => void;
}

function createActionGroup(actions: TableAction[]) {
  const group = document.createElement("div");
  group.className = "tb-action-group";
  group.setAttribute("role", "group");
  for (const action of actions) {
    group.appendChild(
      createToolbarButton({
        label: action.label,
        icon: action.icon,
        title: action.label,
        tabIndex: -1,
        className: `tb-table-btn${action.danger ? " tb-table-danger" : ""}`,
        action: action.handler,
      })
    );
  }
  return group;
}

export function configureTableToolbar(ctx: Ctx) {
  const el = document.createElement("div");
  el.className = "milkdown-table-toolbar";
  el.setAttribute("role", "toolbar");
  el.setAttribute("aria-label", "Table actions");

  for (const btn of inlineFormatButtons(ctx)) {
    el.appendChild(createToolbarButton(btn));
  }

  const linkButton = createToolbarButton({
    label: "Link", title: "Add link (⌘K)", className: "tb-btn tb-link-btn", markName: "link",
    icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m10 13 4-4m-5 6-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/></svg>',
    action: () => openLinkEditor(),
  });
  el.appendChild(linkButton);

  el.appendChild(createToolbarSeparator());
  const rowActions = createActionGroup([
    {
      label: "Move row up",
      icon: ICON_MOVE_UP,
      handler: () => moveRow(ctx.get(editorViewCtx), "up"),
    },
    {
      label: "Move row down",
      icon: ICON_MOVE_DOWN,
      handler: () => moveRow(ctx.get(editorViewCtx), "down"),
    },
    {
      label: "Add row above",
      icon: ICON_ADD_ROW_ABOVE,
      handler: () => ctx.get(commandsCtx).call(addRowBeforeCommand.key),
    },
    {
      label: "Add row below",
      icon: ICON_ADD_ROW_BELOW,
      handler: () => ctx.get(commandsCtx).call(addRowAfterCommand.key),
    },
    {
      label: "Delete row",
      icon: ICON_DELETE_ROW,
      danger: true,
      handler: () => {
        const view = ctx.get(editorViewCtx);
        deleteRow(view.state, view.dispatch);
      },
    },
  ]);
  rowActions.dataset.tableActions = "row";

  const columnActions = createActionGroup([
    {
      label: "Move column left",
      icon: ICON_MOVE_LEFT,
      handler: () => moveColumn(ctx.get(editorViewCtx), "left"),
    },
    {
      label: "Move column right",
      icon: ICON_MOVE_RIGHT,
      handler: () => moveColumn(ctx.get(editorViewCtx), "right"),
    },
    {
      label: "Add column left",
      icon: ICON_ADD_COLUMN_LEFT,
      handler: () => ctx.get(commandsCtx).call(addColBeforeCommand.key),
    },
    {
      label: "Add column right",
      icon: ICON_ADD_COLUMN_RIGHT,
      handler: () => ctx.get(commandsCtx).call(addColAfterCommand.key),
    },
    {
      label: "Delete column",
      icon: ICON_DELETE_COLUMN,
      danger: true,
      handler: () => {
        const view = ctx.get(editorViewCtx);
        deleteColumn(view.state, view.dispatch);
      },
    },
  ]);
  columnActions.dataset.tableActions = "column";
  el.append(rowActions, columnActions);

  ctx.set(tableToolbar.key, {
    view: view => {
      const provider = floatingTooltip({
      content: el,
      middleware: [toolbarPointer(el)],
      debounce: 80,
      offset: 8,
      shouldShow: (view) => {
        const visible = shouldShowTableToolbar({
          editable: view.editable,
          inTable: isInTable(view.state),
          linkAtCursor: isLinkPanelOpen(),
        });
        if (!visible) return false;
        const mode = tableToolbarActionMode(selectedRect(view.state).top);
        rowActions.hidden = mode !== "row";
        columnActions.hidden = mode !== "column";
        return true;
      },
      });
      const update = provider.update;
      provider.update = (...args) => {
        const {selection} = args[0].state;
        linkButton.disabled = selection instanceof CellSelection || !selection.$from.sameParent(selection.$to);
        linkButton.title = linkButton.disabled ? "Select text inside one cell to add a link" : "Add link (⌘K)";
        updateInlineFormatState(el, args[0].state);
        update(...args);
      };
      const focus = () => {
        if (!isInTable(view.state)) return false;
        provider.reopen(); provider.update(view);
        provider.show({getBoundingClientRect: () => {
          const rect = view.coordsAtPos(view.state.selection.from);
          return new DOMRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
        }}, view); el.querySelector<HTMLButtonElement>("button")?.focus(); return true;
      };
      focusTable = focus;
      toolbarKeyboard(el, () => { provider.hide(); view.focus(); });
      const destroy = provider.destroy;
      provider.destroy = () => { if (focusTable === focus) focusTable = undefined; destroy(); };
      return provider;
    },
  });
}
