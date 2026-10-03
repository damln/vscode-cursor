// Per-editor environment shared by the plugins: where floating UI is mounted,
// which element scrolls, and the host hooks that replace platform messaging.
import type { EditorView } from "@milkdown/kit/prose/view";

export interface MermaidResult { url: string; width: number; height: number; description: string }
export type MermaidRenderer = (source: string, dark: boolean) => Promise<MermaidResult>;

export interface MarkoHost {
  /** Open a link or image destination chosen by the user. */
  openLink(href: string): void;
  /** Turn an authored image source into a URL the page can load. */
  resolveImage(src: string, signal: AbortSignal): Promise<string>;
  /** Copy code block text to the clipboard. */
  copyText(text: string, signal: AbortSignal): Promise<void>;
  /** Load the Mermaid renderer on first use. Without it, Mermaid blocks stay plain code. */
  loadMermaid?: () => Promise<MermaidRenderer>;
}

export interface MarkoScope {
  /** Themed element that contains the editor. */
  root: HTMLElement;
  /** Area around the document that handles block selection and may scroll. */
  surface: HTMLElement;
  /** Themed layer on document.body for floating toolbars, menus and dialogs. */
  overlay: HTMLElement;
  host: MarkoHost;
  dark(): boolean;
}

export const defaultHost: MarkoHost = {
  openLink(href) {
    if (/^(https?|mailto):/i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
  },
  resolveImage: src => Promise.resolve(src),
  copyText: text => navigator.clipboard?.writeText(text)
    ?? Promise.reject(new Error("The clipboard is unavailable on this page.")),
};

let sequence = 0;
/** Page-unique element id. crypto.randomUUID is unavailable outside secure contexts. */
export function uniqueId(prefix: string) {
  return `${prefix}-${(++sequence).toString(36)}`;
}

const scopes = new WeakMap<Element, MarkoScope>();

export function registerScope(scope: MarkoScope) {
  scopes.set(scope.root, scope);
  scopes.set(scope.overlay, scope);
  return () => { scopes.delete(scope.root); scopes.delete(scope.overlay); };
}

const fallbackScope: MarkoScope = {
  get root() { return document.body; },
  get surface() { return document.body; },
  get overlay() { return document.body; },
  host: defaultHost,
  dark: () => matchMedia("(prefers-color-scheme: dark)").matches,
};

export function scopeOf(target: EditorView | Element | null | undefined): MarkoScope {
  let node: Element | null = target && "dom" in target ? target.dom : target ?? null;
  for (; node; node = node.parentElement) {
    const scope = scopes.get(node);
    if (scope) return scope;
  }
  return fallbackScope;
}

const mermaidLoads = new WeakMap<MarkoHost, Promise<MermaidRenderer>>();

export function loadMermaid(host: MarkoHost): Promise<MermaidRenderer> {
  if (!host.loadMermaid) return Promise.reject(new Error("Mermaid previews are not enabled."));
  let loading = mermaidLoads.get(host);
  if (!loading) {
    loading = host.loadMermaid();
    loading.catch(() => mermaidLoads.delete(host));
    mermaidLoads.set(host, loading);
  }
  return loading;
}
