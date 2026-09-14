import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { outsideMarksAtInlineCodeBoundary } from "../../inline-code-boundary.js";

export function insertSpaceOutsideLink(
  state: any,
  dispatch: (transaction: any) => void
): boolean {
  const { selection } = state;
  if (!selection.empty) return false;

  const { $from } = selection;
  const linkType = state.schema.marks.link;
  if (!linkType) return false;

  const linkBefore = $from.nodeBefore?.marks.find((mark: any) => mark.type === linkType);
  if (!linkBefore) return false;

  const sameLinkAfter = $from.nodeAfter?.marks.some(
    (mark: any) => mark.type === linkType && mark.eq(linkBefore)
  );
  if (sameLinkAfter) return false;

  const codeMark = state.schema.marks.inlineCode || state.schema.marks.code_inline;
  const boundaryMarks = codeMark
    ? outsideMarksAtInlineCodeBoundary($from, codeMark)
    : null;
  const marks = (boundaryMarks ?? state.storedMarks ?? $from.marks()).filter(
    (mark: any) => mark.type !== linkType
  );
  const space = state.schema.text(" ", marks);
  const transaction = state.tr
    .replaceSelectionWith(space, false)
    .setStoredMarks(marks)
    .scrollIntoView();

  dispatch(transaction);
  return true;
}

export const linkBoundaryPlugin = $prose(() => {
  return new Plugin({
    key: new PluginKey("link-boundary"),
    props: {
      handleKeyDown(view, event) {
        if (event.key !== " " || event.metaKey || event.ctrlKey || event.altKey) {
          return false;
        }

        const handled = insertSpaceOutsideLink(view.state, (transaction) => {
          view.dispatch(transaction);
        });
        if (handled) event.preventDefault();
        return handled;
      },
    },
  });
});
