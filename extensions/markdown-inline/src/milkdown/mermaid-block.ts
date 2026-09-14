import { loadMermaid } from './mermaid-loader';
import { diagramButton, MermaidViewport } from './mermaid-viewport';

export class MermaidBlock {
  private preview = document.createElement('div');
  private message = document.createElement('div');
  private viewport = new MermaidViewport();
  private toggle: HTMLButtonElement;
  private enabled = false;
  private editing = false;
  private source = '';
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private theme: MutationObserver;
  private visible: IntersectionObserver;
  private inView = false;
  private renderedSource?: string;
  private renderedDark?: boolean;

  constructor(private wrapper: HTMLElement, private bar: HTMLElement, private pre: HTMLElement, private edit: () => void) {
    this.preview.className = 'mermaid-preview'; this.preview.contentEditable = 'false'; this.preview.hidden = true;
    this.message.className = 'mermaid-message'; this.message.setAttribute('role', 'status');
    this.toggle = diagramButton('Edit diagram source', '<path d="m8 5-7 7 7 7m8-14 7 7-7 7m-3-16-2 18"/>', () => {
      this.setEditing(!this.editing);
      if (this.editing) this.edit(); else this.schedule();
    });
    const sourceLabel = document.createElement('span'); sourceLabel.textContent = 'Source'; this.toggle.append(sourceLabel);
    this.toggle.classList.add('mermaid-source-toggle', 'mermaid-button-labeled'); this.toggle.hidden = true;
    this.bar.insertBefore(this.toggle, this.bar.querySelector('.code-lang-actions'));
    this.preview.append(this.message, this.viewport.element); this.bar.append(this.viewport.controls);
    this.viewport.controls.hidden = true; this.wrapper.append(this.preview);
    this.theme = new MutationObserver(() => this.schedule());
    this.theme.observe(document.documentElement, {attributes: true, attributeFilter: ['data-inline-theme']});
    this.theme.observe(document.body, {attributes: true, attributeFilter: ['class']});
    this.visible = new IntersectionObserver(entries => {
      this.inView = entries.some(entry => entry.isIntersecting);
      if (this.inView) this.schedule();
    }, {rootMargin: '300px'});
    this.visible.observe(wrapper);
  }
  update(language: string, source: string) {
    const wasEnabled = this.enabled;
    this.enabled = language.trim().toLowerCase() === 'mermaid';
    if (this.source !== source || wasEnabled !== this.enabled) this.generation++;
    this.source = source;
    this.wrapper.classList.toggle('mermaid-block', this.enabled);
    this.preview.hidden = this.toggle.hidden = this.viewport.controls.hidden = !this.enabled;
    if (!this.enabled) {
      clearTimeout(this.timer); this.pre.hidden = false; this.renderedSource = undefined;
      this.viewport.setDiagram(); return;
    }
    if (!wasEnabled) this.setEditing(!source.trim());
    this.pre.hidden = !this.editing;
    this.schedule();
  }
  revealSource() { if (this.enabled && !this.editing) this.setEditing(true); }
  private setEditing(editing: boolean) {
    this.editing = editing; this.pre.hidden = !editing;
    this.toggle.setAttribute('aria-pressed', String(editing));
    const label = editing ? 'Hide diagram source' : 'Edit diagram source';
    this.toggle.setAttribute('aria-label', label); this.toggle.dataset.toolbarHint = label;
  }
  private dark() {
    const theme = document.documentElement.dataset.inlineTheme;
    return theme === 'dark' || (theme === 'auto' && !document.body.classList.contains('vscode-light'));
  }
  private schedule() {
    clearTimeout(this.timer);
    if (!this.enabled || !this.inView || this.disposed) return;
    if (this.renderedSource === this.source && this.renderedDark === this.dark()) return;
    const generation = ++this.generation;
    this.timer = setTimeout(() => void this.render(generation), 250);
  }
  private async render(generation: number) {
    const current = () => !this.disposed && this.enabled && generation === this.generation;
    const source = this.source, dark = this.dark();
    this.preview.dataset.state = 'loading'; this.preview.setAttribute('aria-busy', 'true');
    this.message.hidden = false; this.message.textContent = 'Rendering diagram…';
    try {
      if (!source.trim()) throw new Error('Add Mermaid code to preview your diagram.');
      if (source.length > 50000) throw new Error('This diagram is too large to preview (50,000 character limit).');
      const render = await loadMermaid();
      if (!current()) return;
      const result = await render(source, dark);
      if (!current()) return;
      this.renderedSource = source; this.renderedDark = dark;
      this.viewport.setDiagram(result); this.message.hidden = true; this.preview.dataset.state = 'ready';
    } catch (error) {
      if (!current()) return;
      this.viewport.setDiagram(); this.preview.dataset.state = 'error';
      this.message.textContent = error instanceof Error ? error.message.slice(0, 500) : 'Could not render this diagram. Check the source.';
      this.setEditing(true);
    } finally { if (current()) this.preview.removeAttribute('aria-busy'); }
  }
  contains(target: Node) { return this.preview.contains(target); }
  destroy() {
    this.disposed = true; this.generation++; clearTimeout(this.timer); this.theme.disconnect(); this.visible.disconnect();
    this.viewport.destroy(); this.preview.remove(); this.toggle.remove();
  }
}
