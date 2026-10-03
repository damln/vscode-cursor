import type { NodeType } from "@milkdown/kit/prose/model";
import { TextSelection, type Command } from "@milkdown/kit/prose/state";

export function selectionToCodeBlock(codeBlock: NodeType): Command {
  return (state, dispatch) => {
    const { from, to, empty, $from, $to } = state.selection;
    if (empty || !(state.selection instanceof TextSelection)) return false;
    const text = state.doc.textBetween(from, to, "\n", node =>
      ["hardbreak", "hard_break"].includes(node.type.name) ? "\n" : node.attrs.alt || "");
    if (!text) return false;
    const block = codeBlock.create(null, state.schema.text(text));
    const start = $from.parent.isTextblock && $from.parentOffset === 0 ? $from.before() : from;
    const finish = $to.parent.isTextblock && $to.parentOffset === $to.parent.content.size ? $to.after() : to;
    const tr = state.tr.replaceWith(start, finish, block);
    if (!tr.docChanged) return false;
    const end = tr.mapping.map(to, 1);
    tr.setSelection(TextSelection.near(tr.doc.resolve(end), -1));
    dispatch?.(tr.setStoredMarks([]).scrollIntoView());
    return true;
  };
}
