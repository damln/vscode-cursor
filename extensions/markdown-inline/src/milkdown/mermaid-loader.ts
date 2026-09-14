export interface MermaidResult { url: string; width: number; height: number; description: string }
export type MermaidRenderer = (source: string, dark: boolean) => Promise<MermaidResult>;
declare global { interface Window { damlnRenderMermaid?: MermaidRenderer } }

let loading: Promise<MermaidRenderer> | undefined;
export function loadMermaid(): Promise<MermaidRenderer> {
  if (window.damlnRenderMermaid) return Promise.resolve(window.damlnRenderMermaid);
  if (loading) return loading;
  loading = new Promise<MermaidRenderer>((resolve, reject) => {
    const entry = document.querySelector<HTMLScriptElement>('script[data-mermaid-src]');
    if (!entry?.dataset.mermaidSrc) { reject(new Error('Mermaid renderer is missing. Reload the editor.')); return; }
    const script = document.createElement('script');
    script.src = entry.dataset.mermaidSrc; script.nonce = entry.nonce;
    const timer = setTimeout(() => fail(), 15000);
    const fail = () => { clearTimeout(timer); script.remove(); reject(new Error('Could not load Mermaid. Try preview again.')); };
    script.onload = () => {
      clearTimeout(timer);
      if (window.damlnRenderMermaid) resolve(window.damlnRenderMermaid); else fail();
    };
    script.onerror = fail; document.head.append(script);
  }).catch(error => { loading = undefined; throw error; });
  return loading;
}
