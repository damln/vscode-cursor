import { FloatingPanel } from './floating-panel';
import type { MermaidResult } from './mermaid-loader';

const svg = (path: string) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
export function diagramButton(label: string, path: string, action: () => void) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'mermaid-button';
  button.setAttribute('aria-label', label); button.dataset.toolbarHint = label; button.innerHTML = svg(path);
  button.addEventListener('mousedown', event => event.preventDefault()); button.addEventListener('click', action);
  return button;
}

export class MermaidViewport {
  readonly element = document.createElement('div');
  readonly controls = document.createElement('div');
  private image = document.createElement('img');
  private status = document.createElement('span');
  private zoomIn: HTMLButtonElement;
  private zoomOut: HTMLButtonElement;
  private fitButton: HTMLButtonElement;
  private expand: HTMLButtonElement;
  private result?: MermaidResult;
  private scale = 1;
  private x = 0;
  private y = 0;
  private drag?: {id: number; x: number; y: number};
  private resize: ResizeObserver;
  private abort = new AbortController();
  private modal?: {dialog: HTMLDialogElement; panel: FloatingPanel};

  constructor() {
    const options = {signal: this.abort.signal};
    this.element.className = 'mermaid-viewport'; this.element.tabIndex = 0;
    this.element.setAttribute('role', 'region'); this.element.setAttribute('aria-label', 'Mermaid diagram. Drag to pan; use plus and minus to zoom, zero to fit.');
    this.image.alt = 'Mermaid diagram'; this.image.draggable = false; this.image.hidden = true;
    this.element.append(this.image);
    this.controls.className = 'mermaid-controls'; this.controls.setAttribute('role', 'group'); this.controls.setAttribute('aria-label', 'Diagram view');
    this.zoomOut = diagramButton('Zoom out', '<path d="M5 12h14"/>', () => this.zoom(this.scale / 1.25));
    this.zoomIn = diagramButton('Zoom in', '<path d="M5 12h14M12 5v14"/>', () => this.zoom(this.scale * 1.25));
    this.fitButton = diagramButton('Fit diagram', '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>', () => this.fit());
    this.expand = diagramButton('Full screen', '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>', () => this.open());
    const expandLabel = document.createElement('span'); expandLabel.textContent = 'Full screen'; this.expand.append(expandLabel); this.expand.classList.add('mermaid-button-labeled');
    this.status.className = 'mermaid-zoom'; this.status.setAttribute('aria-live', 'polite');
    this.controls.append(this.zoomOut, this.status, this.zoomIn, this.fitButton, this.expand);
    this.element.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !this.result) return;
      event.preventDefault(); this.element.focus({preventScroll: true});
      this.drag = {id: event.pointerId, x: event.clientX, y: event.clientY};
      this.element.setPointerCapture(event.pointerId); this.element.dataset.panning = 'true';
    }, options);
    this.element.addEventListener('pointermove', event => {
      if (this.drag?.id !== event.pointerId) return;
      this.x += event.clientX - this.drag.x; this.y += event.clientY - this.drag.y;
      this.drag.x = event.clientX; this.drag.y = event.clientY; this.paint();
    }, options);
    const end = () => {this.drag = undefined; delete this.element.dataset.panning;};
    this.element.addEventListener('pointerup', end, options);
    this.element.addEventListener('lostpointercapture', end, options);
    this.element.addEventListener('wheel', event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault(); this.zoom(this.scale * Math.exp(-event.deltaY * .005));
    }, {...options, passive: false});
    this.element.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (['+', '=', '-', '0'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === '0') this.fit(); else this.zoom(this.scale * (event.key === '-' ? .8 : 1.25));
      } else if (event.key.startsWith('Arrow')) {
        event.preventDefault(); event.stopPropagation();
        this.x += event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0;
        this.y += event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0; this.paint();
      }
    }, options);
    this.resize = new ResizeObserver(() => this.fit()); this.resize.observe(this.element);
    this.paint();
  }
  setDiagram(result?: MermaidResult) {
    if (!result) this.modal?.panel.hide();
    this.result = result; this.image.hidden = !result;
    if (result) {this.image.alt = result.description; this.element.style.height = `${Math.max(200, Math.min(440, result.height + 64))}px`; this.image.src = result.url; this.image.style.width = `${result.width}px`; this.image.style.height = `${result.height}px`;}
    else this.image.removeAttribute('src');
    this.fit();
  }
  private paint() {
    if (this.result) {
      const width = this.element.clientWidth, height = this.element.clientHeight;
      const limitX = (width + this.result.width * this.scale) / 2 - 32;
      const limitY = (height + this.result.height * this.scale) / 2 - 32;
      this.x = Math.max(-limitX, Math.min(limitX, this.x)); this.y = Math.max(-limitY, Math.min(limitY, this.y));
    }
    this.image.style.transform = `translate(${this.x}px, ${this.y}px) translate(-50%, -50%) scale(${this.scale})`;
    this.status.textContent = `${Math.round(this.scale * 100)}%`;
    this.zoomIn.disabled = !this.result || this.scale >= 8;
    this.zoomOut.disabled = !this.result || this.scale <= .05;
    this.fitButton.disabled = this.expand.disabled = !this.result;
  }
  private zoom(scale: number) { this.scale = Math.max(.05, Math.min(8, scale)); this.paint(); }
  private fit() {
    if (this.result && this.element.clientWidth) this.scale = Math.max(.05, Math.min(1,
      (this.element.clientWidth - 48) / this.result.width, (this.element.clientHeight - 48) / this.result.height));
    this.x = this.y = 0; this.paint();
  }
  private open() {
    if (!this.result || this.modal) return;
    const home = this.element.parentElement!, controlsHome = this.controls.parentElement!;
    const dialog = document.createElement('dialog'); dialog.className = 'mermaid-fullscreen';
    dialog.setAttribute('aria-label', 'Mermaid diagram viewer');
    const header = document.createElement('div'); header.className = 'mermaid-fullscreen-header';
    const title = document.createElement('span'); title.textContent = 'Mermaid';
    const close = diagramButton('Close full screen', '<path d="m6 6 12 12M6 18 18 6"/>', () => panel.hide());
    const help = document.createElement('span'); help.className = 'mermaid-help'; help.textContent = 'Drag to pan · + / − to zoom · 0 to fit · Esc to close';
    const panel = new FloatingPanel(dialog, 10, () => {
      dialog.close(); home.append(this.element); controlsHome.append(this.controls);
      this.expand.hidden = false; this.modal = undefined; this.fit(); this.expand.focus({preventScroll: true});
      setTimeout(() => panel.destroy(), 100);
    });
    header.append(title, this.controls, close); dialog.append(header, this.element, help); document.body.append(dialog);
    this.expand.hidden = true; this.modal = {dialog, panel}; panel.show(); dialog.showModal(); close.focus(); this.fit();
    dialog.addEventListener('cancel', event => {event.preventDefault(); panel.hide();});
  }
  destroy() {
    this.modal?.panel.hide(); this.abort.abort(); this.resize.disconnect(); this.element.remove(); this.controls.remove();
  }
}
