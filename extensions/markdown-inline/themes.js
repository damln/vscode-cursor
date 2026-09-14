const THEMES = [
  {id: "linen", name: "Linen", mode: "light", description: "Warm paper, soft stone, burnt orange.", colors: ["#faf9f7", "#292524", "#706861", "#e7e2dc", "#f1eeea", "#f4f2ef", "#ffffff", "#c2410c"]},
  {id: "paper", name: "Paper", mode: "light", description: "Crisp white, cool gray, clear blue.", colors: ["#ffffff", "#172033", "#5c687d", "#dce3ed", "#f0f4f9", "#f4f7fb", "#ffffff", "#175ac6"]},
  {id: "rose", name: "Rose", mode: "light", description: "Blush paper with a berry accent.", colors: ["#fff7f8", "#392631", "#7a5969", "#eddce3", "#f7eaf0", "#faedf2", "#fffcfd", "#a52f64"]},
  {id: "charcoal", name: "Charcoal", mode: "dark", description: "Warm graphite with an amber glow.", colors: ["#1a1a1a", "#e7e5e4", "#a8a29e", "#3c3835", "#242220", "#18181b", "#292624", "#fb923c"]},
  {id: "midnight", name: "Midnight", mode: "dark", description: "Deep navy with an ice-blue accent.", colors: ["#101827", "#e5edf9", "#9eafc9", "#2c3d56", "#19253a", "#0d1422", "#1d2a40", "#77b7ff"]},
  {id: "forest", name: "Forest", mode: "dark", description: "Deep green, soft sage, fresh mint.", colors: ["#13211d", "#e4eee8", "#a0b8aa", "#324a3f", "#1c3027", "#101c17", "#21382d", "#8bd9af"]},
  {id: "dune", name: "Dune", mode: "light", description: "Sandstone paper, dark ink, toasted amber.", colors: ["#fbf5e8", "#302a20", "#74644f", "#e4d8c3", "#f1e7d5", "#f4ecde", "#fffcf5", "#85530d"]},
  {id: "glacier", name: "Glacier", mode: "light", description: "Pale ice, slate ink, deep teal.", colors: ["#f1f9fa", "#203439", "#536e74", "#d1e4e7", "#e3f0f2", "#eaf4f5", "#ffffff", "#096974"]},
  {id: "obsidian", name: "Obsidian", mode: "dark", description: "Near-black surfaces with a golden accent.", colors: ["#151513", "#f1eee4", "#b3ad9c", "#3c392f", "#24231e", "#11110f", "#29271f", "#ffd84d"]},
  {id: "cocoa", name: "Cocoa", mode: "dark", description: "Roasted brown, warm cream, soft coral.", colors: ["#241b19", "#f3e7df", "#c2aca0", "#513d35", "#30231f", "#1c1513", "#382a25", "#ffb296"]},
];

function isInlineTheme(value) {
  return THEMES.some(theme => theme.id === value) || ["auto", "dark", "light"].includes(value);
}

function findTheme(value, light = false) {
  return THEMES.find(theme => theme.id === value)
    || THEMES[value === "light" || (value === "auto" && light) ? 0 : 3];
}

function themeVariables(theme) {
  const [page, foreground, secondary, border, muted, code, floating, accent] = theme.colors;
  return {
    "--page-background": page, "--foreground": foreground, "--text-secondary": secondary,
    "--border": border, "--muted": muted, "--code-bg": code, "--floating-surface": floating,
    "--floating-foreground": foreground, "--text-muted": secondary, "--heat-100": accent,
    "--heat-40": `color-mix(in srgb, ${accent} 40%, transparent)`,
    "--heat-12": `color-mix(in srgb, ${accent} 12%, transparent)`,
    "--control-background": muted, "--control-hover": `color-mix(in srgb, ${accent} 12%, ${muted})`,
    "--destructive": theme.mode === "light" ? "#b42332" : "#ff909b",
  };
}

function themeStyles() {
  return THEMES.map(theme => {
    const variables = Object.entries(themeVariables(theme)).map(([key, value]) => `${key}:${value}`).join(";");
    return `html[data-editor-theme="${theme.id}"][data-inline-theme="${theme.mode}"] body, [data-theme-preview="${theme.id}"]{${variables};color-scheme:${theme.mode}}`;
  }).join("\n");
}

module.exports = { THEMES, findTheme, isInlineTheme, themeStyles };
