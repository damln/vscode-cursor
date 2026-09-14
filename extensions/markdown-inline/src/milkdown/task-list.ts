import { $view } from "@milkdown/kit/utils";
import { listItemSchema } from "@milkdown/kit/preset/commonmark";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { Node as PmNode } from "@milkdown/kit/prose/model";

const LIST_ITEM = "list_item";

interface ListItemRef {
  pos: number;
  node: PmNode;
}

/** The list items a selection acts on: the innermost one under a plain cursor,
 *  every intersecting one for a range. */
function selectedListItems(state: EditorState): ListItemRef[] {
  const { from, to, $from } = state.selection;

  if (from === to) {
    for (let depth = $from.depth; depth > 0; depth--) {
      const node = $from.node(depth);
      if (node.type.name === LIST_ITEM) {
        return [{ pos: $from.before(depth), node }];
      }
    }
    return [];
  }

  const items: ListItemRef[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === LIST_ITEM) items.push({ pos, node });
  });
  return items;
}

/** True when every list item the selection covers is already a checkbox. */
export function isTaskListActive(state: EditorState): boolean {
  const items = selectedListItems(state);
  return items.length > 0 && items.every((item) => item.node.attrs.checked != null);
}

/** Turn the selected list items into checkboxes, or back into plain items.
 *  Returns false without dispatching when the selection covers no list item —
 *  the caller decides whether to wrap it in a list first.
 *
 *  `checked` is the GFM task attribute: null renders a plain bullet and
 *  serializes to `- item`, false renders an unchecked box and serializes to
 *  `- [ ] item`. Attribute-only updates never shift positions, so the whole
 *  batch goes into one transaction. */
export function toggleTaskList(
  state: EditorState,
  dispatch: (transaction: Transaction) => void
): boolean {
  const items = selectedListItems(state);
  if (items.length === 0) return false;

  // Any plain item in the selection means "make these checkboxes"; only when
  // every item is already a checkbox does the button convert back.
  const toTasks = items.some((item) => item.node.attrs.checked == null);

  const tr = state.tr;
  for (const { pos, node } of items) {
    // Converting to tasks leaves already-ticked items ticked — a half-checked
    // list must not lose its progress just because the rest joins in.
    if (toTasks && node.attrs.checked != null) continue;
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      checked: toTasks ? false : null,
    });
  }
  dispatch(tr);
  return true;
}

export const taskListView = $view(listItemSchema.node, () => {
  return (node: any, view: any, getPos: any) => {
    const isTask = node.attrs.checked != null;
    const li = document.createElement("li");
    li.setAttribute("data-item-type", isTask ? "task" : "bullet");
    if (isTask) {
      li.setAttribute("data-checked", String(node.attrs.checked));
    }

    let checkbox: HTMLInputElement | null = null;
    const contentSpan = document.createElement("span");

    if (isTask) {
      checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !!node.attrs.checked;
      checkbox.contentEditable = "false";
      checkbox.addEventListener("change", () => {
        const pos = getPos();
        if (pos == null) return;
        const tr = view.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          checked: checkbox!.checked,
        });
        view.dispatch(tr);
      });
      li.appendChild(checkbox);
      contentSpan.className = "task-list-content";
    }

    li.appendChild(contentSpan);

    return {
      dom: li,
      contentDOM: contentSpan,
      update: (updatedNode: any) => {
        const wasTask = isTask;
        const nowTask = updatedNode.attrs.checked != null;
        if (wasTask !== nowTask) return false;
        if (nowTask && checkbox) {
          checkbox.checked = !!updatedNode.attrs.checked;
          li.setAttribute("data-checked", String(updatedNode.attrs.checked));
        }
        node = updatedNode;
        return true;
      },
    };
  };
});
