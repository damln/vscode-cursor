import type { Node } from "@milkdown/kit/prose/model";

export function contiguousMarkedRange(parent: Node, parentStart: number, position: number, hasMark: (node: Node) => boolean) {
  const ranges: { from: number; to: number }[] = [];
  let current: { from: number; to: number } | null = null;
  parent.forEach((child, offset) => {
    const from = parentStart + offset;
    const to = from + child.nodeSize;
    if (!hasMark(child)) { current = null; return; }
    if (current && current.to === from) current.to = to;
    else { current = {from, to}; ranges.push(current); }
  });
  return ranges.find(range => position >= range.from && position <= range.to) ?? null;
}
