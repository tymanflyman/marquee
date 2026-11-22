'use strict';
// Marquee: a custom front end for Jellyfin. Zero dependencies.
// Serves the app and passes /jf/* through to Jellyfin, so the browser only ever talks to one address.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8098);
const JELLYFIN = new URL(process.env.JELLYFIN_URL || 'http://host.docker.internal:8097');
const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};
const lib = JELLYFIN.protocol === 'https:' ? https : http;
const agent = new lib.Agent({ keepAlive: true, maxSockets: 64 });
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'host']);

function proxy(req, res, rest) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v;
  headers.host = JELLYFIN.host;
  const fwd = req.headers['x-forwarded-for'];
  headers['x-forwarded-for'] = fwd ? `${fwd}, ${req.socket.remoteAddress}` : req.socket.remoteAddress;
  const base = JELLYFIN.pathname.replace(/\/$/, '');
  const up = lib.request({
    protocol: JELLYFIN.protocol, hostname: JELLYFIN.hostname, port: JELLYFIN.port, agent,
    method: req.method, path: base + rest, headers,
  }, (r) => {
    const out = {};
    for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k)) out[k] = v;
    res.writeHead(r.statusCode, out);
    r.pipe(res);
    res.on('close', () => r.destroy());
  });
  up.on('error', (e) => {
    console.error('jellyfin unreachable:', e.message);
    if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":"Jellyfin unreachable"}'); } else res.destroy();
  });
  req.on('aborted', () => up.destroy());
  req.pipe(up);
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  let file = path.normalize(path.join(PUBLIC, rel));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  // Unknown paths without an extension are app routes: send the app.
  if (!path.extname(file)) file = path.join(PUBLIC, 'index.html');
  const type = TYPES[path.extname(file)];
  fs.stat(file, (err, st) => {
    if (err || !st.isFile() || !type) { res.writeHead(404); return res.end('not found'); }
    const cache = file.includes(`${path.sep}vendor${path.sep}`) ? 'public, max-age=2592000' : 'no-cache';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cache });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/jf' || url.pathname.startsWith('/jf/')) return proxy(req, res, req.url.slice(3) || '/');
    if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
    res.writeHead(405); res.end();
  } catch (e) {
    console.error(req.method, req.url, e.message);
    if (!res.headersSent) { res.writeHead(400); res.end(); } else res.destroy();
  }
});

// The updater container pulls new code. Exiting lets Docker restart this server on it.
function gitHead() {
  try {
    const git = path.join(__dirname, '.git');
    const ref = fs.readFileSync(path.join(git, 'HEAD'), 'utf8').trim().replace(/^ref: /, '');
    return fs.readFileSync(path.join(git, ref), 'utf8').trim();
  } catch { return null; }
}
const startedOn = gitHead();
setInterval(() => {
  const now = gitHead();
  if (now && now !== startedOn) { console.log(`updating to ${now.slice(0, 7)}`); process.exit(0); }
}, 20000).unref();

process.on('SIGTERM', () => process.exit(0));
server.listen(PORT, () => console.log(`Marquee on :${PORT}, Jellyfin at ${JELLYFIN.href}`));
