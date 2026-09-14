import { gitChanges, type GitChange } from './git-changes';

export interface RenderedBlock { from: number; to: number; element: HTMLElement }

export class GitGutter {
  private baseline: string | null = null;
  private changes: GitChange[] = [];
  private timer = 0;
  private frame = 0;
  private layer = document.createElement('div');
  private observer: ResizeObserver;
  private observed = new Set<HTMLElement>();

  constructor(private scroll: HTMLElement, private getText: () => string,
      private getBlocks: () => RenderedBlock[]) {
    this.layer.className = 'git-gutter';
    scroll.append(this.layer);
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(scroll);
    // Images, diagrams, metadata expansion and width changes all alter geometry.
    new MutationObserver(records => {
      if (records.some(record => !this.layer.contains(record.target) &&
          !(record.target instanceof Element && record.target.closest('.smooth-editor-caret')))) this.layout();
    }).observe(scroll, {childList: true, subtree: true, attributes: true,
      attributeFilter: ['hidden', 'style', 'class']});
    scroll.addEventListener('load', () => this.layout(), true);
    window.addEventListener('resize', () => this.layout());
  }

  setBaseline(text: string | null) { this.baseline = text; this.update(); }

  update() {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.changes = this.baseline === null ? [] : gitChanges(this.baseline, this.getText());
      this.layout();
    }, 100);
  }

  private layout() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  private draw() {
    this.layer.replaceChildren();
    const blocks = this.getBlocks();
    const elements = new Set(blocks.map(block => block.element));
    for (const element of this.observed) if (!elements.has(element)) this.observer.unobserve(element);
    for (const element of elements) if (!this.observed.has(element)) this.observer.observe(element);
    this.observed = elements;
    const origin = this.scroll.getBoundingClientRect().top - this.scroll.scrollTop;
    const markers = new Map<HTMLElement, {block: RenderedBlock; change: GitChange; boundary: boolean}>();
    for (const change of this.changes) {
      const overlapping = blocks.filter(block => change.from < block.to && change.to > block.from);
      const targets = overlapping.length ? overlapping
        : [blocks.find(block => block.to > change.from) ?? blocks.at(-1)].filter(Boolean) as RenderedBlock[];
      for (const block of targets) {
        // A deletion remains a separate boundary marker beside an edited block.
        if (change.kind === 'deleted') { this.marker(block, change, origin, true); continue; }
        const previous = markers.get(block.element);
        markers.set(block.element, {block, boundary: !overlapping.length,
          change: previous?.change.kind === 'modified' ? previous.change : change});
      }
    }
    for (const {block, change, boundary} of markers.values()) this.marker(block, change, origin, boundary);
  }

  private marker(block: RenderedBlock, change: GitChange, origin: number, boundary: boolean) {
    const rect = block.element.getBoundingClientRect();
    if (!rect.height) return;
    const marker = document.createElement('span');
    marker.className = 'git-change';
    marker.dataset.kind = change.kind;
    const atEnd = change.from >= block.to;
    marker.style.top = `${Math.max(0, (atEnd ? rect.bottom : rect.top) - origin)}px`;
    marker.style.height = `${boundary ? 6 : Math.max(6, rect.height)}px`;
    marker.title = `${change.kind[0].toUpperCase() + change.kind.slice(1)} since last commit (+${change.added} / −${change.removed} source lines)`;
    marker.setAttribute('role', 'img');
    marker.setAttribute('aria-label', marker.title);
    this.layer.append(marker);
  }
}
