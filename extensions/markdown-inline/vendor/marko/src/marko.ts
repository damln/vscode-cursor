// Marko turns a textarea (or any element) into an inline Markdown editor.
// The Markdown text stays the source of truth: unchanged blocks keep their
// authored bytes, and syntax the visual editor cannot represent faithfully
// opens in source mode instead of being rewritten.
import {
  Editor, editorViewCtx, parserCtx, remarkCtx, remarkPluginsCtx, rootCtx, serializerCtx,
} from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import type { EditorView } from "@milkdown/kit/prose/view";
import { Selection, TextSelection } from "@milkdown/kit/prose/state";
import { configureEditor, getEditorPlugins } from "./plugins/editor-setup";
import { MARKO_COMMANDS, runCommand, type MarkoCommand } from "./plugins/commands";
import { openLinkEditor } from "./plugins/link-tooltip";
import { SourceMarkdown } from "./model/source-markdown";
import { joinPreservedFrontmatter } from "./model/markdown-model";
import { documentFrontmatter } from "./model/frontmatter";
import { applyExternalDocument } from "./model/external-document";
import { navigateHeading } from "./model/heading-navigation";
import { FrontmatterEditor } from "./frontmatter-editor";
import { defaultHost, registerScope, type MarkoHost, uniqueId } from "./scope";
import { isMarkoTheme, resolveTheme, type MarkoTheme } from "./themes";
import { installSkin, type MarkoSkin } from "./skins";

export type MarkoMode = "visual" | "source";
export type MarkoAppearance = "field" | "document";
export type MarkoMetadata = "auto" | "always" | "hidden";

export interface MarkoChange {
  /** True for single-character edits, useful for debouncing saves. */
  typing: boolean;
  origin: "visual" | "source" | "metadata";
}

export interface MarkoOptions extends Partial<MarkoHost> {
  /** Initial Markdown. Defaults to the textarea value or the element's text. */
  value?: string;
  theme?: MarkoTheme;
  /** Restyle this editor: extra CSS and variables on top of the default look, or a full redesign. */
  skin?: MarkoSkin;
  /** "field" is a bordered form control; "document" is a centered page for full-window editors. */
  appearance?: MarkoAppearance;
  readOnly?: boolean;
  spellcheck?: boolean;
  /** Drag handles and block selection in the left margin. */
  blockHandles?: boolean;
  /** Table of contents button in the top-right corner. */
  contents?: boolean;
  /** Front matter card: shown when present ("auto"), always offered ("always"), or preserved invisibly ("hidden"). */
  metadata?: MarkoMetadata;
  /** Keep undo history in the editor. Disable when the host owns undo, as VS Code does. */
  history?: boolean;
  codeWrap?: boolean;
  /** Accessible name for the editing area. Defaults to the textarea's label. */
  label?: string;
  onChange?: (markdown: string, change: MarkoChange) => void;
  onModeChange?: (mode: MarkoMode, reason: string) => void;
}

const UNSUPPORTED = "Source mode preserves syntax that cannot be represented faithfully in the visual editor.";

function labelFor(element: HTMLElement) {
  return element.getAttribute("aria-label")
    || (element instanceof HTMLTextAreaElement ? element.labels?.[0]?.textContent?.trim() : "")
    || "Markdown editor";
}

export class Marko {
  readonly element = document.createElement("div");
  readonly overlay = document.createElement("div");
  private surface = document.createElement("div");
  private editorRoot = document.createElement("div");
  private notice = document.createElement("p");
  private source: HTMLTextAreaElement;
  private ownsSource: boolean;
  private restore: () => void = () => {};
  private dispatching = false;
  private metadata: FrontmatterEditor | null = null;
  private metadataCard: HTMLElement | null = null;
  private editor: Editor | null = null;
  private model: SourceMarkdown | null = null;
  private text: string;
  private prefix = "";
  private body = "";
  private ready = false;
  private currentMode: MarkoMode = "visual";
  private theme: MarkoTheme;
  private skin: MarkoSkin | null;
  private readOnly: boolean;
  private updates = Promise.resolve();
  private abort = new AbortController();
  private unregister: () => void;
  private systemDark = matchMedia("(prefers-color-scheme: dark)");

  private constructor(private target: HTMLElement, private options: MarkoOptions) {
    this.theme = options.theme ?? "auto";
    this.skin = options.skin ?? null;
    this.readOnly = options.readOnly
      ?? (target instanceof HTMLTextAreaElement && (target.readOnly || target.disabled));
    if (target instanceof HTMLTextAreaElement) {
      this.source = target;
      this.ownsSource = false;
      this.text = options.value ?? target.value;
    } else {
      this.source = document.createElement("textarea");
      this.ownsSource = true;
      this.text = options.value ?? target.textContent ?? "";
    }
    this.build();
    const host: MarkoHost = {
      openLink: options.openLink ?? defaultHost.openLink,
      resolveImage: options.resolveImage ?? defaultHost.resolveImage,
      copyText: options.copyText ?? defaultHost.copyText,
      loadMermaid: options.loadMermaid,
    };
    this.unregister = registerScope({
      root: this.element, surface: this.surface, overlay: this.overlay, host,
      dark: () => this.element.dataset.markoScheme === "dark",
    });
  }

  /** Create an editor. A textarea keeps its name, form membership and value, and serves as source mode. */
  static async create(target: HTMLElement | string, options: MarkoOptions = {}) {
    const element = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
    if (!element) throw new Error(`Marko target not found: ${String(target)}`);
    const marko = new Marko(element, options);
    await marko.createEditor(null);
    return marko;
  }

  /** The current Markdown, including front matter. */
  get markdown() { return this.text; }
  get mode() { return this.currentMode; }
  /** The ProseMirror view, for advanced integrations. Null in source mode before the first visual load. */
  get view(): EditorView | null { return this.withCtx(ctx => ctx.get(editorViewCtx)) ?? null; }

  /** Replace the document, for example after an external file change. Emits no change event. */
  setMarkdown(markdown: string) {
    return this.enqueue(async () => {
      if (markdown === this.text) return;
      this.text = markdown;
      this.writeSource();
      if (this.currentMode === "visual") await this.updateEditor();
      else this.splitText();
    });
  }

  command(command: MarkoCommand) {
    if (!MARKO_COMMANDS.includes(command) || this.currentMode !== "visual" || this.readOnly) return false;
    return this.withCtx(ctx => runCommand(ctx, command)) ?? false;
  }

  focus(position: "start" | "end" | "preserve" = "preserve") {
    if (this.currentMode === "source") {
      this.source.focus();
      if (position !== "preserve") {
        const offset = position === "start" ? 0 : this.source.value.length;
        this.source.setSelectionRange(offset, offset);
      }
      return;
    }
    this.withCtx(ctx => {
      const view = ctx.get(editorViewCtx);
      if (position !== "preserve") {
        const selection = position === "start" ? Selection.atStart(view.state.doc) : Selection.atEnd(view.state.doc);
        view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
      }
      view.focus();
    });
  }

  /** Scroll to a heading by its GitHub-style slug. */
  navigateToHeading(slug: string) {
    return this.withCtx(ctx => navigateHeading(ctx.get(editorViewCtx), slug)) ?? false;
  }

  /** Show the Markdown source in the textarea. */
  showSource() {
    return this.enqueue(async () => this.enterSource(""));
  }

  /** Return to visual editing. Resolves false when the source needs source mode. */
  showVisual() {
    let switched = false;
    return this.enqueue(async () => {
      if (this.currentMode === "visual") { switched = true; return; }
      await this.createEditor(null);
      switched = this.mode === "visual";
    }).then(() => switched);
  }

  setTheme(theme: MarkoTheme) {
    if (!isMarkoTheme(theme)) throw new Error(`Unknown Marko theme: ${String(theme)}`);
    this.theme = theme;
    this.applyTheme();
  }

  /** Apply, replace or remove (null) this editor's skin. Behavior is unchanged. */
  setSkin(skin: MarkoSkin | null) {
    this.skin = skin;
    this.applyTheme();
  }

  setReadOnly(readOnly: boolean) {
    this.readOnly = readOnly;
    this.element.dataset.markoReadonly = String(readOnly);
    this.source.readOnly = readOnly;
    this.withCtx(ctx => ctx.get(editorViewCtx).setProps({editable: () => this.editable()}));
  }

  setCodeWrap(wrap: boolean) {
    this.element.dataset.markoCodeWrap = String(wrap);
  }

  /** Remove the editor and restore the original element. Resolves after the last pending update. */
  async destroy() {
    await this.updates;
    this.abort.abort();
    this.ready = false;
    await this.editor?.destroy();
    this.editor = null;
    this.metadata = null;
    this.unregister();
    this.overlay.remove();
    this.restore();
  }

  private build() {
    const {element, surface, overlay, source} = this;
    element.className = "marko";
    element.dataset.markoAppearance = this.options.appearance ?? "field";
    element.dataset.markoBlockHandles = String(this.options.blockHandles ?? true);
    element.dataset.markoReadonly = String(this.readOnly);
    element.dataset.markoCodeWrap = String(this.options.codeWrap ?? true);
    overlay.className = "marko-overlay";
    surface.className = "marko-surface";
    this.editorRoot.className = "marko-editor";
    this.editorRoot.setAttribute("aria-label", this.options.label ?? labelFor(this.target));
    const noticeId = uniqueId("marko-notice");
    this.notice.className = "marko-source-notice";
    this.notice.id = noticeId;
    this.notice.hidden = true;
    this.notice.setAttribute("role", "status");

    if (this.ownsSource) {
      // Mount inside the target element and give its children back on destroy.
      const children = Array.from(this.target.childNodes);
      source.setAttribute("aria-label", this.options.label ?? labelFor(this.target));
      this.target.replaceChildren(element);
      this.restore = () => this.target.replaceChildren(...children);
    } else {
      // The textarea moves inside the editor, so it stays in its form and becomes source mode.
      const {hidden, className} = source;
      const describedBy = source.getAttribute("aria-describedby");
      source.replaceWith(element);
      this.restore = () => {
        source.hidden = hidden;
        source.className = className;
        if (describedBy === null) source.removeAttribute("aria-describedby"); else source.setAttribute("aria-describedby", describedBy);
        source.value = this.text;
        element.replaceWith(source);
      };
    }
    source.classList.add("marko-source");
    source.hidden = true;
    source.readOnly = this.readOnly || source.readOnly;
    source.setAttribute("aria-describedby", noticeId);
    source.value = this.text;

    if ((this.options.metadata ?? "auto") !== "hidden") this.buildMetadata();
    surface.append(this.editorRoot);
    element.append(this.notice, surface, source);
    document.body.append(overlay);
    this.applyTheme();

    const signal = this.abort.signal;
    source.addEventListener("input", event => {
      if (this.currentMode !== "source" || this.dispatching) return;
      this.text = source.value;
      this.splitText();
      this.options.onChange?.(this.text, {typing: true, origin: "source"});
    }, {signal});
    source.form?.addEventListener("reset", () => {
      setTimeout(() => void this.setMarkdown(source.defaultValue));
    }, {signal});
    this.systemDark.addEventListener("change", () => this.applyTheme(), {signal});
    this.editorRoot.addEventListener("click", event => this.clickLink(event), {signal, capture: true});
  }

  private buildMetadata() {
    const card = document.createElement("section");
    card.className = "frontmatter-card";
    card.setAttribute("aria-label", "Metadata");
    card.hidden = true;
    const header = document.createElement("div");
    header.className = "frontmatter-header";
    const fields = document.createElement("div");
    fields.className = "frontmatter-fields";
    fields.id = uniqueId("marko-fields");
    const add = document.createElement("button");
    add.type = "button";
    add.className = "frontmatter-add";
    card.append(header, fields, add);
    this.surface.append(card);
    this.metadataCard = card;
    this.metadata = new FrontmatterEditor(card, fields, add, prefix => {
      this.prefix = prefix;
      this.text = joinPreservedFrontmatter(prefix, this.body);
      this.publish({typing: false, origin: "metadata"});
    });
  }

  private loadMetadata(prefix: string, eol: string) {
    if (!this.metadata || !this.metadataCard) return;
    this.metadata.load(prefix, eol);
    if ((this.options.metadata ?? "auto") === "auto") this.metadataCard.hidden = !prefix;
  }

  private applyTheme() {
    const theme = resolveTheme(this.theme, this.systemDark.matches);
    const scheme = this.skin?.scheme ?? theme.mode;
    if (this.skin) installSkin(this.skin);
    for (const element of [this.element, this.overlay]) {
      element.dataset.markoTheme = theme.id;
      element.dataset.markoScheme = scheme;
      element.style.colorScheme = scheme;
      if (this.skin) element.dataset.markoSkin = this.skin.id; else delete element.dataset.markoSkin;
      if (this.skin?.base === "none") element.dataset.markoBase = "none"; else delete element.dataset.markoBase;
    }
  }

  private editable() {
    return !this.readOnly && this.currentMode === "visual";
  }

  private withCtx<T>(action: (ctx: Ctx) => T): T | undefined {
    if (!this.editor || !this.ready) return undefined;
    let result: T | undefined;
    this.editor.action(ctx => { result = action(ctx); });
    return result;
  }

  private enqueue(task: () => Promise<void>) {
    this.updates = this.updates.then(task);
    return this.updates;
  }

  private splitText() {
    const split = documentFrontmatter(this.text);
    this.prefix = split.prefix;
    this.body = split.body;
    return split;
  }

  private writeSource() {
    if (this.source.value !== this.text) this.source.value = this.text;
  }

  private publish(change: MarkoChange) {
    this.writeSource();
    if (!this.ownsSource) {
      this.dispatching = true;
      try { this.source.dispatchEvent(new Event("input", {bubbles: true})); } finally { this.dispatching = false; }
    }
    this.options.onChange?.(this.text, change);
  }

  private parseWith(ctx: Ctx) {
    const remark = ctx.get(remarkCtx)();
    for (const entry of ctx.get(remarkPluginsCtx)) remark.use(entry.plugin, entry.options);
    return (value: string) => remark.parse(value);
  }

  private onVisualChange(markdown: string, previous: string, typing: boolean) {
    if (!this.ready || markdown === previous) return;
    try {
      this.body = this.model?.update(markdown) ?? markdown;
    } catch {
      // The edit cannot keep authored formatting; continue from the editor's canonical Markdown.
      this.body = markdown;
      this.withCtx(ctx => { this.model = new SourceMarkdown(markdown, markdown, this.parseWith(ctx)); });
    }
    const next = joinPreservedFrontmatter(this.prefix, this.body);
    if (next === this.text) return;
    this.text = next;
    this.publish({typing, origin: "visual"});
  }

  private async createEditor(snapshot: { selection: unknown; head: number; focused: boolean; scrollTop: number } | null) {
    this.ready = false;
    await this.editor?.destroy();
    this.editor = null;
    this.editorRoot.replaceChildren();
    const split = this.splitText();
    this.loadMetadata(split.prefix, split.eol);
    const editor = Editor.make()
      .config(ctx => ctx.set(rootCtx, this.editorRoot))
      .use(getEditorPlugins({
        blockHandles: this.options.blockHandles ?? true,
        contents: this.options.contents ?? false,
        history: this.options.history ?? true,
      }).flat());
    configureEditor(editor, {
      markdown: split.body,
      spellcheck: this.options.spellcheck ?? (!this.ownsSource && this.target.spellcheck),
      onChange: (markdown, previous, typing) => this.onVisualChange(markdown, previous, typing),
    });
    await editor.create();
    this.editor = editor;
    let supported = false;
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx);
      this.model = new SourceMarkdown(split.body, ctx.get(serializerCtx)(view.state.doc), this.parseWith(ctx));
      supported = this.model.supported;
    });
    this.ready = true;
    if (!supported) { this.enterSource(UNSUPPORTED); return; }
    this.setMode("visual", "");
    this.withCtx(ctx => ctx.get(editorViewCtx).setProps({editable: () => this.editable()}));
    if (snapshot) this.restoreSnapshot(snapshot);
  }

  private async updateEditor() {
    const split = documentFrontmatter(this.text);
    let applied = false;
    this.withCtx(ctx => {
      const next = ctx.get(parserCtx)(split.body);
      if (!next) return;
      const model = new SourceMarkdown(split.body, ctx.get(serializerCtx)(next), this.parseWith(ctx));
      if (!model.supported) return;
      applied = true;
      this.model = model;
      if (this.prefix !== split.prefix) this.loadMetadata(split.prefix, split.eol);
      this.prefix = split.prefix;
      this.body = split.body;
      const scroll = this.surface.scrollTop;
      applyExternalDocument(ctx.get(editorViewCtx), next);
      this.surface.scrollTop = scroll;
    });
    if (!applied) await this.createEditor(this.snapshot());
  }

  private enterSource(reason: string) {
    this.splitText();
    this.writeSource();
    this.withCtx(ctx => ctx.get(editorViewCtx).setProps({editable: () => false}));
    this.setMode("source", reason);
  }

  private setMode(mode: MarkoMode, reason: string) {
    const changed = mode !== this.currentMode;
    this.currentMode = mode;
    this.element.dataset.markoView = mode;
    this.surface.hidden = mode === "source";
    this.source.hidden = mode !== "source";
    this.notice.hidden = !reason;
    this.notice.textContent = reason;
    if (changed) this.options.onModeChange?.(mode, reason);
  }

  private snapshot() {
    return this.withCtx(ctx => {
      const view = ctx.get(editorViewCtx);
      return {selection: view.state.selection.toJSON(), head: view.state.selection.head, focused: view.hasFocus(), scrollTop: this.surface.scrollTop};
    }) ?? null;
  }

  private restoreSnapshot(snapshot: { selection: unknown; head: number; focused: boolean; scrollTop: number }) {
    this.withCtx(ctx => {
      const view = ctx.get(editorViewCtx);
      let selection: Selection;
      try {
        selection = Selection.fromJSON(view.state.doc, snapshot.selection);
      } catch {
        selection = Selection.near(view.state.doc.resolve(Math.max(0, Math.min(snapshot.head, view.state.doc.content.size))));
      }
      view.dispatch(view.state.tr.setSelection(selection));
      if (snapshot.focused) view.focus();
    });
    requestAnimationFrame(() => { this.surface.scrollTop = snapshot.scrollTop; });
  }

  /** Click a link to edit it; Shift+click opens it through the host. */
  private clickLink(event: MouseEvent) {
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!anchor || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      (this.options.openLink ?? defaultHost.openLink)(anchor.getAttribute("href") ?? "");
      return;
    }
    if (!this.editable()) return;
    this.withCtx(ctx => {
      const view = ctx.get(editorViewCtx);
      const link = view.state.schema.marks.link;
      if (!link) return;
      const max = view.state.doc.content.size;
      let start: number | null = null;
      try { start = view.posAtDOM(anchor, 0); } catch { /* fall back to pointer coordinates */ }
      const hit = view.posAtCoords({left: event.clientX, top: event.clientY})?.pos ?? null;
      const position = [start, start === null ? null : start + 1, hit, hit === null ? null : hit - 1]
        .find((candidate): candidate is number => candidate !== null && candidate > 0 && candidate < max &&
          view.state.doc.resolve(candidate).marks().some(mark => mark.type === link));
      if (position === undefined) return;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));
      view.focus();
      openLinkEditor(view);
    });
  }
}

/** Shorthand for {@link Marko.create}. */
export function createMarko(target: HTMLElement | string, options?: MarkoOptions) {
  return Marko.create(target, options);
}
