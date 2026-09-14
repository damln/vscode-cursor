export interface DeferredAction { type: string; flushId?: string; offset?: number; requestId?: string; error?: string }
export class FlushActions {
  private actions: DeferredAction[] = [];
  enqueue(action: DeferredAction) { this.actions.push(action); }
  drain(pending: boolean, error: string, send: (action: DeferredAction) => void) {
    if (error) {
      const actions = this.actions; this.actions = [];
      for (const action of actions) {
        if (action.type === 'flushComplete') send({...action, error});
        else if (action.type === 'save') send({type: 'saveBlocked', error});
      }
      return;
    }
    if (pending) return;
    const actions = this.actions;
    this.actions = [];
    for (const action of actions) send(action);
  }
}
