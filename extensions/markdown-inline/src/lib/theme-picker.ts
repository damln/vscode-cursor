import { THEMES, findTheme } from "../../themes";
import { FloatingPanel } from "../milkdown/floating-panel";

export function setupEditorSettings(trigger: HTMLButtonElement, changed: (theme: string) => void, wrapChanged: (wrap: boolean) => void) {
  const dialog = document.createElement("dialog");
  dialog.className = "theme-picker";
  dialog.id = "editor-theme-picker";
  dialog.setAttribute("aria-labelledby", "editor-theme-title");
  dialog.setAttribute("aria-describedby", "editor-theme-description");
  dialog.innerHTML = `<div class="theme-picker-heading"><div><h2 id="editor-theme-title">Editor settings</h2>
    <p id="editor-theme-description">Choose how your Markdown looks. Changes apply immediately.</p></div>
    <button class="theme-picker-close" type="button" aria-label="Close editor settings" data-toolbar-hint="Close editor settings">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>
    </button></div>`;
  const wrapping = document.createElement("div");
  wrapping.className = "editor-setting-row";
  wrapping.innerHTML = '<div><span id="code-wrap-label">Wrap code lines</span><p id="code-wrap-description">Keep long lines inside the code block.</p></div>';
  const wrapToggle = document.createElement("button");
  wrapToggle.type = "button";
  wrapToggle.className = "editor-setting-switch";
  wrapToggle.setAttribute("role", "switch");
  wrapToggle.setAttribute("aria-labelledby", "code-wrap-label");
  wrapToggle.setAttribute("aria-describedby", "code-wrap-description");
  wrapToggle.innerHTML = '<span aria-hidden="true"></span>';
  function applyCodeWrap(value: boolean) {
    document.documentElement.dataset.codeWrap = String(value);
    wrapToggle.setAttribute("aria-checked", String(value));
  }
  wrapToggle.addEventListener("click", () => {
    const value = wrapToggle.getAttribute("aria-checked") !== "true";
    applyCodeWrap(value);
    wrapChanged(value);
  });
  applyCodeWrap(true);
  wrapping.append(wrapToggle);
  const choices = document.createElement("div");
  choices.className = "theme-picker-choices";
  choices.setAttribute("role", "radiogroup");
  choices.setAttribute("aria-label", "Editor theme");
  const buttons: HTMLButtonElement[] = [];
  let selected = findTheme(document.documentElement.dataset.editorTheme || document.documentElement.dataset.inlineTheme).id;
  for (const mode of ["light", "dark"]) {
    const section = document.createElement("section");
    section.className = "theme-picker-section";
    const heading = document.createElement("h3");
    heading.textContent = mode === "light" ? "Light" : "Dark";
    const grid = document.createElement("div");
    grid.className = "theme-picker-grid";
    for (const theme of THEMES.filter(theme => theme.mode === mode)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "theme-card";
      button.dataset.theme = theme.id;
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", theme.name + ", " + theme.mode);
      button.innerHTML = `<span class="theme-preview" data-theme-preview="${theme.id}" aria-hidden="true">
        <span class="theme-preview-heading">A little clarity.</span>
        <span class="theme-preview-line">Space for your next <span class="theme-preview-link">good idea.</span></span>
        <span class="theme-preview-code"><span>const</span> idea = <i>"begin"</i></span>
        <span class="theme-preview-table"><span>Notes</span><span>Status</span><span>Next chapter</span><span>Ready</span></span>
      </span><span class="theme-card-caption"><span class="theme-card-name">${theme.name}</span>
        <span class="theme-card-check" aria-hidden="true">✓</span></span>
      <span class="theme-card-description">${theme.description}</span>`;
      button.addEventListener("click", () => choose(theme.id));
      buttons.push(button);
      grid.append(button);
    }
    section.append(heading, grid);
    choices.append(section);
  }
  const footer = document.createElement("div");
  footer.className = "theme-picker-footer";
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  const done = document.createElement("button");
  done.type = "button"; done.textContent = "Done";
  footer.append(status, done);
  dialog.append(wrapping, choices, footer);
  document.body.append(dialog);
  trigger.setAttribute("aria-controls", dialog.id);
  const panel = new FloatingPanel(dialog, 4, () => {
    dialog.close();
    trigger.setAttribute("aria-expanded", "false");
  }, restore => {if (restore) trigger.focus({preventScroll: true});});
  function apply(value: string) {
    const theme = findTheme(value, document.body.classList.contains("vscode-light"));
    selected = theme.id;
    document.documentElement.dataset.editorTheme = theme.id;
    document.documentElement.dataset.inlineTheme = theme.mode;
    trigger.dataset.tooltip = "Editor settings · " + theme.name;
    for (const button of buttons) {
      const active = button.dataset.theme === selected;
      button.setAttribute("aria-checked", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    status.textContent = theme.name + " selected";
  }
  function choose(id: string) {
    if (selected === id) return;
    apply(id);
    changed(id);
  }
  const close = () => {panel.hide(); trigger.focus({preventScroll: true});};
  trigger.addEventListener("click", () => {
    if (dialog.open) {close(); return;}
    if (!panel.show()) return;
    dialog.showModal();
    trigger.setAttribute("aria-expanded", "true");
    dialog.scrollTop = 0;
    wrapToggle.focus({preventScroll: true});
  });
  dialog.querySelector(".theme-picker-close")!.addEventListener("click", close);
  done.addEventListener("click", close);
  dialog.addEventListener("cancel", event => {event.preventDefault(); close();});
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
  });
  dialog.addEventListener("keydown", event => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
      .filter(button => !button.disabled && button.tabIndex >= 0);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
  });
  choices.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const columns = getComputedStyle(dialog.querySelector(".theme-picker-grid")!).gridTemplateColumns.split(" ").length;
    const step = event.key === "ArrowUp" ? -columns : event.key === "ArrowDown" ? columns : event.key === "ArrowLeft" ? -1 : 1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + step + buttons.length) % buttons.length;
    buttons[next].focus();
    choose(buttons[next].dataset.theme!);
  });
  apply(selected);
  return {applyTheme: apply, applyCodeWrap};
}
