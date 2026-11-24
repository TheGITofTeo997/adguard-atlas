import * as maplibregl from '/vendor/maplibre-gl/maplibre-gl.mjs';
import { PRESETS, BASEMAP_URLS, TYPE_COLORS, DEFAULTS, loadSettings, saveSettings, typeKey, ClientColors } from './config.js';
import { initSettingsUI } from './settings-ui.js';

const $ = (id) => document.getElementById(id);
const EMPTY = { type: 'FeatureCollection', features: [] };
const LOCAL = /\.(local|lan|home|arpa|internal|localdomain)\.?$/i;

const settings = loadSettings();
const colors = new ClientColors();
const clients = new Map();          // ip -> { count, last }
const arcs = [];
const labels = new Set();
const stats = { total: 0, blocked: 0, msSum: 0, msN: 0 };
let serverSource = null;
let lastStats = null;
let activeTab = 'domains';
let mapReady = false;
let firstConfig = true;

/* ---------------- theme ---------------- */
function applyTheme() {
  const p = PRESETS[settings.preset] ?? PRESETS.midnight;
  const r = document.documentElement;
  const vars = { '--bg': p.bg, '--panel': p.panel, '--fg': p.fg, '--muted': p.muted, '--line': p.line, '--accent': settings.accent || p.accent };
  for (const [k, v] of Object.entries(vars)) r.style.setProperty(k, v);
  r.style.setProperty('--panel-alpha', settings.panelOpacity);
  r.style.setProperty('--blur', `${settings.blur}px`);
  r.dataset.theme = p.light ? 'light' : 'dark';
  r.dataset.side = settings.sidebar;
  r.dataset.panel = settings.sidebarHidden ? 'hidden' : 'visible';
  $('panel').hidden = settings.sidebarHidden;
  $('show-panel').hidden = !settings.sidebarHidden;
}

const styleUrl = () => {
  const key = settings.basemap === 'auto' ? (PRESETS[settings.preset]?.light ? 'light' : 'dark') : settings.basemap;
  return BASEMAP_URLS[key] ?? BASEMAP_URLS.dark;
};

/* ---------------- source location ---------------- */
function getSource() {
  const lat = Number.parseFloat(settings.srcLat);
  const lng = Number.parseFloat(settings.srcLng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  return serverSource ?? { lat: 20, lng: 0 };
}

/* ---------------- map ---------------- */
let currentStyle = styleUrl();
const map = new maplibregl.Map({ container: 'map', style: currentStyle, center: [10, 25], zoom: 1.6, attributionControl: { compact: true } });
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

function fatal(msg) {
  $('spinner').hidden = true;
  $('loading-text').textContent = msg;
  $('loading').hidden = false;
}
const hideLoading = () => { $('loading').hidden = true; };
setTimeout(hideLoading, 8000); // never block the UI on slow basemap tiles

map.on('load', hideLoading);
map.on('idle', hideLoading);
map.on('error', (e) => {
  if (/webgl/i.test(String(e?.error?.message ?? ''))) fatal('WebGL2 is required to draw the map. Enable hardware acceleration or try another browser.');
});

function dstLayer(id, filter, paint) { map.addLayer({ id, type: 'circle', source: 'atlas', filter, paint }); }

map.on('style.load', () => {
  map.addSource('atlas', { type: 'geojson', data: EMPTY });
  const is = (k) => ['==', ['get', 'k'], k];
  const line = { 'line-cap': 'round', 'line-join': 'round' };
  map.addLayer({ id: 'arc-glow', type: 'line', source: 'atlas', filter: is('arc'), layout: line,
    paint: { 'line-color': ['get', 'c'], 'line-width': 8, 'line-blur': 4, 'line-opacity': ['*', ['get', 'o'], 0.35] } });
  map.addLayer({ id: 'arc-line', type: 'line', source: 'atlas', filter: is('arc'), layout: line,
    paint: { 'line-color': ['get', 'c'], 'line-width': 2, 'line-opacity': ['get', 'o'] } });
  dstLayer('dst', is('dst'), { 'circle-color': ['get', 'c'], 'circle-radius': ['get', 'r'], 'circle-opacity': ['get', 'o'], 'circle-blur': 0.3 });
  dstLayer('src-halo', is('src'), { 'circle-color': '#5b8cff', 'circle-radius': 16, 'circle-opacity': 0.2 });
  dstLayer('src', is('src'), { 'circle-color': '#ffffff', 'circle-radius': 5, 'circle-stroke-color': '#5b8cff', 'circle-stroke-width': 2 });
  applyArcPaint();
  applyProjection();
  mapReady = true;
});

function applyProjection() {
  try { map.setProjection({ type: settings.globe ? 'globe' : 'mercator' }); } catch { /* unsupported */ }
}

function applyArcPaint() {
  if (!map.getLayer('arc-line')) return;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5b8cff';
  map.setPaintProperty('arc-line', 'line-width', settings.arcWidth);
  map.setPaintProperty('arc-glow', 'line-width', settings.arcWidth * 3 + settings.glow);
  map.setPaintProperty('arc-glow', 'line-blur', settings.glow);
  map.setLayoutProperty('arc-glow', 'visibility', settings.glow > 0 ? 'visible' : 'none');
  map.setPaintProperty('src', 'circle-stroke-color', accent);
  map.setPaintProperty('src-halo', 'circle-color', accent);
}

function refreshBasemap() {
  const u = styleUrl();
  if (u === currentStyle) return;
  currentStyle = u;
  mapReady = false;
  map.setStyle(u);
}

/* ---------------- arcs ---------------- */
function arcPoints(a, b, n = 48) {
  let bl = b[0];
  while (bl - a[0] > 180) bl -= 360;
  while (bl - a[0] < -180) bl += 360;
  const dx = bl - a[0], dy = b[1] - a[1], k = settings.curve;
  const c = [(a[0] + bl) / 2 - dy * k, (a[1] + b[1]) / 2 + dx * k];
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1), u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * bl, u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
  });
}

const colorFor = (type, ip) => (settings.colorMode === 'client' ? colors.get(ip) : TYPE_COLORS[type] ?? TYPE_COLORS.other);
const dot = (coordinates, c, r, o) => ({ type: 'Feature', properties: { k: 'dst', c, r, o }, geometry: { type: 'Point', coordinates } });

let lastFrame = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (!mapReady || now - lastFrame < 33) return;
  lastFrame = now;
  const src = map.getSource('atlas');
  if (!src) return;
  const s = getSource();
  const life = settings.lifetime * 1000;
  const features = [{ type: 'Feature', properties: { k: 'src' }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } }];

  for (let i = arcs.length - 1; i >= 0; i--) {
    const a = arcs[i];
    const p = (now - a.t0) / life;
    if (p >= 1) { arcs.splice(i, 1); continue; }
    const last = a.pts.length - 1;
    let head, tail, o = 1;
    if (settings.anim === 'fade') { head = Math.min(1, p / 0.3); tail = 0; o = p < 0.5 ? 1 : Math.max(0, 1 - (p - 0.5) * 2); }
    else { head = p < 0.5 ? p * 2 : 1; tail = p < 0.5 ? 0 : (p - 0.5) * 2; }
    const c = colorFor(a.type, a.ip);
    const seg = a.pts.slice(Math.floor(tail * last), Math.ceil(head * last) + 1);
    if (seg.length >= 2) features.push({ type: 'Feature', properties: { k: 'arc', c, o }, geometry: { type: 'LineString', coordinates: seg } });
    if (head >= 1) {
      if (!a.arrivedAt) { a.arrivedAt = now; showLabel(a, c); }
      const end = a.pts[last];
      const base = settings.anim === 'fade' ? o : 1 - tail;
      features.push(dot(end, c, 2.5, base));
      const q = Math.min(1, (now - a.arrivedAt) / 1200);
      if (settings.pulse && q < 1) features.push(dot(end, c, 3 + 10 * q, (1 - q) * 0.7 * base));
    }
  }
  src.setData({ type: 'FeatureCollection', features });
}
requestAnimationFrame(frame);

function showLabel(a, color) {
  if (!settings.labels || labels.size >= 12) return;
  const el = document.createElement('div');
  el.className = 'map-label';
  el.style.setProperty('--c', color);
  const d = document.createElement('b');
  d.textContent = a.domain;
  const where = document.createElement('span');
  where.textContent = [a.city, a.country].filter((x) => x && x !== 'Unknown').join(', ');
  el.append(d, where);
  const m = new maplibregl.Marker({ element: el, anchor: 'left', offset: [10, 0] }).setLngLat(a.pts.at(-1)).addTo(map);
  labels.add(m);
  setTimeout(() => { m.remove(); labels.delete(m); }, 2600);
}

/* ---------------- incoming data ---------------- */
function onQuery(m) {
  const d = m.data;
  if (!d || typeof d.domain !== 'string') return;
  if (settings.hideLocal && LOCAL.test(d.domain)) return;
  stats.total++;
  if (d.filtered) stats.blocked++;
  const ms = Number.parseFloat(d.elapsed);
  if (ms > 0) { stats.msSum += ms; stats.msN++; }

  const ip = typeof d.clientIp === 'string' && d.clientIp ? d.clientIp : 'unknown';
  const cl = clients.get(ip) ?? { count: 0, last: 0 };
  cl.count++; cl.last = Date.now();
  clients.set(ip, cl);
  if (clients.size > 300) clients.delete(clients.keys().next().value);
  colors.get(ip);

  const type = typeKey(d.queryType);
  addLog(d, colorFor(type, ip));

  const dest = m.destination;
  if (mapReady && dest && !d.filtered && Number.isFinite(dest.lat) && Number.isFinite(dest.lng) && arcs.length < settings.maxArcs) {
    const s = getSource();
    arcs.push({ pts: arcPoints([s.lng, s.lat], [dest.lng, dest.lat]), type, ip, domain: d.domain, city: dest.city, country: dest.country, t0: performance.now() });
  }
}

function addLog(d, color) {
  $('log-empty')?.remove();
  const row = document.createElement('div');
  row.className = d.filtered ? 'log-row is-blocked' : 'log-row';
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.style.setProperty('--c', color);
  tag.textContent = String(d.queryType || '?').slice(0, 8);
  const name = document.createElement('span');
  name.className = 'log-domain';
  name.textContent = d.domain;
  const meta = document.createElement('span');
  meta.className = 'log-meta';
  meta.textContent = d.filtered ? 'blocked' : (d.clientIp || '');
  row.append(tag, name, meta);
  const log = $('log');
  log.prepend(row);
  while (log.children.length > 40) log.lastChild.remove();
}

function onMessage(m) {
  switch (m.type) {
    case 'connected':
      if (m.config?.source) {
        serverSource = m.config.source;
        if (firstConfig) {
          firstConfig = false;
          const s = getSource();
          map.easeTo({ center: [s.lng, Math.max(-50, Math.min(60, s.lat))], zoom: 1.8, duration: 1500 });
        }
      }
      break;
    case 'dns_query': onQuery(m); break;
    case 'stats': lastStats = m.data; break;
    case 'error': addLog({ domain: String(m.message ?? 'Server error'), queryType: 'ERR', filtered: false }, '#f85149'); break;
  }
}

/* ---------------- websocket (auto-reconnect forever, back to login if session expired) ---------------- */
let retry = 0;
function setConn(state, text) { $('conn').dataset.state = state; $('conn').textContent = text; }

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  ws.onopen = () => { retry = 0; setConn('live', 'Live'); hideLoading(); };
  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m && typeof m === 'object' && m.type) onMessage(m);
  };
  ws.onclose = async () => {
    setConn('connecting', 'Reconnecting');
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin' });
      if (r.status === 401) { location.href = '/login/'; return; }
    } catch { /* server down: keep retrying */ }
    retry++;
    setTimeout(connect, Math.min(1000 * 2 ** retry, 15000));
  };
}

/* ---------------- sidebar rendering ---------------- */
const clear = (el) => el.replaceChildren();

function renderLegend() {
  const box = $('legend');
  clear(box);
  if (settings.colorMode === 'client') {
    const list = [...clients].sort((a, b) => b[1].last - a[1].last).slice(0, 8);
    if (!list.length) { box.textContent = 'Waiting for clients…'; return; }
    for (const [ip, c] of list) {
      const row = document.createElement('div');
      row.className = 'leg-row';
      const sw = document.createElement('i'); sw.style.setProperty('--c', colors.get(ip));
      const name = document.createElement('span'); name.textContent = ip;
      const n = document.createElement('em'); n.textContent = c.count;
      row.append(sw, name, n);
      box.append(row);
    }
  } else {
    for (const [t, c] of Object.entries(TYPE_COLORS)) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      const sw = document.createElement('i'); sw.style.setProperty('--c', c);
      chip.append(sw, t === 'other' ? 'Other' : t);
      box.append(chip);
    }
  }
}

function renderTop() {
  const box = $('top');
  clear(box);
  const src = { domains: lastStats?.topQueriedDomains, blocked: lastStats?.topBlockedDomains, clients: lastStats?.topClients }[activeTab];
  const items = (Array.isArray(src) ? src : []).slice(0, 8).map((o) => Object.entries(o ?? {})[0]).filter(Boolean);
  if (!items.length) { box.textContent = 'No data yet…'; return; }
  const max = Math.max(...items.map(([, n]) => Number(n) || 0), 1);
  for (const [name, n] of items) {
    const row = document.createElement('div');
    row.className = 'top-row';
    row.style.setProperty('--w', `${Math.round(((Number(n) || 0) / max) * 100)}%`);
    if (activeTab === 'clients') { const sw = document.createElement('i'); sw.style.setProperty('--c', colors.get(name)); row.append(sw); }
    const label = document.createElement('span'); label.textContent = name;
    const count = document.createElement('em'); count.textContent = n;
    row.append(label, count);
    box.append(row);
  }
}

setInterval(() => {
  $('s-active').textContent = arcs.length;
  $('s-total').textContent = stats.total.toLocaleString();
  $('s-blocked').textContent = stats.blocked.toLocaleString();
  $('s-blocked-l').textContent = stats.total ? `Blocked · ${Math.round((stats.blocked / stats.total) * 100)}%` : 'Blocked';
  $('s-ms').textContent = stats.msN ? Math.round(stats.msSum / stats.msN) : 0;
  renderLegend();
  renderTop();
}, 1000);

/* ---------------- controls ---------------- */
function syncMode() {
  for (const b of $('color-mode').children) b.classList.toggle('on', b.dataset.mode === settings.colorMode);
  renderLegend();
}

function onSettingChange(key) {
  saveSettings(settings);
  applyTheme();
  if (key === 'preset' || key === 'basemap') refreshBasemap();
  if (key === 'globe') applyProjection();
  if (key === 'colorMode') syncMode();
  if (mapReady) applyArcPaint();
}

for (const b of $('color-mode').children) {
  b.addEventListener('click', () => { settings.colorMode = b.dataset.mode; onSettingChange('colorMode'); ui.refresh(); });
}
for (const b of $('tabs').children) {
  b.addEventListener('click', () => {
    activeTab = b.dataset.tab;
    for (const x of $('tabs').children) x.classList.toggle('on', x === b);
    renderTop();
  });
}
$('btn-hide').addEventListener('click', () => { settings.sidebarHidden = true; onSettingChange('sidebarHidden'); });
$('show-panel').addEventListener('click', () => { settings.sidebarHidden = false; onSettingChange('sidebarHidden'); });
$('btn-logout').addEventListener('click', async () => {
  try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); }
  finally { location.href = '/login/'; }
});

const ui = initSettingsUI({
  settings, defaults: DEFAULTS, presets: PRESETS,
  onChange: onSettingChange,
  getServerSource: () => serverSource
});
$('btn-settings').addEventListener('click', () => ui.open());

applyTheme();
syncMode();
connect();
