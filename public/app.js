'use strict';
/* Marquee: a custom Jellyfin front end. Everything goes through /jf, which the server passes to Jellyfin. */

const VERSION = '0.1.0';
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('mq-' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mq-' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem('mq-' + k); } catch { /* private mode */ } },
};
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/></svg>',
  restart: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5"/></svg>',
  movie: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/></svg>',
  tv: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="m8.5 2.5 3.5 3.5 3.5-3.5M8 21h8"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/></svg>',
};

/* ---------- Jellyfin API ---------- */
const deviceId = store.get('device') || (() => { const id = 'mq-' + Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('device', id); return id; })();
let session = store.get('session'); // { token, userId, name, imageTag }
function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android TV';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}
function authHeader() {
  let h = `MediaBrowser Client="Marquee", Device="${deviceName()}", DeviceId="${deviceId}", Version="${VERSION}"`;
  if (session?.token) h += `, Token="${session.token}"`;
  return h;
}
async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: { Authorization: authHeader() } };
  if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  if (opts.keepalive) init.keepalive = true;
  const res = await fetch('/jf' + path, init);
  if (res.status === 401 && session && !opts.noLogout) { signOut(true); throw new Error('Signed out'); }
  if (!res.ok) throw new Error(res.status === 502 ? "Can't reach Jellyfin" : `Jellyfin said ${res.status}`);
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') || '';
  return type.includes('json') ? res.json() : null;
}
const qs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const U = () => session.userId;
const LIST_FIELDS = 'Overview,PrimaryImageAspectRatio,ProductionYear,Genres,ParentId';

function img(id, type, opts = {}) {
  if (!id) return '';
  const q = { quality: 90, tag: opts.tag };
  if (opts.w) q.fillWidth = Math.round(opts.w * Math.min(2, window.devicePixelRatio || 1));
  if (opts.h) q.fillHeight = Math.round(opts.h * Math.min(2, window.devicePixelRatio || 1));
  return `/jf/Items/${id}/Images/${type}${opts.index !== undefined ? '/' + opts.index : ''}?${qs(q)}`;
}
const poster = (it, w = 300) => {
  if (it.ImageTags?.Primary && it.Type !== 'Episode') return img(it.Id, 'Primary', { w, tag: it.ImageTags.Primary });
  if (it.SeriesPrimaryImageTag) return img(it.SeriesId, 'Primary', { w, tag: it.SeriesPrimaryImageTag });
  if (it.ImageTags?.Primary) return img(it.Id, 'Primary', { w, tag: it.ImageTags.Primary });
  return '';
};
const backdrop = (it, w = 1920) => {
  if (it.BackdropImageTags?.length) return img(it.Id, 'Backdrop', { w, tag: it.BackdropImageTags[0], index: 0 });
  if (it.ParentBackdropImageTags?.length) return img(it.ParentBackdropItemId, 'Backdrop', { w, tag: it.ParentBackdropImageTags[0], index: 0 });
  return '';
};
const thumb = (it, w = 480) => {
  if (it.Type === 'Episode' && it.ImageTags?.Primary) return img(it.Id, 'Primary', { w, tag: it.ImageTags.Primary });
  if (it.ImageTags?.Thumb) return img(it.Id, 'Thumb', { w, tag: it.ImageTags.Thumb });
  if (it.ParentThumbImageTag) return img(it.ParentThumbItemId, 'Thumb', { w, tag: it.ParentThumbImageTag });
  return backdrop(it, w) || poster(it, w);
};
const logo = (it, w = 600) => {
  if (it.ImageTags?.Logo) return img(it.Id, 'Logo', { w, tag: it.ImageTags.Logo });
  if (it.ParentLogoImageTag) return img(it.ParentLogoItemId, 'Logo', { w, tag: it.ParentLogoImageTag });
  return '';
};

/* ---------- formatting ---------- */
const ticks = (t) => (t || 0) / 1e7;
function clock(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function runtime(t) {
  const m = Math.round(ticks(t) / 60);
  if (!m) return '';
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? (m % 60) + 'm' : ''}`.trim() : `${m}m`;
}
function endsAt(it) {
  const left = ticks(it.RunTimeTicks) - ticks(it.UserData?.PlaybackPositionTicks);
  if (left <= 0) return '';
  return 'Ends at ' + new Date(Date.now() + left * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
const epCode = (it) => (it.ParentIndexNumber != null && it.IndexNumber != null ? `S${it.ParentIndexNumber}:E${it.IndexNumber}` : '');
function factsHtml(it, more = true) {
  const f = [];
  if (it.Type === 'Episode' && epCode(it)) f.push(`<span>${epCode(it)}</span>`);
  if (it.ProductionYear && it.Type !== 'Episode') f.push(`<span>${it.ProductionYear}${it.Type === 'Series' && it.Status === 'Continuing' ? '–' : it.EndDate && new Date(it.EndDate).getFullYear() !== it.ProductionYear ? '–' + new Date(it.EndDate).getFullYear() : ''}</span>`);
  if (it.OfficialRating) f.push(`<span class="badge">${esc(it.OfficialRating)}</span>`);
  if (it.Type === 'Series' && it.ChildCount) f.push(`<span>${it.ChildCount} season${it.ChildCount > 1 ? 's' : ''}</span>`);
  else if (it.RunTimeTicks) f.push(`<span>${runtime(it.RunTimeTicks)}</span>`);
  if (it.CommunityRating) f.push(`<span><span class="star">★</span> ${it.CommunityRating.toFixed(1)}</span>`);
  if (more && it.RunTimeTicks && it.Type !== 'Series') f.push(`<span class="muted">${endsAt(it)}</span>`);
  return `<div class="facts">${f.join('')}</div>`;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}
function imgTag(src, alt = '', fallbackText = '') {
  if (!src) return `<div class="fallback">${esc(fallbackText)}</div>`;
  return `<img src="${src}" alt="${esc(alt)}" loading="lazy" decoding="async" onload="this.classList.add('ok')" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'fallback',textContent:this.alt}))">`;
}

/* ---------- cards ---------- */
function href(it) {
  if (it.Type === 'Season') return `#/item/${it.SeriesId}?season=${it.Id}`;
  if (it.Type === 'CollectionFolder' || it.Type === 'BoxSet' || it.IsFolder && !['Series', 'Season'].includes(it.Type)) return `#/library/${it.Id}`;
  return `#/item/${it.Id}`;
}
function progressBar(it) {
  const p = it.UserData?.PlayedPercentage;
  return p > 0 && p < 100 ? `<div class="prog"><i style="width:${p}%"></i></div>` : '';
}
function tagHtml(it) {
  const u = it.UserData || {};
  if (it.Type === 'Series' && u.UnplayedItemCount) return `<span class="tag">${u.UnplayedItemCount}</span>`;
  if (u.Played) return `<span class="tag">${ICON.check}</span>`;
  return '';
}
function posterCard(it) {
  const sub = it.Type === 'Episode' ? esc(it.SeriesName) : it.ProductionYear || '';
  return `<a class="card" href="${href(it)}" data-id="${it.Id}">
    <div class="art">${imgTag(poster(it), it.Name, it.Name)}${tagHtml(it)}${progressBar(it)}</div>
    <div class="cap"><b>${esc(it.Name)}</b><small>${sub}</small></div></a>`;
}
function wideCard(it, playable = true) {
  const title = it.Type === 'Episode' ? it.SeriesName : it.Name;
  const sub = it.Type === 'Episode' ? `${epCode(it)} · ${it.Name}` : (it.ProductionYear || '');
  const link = playable ? `#/play/${it.Id}` : href(it);
  return `<a class="wide" href="${link}" data-id="${it.Id}">
    <div class="art">${imgTag(thumb(it), title, title)}${progressBar(it)}<div class="play-hint"><span>${ICON.play}</span></div></div>
    <div class="cap"><b>${esc(title)}</b><small>${esc(sub)}</small></div></a>`;
}
function rowHtml(title, items, kind = 'poster', more = '') {
  if (!items?.length) return '';
  const cards = items.map((it) => (kind === 'wide' ? wideCard(it) : kind === 'wide-info' ? wideCard(it, false) : posterCard(it))).join('');
  return `<section class="row"><div class="row-head"><h2>${esc(title)}</h2>${more ? `<a href="${more}">See all</a>` : ''}<span class="spacer"></span>
    <div class="arrows"><button class="icon-btn" data-scroll="-1" aria-label="Scroll left" tabindex="-1">${ICON.left}</button><button class="icon-btn" data-scroll="1" aria-label="Scroll right" tabindex="-1">${ICON.right}</button></div></div>
    <div class="scroller">${cards}</div></section>`;
}
view.addEventListener('click', (e) => {
  const b = e.target.closest('[data-scroll]');
  if (!b) return;
  const sc = b.closest('.row').querySelector('.scroller');
  sc.scrollBy({ left: Number(b.dataset.scroll) * sc.clientWidth * 0.85, behavior: 'smooth' });
});

/* ---------- libraries / nav ---------- */
let libraries = [];
const libIcon = (l) => (l.CollectionType === 'movies' ? ICON.movie : l.CollectionType === 'tvshows' ? ICON.tv : ICON.folder);
async function loadLibraries() {
  const r = await api(`/UserViews?${qs({ userId: U() })}`);
  libraries = (r.Items || []).filter((l) => !['playlists', 'livetv', 'music', 'books', 'photos'].includes(l.CollectionType));
  $('#nav').innerHTML = `<a href="#/" data-route="home">Home</a>` + libraries.map((l) => `<a href="#/library/${l.Id}" data-route="lib-${l.Id}">${esc(l.Name)}</a>`).join('');
  const tabs = libraries.slice(0, 3);
  $('#tabbar').innerHTML = `<a href="#/" data-route="home">${ICON.home}Home</a>` + tabs.map((l) => `<a href="#/library/${l.Id}" data-route="lib-${l.Id}">${libIcon(l)}${esc(l.Name)}</a>`).join('') + `<a href="#/search" data-route="search">${ICON.search}Search</a>`;
}
function setActive(route) {
  for (const a of document.querySelectorAll('[data-route]')) a.classList.toggle('active', a.dataset.route === route);
}

/* ---------- home ---------- */
let heroTimer;
async function renderHome() {
  setActive('home');
  view.innerHTML = '<div class="loading"><div class="spin"></div></div>';
  const [resume, nextUp, featured, ...latest] = await Promise.all([
    api(`/UserItems/Resume?${qs({ userId: U(), Limit: 16, MediaTypes: 'Video', Fields: LIST_FIELDS, EnableTotalRecordCount: false })}`).catch(() => api(`/Users/${U()}/Items/Resume?${qs({ Limit: 16, MediaTypes: 'Video', Fields: LIST_FIELDS })}`)).catch(() => ({ Items: [] })),
    api(`/Shows/NextUp?${qs({ UserId: U(), Limit: 16, Fields: LIST_FIELDS, EnableResumable: false, EnableRewatching: false })}`).catch(() => ({ Items: [] })),
    api(`/Users/${U()}/Items?${qs({ IncludeItemTypes: 'Movie,Series', Recursive: true, SortBy: 'Random', Limit: 6, ImageTypes: 'Backdrop', Fields: LIST_FIELDS, IsPlayed: false })}`).catch(() => ({ Items: [] })),
    ...libraries.map((l) => api(`/Users/${U()}/Items/Latest?${qs({ ParentId: l.Id, Limit: 18, Fields: LIST_FIELDS, GroupItems: true })}`).catch(() => [])),
  ]);
  // Continue watching leads the hero when there is something to resume.
  let heroItems = featured.Items || [];
  if (!heroItems.length) heroItems = (await api(`/Users/${U()}/Items?${qs({ IncludeItemTypes: 'Movie,Series', Recursive: true, SortBy: 'Random', Limit: 6, ImageTypes: 'Backdrop', Fields: LIST_FIELDS })}`).catch(() => ({ Items: [] }))).Items || [];
  const resumeIds = new Set((resume.Items || []).map((i) => i.Id));
  const next = (nextUp.Items || []).filter((i) => !resumeIds.has(i.Id));
  let rows = rowHtml('Continue Watching', resume.Items, 'wide') + rowHtml('Next Up', next, 'wide');
  libraries.forEach((l, i) => { rows += rowHtml(`Recently Added in ${l.Name}`, latest[i], 'poster', `#/library/${l.Id}`); });
  if (!rows) rows = `<p class="empty">Nothing here yet. Add some media to Jellyfin and it'll show up.</p>`;
  view.innerHTML = `${heroItems.length ? heroHtml(heroItems) : '<div style="height:90px"></div>'}<div class="rows">${rows}</div>`;
  startHero(heroItems);
}
function heroHtml(items) {
  return `<section class="hero" id="hero">
    ${items.map((it, i) => `<div class="hero-slide${i ? '' : ' on'}"><img class="bg" src="${backdrop(it)}" alt="" ${i ? 'loading="lazy"' : ''}></div>`).join('')}
    <div class="hero-info" id="hero-info"></div>
    ${items.length > 1 ? `<div class="hero-dots">${items.map((_, i) => `<button aria-label="Show ${i + 1}" data-hero="${i}" tabindex="-1" class="${i ? '' : 'on'}"></button>`).join('')}</div>` : ''}
  </section>`;
}
function heroInfo(it) {
  const lg = logo(it);
  return `${lg ? `<img class="hero-logo" src="${lg}" alt="${esc(it.Name)}" onerror="this.outerHTML='<h1 class=hero-title>${esc(esc(it.Name))}</h1>'">` : `<h1 class="hero-title">${esc(it.Name)}</h1>`}
    ${factsHtml(it, false)}
    <p class="overview">${esc(it.Overview || '')}</p>
    <div class="actions"><a class="btn primary" href="#/play/${it.Id}">${ICON.play}Play</a><a class="btn" href="#/item/${it.Id}">${ICON.info}More info</a></div>`;
}
function startHero(items) {
  clearInterval(heroTimer);
  const hero = $('#hero');
  if (!hero) return;
  let i = 0;
  const show = (n) => {
    i = (n + items.length) % items.length;
    hero.querySelectorAll('.hero-slide').forEach((s, k) => s.classList.toggle('on', k === i));
    hero.querySelectorAll('[data-hero]').forEach((d, k) => d.classList.toggle('on', k === i));
    const keep = hero.contains(document.activeElement) && document.activeElement.closest('#hero-info');
    $('#hero-info').innerHTML = heroInfo(items[i]);
    if (keep) $('#hero-info .btn')?.focus({ preventScroll: true });
  };
  show(0);
  hero.addEventListener('click', (e) => { const d = e.target.closest('[data-hero]'); if (d) { show(Number(d.dataset.hero)); restart(); } });
  const restart = () => { clearInterval(heroTimer); if (items.length > 1) heroTimer = setInterval(() => { if (!document.hidden && !hero.matches(':hover')) show(i + 1); }, 9000); };
  restart();
}

/* ---------- library ---------- */
const SORTS = [
  { id: 'added', label: 'Recently added', by: 'DateCreated,SortName', order: 'Descending' },
  { id: 'name', label: 'A–Z', by: 'SortName', order: 'Ascending' },
  { id: 'year', label: 'Newest', by: 'PremiereDate,ProductionYear,SortName', order: 'Descending' },
  { id: 'rating', label: 'Top rated', by: 'CommunityRating,SortName', order: 'Descending' },
  { id: 'unwatched', label: 'Unwatched', by: 'Random', order: 'Ascending', filter: { IsPlayed: false } },
  { id: 'random', label: 'Shuffle', by: 'Random', order: 'Ascending' },
];
let libObserver;
async function renderLibrary(id) {
  setActive('lib-' + id);
  let lib = libraries.find((l) => l.Id === id);
  if (!lib) lib = await api(`/Users/${U()}/Items/${id}`);
  const types = lib.CollectionType === 'movies' ? 'Movie' : lib.CollectionType === 'tvshows' ? 'Series' : lib.Type === 'BoxSet' ? '' : 'Movie,Series,Video';
  const sortId = store.get('sort-' + id, 'added');
  const sort = SORTS.find((s) => s.id === sortId) || SORTS[0];
  view.innerHTML = `<div class="page"><div class="lib-head"><h1>${esc(lib.Name)}</h1><span class="count" id="lib-count"></span>
    <div class="chips glass" id="sorts">${SORTS.map((s) => `<button data-sort="${s.id}" class="${s.id === sort.id ? 'on' : ''}">${s.label}</button>`).join('')}</div></div>
    <div class="grid" id="lib-grid"></div><div class="sentinel" id="sentinel"><div class="loading" style="min-height:60px"><div class="spin"></div></div></div></div>`;
  $('#sorts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    store.set('sort-' + id, b.dataset.sort);
    renderLibrary(id);
  });
  let start = 0, total = Infinity, busy = false;
  const grid = $('#lib-grid');
  const more = async () => {
    if (busy || start >= total) return;
    busy = true;
    const r = await api(`/Users/${U()}/Items?${qs({ ParentId: id, IncludeItemTypes: types, Recursive: !!types, SortBy: sort.by, SortOrder: sort.order, StartIndex: start, Limit: 60, Fields: LIST_FIELDS, ImageTypeLimit: 1, EnableImageTypes: 'Primary,Backdrop,Thumb', ...(sort.filter || {}) })}`);
    if (!grid.isConnected) return;
    total = r.TotalRecordCount ?? r.Items.length;
    start += r.Items.length;
    grid.insertAdjacentHTML('beforeend', r.Items.map(posterCard).join(''));
    $('#lib-count').textContent = total ? `${total.toLocaleString()} title${total === 1 ? '' : 's'}` : '';
    if (!total) grid.outerHTML = '<p class="empty">Nothing here yet.</p>';
    if (start >= total || !r.Items.length) { total = start; $('#sentinel').innerHTML = ''; }
    busy = false;
    if ($('#sentinel') && $('#sentinel').getBoundingClientRect().top < innerHeight + 600) more();
  };
  libObserver?.disconnect();
  libObserver = new IntersectionObserver((e) => { if (e[0].isIntersecting) more(); }, { rootMargin: '800px' });
  libObserver.observe($('#sentinel'));
  await more();
}

/* ---------- details ---------- */
async function renderItem(id, params) {
  setActive('');
  view.innerHTML = '<div class="loading"><div class="spin"></div></div>';
  let it = await api(`/Users/${U()}/Items/${id}`);
  if (it.Type === 'Season') { location.replace(`#/item/${it.SeriesId}?season=${it.Id}`); return; }
  if (it.IsFolder && !['Series'].includes(it.Type)) { location.replace(`#/library/${it.Id}`); return; }
  const series = it.Type === 'Series';
  const ep = it.Type === 'Episode';
  // A series plays its next episode.
  let target = it;
  if (series) {
    const nu = await api(`/Shows/NextUp?${qs({ UserId: U(), SeriesId: it.Id, Limit: 1, Fields: LIST_FIELDS, EnableRewatching: true })}`).catch(() => ({ Items: [] }));
    target = nu.Items?.[0] || null;
    if (!target) {
      const first = await api(`/Shows/${it.Id}/Episodes?${qs({ UserId: U(), Limit: 1, Fields: LIST_FIELDS })}`).catch(() => ({ Items: [] }));
      target = first.Items?.[0] || null;
    }
  }
  const pos = ticks(target?.UserData?.PlaybackPositionTicks);
  const label = !target ? '' : pos > 0 ? `Resume ${clock(pos)}` : series ? `Play ${epCode(target)}` : 'Play';
  const people = (it.People || []).filter((p) => ['Actor', 'GuestStar'].includes(p.Type)).slice(0, 24);
  const crew = (it.People || []).filter((p) => p.Type === 'Director' || p.Type === 'Writer');
  const extra = [];
  if (it.Genres?.length) extra.push(['Genres', it.Genres.slice(0, 4).join(', ')]);
  const dirs = crew.filter((p) => p.Type === 'Director').map((p) => p.Name);
  if (dirs.length) extra.push([dirs.length > 1 ? 'Directors' : 'Director', dirs.slice(0, 3).join(', ')]);
  if (it.Studios?.length) extra.push([series ? 'Network' : 'Studio', it.Studios.slice(0, 2).map((s) => s.Name).join(', ')]);
  const vs = (it.MediaStreams || []).find((s) => s.Type === 'Video');
  if (vs?.DisplayTitle) extra.push(['Video', vs.DisplayTitle]);
  const audios = (it.MediaStreams || []).filter((s) => s.Type === 'Audio');
  if (audios.length) extra.push(['Audio', audios.slice(0, 2).map((a) => a.DisplayTitle).join(', ') + (audios.length > 2 ? ` +${audios.length - 2}` : '')]);
  const subs = (it.MediaStreams || []).filter((s) => s.Type === 'Subtitle');
  if (subs.length) extra.push(['Subtitles', [...new Set(subs.map((s) => s.Language || s.DisplayTitle))].slice(0, 4).join(', ') + (subs.length > 4 ? '…' : '')]);
  const fav = it.UserData?.IsFavorite;
  const played = it.UserData?.Played;
  view.innerHTML = `<div class="detail">
    <div class="d-backdrop">${backdrop(it) ? `<img src="${backdrop(it)}" alt="">` : ''}</div>
    <div class="d-main">
      <div class="d-poster">${imgTag(poster(it, 500), it.Name, it.Name)}</div>
      <div class="d-info">
        ${ep ? `<a class="d-series" href="#/item/${it.SeriesId}?season=${it.SeasonId || ''}">${esc(it.SeriesName)}</a>` : ''}
        ${!ep && logo(it) ? `<img class="hero-logo" src="${logo(it)}" alt="${esc(it.Name)}">` : `<h1 class="hero-title">${esc(it.Name)}</h1>`}
        ${factsHtml(it)}
        ${it.Taglines?.[0] ? `<p class="tagline">${esc(it.Taglines[0])}</p>` : ''}
        <p class="overview" id="d-overview">${esc(it.Overview || '')}</p>
        <div class="actions">
          ${target ? `<a class="btn primary" href="#/play/${target.Id}" id="d-play">${ICON.play}${label}</a>` : ''}
          ${target && pos > 0 ? `<a class="btn" href="#/play/${target.Id}?start=0">${ICON.restart}From start</a>` : ''}
          <button class="btn${played ? ' on' : ''}" id="d-played">${ICON.check}${played ? 'Watched' : 'Mark watched'}</button>
          <button class="btn${fav ? ' on' : ''}" id="d-fav" aria-label="Favorite">${ICON.heart}</button>
        </div>
        ${extra.length ? `<dl class="d-extra">${extra.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      </div>
    </div>
    ${series ? '<section class="section" id="seasons-sec"><div class="seasons"><div class="chips glass" id="seasons"></div></div><div class="episodes" id="episodes"></div></section>' : ''}
    ${people.length ? `<section class="section"><h2>Cast</h2><div class="scroller">${people.map(personCard).join('')}</div></section>` : ''}
    <div class="section" id="similar"></div>
  </div>`;
  $('#d-overview').addEventListener('click', (e) => e.currentTarget.classList.toggle('open'));
  $('#d-fav').addEventListener('click', async (e) => {
    const on = !e.currentTarget.classList.contains('on');
    await api(`/UserFavoriteItems/${it.Id}?${qs({ userId: U() })}`, { method: on ? 'POST' : 'DELETE' }).catch(() => api(`/Users/${U()}/FavoriteItems/${it.Id}`, { method: on ? 'POST' : 'DELETE' }));
    e.currentTarget.classList.toggle('on', on);
    toast(on ? 'Added to favorites' : 'Removed from favorites');
  });
  $('#d-played').addEventListener('click', async (e) => {
    const on = !e.currentTarget.classList.contains('on');
    await api(`/UserPlayedItems/${it.Id}?${qs({ userId: U() })}`, { method: on ? 'POST' : 'DELETE' }).catch(() => api(`/Users/${U()}/PlayedItems/${it.Id}`, { method: on ? 'POST' : 'DELETE' }));
    toast(on ? 'Marked as watched' : 'Marked as unwatched');
    route();
  });
  if (series) loadSeasons(it, params.get('season') || target?.SeasonId);
  else if (ep) loadEpisodeSiblings(it);
  api(`/Items/${(ep ? it.SeriesId : it.Id)}/Similar?${qs({ userId: U(), Limit: 16, Fields: LIST_FIELDS })}`).then((r) => {
    const box = $('#similar');
    if (box && !ep) box.outerHTML = rowHtml('More Like This', r.Items);
  }).catch(() => {});
}
function personCard(p) {
  const src = p.PrimaryImageTag ? img(p.Id, 'Primary', { w: 200, tag: p.PrimaryImageTag }) : '';
  const initials = p.Name.split(' ').map((w) => w[0]).slice(0, 2).join('');
  return `<a class="person" href="#/search?q=${encodeURIComponent(p.Name)}"><div class="art">${imgTag(src, initials, initials)}</div><b>${esc(p.Name)}</b><small>${esc(p.Role || '')}</small></a>`;
}
async function loadSeasons(series, pick) {
  const r = await api(`/Shows/${series.Id}/Seasons?${qs({ UserId: U(), Fields: 'ItemCounts' })}`);
  const seasons = r.Items || [];
  if (!seasons.length) return;
  const box = $('#seasons');
  if (!box) return;
  let current = seasons.find((s) => s.Id === pick) || seasons.find((s) => s.IndexNumber > 0) || seasons[0];
  box.innerHTML = seasons.map((s) => `<button data-season="${s.Id}">${esc(s.Name)}</button>`).join('');
  const show = async (s) => {
    current = s;
    box.querySelectorAll('[data-season]').forEach((b) => b.classList.toggle('on', b.dataset.season === s.Id));
    const eps = await api(`/Shows/${series.Id}/Episodes?${qs({ UserId: U(), SeasonId: s.Id, Fields: 'Overview,PrimaryImageAspectRatio' })}`);
    const list = $('#episodes');
    if (!list || current !== s) return;
    list.innerHTML = (eps.Items || []).map(episodeRow).join('') || '<p class="empty">No episodes.</p>';
  };
  box.addEventListener('click', (e) => { const b = e.target.closest('[data-season]'); if (b) show(seasons.find((s) => s.Id === b.dataset.season)); });
  show(current);
}
function episodeRow(e) {
  const meta = [`Episode ${e.IndexNumber ?? ''}`, runtime(e.RunTimeTicks), e.PremiereDate ? new Date(e.PremiereDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : ''].filter(Boolean).join(' · ');
  return `<a class="ep" href="#/play/${e.Id}"><div class="art">${imgTag(thumb(e), e.Name, e.Name)}${tagHtml(e)}${progressBar(e)}<div class="play-hint"><span>${ICON.play}</span></div></div>
    <div><h3>${e.IndexNumber != null ? e.IndexNumber + '. ' : ''}${esc(e.Name)}</h3><div class="epmeta">${meta}</div><p>${esc(e.Overview || '')}</p></div></a>`;
}
async function loadEpisodeSiblings(ep) {
  if (!ep.SeasonId) return;
  const r = await api(`/Shows/${ep.SeriesId}/Episodes?${qs({ UserId: U(), SeasonId: ep.SeasonId, Fields: 'Overview' })}`).catch(() => null);
  const box = $('#similar');
  if (box && r?.Items?.length) box.outerHTML = rowHtml(ep.SeasonName || 'Episodes', r.Items, 'wide');
}

/* ---------- search ---------- */
let searchTimer;
function renderSearch(params) {
  setActive('search');
  const q = params.get('q') || '';
  view.innerHTML = `<div class="page"><h1>Search</h1>
    <label class="searchbox glass">${ICON.search}<input id="q" type="search" placeholder="Movies, shows, episodes, people" value="${esc(q)}" autocomplete="off" enterkeyhint="search"></label>
    <div id="results"></div></div>`;
  const input = $('#q');
  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      history.replaceState(null, '', `#/search${input.value ? '?q=' + encodeURIComponent(input.value) : ''}`);
      runSearch(input.value);
    }, 280);
  });
  if (!matchMedia('(hover: none)').matches || !q) input.focus();
  runSearch(q);
}
async function runSearch(q) {
  const box = $('#results');
  if (!box) return;
  q = q.trim();
  if (!q) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="loading" style="min-height:30vh"><div class="spin"></div></div>';
  const [titles, eps, people] = await Promise.all([
    api(`/Users/${U()}/Items?${qs({ searchTerm: q, IncludeItemTypes: 'Movie,Series,BoxSet', Recursive: true, Limit: 40, Fields: LIST_FIELDS })}`).catch(() => ({ Items: [] })),
    api(`/Users/${U()}/Items?${qs({ searchTerm: q, IncludeItemTypes: 'Episode', Recursive: true, Limit: 16, Fields: LIST_FIELDS })}`).catch(() => ({ Items: [] })),
    api(`/Persons?${qs({ searchTerm: q, userId: U(), Limit: 12 })}`).catch(() => ({ Items: [] })),
  ]);
  if ($('#q')?.value.trim() !== q) return;
  // People search: show what they're in.
  let credits = [];
  if (people.Items?.length === 1 || people.Items?.[0]?.Name.toLowerCase() === q.toLowerCase()) {
    const p = people.Items[0];
    credits = (await api(`/Users/${U()}/Items?${qs({ PersonIds: p.Id, IncludeItemTypes: 'Movie,Series', Recursive: true, Limit: 40, Fields: LIST_FIELDS })}`).catch(() => ({ Items: [] }))).Items || [];
  }
  const seen = new Set((titles.Items || []).map((i) => i.Id));
  credits = credits.filter((c) => !seen.has(c.Id));
  let html = '';
  if (titles.Items?.length) html += `<div class="grid">${titles.Items.map(posterCard).join('')}</div>`;
  if (credits.length) html += `<div style="margin:0 calc(-1 * var(--pad))">${rowHtml(`With ${people.Items[0].Name}`, credits)}</div>`;
  if (eps.Items?.length) html += `<div style="margin:24px calc(-1 * var(--pad)) 0">${rowHtml('Episodes', eps.Items, 'wide')}</div>`;
  box.innerHTML = html || `<p class="empty">No results for “${esc(q)}”.</p>`;
}

/* ---------- player ---------- */
const P = {
  el: $('#player'), video: $('#video'), hls: null, item: null, source: null, playSession: null, method: '',
  audio: null, sub: -1, bitrate: store.get('bitrate', 0), reportTimer: null, idleTimer: null, nextEp: null, upnextShown: false,
  offset: 0,
};
const BITRATES = [[0, 'Auto (best)'], [40e6, '40 Mbps · 4K'], [20e6, '20 Mbps · 1080p'], [10e6, '10 Mbps · 1080p'], [4e6, '4 Mbps · 720p'], [1.5e6, '1.5 Mbps · 480p']];
function deviceProfile(maxBitrate) {
  const v = document.createElement('video');
  const can = (t) => !!v.canPlayType(t).replace('no', '');
  const vcodecs = ['h264'];
  if (can('video/mp4; codecs="hvc1.1.6.L120.90"') || can('video/mp4; codecs="hev1.1.6.L120.90"')) vcodecs.push('hevc');
  if (can('video/mp4; codecs="av01.0.08M.08"')) vcodecs.push('av1');
  if (can('video/mp4; codecs="vp09.00.10.08"')) vcodecs.push('vp9');
  const acodecs = ['aac', 'mp3'];
  if (can('audio/mp4; codecs="opus"') || can('audio/webm; codecs="opus"')) acodecs.push('opus');
  if (can('audio/mp4; codecs="flac"') || can('audio/flac')) acodecs.push('flac');
  if (can('audio/mp4; codecs="ac-3"')) acodecs.push('ac3');
  if (can('audio/mp4; codecs="ec-3"')) acodecs.push('eac3');
  const hlsVideo = vcodecs.includes('hevc') ? 'hevc,h264' : 'h264';
  return {
    Name: 'Marquee', MaxStreamingBitrate: maxBitrate || 120e6, MaxStaticBitrate: 120e6, MusicStreamingTranscodingBitrate: 384000,
    DirectPlayProfiles: [
      { Container: 'mp4,m4v', Type: 'Video', VideoCodec: vcodecs.join(','), AudioCodec: acodecs.join(',') },
      ...(can('video/webm; codecs="vp9"') ? [{ Container: 'webm', Type: 'Video', VideoCodec: 'vp8,vp9,av1', AudioCodec: 'vorbis,opus' }] : []),
    ],
    TranscodingProfiles: [
      { Container: 'mp4', Type: 'Video', Protocol: 'hls', Context: 'Streaming', VideoCodec: hlsVideo, AudioCodec: 'aac,mp3' + (acodecs.includes('ac3') ? ',ac3,eac3' : ''), MaxAudioChannels: '6', MinSegments: 1, BreakOnNonKeyFrames: true, CopyTimestamps: false },
    ],
    ContainerProfiles: [],
    CodecProfiles: [
      { Type: 'Video', Codec: 'h264', Conditions: [{ Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '8', IsRequired: false }] },
    ],
    SubtitleProfiles: [
      { Format: 'vtt', Method: 'External' },
      { Format: 'ass', Method: 'Encode' }, { Format: 'ssa', Method: 'Encode' },
      { Format: 'pgssub', Method: 'Encode' }, { Format: 'dvdsub', Method: 'Encode' }, { Format: 'dvbsub', Method: 'Encode' },
    ],
    ResponseProfiles: [{ Type: 'Video', Container: 'm4v', MimeType: 'video/mp4' }],
  };
}
async function play(id, params) {
  document.body.classList.add('locked');
  P.el.classList.remove('hidden');
  P.el.classList.add('waiting', 'paused');
  $('#p-sheet').classList.add('hidden');
  $('#p-upnext').classList.add('hidden');
  P.upnextShown = false;
  try {
    const it = await api(`/Users/${U()}/Items/${id}`);
    if (it.Type === 'Series' || it.Type === 'Season' || it.IsFolder) { location.replace(`#/item/${it.Id}`); return; }
    P.item = it;
    P.audio = null; P.sub = -1;
    $('#p-title').textContent = it.Type === 'Episode' ? it.SeriesName : it.Name;
    $('#p-sub').textContent = it.Type === 'Episode' ? `${epCode(it)} · ${it.Name}` : [it.ProductionYear, runtime(it.RunTimeTicks)].filter(Boolean).join(' · ');
    const startParam = params.get('start');
    const start = startParam !== null ? Number(startParam) : ticks(it.UserData?.PlaybackPositionTicks);
    // Default subtitle: whatever Jellyfin marks as default/forced.
    const def = (it.MediaStreams || []).find((s) => s.Type === 'Subtitle' && (s.IsForced || s.IsDefault));
    if (def) P.sub = def.Index;
    P.nextEp = null;
    $('#p-next').hidden = true;
    if (it.Type === 'Episode') findNext(it);
    await load(start);
  } catch (e) {
    toast(e.message || 'Could not play that');
    closePlayer(true);
  }
}
async function findNext(it) {
  const r = await api(`/Shows/${it.SeriesId}/Episodes?${qs({ UserId: U(), StartItemId: it.Id, Limit: 2, Fields: 'Overview' })}`).catch(() => null);
  const nx = r?.Items?.find((e) => e.Id !== it.Id);
  if (P.item?.Id !== it.Id) return;
  P.nextEp = nx || null;
  $('#p-next').hidden = !nx;
}
async function load(startSec) {
  const it = P.item;
  stopHls();
  await reportStop(); // end the previous stream, if this is a reload
  const body = { DeviceProfile: deviceProfile(P.bitrate) };
  const info = await api(`/Items/${it.Id}/PlaybackInfo?${qs({
    UserId: U(), StartTimeTicks: Math.round(startSec * 1e7), IsPlayback: true, AutoOpenLiveStream: true,
    MaxStreamingBitrate: P.bitrate || 120e6, AudioStreamIndex: P.audio ?? undefined, SubtitleStreamIndex: P.sub, MediaSourceId: P.source?.Id,
  })}`, { method: 'POST', body });
  if (info.ErrorCode) throw new Error(info.ErrorCode === 'NotAllowed' ? "You're not allowed to play this" : 'Jellyfin could not play this');
  const ms = info.MediaSources[0];
  P.source = ms;
  P.playSession = info.PlaySessionId;
  if (P.audio == null) P.audio = ms.DefaultAudioStreamIndex ?? null;
  const v = P.video;
  v.querySelectorAll('track').forEach((t) => t.remove());
  let url;
  if (ms.SupportsDirectPlay && !ms.TranscodingUrl) {
    P.method = 'DirectPlay';
    url = `/jf/Videos/${it.Id}/stream.${(ms.Container || 'mp4').split(',')[0]}?${qs({ Static: true, mediaSourceId: ms.Id, deviceId, api_key: session.token, PlaySessionId: P.playSession, Tag: ms.ETag })}`;
  } else if (ms.TranscodingUrl) {
    url = '/jf' + ms.TranscodingUrl;
    if (!/[?&](api_key|ApiKey)=/i.test(url)) url += (url.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(session.token);
    const why = (new URL(url, location.href).searchParams.get('TranscodeReasons') || '').split(',').filter(Boolean);
    ms.TranscodeReasons = ms.TranscodeReasons?.length ? ms.TranscodeReasons : why;
    // Only container or audio changes means the video is copied as-is, which costs almost nothing.
    P.method = ms.TranscodeReasons.some((r) => /^(Video|Subtitle|Container(Bitrate)?ExceedsLimit|RefFrames|Interlaced|Anamorphic)/.test(r)) ? 'Transcode' : 'DirectStream';
  } else throw new Error('No playable stream');
  const sub = (ms.MediaStreams || []).find((s) => s.Index === P.sub && s.Type === 'Subtitle');
  if (sub && sub.DeliveryMethod === 'External' && sub.DeliveryUrl) {
    const tr = document.createElement('track');
    tr.kind = 'subtitles'; tr.default = true; tr.srclang = sub.Language || 'und'; tr.label = sub.DisplayTitle || 'Subtitles';
    tr.src = '/jf' + (sub.DeliveryUrl.startsWith('/') ? '' : '/') + sub.DeliveryUrl;
    v.appendChild(tr);
    tr.addEventListener('load', () => { tr.track.mode = 'showing'; });
    setTimeout(() => { if (tr.track) tr.track.mode = 'showing'; }, 50);
  }
  const reasons = (ms.TranscodeReasons || info.TranscodeReasons || []);
  $('#p-mode').textContent = P.method === 'DirectPlay' ? 'Direct play' : P.method === 'DirectStream' ? 'Direct stream' : 'Transcoding' + (reasons.length ? ' · ' + reasonText(reasons[0]) : '');
  const isHls = /\.m3u8/i.test(url);
  P.offset = 0;
  // Safari plays HLS best on its own; everywhere else hls.js is more reliable.
  const safari = /Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Android/.test(navigator.userAgent);
  const nativeHls = !!v.canPlayType('application/vnd.apple.mpegurl');
  if (isHls && !(safari && nativeHls) && window.Hls?.isSupported()) {
    P.hls = new Hls({ startPosition: startSec, maxBufferLength: 40, backBufferLength: 60, xhrSetup: (x) => x.setRequestHeader('Authorization', authHeader()) });
    P.hls.loadSource(url);
    P.hls.attachMedia(v);
    P.hls.on(Hls.Events.ERROR, (_, d) => {
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR) P.hls.startLoad();
      else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) P.hls.recoverMediaError();
      else { toast('Playback failed'); }
    });
  } else {
    v.src = url;
    v.addEventListener('loadedmetadata', () => { if (startSec > 1 && v.currentTime < 1 && startSec < v.duration - 5) v.currentTime = startSec; }, { once: true });
  }
  try { await v.play(); } catch { P.el.classList.add('paused'); }
  reportStart();
  poke();
}
function reasonText(r) {
  return ({ ContainerNotSupported: 'format', VideoCodecNotSupported: 'video codec', AudioCodecNotSupported: 'audio codec', ContainerBitrateExceedsLimit: 'quality limit', VideoBitrateNotSupported: 'quality limit', SubtitleCodecNotSupported: 'subtitles', VideoRangeTypeNotSupported: 'HDR', VideoBitDepthNotSupported: '10-bit', AudioChannelsNotSupported: 'audio channels' })[r] || r.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}
function stopHls() {
  if (P.hls) { P.hls.destroy(); P.hls = null; }
  P.video.removeAttribute('src');
  P.video.load();
}
const progressBody = (extra = {}) => ({
  ItemId: P.item.Id, MediaSourceId: P.source?.Id, PlaySessionId: P.playSession, PlayMethod: P.method,
  PositionTicks: Math.round((P.video.currentTime || 0) * 1e7), IsPaused: P.video.paused, CanSeek: true,
  AudioStreamIndex: P.audio, SubtitleStreamIndex: P.sub, ...extra,
});
function reportStart() {
  api('/Sessions/Playing', { method: 'POST', body: progressBody() }).catch(() => {});
  clearInterval(P.reportTimer);
  P.reportTimer = setInterval(() => reportProgress(), 10000);
}
function reportProgress(event = 'TimeUpdate') {
  if (!P.playSession || !P.item) return;
  api('/Sessions/Playing/Progress', { method: 'POST', body: progressBody({ EventName: event }) }).catch(() => {});
}
async function reportStop() {
  clearInterval(P.reportTimer);
  if (!P.playSession || !P.item) return;
  const body = progressBody();
  const ps = P.playSession;
  P.playSession = null;
  await api('/Sessions/Playing/Stopped', { method: 'POST', body, keepalive: true }).catch(() => {});
  if (P.method !== 'DirectPlay') api(`/Videos/ActiveEncodings?${qs({ deviceId, playSessionId: ps })}`, { method: 'DELETE', keepalive: true }).catch(() => {});
}
async function closePlayer(silent) {
  if (P.el.classList.contains('hidden')) return;
  const back = P.item;
  // Tell Jellyfin in the background; it can take a moment to save the position and stop the transcode.
  reportStop();
  stopHls();
  P.item = null; P.source = null;
  P.el.classList.add('hidden');
  document.body.classList.remove('locked');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (!silent && location.hash.startsWith('#/play/')) {
    if (history.length > 1 && sessionStorage.getItem('mq-in-app')) history.back();
    else location.replace(back ? `#/item/${back.Id}` : '#/');
  }
}
/* controls */
const v = P.video;
function poke() {
  P.el.classList.remove('idle');
  clearTimeout(P.idleTimer);
  P.idleTimer = setTimeout(() => { if (!v.paused && $('#p-sheet').classList.contains('hidden')) P.el.classList.add('idle'); }, 3200);
}
const duration = () => (Number.isFinite(v.duration) && v.duration > 0 ? v.duration : ticks(P.item?.RunTimeTicks));
function paint() {
  const d = duration();
  const t = v.currentTime;
  const pct = d ? Math.min(100, (t / d) * 100) : 0;
  $('#p-fill').style.width = pct + '%';
  $('#p-knob').style.left = pct + '%';
  $('#p-time').textContent = clock(t);
  $('#p-left').textContent = '-' + clock(d - t);
  if (v.buffered.length && d) $('#p-buf').style.width = Math.min(100, (v.buffered.end(v.buffered.length - 1) / d) * 100) + '%';
  // Up next card near the end of an episode.
  if (P.nextEp && d && d - t < 30 && d - t > 0 && !P.upnextShown) showUpNext();
}
function showUpNext() {
  P.upnextShown = true;
  const nx = P.nextEp;
  const box = $('#p-upnext');
  box.innerHTML = `<div class="art">${imgTag(thumb(nx, 300), nx.Name, nx.Name)}</div><div><small>Up next · ${epCode(nx)}</small><b>${esc(nx.Name)}</b><button class="btn primary" id="un-play">${ICON.play}Play now</button></div>`;
  box.classList.remove('hidden');
  $('#un-play').addEventListener('click', playNext);
}
function playNext() {
  if (!P.nextEp) return;
  const id = P.nextEp.Id;
  reportStop();
  location.replace(`#/play/${id}`);
}
function seekTo(sec) {
  const d = duration();
  v.currentTime = Math.max(0, Math.min(d ? d - 1 : sec, sec));
  paint();
  reportProgress('TimeUpdate');
  poke();
}
v.addEventListener('timeupdate', paint);
v.addEventListener('progress', paint);
v.addEventListener('waiting', () => P.el.classList.add('waiting'));
v.addEventListener('playing', () => { P.el.classList.remove('waiting', 'paused'); poke(); });
v.addEventListener('canplay', () => P.el.classList.remove('waiting'));
v.addEventListener('pause', () => { P.el.classList.add('paused'); poke(); reportProgress('Pause'); });
v.addEventListener('play', () => { P.el.classList.remove('paused'); reportProgress('Unpause'); });
v.addEventListener('ended', () => { if (P.nextEp) playNext(); else closePlayer(); });
v.addEventListener('error', () => { if (!P.hls && P.item && v.error) toast('Playback error — try a lower quality'); });
const togglePlay = () => (v.paused ? v.play().catch(() => {}) : v.pause());
$('#p-play').addEventListener('click', togglePlay);
$('#p-rew').addEventListener('click', () => seekTo(v.currentTime - 10));
$('#p-fwd').addEventListener('click', () => seekTo(v.currentTime + 30));
$('#p-back').addEventListener('click', () => closePlayer());
$('#p-next').addEventListener('click', playNext);
$('#p-full').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (P.el.requestFullscreen) P.el.requestFullscreen().catch(() => {});
  else if (v.webkitEnterFullscreen) v.webkitEnterFullscreen();
});
P.el.addEventListener('pointermove', poke);
P.el.addEventListener('click', (e) => {
  if (e.target === v || e.target.classList.contains('p-ui') || e.target.classList.contains('p-center')) {
    if (!$('#p-sheet').classList.contains('hidden')) { $('#p-sheet').classList.add('hidden'); return; }
    if (matchMedia('(hover: none)').matches) { if (P.el.classList.contains('idle')) poke(); else P.el.classList.add('idle'); } else togglePlay();
  }
});
(() => {
  const bar = $('#p-bar');
  const at = (e) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  bar.addEventListener('pointerdown', (e) => {
    bar.setPointerCapture(e.pointerId); bar.classList.add('drag');
    const move = (ev) => { const f = at(ev); $('#p-fill').style.width = f * 100 + '%'; $('#p-knob').style.left = f * 100 + '%'; $('#p-hover').style.left = f * 100 + '%'; $('#p-hover').textContent = clock(f * duration()); poke(); };
    const up = (ev) => { bar.classList.remove('drag'); bar.removeEventListener('pointermove', move); seekTo(at(ev) * duration()); };
    move(e);
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up, { once: true });
  });
  bar.addEventListener('pointermove', (e) => { if (bar.classList.contains('drag')) return; const f = at(e); $('#p-hover').style.left = f * 100 + '%'; $('#p-hover').textContent = clock(f * duration()); });
})();
/* audio / subtitles / quality */
$('#p-settings').addEventListener('click', () => {
  const sheet = $('#p-sheet');
  if (!sheet.classList.contains('hidden')) { sheet.classList.add('hidden'); return; }
  const streams = P.source?.MediaStreams || P.item?.MediaStreams || [];
  const audios = streams.filter((s) => s.Type === 'Audio');
  const subs = streams.filter((s) => s.Type === 'Subtitle');
  sheet.innerHTML = `${audios.length > 1 ? `<h4>Audio</h4>${audios.map((a) => `<button data-audio="${a.Index}" class="${a.Index === P.audio ? 'on' : ''}">${esc(a.DisplayTitle || a.Language || 'Track ' + a.Index)}</button>`).join('')}` : ''}
    <h4>Subtitles</h4><button data-sub="-1" class="${P.sub === -1 ? 'on' : ''}">Off</button>${subs.map((s) => `<button data-sub="${s.Index}" class="${s.Index === P.sub ? 'on' : ''}">${esc(s.DisplayTitle || s.Language || 'Track ' + s.Index)}</button>`).join('')}
    <h4>Quality</h4>${BITRATES.map(([b, l]) => `<button data-rate="${b}" class="${b === P.bitrate ? 'on' : ''}">${l}</button>`).join('')}`;
  sheet.classList.remove('hidden');
  sheet.querySelector('button.on, button')?.focus();
  poke();
});
$('#p-sheet').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const pos = v.currentTime;
  if (b.dataset.audio !== undefined) P.audio = Number(b.dataset.audio);
  if (b.dataset.sub !== undefined) P.sub = Number(b.dataset.sub);
  if (b.dataset.rate !== undefined) { P.bitrate = Number(b.dataset.rate); store.set('bitrate', P.bitrate); }
  $('#p-sheet').classList.add('hidden');
  P.el.classList.add('waiting');
  try { await load(pos); } catch (err) { toast(err.message); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && P.item) reportProgress(); });
window.addEventListener('pagehide', () => { if (P.item) reportStop(); });

/* ---------- TV remote / keyboard navigation ---------- */
function focusables() {
  const root = !P.el.classList.contains('hidden') ? P.el : document;
  return [...root.querySelectorAll('a[href], button:not([disabled]):not([tabindex="-1"]), input, [tabindex="0"]')].filter((el) => {
    if (el.closest('.hidden')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}
function moveFocus(dir) {
  const cur = document.activeElement;
  const els = focusables();
  if (!cur || cur === document.body || !els.includes(cur)) {
    const first = els.find((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; }) || els[0];
    first?.focus();
    return;
  }
  const a = cur.getBoundingClientRect();
  const ac = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
  let best = null, bestScore = Infinity;
  for (const el of els) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const dx = c.x - ac.x, dy = c.y - ac.y;
    let main, cross;
    if (dir === 'right') { if (r.left < a.right - 4) continue; main = dx; cross = Math.abs(dy); }
    else if (dir === 'left') { if (r.right > a.left + 4) continue; main = -dx; cross = Math.abs(dy); }
    else if (dir === 'down') { if (r.top < a.bottom - 4) continue; main = dy; cross = Math.abs(dx); }
    else { if (r.bottom > a.top + 4) continue; main = -dy; cross = Math.abs(dx); }
    // Vertical moves prefer staying near the same x, then the nearest row.
    const score = dir === 'up' || dir === 'down' ? main + cross * 0.6 : main + cross * 3;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) {
    best.focus({ preventScroll: true });
    const sc = best.closest('.scroller');
    if (sc) {
      const r = best.getBoundingClientRect(), s = sc.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(sc).paddingLeft) || 0;
      if (r.left < s.left + pad || r.right > s.right - pad) sc.scrollBy({ left: r.left < s.left + pad ? r.left - s.left - pad : r.right - s.right + pad, behavior: 'smooth' });
    }
    const r = best.getBoundingClientRect();
    if (best.closest('.hero-info')) window.scrollTo({ top: 0, behavior: 'smooth' });
    else if (r.top < 90 || r.bottom > innerHeight - 20) window.scrollBy({ top: r.top - innerHeight * 0.35, behavior: 'smooth' });
  }
}
document.addEventListener('keydown', (e) => {
  const inPlayer = !P.el.classList.contains('hidden');
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  const key = e.key;
  if (inPlayer) {
    const sheetOpen = !$('#p-sheet').classList.contains('hidden');
    const uiHidden = P.el.classList.contains('idle');
    if (key === 'Escape' || key === 'Backspace' || key === 'BrowserBack' || key === 'GoBack') {
      e.preventDefault();
      if (sheetOpen) { $('#p-sheet').classList.add('hidden'); $('#p-settings').focus(); } else closePlayer();
      return;
    }
    if (key === ' ' || key === 'MediaPlayPause' || key === 'k') { e.preventDefault(); togglePlay(); poke(); return; }
    if (key === 'MediaPlay') { v.play(); return; }
    if (key === 'MediaPause') { v.pause(); return; }
    if (key === 'MediaFastForward') { seekTo(v.currentTime + 30); return; }
    if (key === 'MediaRewind') { seekTo(v.currentTime - 10); return; }
    if (key === 'MediaTrackNext') { playNext(); return; }
    // With the controls hidden, left/right seek and Enter pauses, like a TV app.
    if (uiHidden && !sheetOpen) {
      if (key === 'ArrowLeft') { e.preventDefault(); seekTo(v.currentTime - 10); return; }
      if (key === 'ArrowRight') { e.preventDefault(); seekTo(v.currentTime + 30); return; }
      if (key === 'Enter') { e.preventDefault(); togglePlay(); poke(); $('#p-play').focus(); return; }
      if (key === 'ArrowUp' || key === 'ArrowDown') { e.preventDefault(); poke(); $('#p-play').focus(); return; }
    }
    if (document.activeElement === $('#p-bar') && (key === 'ArrowLeft' || key === 'ArrowRight')) { e.preventDefault(); seekTo(v.currentTime + (key === 'ArrowLeft' ? -10 : 30)); return; }
    if (key === 'f') { $('#p-full').click(); return; }
    if (key.startsWith('Arrow')) { e.preventDefault(); poke(); moveFocus(key.slice(5).toLowerCase()); }
    else poke();
    return;
  }
  if (typing) {
    if (key === 'ArrowDown' || key === 'Escape') { e.preventDefault(); document.activeElement.blur(); moveFocus('down'); }
    return;
  }
  if (key.startsWith('Arrow')) { e.preventDefault(); document.body.classList.add('remote'); moveFocus(key.slice(5).toLowerCase()); return; }
  if ((key === 'Escape' || key === 'Backspace' || key === 'BrowserBack' || key === 'GoBack') && location.hash && location.hash !== '#/') {
    e.preventDefault();
    if (!$('#user-menu').classList.contains('hidden')) { $('#user-menu').classList.add('hidden'); return; }
    history.back();
  }
});

/* ---------- account ---------- */
$('#user-btn').addEventListener('click', (e) => { e.stopPropagation(); const m = $('#user-menu'); m.classList.toggle('hidden'); if (!m.classList.contains('hidden')) $('#sign-out').focus(); });
document.addEventListener('click', (e) => { if (!e.target.closest('#user-menu')) $('#user-menu').classList.add('hidden'); });
$('#sign-out').addEventListener('click', () => signOut());
function signOut(expired) {
  if (session?.token && !expired) api('/Sessions/Logout', { method: 'POST', noLogout: true }).catch(() => {});
  session = null;
  store.del('session');
  closePlayer(true);
  showLogin(expired ? 'Your session ended. Sign in again.' : '');
}
async function showLogin(msg = '') {
  $('#login').classList.remove('hidden');
  $('#topbar').classList.add('hidden');
  $('#tabbar').classList.add('hidden');
  view.innerHTML = '';
  $('#login-error').textContent = msg;
  try {
    const info = await api('/System/Info/Public');
    $('#login-server').textContent = `Sign in to ${info.ServerName || 'Jellyfin'}`;
    const users = await api('/Users/Public').catch(() => []);
    $('#login-users').innerHTML = (users || []).map((u) => `<button type="button" class="login-user" data-name="${esc(u.Name)}"><span class="avatar" style="${u.PrimaryImageTag ? `background-image:url('/jf/Users/${u.Id}/Images/Primary?tag=${u.PrimaryImageTag}&fillWidth=124')` : ''}">${u.PrimaryImageTag ? '' : esc(u.Name[0].toUpperCase())}</span>${esc(u.Name)}</button>`).join('');
  } catch (e) {
    $('#login-server').textContent = "Can't reach Jellyfin. Check that it's running.";
  }
  const last = store.get('last-user');
  if (last && !$('#login-name').value) $('#login-name').value = last;
  ($('#login-name').value ? $('#login-pw') : $('#login-name')).focus();
}
$('#login-users').addEventListener('click', (e) => {
  const b = e.target.closest('.login-user');
  if (!b) return;
  $('#login-users').querySelectorAll('.login-user').forEach((x) => x.classList.toggle('active', x === b));
  $('#login-name').value = b.dataset.name;
  $('#login-pw').value = '';
  $('#login-pw').focus();
});
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  const btn = e.submitter || $('#login-form button');
  btn.disabled = true;
  try {
    const r = await fetch('/jf/Users/AuthenticateByName', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
      body: JSON.stringify({ Username: $('#login-name').value.trim(), Pw: $('#login-pw').value }),
    });
    if (r.status === 401) throw new Error('Wrong username or password');
    if (!r.ok) throw new Error(r.status === 502 ? "Can't reach Jellyfin" : `Sign in failed (${r.status})`);
    const d = await r.json();
    session = { token: d.AccessToken, userId: d.User.Id, name: d.User.Name };
    store.set('session', session);
    store.set('last-user', d.User.Name);
    $('#login-pw').value = '';
    await startApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  } finally { btn.disabled = false; }
});

/* ---------- router ---------- */
let routeToken = 0;
async function route() {
  if (!session) return;
  const token = ++routeToken;
  const raw = location.hash.slice(1) || '/';
  const [p, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  const parts = p.split('/').filter(Boolean);
  clearInterval(heroTimer);
  libObserver?.disconnect();
  if (parts[0] === 'play') { await play(parts[1], params); return; }
  if (!P.el.classList.contains('hidden')) await closePlayer(true);
  $('#user-menu').classList.add('hidden');
  window.scrollTo(0, 0);
  try {
    if (parts[0] === 'library') await renderLibrary(parts[1]);
    else if (parts[0] === 'item') await renderItem(parts[1], params);
    else if (parts[0] === 'search') renderSearch(params);
    else await renderHome();
  } catch (e) {
    if (token === routeToken && session) view.innerHTML = `<div class="page"><p class="empty">${esc(e.message || 'Something went wrong')}<br><br><a class="btn" href="#/">Go home</a></p></div>`;
  }
  if (document.body.classList.contains('remote') && token === routeToken) setTimeout(() => { if (!view.contains(document.activeElement)) moveFocus('down'); }, 60);
}
window.addEventListener('hashchange', () => { sessionStorage.setItem('mq-in-app', '1'); route(); });
window.addEventListener('scroll', () => $('#topbar').classList.toggle('solid', scrollY > 40), { passive: true });

async function startApp() {
  $('#login').classList.add('hidden');
  $('#topbar').classList.remove('hidden');
  $('#tabbar').classList.remove('hidden');
  $('#user-initial').textContent = (session.name || '?')[0].toUpperCase();
  $('#user-name').textContent = `Signed in as ${session.name}`;
  try { await loadLibraries(); } catch (e) { if (!session) return; toast(e.message); }
  route();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
if (session?.token) startApp(); else showLogin();
