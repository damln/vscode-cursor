import mermaid from 'mermaid';
import type { MermaidResult } from './milkdown/mermaid-loader';

let queue: Promise<unknown> = Promise.resolve();
let sequence = 0;

async function render(source: string, dark: boolean): Promise<MermaidResult> {
  const container = document.createElement('div');
  container.className = 'mermaid-measure';
  container.setAttribute('aria-hidden', 'true');
  document.body.append(container);
  try {
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
      maxTextSize: 50000, maxEdges: 500, htmlLabels: false,
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges',
        'suppressErrorRendering', 'dompurifyConfig', 'htmlLabels', 'themeCSS', 'fontFamily'],
      themeCSS: '.node rect, .actor, .label-container { rx: 8; ry: 8; } .flowchart-link { stroke-width: 1.5px; }',
      theme: 'base', fontFamily: 'system-ui, sans-serif',
      themeVariables: {
        darkMode: dark, background: dark ? '#202020' : '#faf9f7',
        primaryColor: dark ? '#35302b' : '#fff0e4', primaryTextColor: dark ? '#f5f3ef' : '#292524',
        primaryBorderColor: dark ? '#8e7057' : '#c58b5c',
        secondaryColor: dark ? '#26393b' : '#e9f3f1', tertiaryColor: dark ? '#30343c' : '#eef1f5',
        lineColor: dark ? '#b5aaa0' : '#786b60', textColor: dark ? '#f5f3ef' : '#292524',
        mainBkg: dark ? '#35302b' : '#fff0e4', nodeBorder: dark ? '#8e7057' : '#c58b5c',
        clusterBkg: dark ? '#252525' : '#f1efeb', clusterBorder: dark ? '#55514b' : '#d5cec5',
        edgeLabelBackground: dark ? '#202020' : '#faf9f7', fontSize: '15px',
      },
      flowchart: {htmlLabels: false, curve: 'basis', padding: 18, nodeSpacing: 36, rankSpacing: 48},
    });
    const {svg} = await mermaid.render(`inline-mermaid-${++sequence}`, source, container);
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = parsed.documentElement;
    if (root.tagName !== 'svg' || parsed.querySelector('parsererror')) throw new Error('Could not read the rendered diagram.');
    const box = root.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
    if (!box || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) throw new Error('The diagram has no visible content.');
    root.setAttribute('width', String(box[2])); root.setAttribute('height', String(box[3]));
    root.removeAttribute('style');
    return {url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(root)),
      width: box[2], height: box[3], description: [parsed.querySelector('title')?.textContent, parsed.querySelector('desc')?.textContent].filter(Boolean).join('. ') || 'Mermaid diagram'};
  } finally { container.remove(); }
}

window.damlnRenderMermaid = (source, dark) => {
  const next = queue.then(() => render(source, dark));
  queue = next.catch(() => {});
  return next;
};
