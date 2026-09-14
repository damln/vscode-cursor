const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const TYPES = {
  '.html':'text/html; charset=utf-8', '.htm':'text/html; charset=utf-8',
  '.css':'text/css', '.js':'text/javascript', '.mjs':'text/javascript',
  '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp',
  '.avif':'image/avif', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2',
  '.ttf':'font/ttf', '.otf':'font/otf', '.mp4':'video/mp4', '.webm':'video/webm',
  '.mp3':'audio/mpeg', '.wav':'audio/wav', '.pdf':'application/pdf', '.wasm':'application/wasm',
};
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

// HTTP guarantees a browser opens, even when .html files are associated with an editor.
// Bound to loopback only; each explicitly opened workspace gets an unguessable URL.
class BrowserPreview {
  constructor() { this.sessions = new Map(); }
  async url(file, root) {
    root = await fs.realpath(root);
    file = await fs.realpath(file);
    if (!inside(root, file)) throw new Error('The HTML file is outside its preview folder.');
    let session = this.sessions.get(root);
    if (!session) {
      session = this.start(root);
      this.sessions.set(root, session);
      session.catch(() => this.sessions.delete(root));
    }
    const { origin, token } = await session;
    return `${origin}/${token}/${path.relative(root, file).split(path.sep).map(encodeURIComponent).join('/')}`;
  }
  async start(root) {
    const token = randomBytes(24).toString('hex');
    let origin;
    const server = http.createServer(async (request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      try {
        if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
        if (`http://${request.headers.host}` !== origin || (request.headers.origin && request.headers.origin !== origin)) {
          response.writeHead(403).end(); return;
        }
        const url = new URL(request.url, origin);
        const prefix = `/${token}/`;
        if (!url.pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
        const relative = decodeURIComponent(url.pathname.slice(prefix.length));
        if (relative.includes('\\') || relative.split('/').some(part => part.startsWith('.'))) {
          response.writeHead(404).end(); return;
        }
        const target = await fs.realpath(path.join(root, relative));
        const type = TYPES[path.extname(target).toLowerCase()];
        if (!inside(root, target) || !type || !(await fs.stat(target)).isFile()) {
          response.writeHead(404).end(); return;
        }
        const body = await fs.readFile(target);
        response.writeHead(200, {'Content-Type':type, 'Content-Length':body.length});
        response.end(request.method === 'HEAD' ? undefined : body);
      } catch { response.writeHead(404).end(); }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
    return { server, origin, token };
  }
  dispose() {
    for (const session of this.sessions.values()) session.then(({server}) => {server.closeAllConnections(); server.close();}, () => {});
    this.sessions.clear();
  }
}
module.exports = { BrowserPreview };
