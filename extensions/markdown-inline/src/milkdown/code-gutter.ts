export function codeGutter(code: HTMLElement, gutter: HTMLElement) {
  let frame = 0, disposed = false;
  gutter.contentEditable = 'false';
  gutter.setAttribute('aria-hidden', 'true');
  function render() {
    frame = 0;
    if (!code.isConnected || !code.getBoundingClientRect().height) return;
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (node.length) nodes.push(node);
    }
    const text = code.textContent || '';
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    gutter.style.width = `${String(starts.length).length + 3}ch`;
    const codeTop = code.getBoundingClientRect().top;
    const style = getComputedStyle(code);
    const lineHeight = parseFloat(style.lineHeight);
    const numberHeight = parseFloat(getComputedStyle(gutter).fontSize);
    const range = document.createRange();
    let index = 0, offset = 0, previousTop = parseFloat(style.paddingTop) - lineHeight;
    const labels = starts.map((start, line) => {
      while (index < nodes.length && start >= offset + nodes[index].length) {
        offset += nodes[index++].length;
      }
      let top = previousTop + lineHeight;
      if (index < nodes.length) {
        range.setStart(nodes[index], start - offset);
        range.setEnd(nodes[index], start - offset + 1);
        const rect = range.getBoundingClientRect();
        if (rect.height) top = rect.top - codeTop + (rect.height - numberHeight) / 2;
      } else if (start > 0 && nodes.length) {
        const last = nodes.at(-1)!;
        range.setStart(last, last.length - 1);
        range.setEnd(last, last.length);
        const rect = range.getBoundingClientRect();
        if (rect.height) top = rect.top - codeTop + (rect.height - numberHeight) / 2 + lineHeight;
      }
      previousTop = top;
      const label = document.createElement('span');
      label.textContent = String(line + 1);
      label.style.top = `${top}px`;
      return label;
    });
    gutter.replaceChildren(...labels);
  }
  const schedule = () => {if (!disposed && !frame) frame = requestAnimationFrame(render);};
  const resize = new ResizeObserver(schedule);
  resize.observe(code);
  const content = new MutationObserver(schedule);
  content.observe(code, {childList: true, characterData: true, subtree: true});
  const preferences = new MutationObserver(schedule);
  preferences.observe(document.documentElement, {attributes: true, attributeFilter: ['data-code-wrap']});
  void document.fonts.ready.then(schedule);
  schedule();
  return () => {
    disposed = true; cancelAnimationFrame(frame);
    resize.disconnect(); content.disconnect(); preferences.disconnect();
  };
}
