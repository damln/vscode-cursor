// Skins restyle one or more editors without touching behavior. A skin's CSS is
// nested under its editors and placed in the marko.skin layer, so it overrides
// the default look regardless of selector specificity.
import type { ThemeMode } from "./themes";

export interface MarkoSkin {
  /** Letters, digits and dashes; editors using the skin carry data-marko-skin="id". */
  id: string;
  /**
   * Nested CSS. Selectors are relative to the editor and its floating overlay:
   * `.milkdown h1 { ... }`, `.milkdown-selection-toolbar { ... }`, and `&` for the editor itself.
   */
  css?: string;
  /** Custom properties such as `--marko-accent`, applied before `css`. */
  variables?: Record<string, string>;
  /** "default" builds on Marko's look; "none" keeps only layout and behavior (core) for a full redesign. */
  base?: "default" | "none";
  /** Color scheme for scheme-dependent rules and Mermaid. Defaults to the editor theme's scheme. */
  scheme?: ThemeMode;
}

const LAYERS = "@layer marko.core, marko.theme, marko.skin;";

function validId(id: string) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) throw new Error(`Invalid Marko skin id: ${JSON.stringify(id)}`);
  return id;
}

/** The stylesheet text for a skin, for hosts that prefer shipping it as a static file. */
export function skinCss(skin: MarkoSkin) {
  const variables = Object.entries(skin.variables ?? {}).map(([name, value]) => {
    if (!/^--[\w-]+$/.test(name)) throw new Error(`Skin variables must be custom properties: ${name}`);
    return `    ${name}: ${value};\n`;
  }).join("");
  return `${LAYERS}\n@layer marko.skin {\n  :is(.marko, .marko-overlay)[data-marko-skin="${validId(skin.id)}"] {\n${variables}${skin.css ?? ""}\n  }\n}\n`;
}

const sheets = new Map<string, { css: string; sheet: CSSStyleSheet | HTMLStyleElement }>();

/** Install or update a skin's stylesheet once per page. Called automatically by `skin` and `setSkin`. */
export function installSkin(skin: MarkoSkin) {
  const css = skinCss(skin);
  const installed = sheets.get(skin.id);
  if (installed?.css === css) return;
  if (installed) {
    if (installed.sheet instanceof CSSStyleSheet) installed.sheet.replaceSync(css);
    else installed.sheet.textContent = css;
    installed.css = css;
    return;
  }
  // Constructed stylesheets are not blocked by a style-src CSP; fall back to <style> elsewhere.
  if ("adoptedStyleSheets" in Document.prototype && "replaceSync" in CSSStyleSheet.prototype) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    sheets.set(skin.id, {css, sheet});
  } else {
    const style = document.createElement("style");
    style.dataset.markoSkin = skin.id;
    style.textContent = css;
    document.head.append(style);
    sheets.set(skin.id, {css, sheet: style});
  }
}
