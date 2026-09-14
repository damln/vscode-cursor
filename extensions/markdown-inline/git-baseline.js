// Read-only access to VS Code's built-in Git extension API.
class GitBaseline {
  constructor(vscode, uri, publish) {
    this.vscode = vscode;
    this.uri = uri;
    this.publish = publish;
    this.subscriptions = [];
    this.generation = 0;
  }

  async start() {
    if (this.started || this.disposed) return;
    this.started = true;
    try {
      const extension = this.vscode.extensions?.getExtension('vscode.git');
      if (!extension) return;
      const exports = await extension.activate();
      if (this.disposed) return;
      this.api = exports.getAPI(1);
      for (const event of ['onDidOpenRepository', 'onDidCloseRepository', 'onDidChangeState']) {
        if (this.api[event]) this.subscriptions.push(this.api[event](() => this.schedule()));
      }
      this.schedule();
    } catch { /* Git may be disabled or unavailable in this extension host. */ }
  }

  schedule() {
    if (this.disposed) return;
    this.generation++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), 100);
  }

  async refresh() {
    if (this.disposed || !this.api) return;
    const generation = this.generation;
    let text = null;
    try {
      const repository = this.api.getRepository(this.uri);
      if (repository !== this.repository) {
        this.repositorySubscription?.dispose();
        this.repository = repository;
        this.repositorySubscription = repository?.state.onDidChange(() => this.schedule());
      }
      if (repository) {
        const changes = [...repository.state.indexChanges, ...repository.state.workingTreeChanges,
          ...(repository.state.untrackedChanges || [])];
        const change = changes.find(item => item.uri.toString() === this.uri.toString());
        // INDEX_ADDED, UNTRACKED, INTENT_TO_ADD. Ignored files remain undecorated.
        if (change && [1, 7, 9].includes(change.status)) text = '';
        else {
          const original = change?.originalUri || this.uri;
          text = await repository.show('HEAD', original.fsPath);
        }
      }
    } catch { /* No HEAD, unreadable objects and non-repository files have no baseline. */ }
    if (!this.disposed && generation === this.generation) {
      this.publish({type: 'gitBaseline', text});
    }
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    clearTimeout(this.timer);
    this.repositorySubscription?.dispose();
    this.subscriptions.forEach(subscription => subscription.dispose());
  }
}
module.exports = { GitBaseline };
