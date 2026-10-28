import type { Ctx } from '@milkdown/kit/ctx';
import { tooltipFactory } from '@milkdown/kit/plugin/tooltip';
import type { EditorState } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { floatingTooltip, toolbarPointer } from './floating-panel';
import { formattingActions } from './formatting-actions';
import {
  createToolbarButton,
  createToolbarSeparator,
  isInTable,
  toolbarKeyboard,
  updateInlineFormatState,
} from './toolbar-dom';

export const selectionToolbar = tooltipFactory('selection-toolbar');

import { isLinkPanelOpen } from './link-tooltip';
import { focusTableToolbar } from './table-toolbar';

export { openLinkEditor } from './link-tooltip';

const focusSelectionToolbar = new WeakMap<EditorView, () => void>();
export function focusToolbar(view: EditorView) {
  if (!focusTableToolbar(view)) focusSelectionToolbar.get(view)?.();
}

function canShowToolbar(view: EditorView, state: EditorState) {
  if (!view.editable) return false;
  // Check if selection is inside a code block or table
  const { $from } = state.selection;
  if ($from.parent.type.name === 'code_block') return false;
  if (isInTable(state)) return false;
  return true;
}

export function configureSelectionToolbar(ctx: Ctx) {
  const el = document.createElement('div');
  el.className = 'milkdown-selection-toolbar';
  el.setAttribute('role', 'toolbar');
  el.setAttribute('aria-label', 'Formatting and block actions');
  let keyboardOpen = false;

  const buttonsRow = document.createElement('div');
  buttonsRow.className = 'tb-buttons-row';
  buttonsRow.style.display = 'flex';
  buttonsRow.style.alignItems = 'center';
  buttonsRow.style.gap = '2px';
  const actions = formattingActions(ctx);
  const buttons = actions.map((action, index) => {
    if (index && action.group !== actions[index - 1].group && action.group !== 'move') {
      buttonsRow.append(createToolbarSeparator());
    }
    const button = createToolbarButton(action);
    buttonsRow.append(button);
    return button;
  });
  el.append(buttonsRow);
  function updateActiveState(state: EditorState) {
    actions.forEach((action, index) => {
      if (!action.active) return;
      const active = action.active(state);
      buttons[index].classList.toggle('tb-active', active);
      buttons[index].setAttribute('aria-pressed', String(active));
    });
    updateInlineFormatState(el, state);
  }

  ctx.set(selectionToolbar.key, {
    view: (view) => {
      const provider = floatingTooltip(
        view,
        {
          content: el,
          middleware: [toolbarPointer(el)],
          debounce: 50,
          offset: 10,
          shouldShow: (view) => {
            if (isLinkPanelOpen(view)) return false;
            if (el.contains(document.activeElement)) return true;

            const { state } = view;
            const { selection } = state;
            if (selection.empty && !keyboardOpen) return false;
            return canShowToolbar(view, state);
          },
        },
        1,
        undefined,
        (restore) => {
          keyboardOpen = false;
          if (restore) view.focus();
        },
      );
      const update = provider.update;
      provider.update = (...args) => {
        updateActiveState(args[0].state);
        update(...args);
      };
      const focus = () => {
        keyboardOpen = true;
        provider.reopen();
        provider.update(view);
        provider.show(
          {
            getBoundingClientRect: () => {
              const rect = view.coordsAtPos(view.state.selection.from);
              return new DOMRect(
                rect.left,
                rect.top,
                rect.right - rect.left,
                rect.bottom - rect.top,
              );
            },
          },
          view,
        );
        el.querySelector<HTMLButtonElement>('button')?.focus();
      };
      focusSelectionToolbar.set(view, focus);
      toolbarKeyboard(el, () => {
        keyboardOpen = false;
        provider.hide();
        view.focus();
      });
      const destroy = provider.destroy;
      provider.destroy = () => {
        focusSelectionToolbar.delete(view);
        destroy();
      };
      return provider;
    },
  });
}
