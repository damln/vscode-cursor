export interface DocumentUpdate {
  type: 'update' | 'editResult';
  version: number;
  text: string;
  dirty: boolean;
  recoveredDraft?: Draft;
  requestId?: string;
  status?: 'applied' | 'conflict' | 'error';
  error?: string;
}
interface Edit { type: 'edit'; requestId: string; version: number; text: string }
export interface Draft { text: string; baseText: string; conflicted?: boolean; sourceError?: string }

/** One outstanding request; a divergent host update never replaces a local draft. */
export class SyncClient {
  text = '';
  baseText = '';
  version = -1;
  dirty = false;
  inFlight: Edit | null = null;
  error = '';
  conflicted = false;
  sourceError = '';
  private restoring = false;
  private sequence = 0;
  private restored: Draft | null;
  constructor(private session: string, draft: Draft | null = null) { this.restored = draft?.text === draft?.baseText ? null : draft; }
  get pending() { return this.text !== this.baseText || this.inFlight !== null; }
  get draft(): Draft | null { return this.text !== this.baseText ? { text: this.text, baseText: this.baseText, conflicted: this.conflicted, ...(this.sourceError ? {sourceError: this.sourceError} : {}) } : null; }
  edit(text: string) { this.text = text; }
  next(): Edit | null {
    if (this.version < 0 || this.error || this.inFlight || this.text === this.baseText) return null;
    this.inFlight = { type: 'edit', requestId: `${this.session}:${++this.sequence}`, version: this.version, text: this.text };
    return this.inFlight;
  }
  receive(message: DocumentUpdate): boolean {
    const oldText = this.text;
    const matching = message.type === 'editResult' && message.requestId === this.inFlight?.requestId;
    if (message.type === 'editResult' && !matching) return false;
    if (this.version < 0) {
      this.restored ??= message.recoveredDraft?.text !== message.recoveredDraft?.baseText ? message.recoveredDraft ?? null : null;
      this.text = this.restored?.text ?? message.text;
      this.baseText = this.restored?.baseText ?? message.text;
      if (this.restored && this.text !== message.text && (this.restored.conflicted || this.baseText !== message.text)) {
        this.conflicted = true;
        this.error = 'A recovered draft differs from the file. Compare both versions.';
      }
      if (!this.conflicted && this.text !== message.text && this.restored?.sourceError) {
        this.sourceError = this.restored.sourceError;
        this.error = this.sourceError;
      }
      this.restored = null;
    }
    if (matching && this.restoring) {
      this.restoring = false;
      if (message.status === 'applied' && message.version >= this.version) {
        this.conflicted = false; this.sourceError = ''; this.error = '';
      }
    }
    if (this.conflicted && message.version >= this.version && message.text === this.text &&
        (message.type === 'update' || message.status === 'applied')) {
      this.conflicted = false; this.sourceError = ''; this.error = '';
    }
    const localPending = this.text !== this.baseText;
    if (message.version >= this.version) {
      const ownUpdate = message.text === this.inFlight?.text;
      if (localPending && message.text !== this.baseText && message.text !== this.text && !ownUpdate) {
        this.conflicted = true;
        this.error = 'The file changed while you were editing. Your draft is retained.';
      }
      this.version = message.version;
      this.baseText = message.text;
      this.dirty = message.dirty;
      if (!localPending && !this.inFlight && !this.error) this.text = message.text;
    }
    if (matching) {
      if (message.status !== 'applied') {
        this.conflicted ||= message.status === 'conflict';
        this.error = message.error || 'The edit was not accepted. Your draft is retained.';
      }
      this.inFlight = null;
    }
    return oldText !== this.text;
  }
  retainSource(text: string, error: string) {
    this.text = text; this.sourceError = error;
    if (!this.conflicted) this.error = error;
  }
  sourceSucceeded() {
    if (this.error === this.sourceError && !this.conflicted) this.error = '';
    this.sourceError = '';
  }
  restoreRequest() {
    if (this.inFlight || this.version < 0) return null;
    this.restoring = true;
    this.inFlight = {type: 'edit', requestId: `${this.session}:${++this.sequence}`, version: this.version, text: this.text};
    return {...this.inFlight, type: 'restoreDraft'};
  }
  disconnected() { this.error = 'VS Code has not acknowledged this edit. Your draft is retained.'; }
  retry() { if (!this.conflicted && !this.sourceError) { this.inFlight = null; this.error = ''; } }
  useFile() { this.sourceError = ''; this.conflicted = false; this.text = this.baseText; this.inFlight = null; this.error = ''; }
}
