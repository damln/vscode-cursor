export type CopyTarget = 'document' | 'path' | 'folderPath';

/** Keeps asynchronous clipboard feedback inside the button's fixed icon slot. */
export class CopyFeedback {
  private sequence = 0;
  private pending = new Map<CopyTarget, string>();
  private timers = new Map<CopyTarget, number>();

  constructor(private buttons: Record<CopyTarget, HTMLButtonElement>, private status: HTMLElement) {}

  private clearTimer(target: CopyTarget) {
    window.clearTimeout(this.timers.get(target));
    this.timers.delete(target);
  }

  begin(target: CopyTarget) {
    this.clearTimer(target);
    const requestId = `copy-${++this.sequence}`;
    this.pending.set(target, requestId);
    const button = this.buttons[target];
    button.dataset.state = 'loading';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.dataset.tooltip = `${button.getAttribute('aria-label')}: copying…`;
    this.status.textContent = button.dataset.tooltip;
    this.timers.set(target, window.setTimeout(() => {
      this.finish(target, requestId, 'Clipboard did not respond. Try again.');
    }, 15000));
    return requestId;
  }

  isPending(target: CopyTarget, requestId: string) { return this.pending.get(target) === requestId; }

  cancelDocument(error: string) {
    const requestId = this.pending.get('document');
    if (requestId) this.finish('document', requestId, error);
  }

  finish(target: CopyTarget, requestId: string, error = '') {
    if (!this.isPending(target, requestId)) return;
    this.clearTimer(target);
    this.pending.delete(target);
    const button = this.buttons[target];
    const label = button.getAttribute('aria-label')!;
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.dataset.state = error ? 'error' : 'success';
    button.dataset.tooltip = error ? `${label}: ${error}` : `${label}: copied`;
    this.status.textContent = button.dataset.tooltip;
    // Errors stay visible until retry; successful actions remain immediately reusable.
    if (!error) this.timers.set(target, window.setTimeout(() => {
      delete button.dataset.state;
      button.dataset.tooltip = button.dataset.tooltipDefault || label;
      this.timers.delete(target);
    }, 1200));
  }
}
