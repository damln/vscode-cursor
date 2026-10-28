function textNodes(code: HTMLElement): Text[] {
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.length) nodes.push(node);
  }
  return nodes;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function glyphTop(
  range: Range,
  node: Text,
  offset: number,
  codeTop: number,
  numberHeight: number,
): number | null {
  range.setStart(node, offset);
  range.setEnd(node, offset + 1);
  // Safari adds an empty rect at the end of the previous line, so the bounding rect spans two lines.
  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.height)
    .reverse();
  const rect = rects.find((rect) => rect.width) ?? rects[0];
  return rect ? rect.top - codeTop + (rect.height - numberHeight) / 2 : null;
}

function lineTop(
  metrics: {
    range: Range;
    nodes: Text[];
    codeTop: number;
    lineHeight: number;
    numberHeight: number;
  },
  index: number,
  start: number,
  offset: number,
  previousTop: number,
): number {
  const { range, nodes, codeTop, lineHeight, numberHeight } = metrics;
  let top = previousTop + lineHeight;
  if (index < nodes.length) {
    top = glyphTop(range, nodes[index], start - offset, codeTop, numberHeight) ?? top;
  } else if (start > 0 && nodes.length) {
    const last = nodes[nodes.length - 1];
    const lastTop = glyphTop(range, last, last.length - 1, codeTop, numberHeight);
    if (lastTop !== null) top = lastTop + lineHeight;
  }
  return top;
}

export function codeGutter(code: HTMLElement, gutter: HTMLElement) {
  let frame = 0,
    disposed = false;
  gutter.contentEditable = 'false';
  gutter.setAttribute('aria-hidden', 'true');
  function render() {
    frame = 0;
    if (!code.isConnected || !code.getBoundingClientRect().height) return;
    const nodes = textNodes(code);
    const starts = lineStarts(code.textContent || '');
    gutter.style.width = `${String(starts.length).length + 3}ch`;
    const codeTop = code.getBoundingClientRect().top;
    const style = getComputedStyle(code);
    const lineHeight = parseFloat(style.lineHeight);
    const numberHeight = parseFloat(getComputedStyle(gutter).fontSize);
    const range = document.createRange();
    let index = 0,
      offset = 0,
      previousTop = parseFloat(style.paddingTop) - (lineHeight + numberHeight) / 2;
    const metrics = { range, nodes, codeTop, lineHeight, numberHeight };
    const labels = starts.map((start, line) => {
      while (index < nodes.length && start >= offset + nodes[index].length) {
        offset += nodes[index++].length;
      }
      const top = lineTop(metrics, index, start, offset, previousTop);
      previousTop = top;
      const label = document.createElement('span');
      label.textContent = String(line + 1);
      label.style.top = `${top}px`;
      return label;
    });
    gutter.replaceChildren(...labels);
  }
  const schedule = () => {
    if (!disposed && !frame) frame = requestAnimationFrame(render);
  };
  const resize = new ResizeObserver(schedule);
  resize.observe(code);
  const content = new MutationObserver(schedule);
  content.observe(code, { childList: true, characterData: true, subtree: true });
  void document.fonts.ready.then(schedule);
  schedule();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    content.disconnect();
  };
}
