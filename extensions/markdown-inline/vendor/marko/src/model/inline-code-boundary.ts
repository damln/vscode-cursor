import type { Mark, MarkType, Node, ResolvedPos } from "@milkdown/kit/prose/model";

export function isInlineCodeMark(mark: Mark | null | undefined, codeMarkType: MarkType) {
  return Boolean(mark && (mark.type === codeMarkType || mark.type.name === "inlineCode" || mark.type.name === "code_inline"));
}

function marksOf(node: Node | null | undefined): readonly Mark[] {
  return node?.marks ?? [];
}

export function sameMarks(left: readonly Mark[], right: readonly Mark[]) {
  return left.length === right.length && left.every((mark, index) => mark.eq(right[index]));
}

/**
 * A caret at the edge of inline code. The edge has two caret positions: inside
 * the code and outside it. `end` is true when the code ends at the caret.
 */
export interface CodeEdge {
  end: boolean;
  inside: readonly Mark[];
  outside: readonly Mark[];
}

export function codeEdgeAt(cursor: ResolvedPos, codeMarkType: MarkType): CodeEdge | null {
  const beforeMarks = marksOf(cursor.nodeBefore);
  const afterMarks = marksOf(cursor.nodeAfter);
  const codeBefore = beforeMarks.some(mark => isInlineCodeMark(mark, codeMarkType));
  const codeAfter = afterMarks.some(mark => isInlineCodeMark(mark, codeMarkType));
  if (codeBefore === codeAfter) return null;
  const outsideNode = codeBefore ? cursor.nodeAfter : cursor.nodeBefore;
  const sourceMarks = outsideNode ? marksOf(outsideNode) : codeBefore ? beforeMarks : afterMarks;
  return {
    end: codeBefore,
    inside: codeBefore ? beforeMarks : afterMarks,
    outside: sourceMarks.filter(mark => !isInlineCodeMark(mark, codeMarkType)),
  };
}

/** Marks a caret should carry when it sits on the non-code side of inline code. */
export function outsideMarksAtInlineCodeBoundary(cursor: ResolvedPos, codeMarkType: MarkType) {
  return codeEdgeAt(cursor, codeMarkType)?.outside ?? null;
}
