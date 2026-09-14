function isInlineCodeMark(mark, codeMarkType) {
  return Boolean(
    mark &&
      (mark.type === codeMarkType ||
        mark.type?.name === "inlineCode" ||
        mark.type?.name === "code_inline")
  );
}

function marksOf(node) {
  return Array.isArray(node?.marks) ? node.marks : [];
}

function sameMarks(left, right) {
  return (
    left.length === right.length &&
    left.every((mark, index) =>
      typeof mark.eq === "function" ? mark.eq(right[index]) : mark === right[index]
    )
  );
}

function outsideMarksAtInlineCodeBoundary(cursor, codeMarkType) {
  const beforeMarks = marksOf(cursor.nodeBefore);
  const afterMarks = marksOf(cursor.nodeAfter);
  const codeBefore = beforeMarks.some(mark => isInlineCodeMark(mark, codeMarkType));
  const codeAfter = afterMarks.some(mark => isInlineCodeMark(mark, codeMarkType));
  if (codeBefore === codeAfter) {
    return null;
  }

  const outsideNode = codeBefore ? cursor.nodeAfter : cursor.nodeBefore;
  const insideMarks = codeBefore ? beforeMarks : afterMarks;
  const sourceMarks = outsideNode ? marksOf(outsideNode) : insideMarks;
  return sourceMarks.filter(mark => !isInlineCodeMark(mark, codeMarkType));
}

module.exports = {
  isInlineCodeMark,
  outsideMarksAtInlineCodeBoundary,
  sameMarks
};
