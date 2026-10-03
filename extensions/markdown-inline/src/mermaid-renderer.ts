import { renderMermaid } from '../vendor/marko/src/mermaid';
import type { MermaidRenderer } from '../vendor/marko/src/scope';
declare global { interface Window { damlnRenderMermaid?: MermaidRenderer } }
window.damlnRenderMermaid = renderMermaid;
