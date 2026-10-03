// Standalone Mermaid renderer: exposes window.MarkoMermaid for pages without a bundler.
import { renderMermaid } from "./mermaid";

declare global { interface Window { MarkoMermaid: { renderMermaid: typeof renderMermaid } } }
window.MarkoMermaid = {renderMermaid};
