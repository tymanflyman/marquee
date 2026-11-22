'use strict';
// Marquee: a custom front end for Jellyfin. Zero dependencies.
// Serves the app and passes /jf/* through to Jellyfin, so the browser only ever talks to one address.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8098);
const JELLYFIN = new URL(process.env.JELLYFIN_URL || 'http://host.docker.internal:8096');
const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};
const CONFIG_DIR = process.env.CONFIG_DIR || '/config';
const TMDB_BASE = process.env.TMDB_BASE || 'https://api.themoviedb.org/3';
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

/* ---------- TMDB filmography ---------- */
// The key lives in /config/tmdb-key (or TMDB_API_KEY), so it stays out of git. Either a v3 key or a v4 read token works.
function tmdbKey() {
  try { return fs.readFileSync(path.join(CONFIG_DIR, 'tmdb-key'), 'utf8').trim(); } catch { return (process.env.TMDB_API_KEY || '').trim(); }
}
const tmdbCache = new Map();
async function tmdb(pathname, params = {}) {
  const key = tmdbKey();
  const url = new URL(TMDB_BASE + pathname);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { Accept: 'application/json' };
  if (key.length > 40) headers.Authorization = `Bearer ${key}`; else url.searchParams.set('api_key', key);
  const cached = tmdbCache.get(url.href);
  if (cached && cached.at > Date.now() - 24 * 3600e3) return cached.data;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
  if (r.status === 401) throw Object.assign(new Error('TMDB rejected the key'), { reason: 'badkey' });
  if (!r.ok) throw new Error(`TMDB said ${r.status}`);
  const data = await r.json();
  tmdbCache.set(url.href, { at: Date.now(), data });
  if (tmdbCache.size > 500) tmdbCache.delete(tmdbCache.keys().next().value);
  return data;
}
// Talk shows, news, awards and "Himself" cameos crowd out the real roles.
const SKIP_GENRES = new Set([10767, 10763]);
const SELF = /\b(self|himself|herself|themselves|narrator \(voice\) - self)\b/i;
function credit(c, role) {
  const date = c.release_date || c.first_air_date || '';
  return {
    id: c.id, type: c.media_type, title: c.title || c.name, date, year: date ? Number(date.slice(0, 4)) : null,
    role, poster: c.poster_path || null, episodes: c.episode_count || null, popularity: c.popularity || 0,
  };
}
function merge(list) {
  const byKey = new Map();
  for (const c of list) {
    const k = c.type + c.id;
    const had = byKey.get(k);
    if (!had) byKey.set(k, c);
    else if (c.role && had.role && !had.role.split(' / ').includes(c.role)) had.role += ' / ' + c.role;
  }
  return [...byKey.values()].sort((a, b) => (b.date || '0').localeCompare(a.date || '0'));
}
async function person(q) {
  if (!tmdbKey()) return { ok: false, reason: 'nokey' };
  let id = /^\d+$/.test(q.get('tmdb') || '') ? q.get('tmdb') : null;
  if (!id && q.get('imdb')) id = (await tmdb(`/find/${encodeURIComponent(q.get('imdb'))}`, { external_source: 'imdb_id' })).person_results?.[0]?.id;
  if (!id && q.get('name')) id = (await tmdb('/search/person', { query: q.get('name') })).results?.[0]?.id;
  if (!id) return { ok: false, reason: 'notfound' };
  const [info, cc] = await Promise.all([tmdb(`/person/${id}`), tmdb(`/person/${id}/combined_credits`)]);
  const cast = merge((cc.cast || [])
    .filter((c) => (c.media_type === 'movie' || c.media_type === 'tv') && !(c.genre_ids || []).some((g) => SKIP_GENRES.has(g)) && !SELF.test(c.character || ''))
    .map((c) => credit(c, (c.character || '').trim())));
  const directing = merge((cc.crew || []).filter((c) => c.job === 'Director' || c.job === 'Creator').map((c) => credit(c, c.job)));
  const writing = merge((cc.crew || []).filter((c) => c.department === 'Writing').map((c) => credit(c, c.job)));
  return {
    ok: true, tmdbId: Number(id), name: info.name, department: info.known_for_department, bio: info.biography || '',
    birthday: info.birthday, deathday: info.deathday, place: info.place_of_birth, photo: info.profile_path || null,
    movies: cast.filter((c) => c.type === 'movie'), tv: cast.filter((c) => c.type === 'tv'), directing, writing,
  };
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
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
    if (url.pathname === '/api/person' && req.method === 'GET') {
      person(url.searchParams).then((r) => sendJson(res, 200, r)).catch((e) => {
        console.error('tmdb:', e.message);
        sendJson(res, 200, { ok: false, reason: e.reason || 'error', message: e.message });
      });
      return;
    }
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
