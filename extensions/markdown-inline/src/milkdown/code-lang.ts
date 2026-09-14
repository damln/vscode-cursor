import { MermaidBlock } from "./mermaid-block";
import { codeGutter } from "./code-gutter";
import { copyCode } from "../lib/code-clipboard";
import { Selection, TextSelection } from "@milkdown/kit/prose/state";
import { FloatingPanel, positionMenu } from "./floating-panel";
import { $view } from "@milkdown/kit/utils";
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import { ICON_CHEVRON_DOWN, ICON_COPY, ICON_COPY_SUCCESS, ICON_TRASH, ICON_ERASER } from "./icons";

export const codeBlockLangView = $view(codeBlockSchema.node, () => {
  return (node: any, view: any, getPos: any) => {
    // Wrapper
    const wrapper = document.createElement("div");
    wrapper.className = "code-lang-wrapper";

    // Top bar
    const bar = document.createElement("div");
    bar.className = "code-lang-bar";
    bar.contentEditable = "false";

    // Language trigger button
    const trigger = document.createElement("button");
    trigger.className = "code-lang-trigger";
    const langName = document.createElement("span");
    langName.textContent = node.attrs.language || "plain";
    const chevron = document.createElement("span");
    chevron.className = "code-lang-chevron";
    chevron.innerHTML = ICON_CHEVRON_DOWN;
    trigger.append(langName, chevron);
    trigger.setAttribute("aria-label", "Code language");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");

    // Actions
    const actions = document.createElement("div");
    actions.className = "code-lang-actions";

    // Copy button
    const copyBtn = document.createElement("button");
    copyBtn.className = "code-lang-action-btn";
    copyBtn.innerHTML = ICON_COPY;
    copyBtn.title = "Copy code";
    let disposed = false;
    let copyController: AbortController | null = null;
    let copyReset: ReturnType<typeof setTimeout> | undefined;
    const copyStatus = document.createElement("span");
    copyStatus.className = "visually-hidden";
    copyStatus.setAttribute("role", "status");
    copyStatus.setAttribute("aria-live", "polite");
    copyBtn.addEventListener("click", async () => {
      if (disposed || copyController) return;
      clearTimeout(copyReset);
      copyController = new AbortController();
      copyBtn.disabled = true;
      copyBtn.setAttribute("aria-busy", "true");
      copyBtn.dataset.state = "loading";
      copyBtn.title = "Copying code…";
      copyStatus.textContent = copyBtn.title;
      copyBtn.innerHTML = '<svg class="code-copy-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3a9 9 0 1 1-9 9"/></svg>';
      try {
        await copyCode(node.textContent, copyController.signal);
        if (disposed) return;
        copyBtn.dataset.state = "success";
        copyBtn.innerHTML = ICON_COPY_SUCCESS;
        copyBtn.title = "Code copied";
        copyStatus.textContent = copyBtn.title;
        copyReset = setTimeout(() => {
          copyBtn.innerHTML = ICON_COPY; copyBtn.title = "Copy code"; delete copyBtn.dataset.state;
        }, 1500);
      } catch (error) {
        if (disposed) return;
        copyBtn.dataset.state = "error";
        copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></svg>';
        copyBtn.title = error instanceof Error ? error.message : "Could not copy code. Try again.";
        copyStatus.textContent = copyBtn.title;
      } finally {
        copyController = null;
        if (!disposed) { copyBtn.disabled = false; copyBtn.removeAttribute("aria-busy"); }
      }
    });

    // Clear button
    const clearBtn = document.createElement("button");
    clearBtn.className = "code-lang-action-btn";
    clearBtn.innerHTML = ICON_ERASER;
    clearBtn.title = "Clear code";
    clearBtn.disabled = !node.textContent;
    clearBtn.addEventListener("click", () => {
      if (disposed || !view.editable || !node.textContent) return;
      const pos = getPos();
      if (pos == null) return;
      const tr = view.state.tr.insertText("", pos + 1, pos + node.nodeSize - 1);
      view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView());
      view.focus();
    });

    // Delete button
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "code-lang-action-btn code-lang-action-btn--danger";
    deleteBtn.innerHTML = ICON_TRASH;
    deleteBtn.title = "Delete block";
    deleteBtn.addEventListener("click", () => {
      if (disposed || !view.editable) return;
      const pos = getPos();
      if (pos == null) return;
      const tr = view.state.tr.delete(pos, pos + node.nodeSize);
      view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)))).scrollIntoView());
      view.focus();
    });

    for (const button of [trigger, copyBtn, clearBtn, deleteBtn]) {
      button.type = "button";
      if (button.title) button.setAttribute("aria-label", button.title);
      button.addEventListener("mousedown", event => event.preventDefault());
    }
    actions.append(copyBtn, clearBtn, deleteBtn);
    bar.append(trigger, actions, copyStatus);

    // Pre + code (contentDOM)
    const pre = document.createElement("pre");
    pre.className = "code-with-gutter";

    // Line number gutter
    const gutter = document.createElement("div");
    gutter.className = "code-gutter";

    const code = document.createElement("code");
    pre.append(gutter, code);
    wrapper.append(bar, pre);
    const disposeGutter = codeGutter(code, gutter);

    const mermaid = new MermaidBlock(wrapper, bar, pre, () => {
      const pos = getPos();
      if (disposed || !view.editable || pos == null) return;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)));
      view.focus();
    });
    const revealSource = () => {
      const pos = getPos();
      if (!disposed && pos != null && view.hasFocus() && view.state.selection.from > pos && view.state.selection.to < pos + node.nodeSize) mermaid.revealSource();
    };
    document.addEventListener('selectionchange', revealSource);

    function updateGutter() {
      clearBtn.disabled = !node.textContent;
      clearBtn.title = clearBtn.disabled ? "Code is already empty" : "Clear code";
    }
    updateGutter();
    mermaid.update(node.attrs.language || "", node.textContent);

    const dd = document.createElement("div");
    dd.className = "code-lang-dropdown";
    dd.setAttribute("role", "dialog");
    dd.setAttribute("aria-label", "Choose code language");
    const panel = new FloatingPanel(dd, 3, () => trigger.setAttribute("aria-expanded", "false"), restore => close(restore));
    const search = document.createElement("input");
    search.className = "code-lang-search";
    search.placeholder = "Search languages";
    search.setAttribute("aria-label", "Search languages");
    const list = document.createElement("div");
    list.className = "code-lang-list";
    const languages = ["plain", "javascript", "typescript", "python", "ruby", "elixir",
      "rust", "go", "java", "bash", "css", "html", "json", "yaml", "toml", "sql",
      "markdown", "docker", "mermaid", "c", "cpp"];
    function close(restore = false) { panel.hide(); if (restore) trigger.focus(); }
    function renderList() {
      list.replaceChildren();
      for (const lang of languages.filter(value => value.includes(search.value.toLowerCase()))) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "code-lang-item";
        button.textContent = lang;
        button.setAttribute("aria-pressed", String(lang === (node.attrs.language || "plain")));
        button.addEventListener("click", () => {
          const pos = getPos();
          if (disposed || pos == null || !view.editable) return;
          view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, {...node.attrs, language: lang === "plain" ? "" : lang}));
          close(true);
        });
        list.append(button);
      }
      if (!list.childElementCount) list.textContent = "No matching language";
    }
    search.addEventListener("input", renderList);
    dd.append(search, list);
    document.body.append(dd);
    const position = () => { if (trigger.getAttribute("aria-expanded") === "true") positionMenu(dd, trigger.getBoundingClientRect()); };
    trigger.addEventListener("click", () => {
      if (disposed || !view.editable) return;
      if (trigger.getAttribute("aria-expanded") === "true") { close(); return; }
      search.value = ""; renderList();
      panel.show(); trigger.setAttribute("aria-expanded", "true"); position(); search.focus();
    });
    dd.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
      const buttons = Array.from(list.querySelectorAll("button"));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      let target: HTMLButtonElement | HTMLInputElement | undefined;
      if (event.key === "ArrowDown") target = buttons[Math.min(index + 1, buttons.length - 1)];
      if (event.key === "ArrowUp") target = index <= 0 ? search : buttons[index - 1];
      if (event.target !== search && event.key === "Home") target = buttons[0];
      if (event.target !== search && event.key === "End") target = buttons.at(-1);
      if (event.target === search && event.key === "Enter") { event.preventDefault(); buttons[0]?.click(); }
      if (target) { event.preventDefault(); target.focus(); }
    });
    const outside = (event: Event) => {
      if (event.target instanceof Node && !dd.contains(event.target) && !trigger.contains(event.target)) close();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);

    return {
      dom: wrapper,
      contentDOM: code,
      stopEvent: (event: Event) => event.target instanceof Node && (bar.contains(event.target) || mermaid.contains(event.target)),
      ignoreMutation: (mutation: MutationRecord | {type: "selection"}) =>
        mutation.type !== "selection" && !code.contains(mutation.target),
      update: (updatedNode: any) => {
        if (updatedNode.type.name !== "code_block") return false;
        node = updatedNode;
        langName.textContent = updatedNode.attrs.language || "plain";
        updateGutter();
        mermaid.update(node.attrs.language || "", node.textContent);
        return true;
      },
      destroy: () => {
        disposed = true; copyController?.abort(); clearTimeout(copyReset);
        disposeGutter();
        mermaid.destroy(); document.removeEventListener("selectionchange", revealSource);
        panel.destroy();
        document.removeEventListener("mousedown", outside);
        document.removeEventListener("scroll", position, true);
        window.removeEventListener("resize", position);
      },
    };
  };
});
