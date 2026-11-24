export const PRESETS = {
  midnight: { name: 'Midnight', bg: '#0d151e', panel: '#14212c', fg: '#e7f0f4', muted: '#a6bbc7', line: '#304350', accent: '#6de8bf' },
  aurora:   { name: 'Aurora',   bg: '#07161a', panel: '#0d2228', fg: '#e6f6f3', muted: '#7fa7a3', line: '#1c3b42', accent: '#2de2c4' },
  ember:    { name: 'Ember',    bg: '#140c0a', panel: '#1f1412', fg: '#f8ece6', muted: '#b09189', line: '#3a2420', accent: '#ff7a3d' },
  mono:     { name: 'Mono',     bg: '#0a0a0a', panel: '#151515', fg: '#eaeaea', muted: '#8f8f8f', line: '#2a2a2a', accent: '#ffffff' },
  daylight: { name: 'Daylight', bg: '#eef1f6', panel: '#ffffff', fg: '#151a2a', muted: '#5b6580', line: '#d5dbe8', accent: '#3b6cf6', light: true }
};

export const BASEMAP_URLS = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  voyager: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  demo: 'https://demotiles.maplibre.org/style.json'
};

export const TYPE_COLORS = {
  A: '#ff9f1c', AAAA: '#4ea8ff', CNAME: '#2ec4b6', HTTPS: '#b388ff', SVCB: '#b388ff',
  MX: '#ff5d8f', TXT: '#ffd166', SRV: '#9be564', PTR: '#7bdff2', NS: '#f4a261', other: '#aab2c5'
};

export const DEFAULTS = {
  preset: 'midnight', accent: null, panelOpacity: 0.82, blur: 14, sidebar: 'left', sidebarHidden: false,
  basemap: 'auto', globe: false, hideLocal: true, srcLat: '', srcLng: '',
  colorMode: 'type', anim: 'comet', arcWidth: 2, glow: 4, lifetime: 5, curve: 0.25, maxArcs: 100,
  labels: true, pulse: true
};

const KEY = 'atlas.settings.v1';

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

/** "CNAME→A/AAAA" → "CNAME"; unknown types → "other" */
export function typeKey(queryType) {
  const t = String(queryType || '').split('→')[0].toUpperCase();
  return Object.hasOwn(TYPE_COLORS, t) ? t : 'other';
}

/** Stable, well-spread color per client: golden-angle hues in order of first appearance. */
export class ClientColors {
  constructor() { this.index = new Map(); }
  get(ip) {
    let i = this.index.get(ip);
    if (i === undefined) { i = this.index.size; this.index.set(ip, i); }
    return `hsl(${Math.round((i * 137.508) % 360)} 80% 62%)`;
  }
}

