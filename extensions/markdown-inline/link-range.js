function contiguousMarkedRange(parent, parentStart, position, hasMark) {
  const ranges = [];
  let current = null;

  parent.forEach((child, offset) => {
    const from = parentStart + offset;
    const to = from + child.nodeSize;
    if (!hasMark(child)) {
      current = null;
      return;
    }
    if (current && current.to === from) {
      current.to = to;
    } else {
      current = { from, to };
      ranges.push(current);
    }
  });

  return ranges.find(range => position >= range.from && position <= range.to) || null;
}

module.exports = { contiguousMarkedRange };
