const KEY = 'markdownInline.recoveryDrafts';

class DraftStore {
  constructor(state) { this.state = state; this.drafts = state.get(KEY, {}); this.pending = Promise.resolve(); }
  async retain(uri, session, draft) {
    if (draft) this.drafts[uri] = { ...(this.drafts[uri] || {}), [session]: draft };
    else if (this.drafts[uri]) {
      delete this.drafts[uri][session];
      if (!Object.keys(this.drafts[uri]).length) delete this.drafts[uri];
    }
    const snapshot = structuredClone(this.drafts);
    const write = this.pending.then(() => this.state.update(KEY, snapshot));
    this.pending = write.catch(() => {});
    await write;
  }
  async transfer(uri, owner, session, draft) {
    if (owner === session) return;
    delete this.drafts[uri]?.[owner];
    await this.retain(uri, session, draft);
  }
  recover(uri, session, activeSessions, currentText) {
    const drafts = this.drafts[uri] || {};
    const useful = id => drafts[id] && drafts[id].text !== drafts[id].baseText && drafts[id].text !== currentText;
    const owner = useful(session) ? session : Object.keys(drafts).find(id => !activeSessions.has(id) && useful(id));
    return owner ? { owner, draft: drafts[owner] } : null;
  }
}
module.exports = { DraftStore };
