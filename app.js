/* Bubble Diagram — true-scale program diagrams over a calibrated site plan.
   World units are always feet (areas in SF). Display can switch to metres. */
(() => {
'use strict';

// ---------------------------------------------------------------- constants
const $ = s => document.querySelector(s);
const SF_M2 = 0.09290304, FT_M = 0.3048;
const STORE_KEY = 'bubble-diagram:v1';
// Well-separated categorical palette (Tableau-10 order, then two extras).
const PALETTE = ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948',
                 '#B07AA1', '#FF9DA7', '#9C755F', '#A0CBE8', '#D37295', '#8CD17D'];
const LINE_COLORS = ['#1b1b1b', '#6b6b6b', '#c0392b', '#2457d6', '#2e7d4f', '#d97706'];
const REL = {
  required:  { label: 'Required',  color: '#1b1b1b', width: 3,    dash: 'solid' },
  preferred: { label: 'Preferred', color: '#1b1b1b', width: 1.25, dash: 'solid' },
  avoid:     { label: 'Avoid',     color: '#c0392b', width: 1.5,  dash: 'dash'  },
};
const REL_ORDER = ['required', 'preferred', 'avoid'];
const LABEL_FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
// Drawing scales as feet of real distance per inch of paper.
const SCALES = [
  ['1/32" = 1\'-0"', 32], ['1/16" = 1\'-0"', 16], ['3/32" = 1\'-0"', 32 / 3], ['1/8" = 1\'-0"', 8],
  ['3/16" = 1\'-0"', 16 / 3], ['1/4" = 1\'-0"', 4], ['3/8" = 1\'-0"', 8 / 3], ['1/2" = 1\'-0"', 2],
  ['1" = 10\'', 10], ['1" = 20\'', 20], ['1" = 30\'', 30], ['1" = 40\'', 40], ['1" = 50\'', 50],
  ['1" = 60\'', 60], ['1" = 100\'', 100], ['1" = 200\'', 200],
  ['1:100', 100 / 12], ['1:200', 200 / 12], ['1:250', 250 / 12], ['1:500', 500 / 12], ['1:1000', 1000 / 12],
];

const svg = $('#svg'), gGrid = $('#gGrid'), gObj = $('#gObj'), gUi = $('#gUi');
const bdImage = $('#bdImage'), stage = $('#stage'), inspector = $('#inspector');

// ---------------------------------------------------------------- state
let S = freshState();
let view = { z: 4, tx: 300, ty: 200 };          // screen = world * z + t   (z = px per ft)
let sel = new Set();
let tool = 'select';
let srcCache = {};                               // backdrop srcId -> dataURL
let bdImg = null;                                // decoded backdrop for PNG export
let drag = null, draft = null, calib = null, meas = null, lastClick = null;
let spaceDown = false, cursorW = null, hoverBlock = null;
let relPick = 'required';
let leftTab = 'prog';
let uid = 0;
const newId = p => p + Date.now().toString(36).slice(-4) + (++uid).toString(36) + Math.random().toString(36).slice(2, 5);

function freshState() {
  return {
    app: 'bubble-diagram', version: 1, name: 'Untitled diagram', units: 'ft',
    backdrop: null, objects: [], zones: {},
    settings: { grid: true, gridSize: 10, snap: false, labelSize: 12, fillOpacity: 0.6, newShape: 'ellipse',
                colorBy: 'program', hulls: true, legend: true },
    pathStyle: { color: '#1b1b1b', width: 1.5, dash: 'solid', arrowStart: false, arrowEnd: false },
  };
}

// ---------------------------------------------------------------- units & format
const isM = () => S.units === 'm';
const lenOut = ft => isM() ? ft * FT_M : ft;
const lenIn = v => isM() ? v / FT_M : v;
const areaOut = sf => isM() ? sf * SF_M2 : sf;
const areaIn = v => isM() ? v / SF_M2 : v;
const areaUnit = () => isM() ? 'm²' : 'SF';
const lenUnit = () => isM() ? 'm' : 'ft';
function fmtArea(sf, withUnit = true) {
  const v = areaOut(sf);
  const s = isM() ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : Math.round(v).toLocaleString('en-US');
  return withUnit ? s + ' ' + areaUnit() : s;
}
function fmtLen(ft) {
  if (isM()) return (ft * FT_M).toFixed(2) + ' m';
  const neg = ft < 0; ft = Math.abs(ft);
  let f = Math.floor(ft), i = Math.round((ft - f) * 12);
  if (i === 12) { f++; i = 0; }
  return (neg ? '-' : '') + f + "'-" + i + '"';
}
const r2 = v => Math.round(v * 100) / 100;
const f2 = v => (Math.round(v * 100) / 100).toString();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function pctDiff(a, t) { return t > 0 ? (a - t) / t : 0; }
function fmtPct(d) { return (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d * 100).toFixed(1) + '%'; }

function parseLength(s, defUnit) {
  s = String(s).trim().toLowerCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  let m;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*-?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/))) return +m[1] + (m[2] ? +m[2] / 12 : 0);
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in)$/))) return +m[1] / 12;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*m$/))) return +m[1] / FT_M;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*cm$/))) return +m[1] / 30.48;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*mm$/))) return +m[1] / 304.8;
  if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) return defUnit === 'm' ? +m[1] / FT_M : +m[1];
  return NaN;
}

// ---------------------------------------------------------------- colour
function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function shade(h, k) { const [r, g, b] = hexToRgb(h); return rgbToHex(r * (1 - k), g * (1 - k), b * (1 - k)); }
function hslHex(hh, s, l) {
  s /= 100; l /= 100; const a = s * Math.min(l, 1 - l);
  const f = n => { const k = (n + hh / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}
function pickColor(usedList) {
  const used = {};
  usedList.forEach(c => { c = (c || '').toLowerCase(); used[c] = (used[c] || 0) + 1; });
  const free = PALETTE.find(c => !used[c.toLowerCase()]);
  if (free) return free;
  // palette exhausted: golden-angle hues, still distinct from each other
  const n = usedList.length;
  return hslHex((n * 137.508 + 20) % 360, 52, 58);
}
const nextBlockColor = () => pickColor(blocks().map(b => b.color));
function zoneColor(z) {
  if (!z) return '#9a9a96';
  if (!S.zones[z]) S.zones[z] = pickColor(Object.values(S.zones));
  return S.zones[z];
}
const fillOf = b => (S.settings.colorBy === 'zone' && b.zone) ? zoneColor(b.zone) : b.color;

// ---------------------------------------------------------------- geometry
const blocks = () => S.objects.filter(o => o.type === 'block');
const paths = () => S.objects.filter(o => o.type === 'path');
const byId = id => S.objects.find(o => o.id === id);
const areaOf = b => b.shape === 'ellipse' ? Math.PI * b.w * b.h / 4 : b.w * b.h;
const targetOf = b => (b.target || 0) * (b.qty || 1);
function rot(x, y, deg) { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return { x: x * c - y * s, y: x * s + y * c }; }
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
function norm(a) { const l = Math.hypot(a.x, a.y); return l < 1e-9 ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l }; }
function sizeForArea(shape, A, ratio = 1) {
  if (shape === 'ellipse') { const h = Math.sqrt(4 * A / (Math.PI * ratio)); return { w: h * ratio, h }; }
  const h = Math.sqrt(A / ratio); return { w: h * ratio, h };
}
function boundaryPoint(b, target) {
  const d = rot(target.x - b.cx, target.y - b.cy, -b.rot);
  if (Math.abs(d.x) < 1e-9 && Math.abs(d.y) < 1e-9) return { x: b.cx, y: b.cy };
  const a = b.w / 2, c = b.h / 2;
  let t;
  if (b.shape === 'ellipse') t = 1 / Math.sqrt((d.x / a) ** 2 + (d.y / c) ** 2);
  else t = Math.min(Math.abs(d.x) > 1e-9 ? a / Math.abs(d.x) : Infinity, Math.abs(d.y) > 1e-9 ? c / Math.abs(d.y) : Infinity);
  const p = rot(d.x * t, d.y * t, b.rot);
  return { x: b.cx + p.x, y: b.cy + p.y };
}
function pointInBlock(b, p, padFt = 0) {
  const d = rot(p.x - b.cx, p.y - b.cy, -b.rot);
  const a = b.w / 2 + padFt, c = b.h / 2 + padFt;
  if (b.shape === 'ellipse') return (d.x / a) ** 2 + (d.y / c) ** 2 <= 1;
  return Math.abs(d.x) <= a && Math.abs(d.y) <= c;
}
function blockOutline(b, n = 32, padFt = 0) {
  const pts = [];
  if (b.shape === 'ellipse') {
    for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; const p = rot(Math.cos(t) * (b.w / 2 + padFt), Math.sin(t) * (b.h / 2 + padFt), b.rot); pts.push({ x: b.cx + p.x, y: b.cy + p.y }); }
  } else {
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const p = rot(sx * (b.w / 2 + padFt), sy * (b.h / 2 + padFt), b.rot); pts.push({ x: b.cx + p.x, y: b.cy + p.y }); }
  }
  return pts;
}
function bboxOfPts(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  pts.forEach(p => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
  return { x0, y0, x1, y1 };
}
function bboxOf(o) { return bboxOfPts(o.type === 'block' ? blockOutline(o, 24) : resolvedPoints(o)); }
function hitBlockAt(p, exclude) {
  const bs = blocks();
  for (let i = bs.length - 1; i >= 0; i--) if (bs[i].id !== exclude && pointInBlock(bs[i], p)) return bs[i];
  return null;
}
// Endpoints attached to blocks are resolved to the block boundary, facing the neighbour point.
function resolvedPoints(p) {
  const pts = p.points.map(q => ({ x: q.x, y: q.y }));
  const n = pts.length;
  p.points.forEach((q, i) => {
    if (!q.to) return;
    const b = byId(q.to);
    if (!b || (i !== 0 && i !== n - 1)) { delete q.to; return; }
    q.x = b.cx; q.y = b.cy; pts[i] = { x: b.cx, y: b.cy };
  });
  const out = pts.map(q => ({ ...q }));
  [[0, 1], [n - 1, n - 2]].forEach(([i, j]) => {
    const q = p.points[i];
    if (q && q.to && n > 1) out[i] = boundaryPoint(byId(q.to), pts[j]);
  });
  return out;
}
function convexHull(pts) {
  pts = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop();
  return lo.concat(up);
}
function catmull(pts) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || pts[i + 1];
    segs.push([p1, add(p1, mul(sub(p2, p0), 1 / 6)), sub(p2, mul(sub(p3, p1), 1 / 6)), p2]);
  }
  return segs;
}

// ---------------------------------------------------------------- view transforms
const w2s = (v, x, y) => ({ x: x * v.z + v.tx, y: y * v.z + v.ty });
const canvasW = () => svg.clientWidth || Math.max(320, window.innerWidth - 536) || 900;
const canvasH = () => svg.clientHeight || Math.max(320, window.innerHeight - 76) || 600;
const viewOk = v => v && [v.z, v.tx, v.ty].every(Number.isFinite) && v.z > 0;
const toW = sp => ({ x: (sp.x - view.tx) / view.z, y: (sp.y - view.ty) / view.z });
function spt(e) { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
const gridFt = () => { const g = +S.settings.gridSize || 10; return isM() ? g / FT_M : g; };
function snapPt(p) {
  if (!S.settings.snap) return { x: p.x, y: p.y };
  const g = gridFt(); return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
}

// ---------------------------------------------------------------- history & persistence
let hist = [], hIdx = -1;
const snapshot = () => JSON.stringify({ objects: S.objects, backdrop: S.backdrop, zones: S.zones });
function commit() {
  hist = hist.slice(0, hIdx + 1);
  hist.push(snapshot());
  if (hist.length > 200) hist.shift();
  hIdx = hist.length - 1;
  scheduleSave();
  requestRender();
}
function restore(str) {
  const o = JSON.parse(str);
  S.objects = o.objects; S.backdrop = o.backdrop; S.zones = o.zones || {};
  sel = new Set([...sel].filter(id => byId(id)));
  syncBackdropImage();
  scheduleSave(); requestRender();
}
function undo() { if (hIdx > 0) { hIdx--; restore(hist[hIdx]); } }
function redo() { if (hIdx < hist.length - 1) { hIdx++; restore(hist[hIdx]); } }

// IndexedDB holds the (possibly large) backdrop image; localStorage holds the rest.
const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('bubble-diagram', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = (mode, fn) => open().then(db => new Promise((res, rej) => {
    const t = db.transaction('kv', mode); const st = t.objectStore('kv'); const q = fn(st);
    t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error);
  }));
  return { get: k => tx('readonly', s => s.get(k)), put: (k, v) => tx('readwrite', s => s.put(v, k)), del: k => tx('readwrite', s => s.delete(k)) };
})();
let saveTimer = 0, savedSrcId = null;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveLocal, 400); }
function saveLocal() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ state: S, view })); } catch (e) { /* storage full or blocked */ }
  const id = S.backdrop ? S.backdrop.srcId : null;
  if (id !== savedSrcId) {
    const p = id ? idb.put('backdrop', { id, src: srcCache[id] }) : idb.del('backdrop');
    p.then(() => { savedSrcId = id; }).catch(() => {});
  }
}
async function loadLocal() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { raw = null; }
  if (!raw || !raw.state) return false;
  S = Object.assign(freshState(), raw.state);
  S.settings = Object.assign(freshState().settings, raw.state.settings || {});
  S.pathStyle = Object.assign(freshState().pathStyle, raw.state.pathStyle || {});
  const badBlock = o => o.type === 'block' && ![o.cx, o.cy, o.w, o.h].every(Number.isFinite);
  if ((raw.state.objects || []).some(badBlock)) {
    if (/^Example/.test(raw.state.name || '')) { S = freshState(); return false; }
    raw.state.objects.forEach(o => { if (badBlock(o)) { o.cx = Number.isFinite(o.cx) ? o.cx : 0; o.cy = Number.isFinite(o.cy) ? o.cy : 0; } });
    raw.view = null;
  }
  if (viewOk(raw.view)) view = raw.view;
  if (S.backdrop) {
    try {
      const rec = await idb.get('backdrop');
      if (rec && rec.id === S.backdrop.srcId) { srcCache[rec.id] = rec.src; savedSrcId = rec.id; }
      else S.backdrop = null;
    } catch (e) { S.backdrop = null; }
  }
  return true;
}

// ---------------------------------------------------------------- rendering
let raf = 0;
function requestRender() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); }
function render() {
  if (!viewOk(view)) { view = { z: 4, tx: canvasW() / 2, ty: canvasH() / 2 }; zoomFit(); }
  const W = svg.clientWidth, H = svg.clientHeight;
  syncBackdropImage();
  gGrid.innerHTML = S.settings.grid ? gridSVG(view, W, H) : '';
  gObj.innerHTML = objectsSVG(view, {});
  gUi.innerHTML = uiSVG(W, H);
  $('#emptyState').style.display = (!S.backdrop && !S.objects.length) ? '' : 'none';
  syncPanels();
}

let bdHref = null;
function syncBackdropImage() {
  const bd = S.backdrop;
  if (!bd || !bd.visible || !srcCache[bd.srcId]) { bdImage.style.display = 'none'; return; }
  const src = srcCache[bd.srcId];
  if (bdHref !== src) {
    bdImage.setAttribute('href', src); bdHref = src;
    bdImg = new Image(); bdImg.src = src;
  }
  const p = w2s(view, bd.x, bd.y);
  bdImage.setAttribute('x', p.x); bdImage.setAttribute('y', p.y);
  bdImage.setAttribute('width', Math.max(0, bd.w * bd.ftPerPx * view.z));
  bdImage.setAttribute('height', Math.max(0, bd.h * bd.ftPerPx * view.z));
  bdImage.setAttribute('opacity', bd.opacity);
  bdImage.style.display = '';
}

function gridSVG(v, W, H) {
  let step = gridFt(); if (!(step > 0)) return '';
  while (step * v.z < 8) step *= 5;
  const major = step * 5;
  let mi = '', ma = '';
  const x0 = Math.floor(-v.tx / v.z / step) * step, y0 = Math.floor(-v.ty / v.z / step) * step;
  for (let x = x0; x * v.z + v.tx < W; x += step) {
    const s = Math.round(x * v.z + v.tx) + 0.5;
    const isMaj = Math.abs(x / major - Math.round(x / major)) < 1e-6;
    (isMaj ? (ma += `M${s} 0V${H}`) : (mi += `M${s} 0V${H}`));
  }
  for (let y = y0; y * v.z + v.ty < H; y += step) {
    const s = Math.round(y * v.z + v.ty) + 0.5;
    const isMaj = Math.abs(y / major - Math.round(y / major)) < 1e-6;
    (isMaj ? (ma += `M0 ${s}H${W}`) : (mi += `M0 ${s}H${W}`));
  }
  return `<path d="${mi}" stroke="#e6e8ec" stroke-width="1" fill="none"/><path d="${ma}" stroke="#cfd4db" stroke-width="1" fill="none"/>`;
}

function objectsSVG(v, opts) {
  const k = v.k || 1;
  let out = '';
  const hulls = S.settings.hulls ? hullsSVG(v) : { shapes: '', labels: '' };
  out += hulls.shapes;
  for (const o of S.objects) out += o.type === 'block' ? blockSVG(v, o, opts) : pathSVG(v, o, opts);
  out += `<g pointer-events="none">${hulls.labels}${blocks().map(b => labelSVG(v, b)).join('')}</g>`;
  return out;
}

function hullsSVG(v) {
  const k = v.k || 1;
  const groups = {};
  blocks().forEach(b => { if (b.zone) (groups[b.zone] = groups[b.zone] || []).push(b); });
  let out = '', labels = '';
  for (const [z, bs] of Object.entries(groups)) {
    const padFt = 14 * k / v.z;
    const pts = convexHull(bs.flatMap(b => blockOutline(b, 28, padFt))).map(p => w2s(v, p.x, p.y));
    if (pts.length < 3) continue;
    const d = 'M' + pts.map(p => `${f2(p.x)} ${f2(p.y)}`).join('L') + 'Z';
    const top = pts.reduce((a, p) => p.y < a.y ? p : a, pts[0]);
    const col = zoneColor(z);
    out += `<path d="${d}" fill="${col}" fill-opacity="0.07" stroke="${shade(col, .25)}" stroke-opacity=".75" stroke-width="${f2(1 * k)}" stroke-dasharray="${f2(5 * k)} ${f2(4 * k)}" stroke-linejoin="round" pointer-events="none"/>`;
    labels += `<text x="${f2(top.x)}" y="${f2(top.y - 6 * k)}" text-anchor="middle" font-family='${LABEL_FONT}' font-size="${f2(10 * k)}" letter-spacing="${f2(1.2 * k)}" fill="${shade(col, .45)}" paint-order="stroke" stroke="#fff" stroke-width="${f2(3 * k)}" stroke-linejoin="round">${esc(z.toUpperCase())}</text>`;
  }
  return { shapes: out, labels };
}

function blockSVG(v, b, opts) {
  const k = v.k || 1;
  const c = w2s(v, b.cx, b.cy), w = b.w * v.z, h = b.h * v.z;
  const fill = fillOf(b), st = shade(fill, 0.35);
  const shape = b.shape === 'ellipse'
    ? `<ellipse cx="${f2(c.x)}" cy="${f2(c.y)}" rx="${f2(w / 2)}" ry="${f2(h / 2)}"`
    : `<rect x="${f2(c.x - w / 2)}" y="${f2(c.y - h / 2)}" width="${f2(w)}" height="${f2(h)}"`;
  const attrs = opts.export ? `id="${esc(slug(b.name))}"` : `data-id="${b.id}" class="obj block"`;
  return `<g ${attrs} transform="rotate(${f2(b.rot)} ${f2(c.x)} ${f2(c.y)})">${shape} fill="${fill}" fill-opacity="${S.settings.fillOpacity}" stroke="${st}" stroke-width="${f2(1.2 * k)}"/></g>`;
}
const slug = s => String(s || 'block').replace(/[^\w-]+/g, '_');

function labelSVG(v, b) {
  const k = v.k || 1;
  const c = w2s(v, b.cx, b.cy);
  const L = S.settings.labelSize * k;
  const A = areaOf(b), T = targetOf(b);
  const small = Math.min(b.w, b.h) * v.z < 34 * k;
  const lines = [{ t: b.name + ((b.qty || 1) > 1 ? ` ×${b.qty}` : ''), s: L, w: 600, fill: '#141414' }];
  if (!small) {
    lines.push({ t: fmtArea(A), s: L * 0.9, w: 400, fill: '#2a2a2a', mono: true });
    if (T > 0) {
      const d = pctDiff(A, T);
      if (Math.abs(d) < 0.005) lines.push({ t: `on target`, s: L * 0.78, w: 500, fill: '#3f6b2f' });
      else lines.push({ t: `${fmtPct(d)} of ${fmtArea(T)}`, s: L * 0.78, w: 500, fill: d > 0 ? '#9a4500' : '#1f4fb8' });
    }
  }
  const gap = 0.22;
  const total = lines.reduce((a, l) => a + l.s * (1 + gap), 0) - lines[lines.length - 1].s * gap;
  let y = c.y - total / 2;
  let tsp = '';
  lines.forEach(l => {
    y += l.s * 0.8;
    tsp += `<tspan x="${f2(c.x)}" y="${f2(y)}" font-size="${f2(l.s)}" font-weight="${l.w}" fill="${l.fill}">${esc(l.t)}</tspan>`;
    y += l.s * (0.2 + gap);
  });
  return `<text text-anchor="middle" font-family='${LABEL_FONT}' paint-order="stroke" stroke="#fff" stroke-opacity=".85" stroke-width="${f2(3 * k)}" stroke-linejoin="round">${tsp}</text>`;
}

function dashArray(dash, w, k) {
  w *= k;
  if (dash === 'dash') return `${f2(4 * w + 4 * k)} ${f2(3 * w + 3 * k)}`;
  if (dash === 'dot') return `0 ${f2(2.2 * w + 2.5 * k)}`;
  if (dash === 'dashdot') return `${f2(5 * w + 6 * k)} ${f2(2 * w + 3 * k)} 0 ${f2(2 * w + 3 * k)}`;
  return '';
}
function pathGeom(v, p, rawPts) {
  const k = v.k || 1;
  const W = (rawPts || resolvedPoints(p)).map(q => w2s(v, q.x, q.y));
  const n = W.length;
  if (n < 2) return null;
  const sw = p.width * k, al = (6 + p.width * 2.4) * k;
  const curve = p.kind === 'curve' && n > 2;
  let sDir, eDir;
  if (curve) { const sg = catmull(W); sDir = norm(sub(W[0], sg[0][1])); eDir = norm(sub(W[n - 1], sg[sg.length - 1][2])); }
  else { sDir = norm(sub(W[0], W[1])); eDir = norm(sub(W[n - 1], W[n - 2])); }
  const pts = W.map(q => ({ ...q }));
  const heads = [];
  const head = (tip, u) => { const b = sub(tip, mul(u, al)), pp = { x: -u.y, y: u.x }, hw = al * 0.4; return [tip, add(b, mul(pp, hw)), sub(b, mul(pp, hw))]; };
  if (p.arrowEnd) { heads.push(head(W[n - 1], eDir)); pts[n - 1] = sub(W[n - 1], mul(eDir, al * 0.7)); }
  if (p.arrowStart) { heads.push(head(W[0], sDir)); pts[0] = sub(W[0], mul(sDir, al * 0.7)); }
  let d;
  if (curve) { const sg = catmull(pts); d = `M${f2(pts[0].x)} ${f2(pts[0].y)}` + sg.map(s => `C${f2(s[1].x)} ${f2(s[1].y)} ${f2(s[2].x)} ${f2(s[2].y)} ${f2(s[3].x)} ${f2(s[3].y)}`).join(''); }
  else d = 'M' + pts.map(q => `${f2(q.x)} ${f2(q.y)}`).join('L');
  // midpoint (by length along the polyline of control points) for the 'avoid' mark
  let L = 0; for (let i = 1; i < n; i++) L += dist(W[i - 1], W[i]);
  let acc = 0, mid = W[0];
  for (let i = 1; i < n; i++) { const s = dist(W[i - 1], W[i]); if (acc + s >= L / 2) { mid = add(W[i - 1], mul(sub(W[i], W[i - 1]), (L / 2 - acc) / (s || 1))); break; } acc += s; }
  return { d, heads, sw, mid };
}
function pathSVG(v, p, opts) {
  const k = v.k || 1;
  const g = pathGeom(v, p); if (!g) return '';
  const da = dashArray(p.dash, p.width, k);
  let s = `<g ${opts.export ? `id="${esc(p.rel ? REL[p.rel].label : 'circulation')}"` : `data-id="${p.id}" class="obj path"`}>`;
  if (!opts.export) s += `<path d="${g.d}" fill="none" stroke="transparent" stroke-width="${g.sw + 12}"/>`;
  s += `<path d="${g.d}" fill="none" stroke="${p.color}" stroke-width="${f2(g.sw)}" stroke-linecap="${p.dash === 'dot' ? 'round' : 'butt'}" stroke-linejoin="round"${da ? ` stroke-dasharray="${da}"` : ''}/>`;
  g.heads.forEach(h => { s += `<polygon points="${h.map(q => `${f2(q.x)},${f2(q.y)}`).join(' ')}" fill="${p.color}"/>`; });
  if (p.rel === 'avoid') {
    const m = g.mid, r = 4.5 * k;
    s += `<circle cx="${f2(m.x)}" cy="${f2(m.y)}" r="${f2(r + 3 * k)}" fill="#fff"/><path d="M${f2(m.x - r)} ${f2(m.y - r)}L${f2(m.x + r)} ${f2(m.y + r)}M${f2(m.x + r)} ${f2(m.y - r)}L${f2(m.x - r)} ${f2(m.y + r)}" stroke="${p.color}" stroke-width="${f2(1.6 * k)}" stroke-linecap="round"/>`;
  }
  return s + '</g>';
}

function scaleBarSVG(v, x, y) {
  const k = v.k || 1;
  const pxPerUnit = isM() ? v.z / FT_M : v.z;
  const raw = 150 * k / pxPerUnit;
  const p10 = Math.pow(10, Math.floor(Math.log10(raw)));
  const L = [5, 2, 1].map(m => m * p10).find(c => c <= raw) || p10;
  const segs = [0, L / 4, L / 2, L];
  let s = `<g font-family='${LABEL_FONT}' font-size="${f2(10 * k)}" fill="#1b1b1b">`;
  for (let i = 0; i < 3; i++) {
    const a = x + segs[i] * pxPerUnit, b = x + segs[i + 1] * pxPerUnit;
    s += `<rect x="${f2(a)}" y="${f2(y)}" width="${f2(b - a)}" height="${f2(5 * k)}" fill="${i % 2 ? '#fff' : '#1b1b1b'}" stroke="#1b1b1b" stroke-width="${f2(0.75 * k)}"/>`;
  }
  segs.forEach((t, i) => { s += `<text x="${f2(x + t * pxPerUnit)}" y="${f2(y - 4 * k)}" text-anchor="middle">${r2(t)}${i === 3 ? ' ' + lenUnit() : ''}</text>`; });
  return s + '</g>';
}

function legendSVG(v, x, y, anchorRight) {
  const k = v.k || 1;
  const used = REL_ORDER.filter(r => paths().some(p => p.rel === r));
  if (!used.length) return '';
  const rowH = 18 * k, w = 128 * k, h = used.length * rowH + 12 * k;
  const x0 = anchorRight ? x - w : x, y0 = y - h;
  let s = `<g font-family='${LABEL_FONT}' font-size="${f2(10 * k)}" pointer-events="none"><rect x="${f2(x0)}" y="${f2(y0)}" width="${f2(w)}" height="${f2(h)}" rx="${f2(4 * k)}" fill="#fff" fill-opacity=".92" stroke="#d0d0cb" stroke-width="${f2(k)}"/>`;
  used.forEach((r, i) => {
    const R = REL[r], yy = y0 + 6 * k + rowH * (i + 0.5);
    const da = dashArray(R.dash, R.width, k);
    s += `<path d="M${f2(x0 + 10 * k)} ${f2(yy)}H${f2(x0 + 44 * k)}" stroke="${R.color}" stroke-width="${f2(R.width * k)}"${da ? ` stroke-dasharray="${da}"` : ''}/>`;
    if (r === 'avoid') { const m = x0 + 27 * k, rr = 3.5 * k; s += `<circle cx="${f2(m)}" cy="${f2(yy)}" r="${f2(rr + 2 * k)}" fill="#fff"/><path d="M${f2(m - rr)} ${f2(yy - rr)}L${f2(m + rr)} ${f2(yy + rr)}M${f2(m + rr)} ${f2(yy - rr)}L${f2(m - rr)} ${f2(yy + rr)}" stroke="${R.color}" stroke-width="${f2(1.4 * k)}"/>`; }
    s += `<text x="${f2(x0 + 52 * k)}" y="${f2(yy + 3.5 * k)}" fill="#1b1b1b" letter-spacing="${f2(0.8 * k)}">${R.label.toUpperCase()}</text>`;
  });
  return s + '</g>';
}

const ACC = '#2457d6';
function uiSVG(W, H) {
  let s = '';
  const objs = [...sel].map(byId).filter(Boolean);
  // selection
  objs.forEach(o => {
    if (o.type === 'block') {
      const c = w2s(view, o.cx, o.cy), w = o.w * view.z, h = o.h * view.z;
      s += `<g transform="rotate(${f2(o.rot)} ${f2(c.x)} ${f2(c.y)})" pointer-events="none"><rect x="${f2(c.x - w / 2 - 3)}" y="${f2(c.y - h / 2 - 3)}" width="${f2(w + 6)}" height="${f2(h + 6)}" fill="none" stroke="${ACC}" stroke-width="1" stroke-dasharray="4 3"/></g>`;
    } else {
      const g = pathGeom(view, o);
      if (g) s += `<path d="${g.d}" fill="none" stroke="${ACC}" stroke-width="1" stroke-dasharray="4 3" pointer-events="none"/>`;
    }
  });
  if (objs.length === 1 && objs[0].type === 'block' && !drag?.noHandles) {
    const b = objs[0], c = w2s(view, b.cx, b.cy), w = b.w * view.z, h = b.h * view.z;
    s += `<g transform="rotate(${f2(b.rot)} ${f2(c.x)} ${f2(c.y)})">`;
    s += `<line x1="${f2(c.x)}" y1="${f2(c.y - h / 2 - 3)}" x2="${f2(c.x)}" y2="${f2(c.y - h / 2 - 24)}" stroke="${ACC}" stroke-width="1"/>`;
    s += `<circle data-handle="rot:${b.id}" cx="${f2(c.x)}" cy="${f2(c.y - h / 2 - 28)}" r="5" fill="#fff" stroke="${ACC}" stroke-width="1.2"/>`;
    for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) {
      if (!sx && !sy) continue;
      const x = c.x + sx * (w / 2 + 3), y = c.y + sy * (h / 2 + 3);
      s += `<rect data-handle="r:${sx}:${sy}" x="${f2(x - 4)}" y="${f2(y - 4)}" width="8" height="8" fill="#fff" stroke="${ACC}" stroke-width="1.2"/>`;
    }
    s += '</g>';
  }
  objs.filter(o => o.type === 'path').forEach(p => {
    const rp = resolvedPoints(p);
    rp.forEach((q, i) => {
      const sp = w2s(view, q.x, q.y), at = !!p.points[i].to;
      s += `<circle data-handle="v:${p.id}:${i}" cx="${f2(sp.x)}" cy="${f2(sp.y)}" r="${at ? 5 : 4}" fill="${at ? ACC : '#fff'}" stroke="${ACC}" stroke-width="1.2"/>`;
    });
  });
  // attach target highlight
  const hb = hoverBlock && byId(hoverBlock);
  if (hb) {
    const pts = blockOutline(hb, 48, 2 / view.z).map(p => w2s(view, p.x, p.y));
    s += `<path d="M${pts.map(p => `${f2(p.x)} ${f2(p.y)}`).join('L')}Z" fill="none" stroke="${ACC}" stroke-width="2" pointer-events="none"/>`;
  }
  // draft path
  if (draft) {
    const pts = draft.points.concat(draft.hover ? [draft.hover] : []);
    const tmp = { kind: draft.kind === 'curve' ? 'curve' : 'line', points: pts.map(q => ({ ...q })), width: S.pathStyle.width, color: S.pathStyle.color, dash: S.pathStyle.dash,
      arrowEnd: draft.kind === 'arrow' ? true : S.pathStyle.arrowEnd, arrowStart: S.pathStyle.arrowStart };
    if (pts.length >= 2) {
      const g = pathGeom(view, tmp);
      if (g) {
        const da = dashArray(tmp.dash, tmp.width, 1);
        s += `<g pointer-events="none" opacity=".85"><path d="${g.d}" fill="none" stroke="${tmp.color}" stroke-width="${tmp.width}"${da ? ` stroke-dasharray="${da}"` : ''}/>${g.heads.map(h => `<polygon points="${h.map(q => `${f2(q.x)},${f2(q.y)}`).join(' ')}" fill="${tmp.color}"/>`).join('')}</g>`;
      }
    }
    draft.points.forEach(q => { const sp = w2s(view, q.x, q.y); s += `<circle cx="${f2(sp.x)}" cy="${f2(sp.y)}" r="3" fill="${ACC}" pointer-events="none"/>`; });
  }
  // calibration and measuring
  const rulerLine = (a, b, label, col) => {
    const A = w2s(view, a.x, a.y), B = w2s(view, b.x, b.y), m = mul(add(A, B), 0.5);
    let t = `<g pointer-events="none"><line x1="${f2(A.x)}" y1="${f2(A.y)}" x2="${f2(B.x)}" y2="${f2(B.y)}" stroke="${col}" stroke-width="1.5"/>`;
    for (const P of [A, B]) t += `<path d="M${f2(P.x - 7)} ${f2(P.y)}H${f2(P.x + 7)}M${f2(P.x)} ${f2(P.y - 7)}V${f2(P.y + 7)}" stroke="${col}" stroke-width="1.2"/><circle cx="${f2(P.x)}" cy="${f2(P.y)}" r="3" fill="none" stroke="${col}"/>`;
    if (label) t += `<text x="${f2(m.x)}" y="${f2(m.y - 8)}" text-anchor="middle" font-family='${LABEL_FONT}' font-size="12" font-weight="600" fill="${col}" paint-order="stroke" stroke="#fff" stroke-width="4" stroke-linejoin="round">${esc(label)}</text>`;
    return t + '</g>';
  };
  if (calib && calib.a) {
    const b = calib.b || calib.hover;
    if (b) { const px = dist(calib.a, b) / S.backdrop.ftPerPx; s += rulerLine(calib.a, b, `${px.toFixed(1)} px on image`, '#d9480f'); }
  }
  if (meas && meas.a) {
    const b = meas.b || meas.hover;
    if (b) { const d = dist(meas.a, b); s += rulerLine(meas.a, b, `${fmtLen(d)}  (${lenOut(d).toFixed(2)} ${lenUnit()})`, ACC); }
  }
  // marquee
  if (drag && drag.mode === 'marquee') {
    const A = w2s(view, drag.a.x, drag.a.y), B = w2s(view, drag.b.x, drag.b.y);
    const crossing = B.x < A.x;
    s += `<rect x="${f2(Math.min(A.x, B.x))}" y="${f2(Math.min(A.y, B.y))}" width="${f2(Math.abs(B.x - A.x))}" height="${f2(Math.abs(B.y - A.y))}" fill="${crossing ? 'rgba(46,125,79,.08)' : 'rgba(36,87,214,.08)'}" stroke="${crossing ? '#2e7d4f' : ACC}" stroke-width="1" ${crossing ? 'stroke-dasharray="4 3"' : ''} pointer-events="none"/>`;
  }
  // live resize readout
  if (drag && (drag.mode === 'resize' || drag.mode === 'rotate')) {
    const b = byId(drag.id), sp = drag.sp;
    if (b && sp) {
      const A = areaOf(b), T = targetOf(b);
      const txt = drag.mode === 'rotate' ? `${r2(b.rot)}°` : `${fmtLen(b.w)} × ${fmtLen(b.h)} · ${fmtArea(A)}${T ? ' · ' + fmtPct(pctDiff(A, T)) : ''}`;
      s += `<g pointer-events="none"><rect x="${f2(sp.x + 14)}" y="${f2(sp.y + 12)}" width="${txt.length * 6.6 + 14}" height="22" rx="4" fill="#1b1b1b"/><text x="${f2(sp.x + 21)}" y="${f2(sp.y + 27)}" font-family='${LABEL_FONT}' font-size="11.5" fill="#fff">${esc(txt)}</text></g>`;
    }
  }
  // scale bar & legend
  s += `<rect x="12" y="${H - 38}" width="${190}" height="30" rx="4" fill="#fff" fill-opacity=".85" pointer-events="none"/>`;
  s += scaleBarSVG(view, 24, H - 18);
  if (S.settings.legend) s += legendSVG(view, W - 12, H - 12, true);
  return s;
}

// ---------------------------------------------------------------- programs
function parseProgramLine(line) {
  line = line.trim();
  if (!line) return null;
  let name, area, qty = 1, zone = '', unit = null;
  const cells = line.includes('\t') ? line.split('\t') : (/^[^,]+,\s*[\d.,]+/.test(line) && line.split(',').length <= 4 ? line.split(',') : null);
  if (cells && cells.length >= 2 && /[\d]/.test(cells[1])) {
    name = cells[0].trim(); area = parseFloat(cells[1].replace(/[^\d.]/g, ''));
    if (cells[2] && /\d/.test(cells[2])) qty = Math.max(1, parseInt(cells[2], 10) || 1);
    zone = (cells[3] || '').trim();
    if (/m2|m²|sqm/i.test(cells[1])) unit = 'm'; else if (/sf|sqft|ft/i.test(cells[1])) unit = 'ft';
  } else {
    let m = line.match(/@\s*(.+)$/);
    if (m) { zone = m[1].trim(); line = line.slice(0, m.index).trim(); }
    m = line.match(/\s[x×]\s*(\d+)\s*$/i);
    if (m) { qty = Math.max(1, +m[1]); line = line.slice(0, m.index).trim(); }
    m = line.match(/^(.*?)[\s:=,-]*(\d[\d,]*(?:\.\d+)?)\s*(sf|sq\.?\s*ft|ft2|ft²|m2|m²|sqm)?$/i);
    if (!m || !m[1].trim()) return { error: line };
    name = m[1].trim(); area = parseFloat(m[2].replace(/,/g, ''));
    if (m[3]) unit = /m/i.test(m[3][0]) ? 'm' : 'ft';
  }
  if (!(area > 0)) return { error: line };
  const sf = (unit || S.units) === 'm' ? area / SF_M2 : area;
  return { name, unitArea: sf, qty, zone };
}

function addPrograms(text) {
  const lines = text.split(/\r?\n/);
  const added = [], bad = [];
  lines.forEach((l, i) => {
    if (i === 0 && /\b(name|space|program)\b/i.test(l) && /\b(area|sf|m2|m²)\b/i.test(l)) return; // header row
    const p = parseProgramLine(l);
    if (!p) return;
    if (p.error) { bad.push(p.error); return; }
    added.push(createBlock(p));
  });
  if (added.length) { sel = new Set(added.map(b => b.id)); commit(); }
  if (bad.length) toast(`Couldn't read: “${bad[0]}”. Use a name and an area, e.g. Classroom 900`);
  return added.length;
}

function createBlock({ name, unitArea, qty = 1, zone = '' }) {
  const shape = S.settings.newShape;
  const A = unitArea * qty;
  const { w, h } = sizeForArea(shape, A, 1);
  const b = { id: newId('b'), type: 'block', shape, name, target: unitArea, qty, zone, cx: 0, cy: 0, w, h, rot: 0, color: nextBlockColor(), lockRatio: false, pinned: false };
  if (zone) zoneColor(zone);
  placeBlock(b);
  S.objects.push(b);
  return b;
}
// Spiral out from the view centre until the new block clears existing blocks.
function placeBlock(b) {
  const c = toW({ x: canvasW() / 2, y: canvasH() / 2 });
  const r = Math.hypot(b.w, b.h) / 2;
  const others = blocks();
  const free = (x, y) => others.every(o => Math.hypot(o.cx - x, o.cy - y) > r + Math.hypot(o.w, o.h) / 2 + 2);
  for (let i = 0; i < 600; i++) {
    const t = i * 0.5, rr = i === 0 ? 0 : r * 0.35 * Math.sqrt(i) * 2;
    const x = c.x + Math.cos(t * 2.4) * rr, y = c.y + Math.sin(t * 2.4) * rr;
    if (free(x, y)) { b.cx = x; b.cy = y; return; }
  }
  b.cx = c.x; b.cy = c.y;
}
function snapToTarget(b) {
  const T = targetOf(b); if (!(T > 0)) return;
  const k = Math.sqrt(T / areaOf(b)); b.w *= k; b.h *= k;
}

// ---------------------------------------------------------------- relationships
function relBetween(a, b) {
  return paths().find(p => p.points.length === 2 && p.rel &&
    ((p.points[0].to === a && p.points[1].to === b) || (p.points[0].to === b && p.points[1].to === a)));
}
function makeConnector(a, b, rel) {
  const A = byId(a), B = byId(b);
  const R = REL[rel];
  const p = { id: newId('p'), type: 'path', kind: 'line', rel,
    points: [{ x: A.cx, y: A.cy, to: a }, { x: B.cx, y: B.cy, to: b }],
    color: R.color, width: R.width, dash: R.dash, arrowStart: false, arrowEnd: false };
  // connectors sit under the blocks so labels stay readable
  const firstBlock = S.objects.findIndex(o => o.type === 'block');
  S.objects.splice(Math.max(0, firstBlock), 0, p);
  return p;
}
function applyRel(p, rel) {
  p.rel = rel || null;
  if (rel) { const R = REL[rel]; p.color = R.color; p.width = R.width; p.dash = R.dash; }
}

// ---------------------------------------------------------------- arrange (force layout at true size)
let arrangeAnim = 0;
function arrange() {
  const bs = blocks();
  if (bs.length < 2) { toast('Add at least two programs to arrange.'); return; }
  const N = bs.map(b => ({ b, x: b.cx, y: b.cy, r: b.shape === 'ellipse' ? Math.max(b.w, b.h) / 2 : Math.hypot(b.w, b.h) / 2, vx: 0, vy: 0 }));
  const idx = new Map(N.map((n, i) => [n.b.id, i]));
  const links = paths().filter(p => p.rel && p.points.length >= 2 && p.points[0].to && p.points[p.points.length - 1].to)
    .map(p => ({ a: idx.get(p.points[0].to), b: idx.get(p.points[p.points.length - 1].to), rel: p.rel })).filter(l => l.a != null && l.b != null && l.a !== l.b);
  const meanR = N.reduce((a, n) => a + n.r, 0) / N.length;
  const gap = meanR * 0.3;
  const cx = N.reduce((a, n) => a + n.x, 0) / N.length, cy = N.reduce((a, n) => a + n.y, 0) / N.length;
  const frames = [];
  for (let it = 0; it < 360; it++) {
    const alpha = 1 - it / 360;
    const F = N.map(() => ({ x: 0, y: 0 }));
    links.forEach(l => {
      const A = N[l.a], B = N[l.b], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 0.01;
      const rest = A.r + B.r + (l.rel === 'avoid' ? meanR * 2.5 : gap);
      if (l.rel === 'avoid' && d > rest) return;
      const kk = l.rel === 'required' ? 0.12 : l.rel === 'preferred' ? 0.05 : 0.08;
      const f = (d - rest) * kk, ux = dx / d, uy = dy / d;
      F[l.a].x += ux * f; F[l.a].y += uy * f; F[l.b].x -= ux * f; F[l.b].y -= uy * f;
    });
    // same zone: gentle pull to the zone centroid
    const zc = {};
    N.forEach(n => { const z = n.b.zone; if (!z) return; (zc[z] = zc[z] || { x: 0, y: 0, c: 0 }); zc[z].x += n.x; zc[z].y += n.y; zc[z].c++; });
    N.forEach((n, i) => {
      const z = n.b.zone && zc[n.b.zone];
      if (z && z.c > 1) { F[i].x += (z.x / z.c - n.x) * 0.02; F[i].y += (z.y / z.c - n.y) * 0.02; }
      F[i].x += (cx - n.x) * 0.004; F[i].y += (cy - n.y) * 0.004;
    });
    // collisions
    for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
      const A = N[i], B = N[j], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 0.01, min = A.r + B.r + gap;
      if (d < min) { const f = (min - d) * 0.5, ux = dx / d, uy = dy / d; F[i].x -= ux * f; F[i].y -= uy * f; F[j].x += ux * f; F[j].y += uy * f; }
    }
    N.forEach((n, i) => {
      if (n.b.pinned) return;
      n.vx = (n.vx + F[i].x) * 0.6; n.vy = (n.vy + F[i].y) * 0.6;
      const sp = Math.hypot(n.vx, n.vy), cap = meanR * 0.5 * (0.3 + alpha);
      if (sp > cap) { n.vx *= cap / sp; n.vy *= cap / sp; }
      n.x += n.vx; n.y += n.vy;
    });
    if (it % 9 === 0 || it === 359) frames.push(N.map(n => [n.x, n.y]));
  }
  cancelAnimationFrame(arrangeAnim);
  let f = 0;
  const step = () => {
    const fr = frames[f];
    N.forEach((n, i) => { n.b.cx = fr[i][0]; n.b.cy = fr[i][1]; });
    requestRender();
    if (++f < frames.length) arrangeAnim = requestAnimationFrame(step); else commit();
  };
  step();
}

// ---------------------------------------------------------------- object ops
function selectedObjs() { return [...sel].map(byId).filter(Boolean); }
function deleteSelected() {
  if (!sel.size) return;
  const drop = new Set(sel);
  paths().forEach(p => {
    if (drop.has(p.id) || !p.points.some(q => q.to && drop.has(q.to))) return;
    // a relationship whose program is gone means nothing: remove it
    if (p.rel) { drop.add(p.id); return; }
    // free circulation lines stay, frozen at their current geometry
    const rp = resolvedPoints(p);
    p.points.forEach((q, i) => { if (q.to && drop.has(q.to)) { q.x = rp[i].x; q.y = rp[i].y; delete q.to; } });
  });
  S.objects = S.objects.filter(o => !drop.has(o.id));
  sel.clear(); commit();
}
function duplicateSelected() {
  const objs = selectedObjs(); if (!objs.length) return;
  const map = {}, off = 6;
  const clones = objs.map(o => { const c = JSON.parse(JSON.stringify(o)); c.id = newId(o.type[0]); map[o.id] = c.id; return c; });
  clones.forEach(c => {
    if (c.type === 'block') { c.cx += off; c.cy += off; }
    else c.points.forEach(q => { if (q.to) { if (map[q.to]) q.to = map[q.to]; else { delete q.to; } } q.x += off; q.y += off; });
  });
  S.objects.push(...clones);
  sel = new Set(clones.map(c => c.id)); commit();
}
function reorder(how) {
  const ids = sel; if (!ids.size) return;
  const a = S.objects;
  if (how === 'front') S.objects = a.filter(o => !ids.has(o.id)).concat(a.filter(o => ids.has(o.id)));
  else if (how === 'back') S.objects = a.filter(o => ids.has(o.id)).concat(a.filter(o => !ids.has(o.id)));
  else if (how === 'forward') { for (let i = a.length - 2; i >= 0; i--) if (ids.has(a[i].id) && !ids.has(a[i + 1].id)) [a[i], a[i + 1]] = [a[i + 1], a[i]]; }
  else if (how === 'backward') { for (let i = 1; i < a.length; i++) if (ids.has(a[i].id) && !ids.has(a[i - 1].id)) [a[i], a[i - 1]] = [a[i - 1], a[i]]; }
  commit();
}
function nudge(dx, dy) {
  selectedObjs().forEach(o => {
    if (o.type === 'block') { o.cx += dx; o.cy += dy; }
    else o.points.forEach(q => { if (!q.to) { q.x += dx; q.y += dy; } });
  });
  commit();
}

// ---------------------------------------------------------------- tools
const PATH_TOOLS = ['line', 'polyline', 'arrow', 'curve'];
function setTool(t) {
  if (draft) finishDraft(true);
  calib = null; meas = null; hoverBlock = null; closeCalibPop();
  tool = t;
  document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  stage.classList.remove('t-pan', 't-draw', 't-scale', 't-measure');
  if (t === 'pan') stage.classList.add('t-pan');
  if (PATH_TOOLS.includes(t)) stage.classList.add('t-draw');
  if (t === 'scale') {
    stage.classList.add('t-scale');
    if (!S.backdrop) { toast('Load a site plan first, then calibrate it.'); }
    else toast('Click the first point of a known distance (zoom in for precision; Shift keeps it straight).');
    calib = {};
  }
  if (t === 'measure') { stage.classList.add('t-measure'); meas = {}; }
  requestRender();
}

function finishDraft(cancel) {
  const d = draft; draft = null; hoverBlock = null;
  if (cancel || !d) { requestRender(); return; }
  const pts = [];
  d.points.forEach(q => { const last = pts[pts.length - 1]; if (!last || dist(last, q) * view.z > 1 || (q.to && q.to !== last.to)) pts.push({ ...q }); });
  if (pts.length < 2) { requestRender(); return; }
  const n = pts.length;
  pts.forEach((q, i) => {
    if (i > 0 && i < n - 1) { delete q.to; return; }
    if (q.to) { const b = byId(q.to); q.x = b.cx; q.y = b.cy; }
  });
  if (n === 2 && pts[0].to && pts[0].to === pts[1].to) delete pts[1].to;
  const ps = S.pathStyle;
  const p = { id: newId('p'), type: 'path', kind: d.kind === 'curve' ? 'curve' : 'line', rel: null, points: pts,
    color: ps.color, width: ps.width, dash: ps.dash,
    arrowStart: ps.arrowStart, arrowEnd: d.kind === 'arrow' ? true : ps.arrowEnd };
  S.objects.push(p);
  sel = new Set([p.id]);
  commit();
}

function attachOrSnap(wp) {
  const b = hitBlockAt(wp);
  const p = snapPt(wp);
  return b ? { x: p.x, y: p.y, to: b.id } : p;
}

// ---------------------------------------------------------------- pointer handling
svg.addEventListener('contextmenu', e => e.preventDefault());
const touches = new Map();
function startPinch() {
  const [a, b] = [...touches.values()];
  drag = { mode: 'pinch', d0: Math.max(1, dist(a, b)), m0: mul(add(a, b), 0.5), z0: view.z, tx0: view.tx, ty0: view.ty };
  if (draft && draft.points.length <= 1) draft = null;
}
svg.addEventListener('pointerdown', e => {
  closeCalibPop(true);
  const sp = spt(e), wp = toW(sp);
  svg.setPointerCapture(e.pointerId);
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, sp);
    if (touches.size === 2) { startPinch(); return; }
    if (touches.size > 2) return;
  }
  if (e.button === 1 || e.button === 2 || spaceDown || tool === 'pan') {
    drag = { mode: 'pan', sx: sp.x, sy: sp.y, tx: view.tx, ty: view.ty };
    stage.classList.add('dragging-pan'); e.preventDefault(); return;
  }
  if (e.button !== 0) return;
  if (tool === 'select') return selectDown(e, sp, wp);
  if (tool === 'scale') return calibClick(e, wp);
  if (tool === 'measure') return measClick(e, wp);
  if (PATH_TOOLS.includes(tool)) return drawDown(e, wp);
});

function selectDown(e, sp, wp) {
  const h = e.target.closest('[data-handle]');
  if (h) {
    const [kind, a, b] = h.dataset.handle.split(':');
    if (kind === 'r') { const blk = selectedObjs()[0]; drag = { mode: 'resize', id: blk.id, sx: +a, sy: +b, orig: { ...blk } }; }
    else if (kind === 'rot') drag = { mode: 'rotate', id: a, orig: { ...byId(a) } };
    else if (kind === 'v') {
      const p = byId(a), i = +b;
      if (e.altKey) { if (p.points.length > 2) { p.points.splice(i, 1); commit(); } return; }
      drag = { mode: 'vertex', id: a, i };
    }
    return;
  }
  const o = e.target.closest('[data-id]');
  if (o) {
    const id = o.dataset.id;
    if (e.shiftKey) { sel.has(id) ? sel.delete(id) : sel.add(id); }
    else if (!sel.has(id)) sel = new Set([id]);
    const orig = new Map();
    selectedObjs().forEach(x => orig.set(x.id, x.type === 'block' ? { cx: x.cx, cy: x.cy } : x.points.map(q => ({ x: q.x, y: q.y }))));
    drag = { mode: 'move', start: wp, orig, moved: false, lead: id };
    requestRender(); return;
  }
  const bd = S.backdrop;
  if (bd && !bd.locked && bd.visible && wp.x >= bd.x && wp.y >= bd.y && wp.x <= bd.x + bd.w * bd.ftPerPx && wp.y <= bd.y + bd.h * bd.ftPerPx) {
    drag = { mode: 'backdrop', start: wp, ox: bd.x, oy: bd.y }; return;
  }
  if (e.pointerType === 'touch') { sel.clear(); drag = { mode: 'pan', sx: sp.x, sy: sp.y, tx: view.tx, ty: view.ty }; requestRender(); return; }
  if (!e.shiftKey) sel.clear();
  drag = { mode: 'marquee', a: wp, b: wp, base: new Set(sel) };
  requestRender();
}

function drawDown(e, wp) {
  const now = performance.now();
  const pt = attachOrSnap(wp);
  if (!draft) {
    draft = { kind: tool, points: [pt], hover: pt };
    if (tool === 'line' || tool === 'arrow') drag = { mode: 'draw2', start: wp, sp: spt(e) };
    lastClick = { t: now, p: wp };
    requestRender(); return;
  }
  if (tool === 'line' || tool === 'arrow') { draft.points.push(pt); finishDraft(); return; }
  if (lastClick && now - lastClick.t < 350 && dist(wp, lastClick.p) * view.z < 6) { lastClick = null; finishDraft(); return; }
  draft.points.push(pt);
  lastClick = { t: now, p: wp };
  requestRender();
}

function constrain(a, p) {
  const dx = p.x - a.x, dy = p.y - a.y;
  return Math.abs(dx) > Math.abs(dy) ? { x: p.x, y: a.y } : { x: a.x, y: p.y };
}
function calibClick(e, wp) {
  if (!S.backdrop) { toast('Load a site plan first, then calibrate it.'); return; }
  if (!calib) calib = {};
  if (!calib.a || calib.b) { calib = { a: wp }; toast('Now click the second point.'); requestRender(); return; }
  calib.b = e.shiftKey ? constrain(calib.a, wp) : wp;
  requestRender();
  openCalibPop();
}
function measClick(e, wp) {
  const p = snapPt(wp);
  if (!meas || !meas.a || meas.b) { meas = { a: p }; requestRender(); return; }
  meas.b = e.shiftKey ? constrain(meas.a, p) : p;
  toast(`Distance ${fmtLen(dist(meas.a, meas.b))}`);
  requestRender();
}

svg.addEventListener('pointermove', e => {
  const sp = spt(e), wp = toW(sp);
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) touches.set(e.pointerId, sp);
  if (drag && drag.mode === 'pinch') {
    if (touches.size < 2) return;
    const [a, b] = [...touches.values()], m = mul(add(a, b), 0.5);
    const z = Math.max(0.02, Math.min(400, drag.z0 * dist(a, b) / drag.d0));
    const w = { x: (drag.m0.x - drag.tx0) / drag.z0, y: (drag.m0.y - drag.ty0) / drag.z0 };
    view.z = z; view.tx = m.x - w.x * z; view.ty = m.y - w.y * z;
    requestRender(); return;
  }
  cursorW = wp; updateCursorStatus();
  if (!drag) {
    if (draft) {
      draft.hover = attachOrSnap(wp);
      hoverBlock = draft.hover.to || null;
      requestRender();
    } else if (PATH_TOOLS.includes(tool)) {
      const b = hitBlockAt(wp); const id = b ? b.id : null;
      if (id !== hoverBlock) { hoverBlock = id; requestRender(); }
    } else if (calib && calib.a && !calib.b) { calib.hover = e.shiftKey ? constrain(calib.a, wp) : wp; requestRender(); }
    else if (meas && meas.a && !meas.b) { const p = snapPt(wp); meas.hover = e.shiftKey ? constrain(meas.a, p) : p; requestRender(); }
    return;
  }
  switch (drag.mode) {
    case 'pan': view.tx = drag.tx + sp.x - drag.sx; view.ty = drag.ty + sp.y - drag.sy; break;
    case 'move': {
      let dx = wp.x - drag.start.x, dy = wp.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) * view.z < 3) return;
      drag.moved = true;
      if (S.settings.snap) {
        const lead = byId(drag.lead), o = drag.orig.get(drag.lead);
        if (lead && lead.type === 'block') { const p = snapPt({ x: o.cx + dx, y: o.cy + dy }); dx = p.x - o.cx; dy = p.y - o.cy; }
      }
      drag.orig.forEach((o, id) => {
        const x = byId(id); if (!x) return;
        if (x.type === 'block') { x.cx = o.cx + dx; x.cy = o.cy + dy; }
        else x.points.forEach((q, i) => { if (!q.to) { q.x = o[i].x + dx; q.y = o[i].y + dy; } });
      });
      break;
    }
    case 'resize': resizeBlock(drag, wp, e); drag.sp = sp; break;
    case 'rotate': {
      const b = byId(drag.id);
      let ang = Math.atan2(wp.y - b.cy, wp.x - b.cx) * 180 / Math.PI + 90;
      if (e.shiftKey) ang = Math.round(ang / 15) * 15;
      b.rot = ((ang % 360) + 540) % 360 - 180; drag.sp = sp; break;
    }
    case 'vertex': {
      const p = byId(drag.id); if (!p) break;
      const q = p.points[drag.i], isEnd = drag.i === 0 || drag.i === p.points.length - 1;
      const pt = snapPt(wp);
      if (isEnd) {
        const hb = hitBlockAt(wp);
        if (hb) { q.to = hb.id; q.x = hb.cx; q.y = hb.cy; hoverBlock = hb.id; }
        else { delete q.to; q.x = pt.x; q.y = pt.y; hoverBlock = null; }
      } else { q.x = pt.x; q.y = pt.y; }
      break;
    }
    case 'marquee': drag.b = wp; break;
    case 'backdrop': S.backdrop.x = drag.ox + wp.x - drag.start.x; S.backdrop.y = drag.oy + wp.y - drag.start.y; break;
    case 'draw2': if (draft) { draft.hover = attachOrSnap(wp); hoverBlock = draft.hover.to || null; } break;
  }
  requestRender();
});

svg.addEventListener('pointercancel', e => { touches.delete(e.pointerId); drag = null; stage.classList.remove('dragging-pan'); requestRender(); });
svg.addEventListener('pointerup', e => {
  if (e.pointerType === 'touch') touches.delete(e.pointerId);
  if (drag && drag.mode === 'pinch') { if (touches.size < 2) { drag = null; scheduleSave(); } return; }
  const d = drag; drag = null;
  stage.classList.remove('dragging-pan');
  if (!d) return;
  const sp = spt(e), wp = toW(sp);
  switch (d.mode) {
    case 'move': if (d.moved) commit(); break;
    case 'resize': case 'rotate': case 'backdrop': commit(); break;
    case 'vertex': hoverBlock = null; commit(); break;
    case 'marquee': {
      const A = d.a, B = d.b;
      if (dist(A, B) * view.z > 3) {
        const r = { x0: Math.min(A.x, B.x), y0: Math.min(A.y, B.y), x1: Math.max(A.x, B.x), y1: Math.max(A.y, B.y) };
        const crossing = B.x < A.x;
        const hit = S.objects.filter(o => {
          const bb = bboxOf(o);
          return crossing ? !(bb.x1 < r.x0 || bb.x0 > r.x1 || bb.y1 < r.y0 || bb.y0 > r.y1)
                          : (bb.x0 >= r.x0 && bb.x1 <= r.x1 && bb.y0 >= r.y0 && bb.y1 <= r.y1);
        });
        sel = new Set([...d.base, ...hit.map(o => o.id)]);
      }
      break;
    }
    case 'draw2':
      if (draft && dist(d.sp, sp) > 6) { draft.points.push(attachOrSnap(wp)); finishDraft(); }
      break;
  }
  requestRender();
});

svg.addEventListener('dblclick', e => {
  if (tool !== 'select') return;
  const o = e.target.closest('[data-id]'); if (!o) return;
  const obj = byId(o.dataset.id);
  if (obj.type === 'block') { const inp = inspector.querySelector('[data-k="name"]'); if (inp) { inp.focus(); inp.select(); } return; }
  // insert a vertex on the nearest segment
  const wp = toW(spt(e)), rp = resolvedPoints(obj);
  let best = 0, bd = Infinity;
  for (let i = 0; i < rp.length - 1; i++) {
    const a = rp[i], b = rp[i + 1], ab = sub(b, a), t = Math.max(0, Math.min(1, ((wp.x - a.x) * ab.x + (wp.y - a.y) * ab.y) / (ab.x ** 2 + ab.y ** 2 || 1)));
    const dd = dist(wp, add(a, mul(ab, t)));
    if (dd < bd) { bd = dd; best = i; }
  }
  obj.points.splice(best + 1, 0, { x: wp.x, y: wp.y });
  commit();
});

function resizeBlock(d, wp, e) {
  const b = byId(d.id), o = d.orig;
  const lp = rot(wp.x - o.cx, wp.y - o.cy, -o.rot);
  const fromCenter = e.altKey;
  const ax = -d.sx * o.w / 2, ay = -d.sy * o.h / 2;
  let w = o.w, h = o.h;
  if (d.sx) w = Math.max(0.5, fromCenter ? 2 * Math.abs(lp.x) : d.sx * (lp.x - ax));
  if (d.sy) h = Math.max(0.5, fromCenter ? 2 * Math.abs(lp.y) : d.sy * (lp.y - ay));
  const lock = !!o.lockRatio !== e.shiftKey;
  if (lock) {
    const k = d.sx && d.sy ? Math.max(w / o.w, h / o.h) : d.sx ? w / o.w : h / o.h;
    w = o.w * k; h = o.h * k;
  }
  const cl = fromCenter ? { x: 0, y: 0 } : { x: d.sx ? ax + d.sx * w / 2 : 0, y: d.sy ? ay + d.sy * h / 2 : 0 };
  const c = rot(cl.x, cl.y, o.rot);
  b.cx = o.cx + c.x; b.cy = o.cy + c.y; b.w = w; b.h = h;
}

svg.addEventListener('wheel', e => {
  e.preventDefault();
  const sp = spt(e);
  const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
  const z = Math.max(0.02, Math.min(400, view.z * f));
  const w = toW(sp);
  view.z = z; view.tx = sp.x - w.x * z; view.ty = sp.y - w.y * z;
  updateCursorStatus(); requestRender(); scheduleSave();
}, { passive: false });

function zoomFit() {
  let pts = [];
  const bd = S.backdrop;
  if (bd && bd.visible) pts.push({ x: bd.x, y: bd.y }, { x: bd.x + bd.w * bd.ftPerPx, y: bd.y + bd.h * bd.ftPerPx });
  S.objects.forEach(o => { const b = bboxOf(o); pts.push({ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }); });
  if (!pts.length) { view = { z: 4, tx: canvasW() / 2, ty: canvasH() / 2 }; requestRender(); return; }
  const b = bboxOfPts(pts), W = canvasW(), H = canvasH(), pad = 40;
  const z = Math.min((W - 2 * pad) / Math.max(1, b.x1 - b.x0), (H - 2 * pad - 30) / Math.max(1, b.y1 - b.y0));
  view.z = Math.max(0.02, Math.min(400, z));
  view.tx = (W - (b.x1 - b.x0) * view.z) / 2 - b.x0 * view.z;
  view.ty = (H - 30 - (b.y1 - b.y0) * view.z) / 2 - b.y0 * view.z;
  requestRender(); scheduleSave();
}

// ---------------------------------------------------------------- keyboard
const isTyping = () => { const a = document.activeElement; return a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['range', 'checkbox', 'color', 'button'].includes(a.type)) || a.tagName === 'SELECT'); };
window.addEventListener('keydown', e => {
  const typing = isTyping();
  if (e.code === 'Space' && !typing) { if (!spaceDown) { spaceDown = true; stage.classList.add('panning'); } e.preventDefault(); return; }
  const mod = e.ctrlKey || e.metaKey;
  if (mod) {
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); saveProject(); return; }
    if (k === 'o') { e.preventDefault(); $('#fileProj').click(); return; }
    if (typing) return;
    if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (k === 'y') { e.preventDefault(); redo(); return; }
    if (k === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (k === 'a') { e.preventDefault(); sel = new Set(S.objects.map(o => o.id)); requestRender(); return; }
    if (e.key === ']') { e.preventDefault(); reorder(e.shiftKey ? 'front' : 'forward'); return; }
    if (e.key === '[') { e.preventDefault(); reorder(e.shiftKey ? 'back' : 'backward'); return; }
    return;
  }
  if (typing) { if (e.key === 'Escape') document.activeElement.blur(); return; }
  const k = e.key;
  const toolKeys = { v: 'select', h: 'pan', s: 'scale', m: 'measure', l: 'line', p: 'polyline', a: 'arrow', c: 'curve' };
  if (toolKeys[k.toLowerCase()] && !e.altKey) { setTool(toolKeys[k.toLowerCase()]); return; }
  if (k === 'Escape') {
    if (draft) finishDraft(true);
    else if (calib && calib.a) { calib = {}; closeCalibPop(); }
    else if (meas && meas.a) meas = {};
    else if (tool !== 'select') setTool('select');
    else sel.clear();
    requestRender(); return;
  }
  if (k === 'Enter' && draft) { finishDraft(); return; }
  if ((k === 'Backspace' || k === 'Delete')) {
    e.preventDefault();
    if (draft && k === 'Backspace') { draft.points.pop(); if (!draft.points.length) draft = null; requestRender(); return; }
    deleteSelected(); return;
  }
  if (k === 'f' || k === 'F') { zoomFit(); return; }
  if (k === 'g' || k === 'G') { S.settings.grid = !S.settings.grid; scheduleSave(); requestRender(); return; }
  const step = lenIn(e.shiftKey ? 10 : 1);
  if (k === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0); }
  if (k === 'ArrowRight') { e.preventDefault(); nudge(step, 0); }
  if (k === 'ArrowUp') { e.preventDefault(); nudge(0, -step); }
  if (k === 'ArrowDown') { e.preventDefault(); nudge(0, step); }
});
window.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; stage.classList.remove('panning'); } });
window.addEventListener('blur', () => { spaceDown = false; stage.classList.remove('panning'); });

// ---------------------------------------------------------------- calibration
const calibPop = $('#calibPop');
function openCalibPop() {
  const B = w2s(view, calib.b.x, calib.b.y);
  const r = stage.getBoundingClientRect();
  calibPop.style.left = Math.min(r.width - 275, Math.max(8, B.x + 14)) + 'px';
  calibPop.style.top = Math.min(r.height - 190, Math.max(8, B.y + 14)) + 'px';
  $('#calibUnit').value = S.units;
  const px = dist(calib.a, calib.b) / S.backdrop.ftPerPx;
  $('#calibPx').textContent = `Measured ${px.toFixed(2)} px on the image`;
  calibPop.hidden = false;
  const inp = $('#calibInput'); inp.value = ''; setTimeout(() => inp.focus(), 0);
}
function closeCalibPop(keepPoints) { if (!calibPop.hidden) { calibPop.hidden = true; if (!keepPoints && calib) calib = {}; } }
calibPop.addEventListener('submit', e => {
  e.preventDefault();
  const D = parseLength($('#calibInput').value, $('#calibUnit').value);
  if (!(D > 0)) { toast('Type a distance like 32, 32\'-6" or 10 m'); return; }
  const bd = S.backdrop, f0 = bd.ftPerPx;
  const aImg = { x: (calib.a.x - bd.x) / f0, y: (calib.a.y - bd.y) / f0 };
  const bImg = { x: (calib.b.x - bd.x) / f0, y: (calib.b.y - bd.y) / f0 };
  const dpx = dist(aImg, bImg);
  if (dpx < 2) { toast('The two points are too close together.'); return; }
  const f1 = D / dpx;
  bd.x = calib.a.x - aImg.x * f1; bd.y = calib.a.y - aImg.y * f1;   // keep the first point fixed
  bd.ftPerPx = f1; bd.calibrated = true;
  bd.calibNote = `2-point: ${fmtLen(D)} over ${dpx.toFixed(1)} px`;
  calibPop.hidden = true; calib = null;
  commit();
  setTool('select');
  toast(`Scale set: 1 px = ${f1.toPrecision(5)} ft. Blocks are now true size on this plan.`);
});
$('#calibCancel').addEventListener('click', () => { closeCalibPop(); requestRender(); });
$('#calibInput').addEventListener('keydown', e => { if (e.key === 'Escape') { closeCalibPop(); requestRender(); } });

function nearestPreset(ftPerIn) {
  let best = null;
  SCALES.forEach(([lab, v]) => { const d = Math.abs(ftPerIn / v - 1); if (!best || d < best.d) best = { lab, v, d }; });
  return best;
}

// ---------------------------------------------------------------- backdrop loading
function readDpi(u8) {
  const nice = d => Math.abs(d - Math.round(d)) < 0.05 ? Math.round(d) : +d.toFixed(2);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8[0] === 0x89 && u8[1] === 0x50) {
    let p = 8;
    while (p < u8.length - 12) {
      const len = dv.getUint32(p), t = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
      if (t === 'pHYs') { const ppx = dv.getUint32(p + 8), unit = u8[p + 16]; return unit === 1 ? nice(ppx * 0.0254) : null; }
      if (t === 'IDAT' || t === 'IEND') break;
      p += 12 + len;
    }
  } else if (u8[0] === 0xFF && u8[1] === 0xD8) {
    let p = 2;
    while (p < u8.length - 16 && u8[p] === 0xFF) {
      const mk = u8[p + 1], len = (u8[p + 2] << 8) | u8[p + 3];
      if (mk === 0xE0 && String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]) === 'JFIF') {
        const unit = u8[p + 11], xd = (u8[p + 12] << 8) | u8[p + 13];
        return unit === 1 ? xd : unit === 2 ? nice(xd * 2.54) : null;
      }
      if (mk === 0xDA) break;
      p += 2 + len;
    }
  }
  return null;
}
const blobToDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });

async function loadBackdropFile(file) {
  try {
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return await loadPdf(file);
    const buf = new Uint8Array(await file.arrayBuffer());
    const dpi = readDpi(buf);
    const url = await blobToDataURL(file);
    const img = await loadImg(url);
    setBackdrop({ src: url, name: file.name, w: img.naturalWidth, h: img.naturalHeight, dpi, img });
  } catch (err) { console.error(err); toast('Could not read that file as an image or PDF.'); }
}
async function loadPdf(file) {
  toast('Rendering the PDF’s first page…');
  if (!window['pdfjs-dist/build/pdf']) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
  const lib = window['pdfjs-dist/build/pdf'];
  lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await doc.getPage(1);
  const vp1 = page.getViewport({ scale: 1 });
  const wIn = vp1.width / 72, hIn = vp1.height / 72;
  // 150 dpi, capped at ~25 MP so the browser stays responsive
  const dpi = Math.min(150, Math.floor(Math.sqrt(25e6 / (wIn * hIn))));
  const vp = page.getViewport({ scale: dpi / 72 });
  const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const url = cv.toDataURL('image/png');
  const img = await loadImg(url);
  setBackdrop({ src: url, name: file.name + ' (p.1)', w: cv.width, h: cv.height, dpi, img });
  toast(`PDF rendered at ${dpi} dpi. Pick its drawing scale and press Set for an exact calibration.`);
}
function setBackdrop({ src, name, w, h, dpi, img }) {
  const id = newId('img');
  srcCache[id] = src; bdImg = img || null;
  S.backdrop = { srcId: id, name, w, h, dpi: dpi || null, x: 0, y: 0, ftPerPx: 0.1, opacity: 0.85, visible: true, locked: true, calibrated: false, calibNote: '' };
  commit(); zoomFit();
  if (!/PDF/.test(name)) toast('Site plan loaded. Press S and click two points of a known distance to calibrate.');
}

// ---------------------------------------------------------------- save / load / export
// On claude.ai the page runs in a sandboxed frame: files go through the viewer's
// "downloads" capability (the viewer confirms each save). Locally a plain link works.
const inArtifact = !!(window.claude && typeof window.claude.use === 'function');
const downloadsP = inArtifact ? Promise.resolve(window.claude.use('downloads')).catch(() => null) : Promise.resolve(null);
async function download(blob, name, okMsg) {
  if (inArtifact) {
    const dl = await downloadsP;
    if (!dl) { toast('Saving files is not available in this view.'); return; }
    try { await dl.save({ filename: name, data: blob }); if (okMsg) toast(okMsg); }
    catch (err) { if (err && err.code !== 'declined') toast(err.code === 'rate_limited' ? 'A save is already waiting for your answer.' : 'Could not save the file here.'); }
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  if (okMsg) toast(okMsg);
}
const fileBase = () => slug(S.name || 'bubble-diagram');
function saveProject() {
  const out = JSON.parse(JSON.stringify(S));
  if (out.backdrop) out.backdrop.src = srcCache[out.backdrop.srcId];
  out.view = view;
  download(new Blob([JSON.stringify(out)], { type: 'application/json' }), fileBase() + '.json', 'Project saved with the site plan and scale embedded.');
}
async function loadProject(file) {
  try {
    const o = JSON.parse(await file.text());
    if (o.app !== 'bubble-diagram') throw new Error('not a project');
    const st = Object.assign(freshState(), o);
    st.settings = Object.assign(freshState().settings, o.settings || {});
    st.pathStyle = Object.assign(freshState().pathStyle, o.pathStyle || {});
    if (st.backdrop && st.backdrop.src) { srcCache[st.backdrop.srcId] = st.backdrop.src; delete st.backdrop.src; }
    if (o.view) view = o.view;
    delete st.view;
    S = st; sel.clear(); hist = []; hIdx = -1;
    $('#projName').value = S.name;
    commit(); syncSettingsUI();
    if (!o.view) zoomFit();
    toast('Project opened.');
  } catch (err) { toast('That file is not a Bubble Diagram project.'); }
}
function exportFrame(scale) {
  const pts = [];
  const bd = S.backdrop;
  if (bd && bd.visible) pts.push({ x: bd.x, y: bd.y }, { x: bd.x + bd.w * bd.ftPerPx, y: bd.y + bd.h * bd.ftPerPx });
  S.objects.forEach(o => { const b = bboxOf(o); pts.push({ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }); });
  if (!pts.length) return null;
  const b = bboxOfPts(pts);
  const z = view.z * scale, pad = 40 * scale, foot = 50 * scale;
  return { v: { z, k: scale, tx: -b.x0 * z + pad, ty: -b.y0 * z + pad }, W: Math.ceil((b.x1 - b.x0) * z + 2 * pad), H: Math.ceil((b.y1 - b.y0) * z + 2 * pad + foot) };
}
function exportSVGString(fr, withImage) {
  const { v, W, H } = fr, k = v.k;
  const bd = S.backdrop;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  if (withImage) {
    s += `<rect width="${W}" height="${H}" fill="#fff"/>`;
    if (bd && bd.visible) { const p = w2s(v, bd.x, bd.y); s += `<g id="site_plan"><image href="${srcCache[bd.srcId]}" xlink:href="${srcCache[bd.srcId]}" x="${f2(p.x)}" y="${f2(p.y)}" width="${f2(bd.w * bd.ftPerPx * v.z)}" height="${f2(bd.h * bd.ftPerPx * v.z)}" opacity="${bd.opacity}" preserveAspectRatio="none"/></g>`; }
  }
  s += `<g id="diagram">${objectsSVG(v, { export: true })}</g>`;
  s += `<g id="scale_bar">${scaleBarSVG(v, 40 * k, H - 22 * k)}</g>`;
  if (S.settings.legend) s += `<g id="legend">${legendSVG(v, W - 20 * k, H - 12 * k, true)}</g>`;
  s += `<text x="${f2(W - 20 * k)}" y="${f2(H - 4 * k)}" text-anchor="end" font-family='${LABEL_FONT}' font-size="${f2(8 * k)}" fill="#8a8a86">${esc(S.name)} · ${bd && bd.calibrated ? 'site plan calibrated' : 'site plan not calibrated'}</text>`;
  return s + '</svg>';
}
function exportSVG() {
  const fr = exportFrame(1); if (!fr) { toast('Nothing to export yet.'); return; }
  download(new Blob([exportSVGString(fr, true)], { type: 'image/svg+xml' }), fileBase() + '.svg');
}
async function exportPNG() {
  let fr = exportFrame(1); if (!fr) { toast('Nothing to export yet.'); return; }
  const scale = Math.max(0.25, Math.min(3, 8000 / Math.max(fr.W, fr.H)));
  fr = exportFrame(scale);
  const cv = document.createElement('canvas'); cv.width = fr.W; cv.height = fr.H;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, fr.W, fr.H);
  const bd = S.backdrop;
  if (bd && bd.visible && bdImg) {
    if (!bdImg.complete) await new Promise(r => { bdImg.onload = r; });
    const p = w2s(fr.v, bd.x, bd.y);
    ctx.globalAlpha = bd.opacity;
    ctx.drawImage(bdImg, p.x, p.y, bd.w * bd.ftPerPx * fr.v.z, bd.h * bd.ftPerPx * fr.v.z);
    ctx.globalAlpha = 1;
  }
  const url = URL.createObjectURL(new Blob([exportSVGString(fr, false)], { type: 'image/svg+xml' }));
  const img = await loadImg(url);
  ctx.drawImage(img, 0, 0); URL.revokeObjectURL(url);
  cv.toBlob(b => download(b, fileBase() + '.png'), 'image/png');
}

// ---------------------------------------------------------------- panels
let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200); }
function updateCursorStatus() {
  if (cursorW) $('#stCursor').textContent = `X ${fmtLen(cursorW.x)}   Y ${fmtLen(cursorW.y)}`;
  $('#stZoom').textContent = isM() ? `1 m = ${(view.z / FT_M).toFixed(1)} px` : `1 ft = ${view.z.toFixed(2)} px`;
}

let lastPanelSig = '', lastInspKey = '';
function syncPanels() {
  updateCursorStatus();
  const bd = S.backdrop;
  const st = $('#stScale');
  if (!bd) { st.textContent = 'No site plan'; st.classList.remove('warn'); }
  else if (!bd.calibrated) { st.textContent = 'Site plan not calibrated'; st.classList.add('warn'); }
  else { st.textContent = `Site plan: 1 px = ${bd.ftPerPx.toPrecision(5)} ft`; st.classList.remove('warn'); }
  $('#stSel').textContent = sel.size ? `${sel.size} selected` : '';
  $('#btnUndo').disabled = hIdx <= 0; $('#btnRedo').disabled = hIdx >= hist.length - 1;

  const sig = JSON.stringify([S.objects.map(o => o.type === 'block' ? [o.id, o.name, Math.round(areaOf(o)), o.target, o.qty, o.zone, o.color, o.shape] : [o.id, o.rel, o.points.map(q => q.to)]),
    [...sel], S.units, S.settings.colorBy, S.zones, bd && [bd.name, bd.ftPerPx, bd.calibrated, bd.opacity, bd.visible, bd.locked, bd.dpi], leftTab, relPick]);
  if (sig !== lastPanelSig) { lastPanelSig = sig; renderProgramList(); renderBackdropPanel(); if (leftTab === 'matrix') renderMatrix(); }
  const key = inspectorKey();
  if (key !== lastInspKey) { lastInspKey = key; buildInspector(); }
  syncInspector();
}

function renderProgramList() {
  const bs = blocks();
  $('#unitHint').textContent = `Areas in ${areaUnit()}.`;
  $('#progList').innerHTML = bs.map(b => {
    const A = areaOf(b), T = targetOf(b), d = pctDiff(A, T);
    const cls = !T ? '' : Math.abs(d) < 0.005 ? 'ok' : d > 0 ? 'over' : 'under';
    const sub = [(b.qty || 1) > 1 ? `${fmtArea(b.target)} ×${b.qty}` : `target ${fmtArea(T)}`, b.zone].filter(Boolean).join(' · ');
    return `<button class="prog ${sel.has(b.id) ? 'on' : ''}" data-id="${b.id}"><span class="sw ${b.shape === 'rect' ? 'rect' : ''}" style="background:${fillOf(b)}"></span><span class="nm">${esc(b.name)}</span><span class="ar">${fmtArea(A)}</span><span class="qz">${esc(sub)}</span><span class="df ${cls}">${T ? (Math.abs(d) < 0.005 ? '✓' : fmtPct(d)) : ''}</span></button>`;
  }).join('');
  if (!bs.length) { $('#progTotals').innerHTML = ''; return; }
  const totA = bs.reduce((a, b) => a + areaOf(b), 0), totT = bs.reduce((a, b) => a + targetOf(b), 0);
  const zones = {};
  bs.forEach(b => { if (b.zone) zones[b.zone] = (zones[b.zone] || 0) + areaOf(b); });
  let h = Object.entries(zones).map(([z, a]) => `<span><i class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${zoneColor(z)};margin-right:5px"></i>${esc(z)}</span><b>${fmtArea(a)}</b>`).join('');
  h += `<span>${bs.length} programs · drawn</span><b>${fmtArea(totA)}</b><span>Target total</span><b>${fmtArea(totT)}</b>`;
  if (totT) { const d = pctDiff(totA, totT); h += `<span>Difference</span><b class="${Math.abs(d) < 0.005 ? 'ok' : d > 0 ? 'over' : 'under'}">${fmtPct(d)}</b>`; }
  $('#progTotals').innerHTML = h;
}

function relIcon(rel, size = 12) {
  if (rel === 'required') return `<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill="#1b1b1b"/></svg>`;
  if (rel === 'preferred') return `<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="3.6" fill="none" stroke="#1b1b1b" stroke-width="1.3"/></svg>`;
  if (rel === 'avoid') return `<svg viewBox="0 0 12 12"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="#c0392b" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  return '';
}
function renderMatrix() {
  $('#relPick').innerHTML = REL_ORDER.map(r => {
    const R = REL[r], da = dashArray(R.dash, R.width, 1);
    return `<button data-rel="${r}" class="${relPick === r ? 'on' : ''}"><svg viewBox="0 0 22 10"><path d="M1 5H21" stroke="${R.color}" stroke-width="${R.width}"${da ? ` stroke-dasharray="${da}"` : ''}/></svg>${R.label}</button>`;
  }).join('');
  const bs = blocks();
  if (bs.length < 2) { $('#matrix').innerHTML = '<p class="hint">Add two or more programs to fill the matrix.</p>'; return; }
  let h = '<table><thead><tr><th></th>' + bs.map((_, i) => `<th>${i + 1}</th>`).join('') + '</tr></thead><tbody>';
  bs.forEach((a, i) => {
    h += `<tr><th title="${esc(a.name)}"><span class="dot" style="background:${fillOf(a)}"></span>${i + 1}. ${esc(a.name)}</th>`;
    bs.forEach((b, j) => {
      if (i === j) { h += '<td class="self"></td>'; return; }
      const p = relBetween(a.id, b.id);
      h += `<td data-a="${a.id}" data-b="${b.id}" title="${esc(a.name)} – ${esc(b.name)}">${p ? relIcon(p.rel) : ''}</td>`;
    });
    h += '</tr>';
  });
  $('#matrix').innerHTML = h + '</tbody></table>';
}
$('#tabMatrix').addEventListener('click', e => {
  const rb = e.target.closest('[data-rel]');
  if (rb) { relPick = rb.dataset.rel; renderMatrix(); return; }
  const td = e.target.closest('td[data-a]'); if (!td) return;
  const { a, b } = td.dataset, p = relBetween(a, b);
  if (p && p.rel === relPick) S.objects = S.objects.filter(o => o !== p);
  else if (p) applyRel(p, relPick);
  else makeConnector(a, b, relPick);
  commit();
});
document.querySelectorAll('[data-ltab]').forEach(b => b.addEventListener('click', () => {
  leftTab = b.dataset.ltab;
  document.querySelectorAll('[data-ltab]').forEach(x => x.classList.toggle('on', x === b));
  $('#tabProg').hidden = leftTab !== 'prog'; $('#tabMatrix').hidden = leftTab !== 'matrix';
  lastPanelSig = ''; requestRender();
}));

function renderBackdropPanel() {
  const bd = S.backdrop;
  $('#bdEmpty').hidden = !!bd; $('#bdBox').hidden = !bd;
  if (!bd) return;
  $('#bdName').textContent = bd.name; $('#bdName').title = bd.name;
  let h;
  if (bd.calibrated) {
    h = `<span class="badge good">Calibrated</span><br>1 px = <span class="mono">${bd.ftPerPx.toPrecision(6)}</span> ft · 1 ft = <span class="mono">${(1 / bd.ftPerPx).toPrecision(5)}</span> px<br>`;
    h += `<span class="legend-note">${esc(bd.calibNote || '')}</span>`;
    if (bd.dpi) {
      const np = nearestPreset(bd.ftPerPx * bd.dpi);
      if (np && np.d < 0.02) h += `<br><span class="legend-note">≈ ${esc(np.lab)} at ${bd.dpi} dpi (${(np.d * 100).toFixed(2)}% off)</span>`;
    }
  } else h = `<span class="badge warn">Not calibrated</span><br><span class="legend-note">Blocks are true size, the plan is not yet. Calibrate before judging fit.</span>`;
  h += `<br><span class="legend-note">${bd.w} × ${bd.h} px${bd.dpi ? ` · ${bd.dpi} dpi` : ''} · plan ${fmtLen(bd.w * bd.ftPerPx)} × ${fmtLen(bd.h * bd.ftPerPx)}</span>`;
  $('#bdStatus').innerHTML = h;
  if (document.activeElement !== $('#bdDpi')) $('#bdDpi').value = bd.dpi || '';
  $('#bdOpacity').value = bd.opacity; $('#bdOpOut').textContent = Math.round(bd.opacity * 100) + '%';
  $('#bdVisible').checked = bd.visible; $('#bdLocked').checked = bd.locked;
}

// ---------------------------------------------------------------- inspector
function inspectorKey() {
  const objs = selectedObjs();
  let kind = 'none';
  if (objs.length === 1) kind = objs[0].type;
  else if (objs.length > 1) kind = objs.every(o => o.type === 'path') ? 'paths' : 'multi';
  if (kind === 'none' && PATH_TOOLS.includes(tool)) kind = 'pathstyle';
  return kind + '|' + objs.map(o => o.id).join(',') + '|' + S.units + '|' + S.settings.colorBy;
}
const swatchRow = (cols, attr) => cols.map(c => `<button type="button" ${attr}="${c}" style="background:${c}" title="${c}" aria-label="Colour ${c}"></button>`).join('');
const orderRow = `<div class="insp-sec"><h2>Layer order</h2><div class="row mt">
  <button class="btn sm" data-act="back" title="Send to back (Ctrl+Shift+[)">Back</button>
  <button class="btn sm" data-act="backward" title="Send backward (Ctrl+[)">Backward</button>
  <button class="btn sm" data-act="forward" title="Bring forward (Ctrl+])">Forward</button>
  <button class="btn sm" data-act="front" title="Bring to front (Ctrl+Shift+])">Front</button></div>
  <div class="row mt"><button class="btn sm" data-act="duplicate">Duplicate <kbd>Ctrl D</kbd></button><button class="btn sm danger" data-act="delete">Delete <kbd>Del</kbd></button></div></div>`;
function pathControls(title) {
  return `<div class="insp-h"><h2>${title}</h2></div>
  <div class="fld"><span>Relationship</span><select data-pk="rel"><option value="">Free line (circulation)</option>${REL_ORDER.map(r => `<option value="${r}">${REL[r].label}</option>`).join('')}</select></div>
  <div class="fld"><span>Colour</span><div class="swatches">${swatchRow(LINE_COLORS, 'data-pcolor')}<input type="color" data-pk="color" aria-label="Custom line colour"></div></div>
  <label class="fld"><span>Weight <output data-out="width"></output></span><input type="range" data-pk="width" min="0.25" max="8" step="0.25"></label>
  <div class="fld"><span>Dash</span><select data-pk="dash"><option value="solid">Solid</option><option value="dash">Dashed</option><option value="dot">Dotted</option><option value="dashdot">Dash-dot</option></select></div>
  <div class="fld"><span>Arrowheads</span><div class="row chks"><label class="chk"><input type="checkbox" data-pk="arrowStart"> Start</label><label class="chk"><input type="checkbox" data-pk="arrowEnd"> End</label></div></div>`;
}
function buildInspector() {
  const objs = selectedObjs();
  const kind = lastInspKey.split('|')[0];
  const au = areaUnit(), lu = lenUnit();
  let h = '';
  if (kind === 'block') {
    h = `<div class="insp-h"><span class="sw" data-sync="swatch"></span><h2>Program</h2></div>
      <label class="fld"><span>Name</span><input type="text" data-k="name"></label>
      <div class="grid2"><label class="fld"><span>Zone</span><input type="text" data-k="zone" list="zoneList" placeholder="—"></label>
      <label class="fld"><span>Quantity</span><input type="number" data-k="qty" min="1" step="1"></label></div>
      <datalist id="zoneList">${Object.keys(S.zones).map(z => `<option value="${esc(z)}">`).join('')}</datalist>
      <div class="fld"><span>Shape (keeps area)</span><div class="seg sm"><button data-shape="ellipse">Bubble</button><button data-shape="rect">Box</button></div></div>
      <div class="fld"><span>Colour${S.settings.colorBy === 'zone' ? ' (showing zone colour)' : ''}</span><div class="swatches">${swatchRow(PALETTE, 'data-color')}<input type="color" data-k="color" aria-label="Custom colour"></div></div>
      <div class="insp-sec"><h2>Area</h2>
      <div class="grid2"><label class="fld"><span>Target ${au}<span data-sync="each"></span></span><input type="number" data-k="target" min="0" step="any"></label>
      <label class="fld"><span>Drawn ${au}</span><input type="number" data-k="area" min="0" step="any"></label></div>
      <div class="delta" data-sync="delta"></div>
      <button class="btn wide primary mt" data-act="snapTarget">Snap to target area</button></div>
      <div class="insp-sec"><h2>Size</h2>
      <div class="grid3"><label class="fld"><span>W ${lu}</span><input type="number" data-k="w" min="0" step="any"></label>
      <label class="fld"><span>H ${lu}</span><input type="number" data-k="h" min="0" step="any"></label>
      <label class="fld"><span>Rot °</span><input type="number" data-k="rot" step="any"></label></div>
      <div class="row chks mt"><label class="chk"><input type="checkbox" data-k="lockRatio"> Lock proportions</label><label class="chk" title="Arrange leaves pinned blocks in place"><input type="checkbox" data-k="pinned"> Pin</label></div>
      <p class="insp-note"><kbd>Shift</kbd> while resizing flips the lock, <kbd>Alt</kbd> resizes from the centre, <kbd>Shift</kbd> while rotating snaps to 15°.</p>
      <button class="btn sm mt" data-act="equalize">Make round / square (keep area)</button></div>` + orderRow;
  } else if (kind === 'path' || kind === 'paths') {
    h = pathControls(kind === 'path' ? 'Line' : `${objs.length} lines`) +
      `<label class="chk mt"><input type="checkbox" data-pk="smooth"> Smooth curve through points</label>
      <p class="insp-note">Drag an end point onto a block to connect it; connected ends follow the block. Double-click the line to add a point, <kbd>Alt</kbd>-click a point to remove it.</p>` + orderRow;
  } else if (kind === 'pathstyle') {
    h = pathControls('Style for new lines') + `<p class="insp-note">Start or end a line inside a block to connect it. Polyline and curve: click points, double-click or <kbd>Enter</kbd> to finish, <kbd>Backspace</kbd> removes the last point.</p>`;
  } else if (kind === 'multi') {
    const nb = objs.filter(o => o.type === 'block').length;
    h = `<div class="insp-h"><h2>${objs.length} selected</h2></div><p class="insp-note">${nb} blocks, ${objs.length - nb} lines.</p>
      <div class="fld"><span>Colour for blocks</span><div class="swatches">${swatchRow(PALETTE, 'data-color')}</div></div>
      <div class="fld"><span>Shape (keeps area)</span><div class="seg sm"><button data-shape="ellipse">Bubble</button><button data-shape="rect">Box</button></div></div>
      <label class="fld"><span>Zone for blocks</span><input type="text" data-k="zone" list="zoneList2" placeholder="Type a zone"></label><datalist id="zoneList2">${Object.keys(S.zones).map(z => `<option value="${esc(z)}">`).join('')}</datalist>
      <button class="btn wide primary mt" data-act="snapTarget">Snap all to target area</button>` + orderRow;
  } else {
    h = `<div class="help"><h2>Inspector</h2><p class="insp-note">Select a block or a line to edit it.</p>
      <div class="insp-sec"><h2>Workflow</h2><p class="insp-note">1. Drop a site plan on the canvas.<br>2. Calibrate: <kbd>S</kbd>, click two points, type the distance (or set the drawing scale + dpi).<br>3. Type programs on the left; each is drawn at its true area.<br>4. Connect them in the Matrix tab or with the line tools, then Arrange or move by hand.</p></div>
      <div class="insp-sec"><h2>Keys</h2><dl>
      <dt><kbd>V</kbd></dt><dd>Select, move, resize, rotate</dd>
      <dt><kbd>Space</kbd> drag</dt><dd>Pan (or right / middle drag)</dd>
      <dt>Wheel</dt><dd>Zoom at cursor · <kbd>F</kbd> fit</dd>
      <dt><kbd>L P A C</kbd></dt><dd>Line, polyline, arrow, curve</dd>
      <dt><kbd>S</kbd> / <kbd>M</kbd></dt><dd>Calibrate / measure</dd>
      <dt><kbd>Ctrl Z</kbd></dt><dd>Undo · <kbd>Ctrl Shift Z</kbd> redo</dd>
      <dt>Arrows</dt><dd>Nudge 1 ${lenUnit()} (<kbd>Shift</kbd> 10)</dd>
      <dt><kbd>G</kbd></dt><dd>Toggle grid</dd></dl></div></div>`;
  }
  inspector.innerHTML = h;
}
function setVal(sel_, v) { const el = inspector.querySelector(sel_); if (el && document.activeElement !== el) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v; } }
function syncInspector() {
  const objs = selectedObjs();
  const kind = lastInspKey.split('|')[0];
  if (kind === 'block') {
    const b = objs[0]; if (!b) return;
    const A = areaOf(b), T = targetOf(b);
    setVal('[data-k="name"]', b.name); setVal('[data-k="zone"]', b.zone || ''); setVal('[data-k="qty"]', b.qty || 1);
    setVal('[data-k="target"]', isM() ? r2(areaOut(b.target)) : Math.round(areaOut(b.target)));
    setVal('[data-k="area"]', isM() ? r2(areaOut(A)) : Math.round(areaOut(A)));
    setVal('[data-k="w"]', r2(lenOut(b.w))); setVal('[data-k="h"]', r2(lenOut(b.h))); setVal('[data-k="rot"]', r2(b.rot));
    setVal('[data-k="lockRatio"]', b.lockRatio); setVal('[data-k="pinned"]', b.pinned); setVal('[data-k="color"]', b.color);
    const sw = inspector.querySelector('[data-sync="swatch"]'); if (sw) { sw.style.background = fillOf(b); sw.style.borderRadius = b.shape === 'rect' ? '2px' : '50%'; }
    const each = inspector.querySelector('[data-sync="each"]'); if (each) each.textContent = (b.qty || 1) > 1 ? ` (each, ×${b.qty} = ${fmtArea(T)})` : '';
    const dl = inspector.querySelector('[data-sync="delta"]');
    if (dl) {
      const d = pctDiff(A, T);
      dl.innerHTML = T ? `Drawn ${fmtArea(A)} / target ${fmtArea(T)}<br><b class="${Math.abs(d) < 0.005 ? 'ok' : d > 0 ? 'over' : 'under'}">${Math.abs(d) < 0.005 ? 'On target' : `${fmtPct(d)} (${d > 0 ? '+' : '−'}${fmtArea(Math.abs(A - T))})`}</b> · ratio ${(A / T).toFixed(3)}` : 'No target area set.';
    }
    inspector.querySelectorAll('[data-shape]').forEach(x => x.classList.toggle('on', x.dataset.shape === b.shape));
    inspector.querySelectorAll('[data-color]').forEach(x => x.classList.toggle('on', x.dataset.color.toLowerCase() === b.color.toLowerCase()));
  } else if (kind === 'path' || kind === 'paths' || kind === 'pathstyle') {
    const p = kind === 'pathstyle' ? S.pathStyle : objs[0]; if (!p) return;
    setVal('[data-pk="rel"]', p.rel || ''); setVal('[data-pk="color"]', p.color); setVal('[data-pk="width"]', p.width); setVal('[data-pk="dash"]', p.dash);
    setVal('[data-pk="arrowStart"]', p.arrowStart); setVal('[data-pk="arrowEnd"]', p.arrowEnd); setVal('[data-pk="smooth"]', p.kind === 'curve');
    const o = inspector.querySelector('[data-out="width"]'); if (o) o.textContent = p.width + ' px';
    inspector.querySelectorAll('[data-pcolor]').forEach(x => x.classList.toggle('on', x.dataset.pcolor.toLowerCase() === (p.color || '').toLowerCase()));
    const relSel = inspector.querySelector('[data-pk="rel"]'); if (relSel && kind === 'pathstyle') relSel.closest('.fld').style.display = 'none';
  } else if (kind === 'multi') {
    inspector.querySelectorAll('[data-shape]').forEach(x => x.classList.remove('on'));
  }
}
function pathTargets() {
  const kind = lastInspKey.split('|')[0];
  return kind === 'pathstyle' ? [S.pathStyle] : selectedObjs().filter(o => o.type === 'path');
}
function applyBlockField(b, k, el) {
  const v = el.type === 'checkbox' ? el.checked : el.value;
  switch (k) {
    case 'name': b.name = v; break;
    case 'zone': b.zone = String(v).trim(); if (b.zone) zoneColor(b.zone); break;
    case 'qty': { const q = Math.max(1, parseInt(v, 10) || 1); b.qty = q; break; }
    case 'target': { const t = +v; if (t >= 0) b.target = areaIn(t); break; }
    case 'area': { const a = areaIn(+v); if (a > 0) { const kk = Math.sqrt(a / areaOf(b)); b.w *= kk; b.h *= kk; } break; }
    case 'w': { const w = lenIn(+v); if (w > 0) { if (b.lockRatio) b.h *= w / b.w; b.w = w; } break; }
    case 'h': { const h = lenIn(+v); if (h > 0) { if (b.lockRatio) b.w *= h / b.h; b.h = h; } break; }
    case 'rot': b.rot = +v || 0; break;
    case 'lockRatio': b.lockRatio = v; break;
    case 'pinned': b.pinned = v; break;
    case 'color': b.color = v; break;
  }
}
function applyPathField(p, k, el) {
  const v = el.type === 'checkbox' ? el.checked : el.value;
  if (k === 'rel') { if (p.type === 'path') applyRel(p, v || null); return; }
  if (k === 'width') p.width = +v;
  else if (k === 'smooth') { if (p.type === 'path') p.kind = v ? 'curve' : 'line'; }
  else p[k] = v;
}
inspector.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.k) {
    if (lastInspKey.startsWith('multi')) { if (el.dataset.k === 'zone') selectedObjs().filter(o => o.type === 'block').forEach(b => applyBlockField(b, 'zone', el)); }
    else { const b = selectedObjs()[0]; if (b) applyBlockField(b, el.dataset.k, el); }
    requestRender();
  } else if (el.dataset.pk) {
    pathTargets().forEach(p => applyPathField(p, el.dataset.pk, el));
    requestRender();
  }
});
inspector.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.k || el.dataset.pk) {
    if (lastInspKey.startsWith('pathstyle')) scheduleSave(); else commit();
    lastPanelSig = ''; if (el.dataset.k === 'zone') lastInspKey = '';
    requestRender();
  }
});
inspector.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  const objs = selectedObjs(), bs = objs.filter(o => o.type === 'block');
  if (t.dataset.color) { bs.forEach(b => b.color = t.dataset.color); if (S.settings.colorBy === 'zone' && bs.length) toast('Colour by is set to Zone; switch to Program in View to see block colours.'); commit(); return; }
  if (t.dataset.pcolor) { pathTargets().forEach(p => p.color = t.dataset.pcolor); lastInspKey.startsWith('pathstyle') ? (scheduleSave(), requestRender()) : commit(); return; }
  if (t.dataset.shape) {
    bs.forEach(b => { if (b.shape === t.dataset.shape) return; const A = areaOf(b), r = b.w / b.h; b.shape = t.dataset.shape; Object.assign(b, sizeForArea(b.shape, A, r)); });
    commit(); return;
  }
  const act = t.dataset.act;
  if (!act) return;
  if (act === 'snapTarget') { bs.forEach(snapToTarget); commit(); }
  else if (act === 'equalize') { bs.forEach(b => { const A = areaOf(b); Object.assign(b, sizeForArea(b.shape, A, 1)); }); commit(); }
  else if (act === 'duplicate') duplicateSelected();
  else if (act === 'delete') deleteSelected();
  else reorder(act);
});

// ---------------------------------------------------------------- left panel wiring
$('#progInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const n = addPrograms(e.target.value);
    if (n) { e.target.value = ''; toast(n === 1 ? 'Program added at true size.' : `${n} programs added at true size.`); }
  }
});
$('#progInput').addEventListener('paste', e => {
  const t = (e.clipboardData || window.clipboardData).getData('text');
  if (t && t.includes('\n')) {
    e.preventDefault();
    const n = addPrograms(t);
    if (n) toast(`${n} programs added from the pasted rows.`);
  }
});
$('#progList').addEventListener('click', e => {
  const b = e.target.closest('[data-id]'); if (!b) return;
  if (e.shiftKey) { sel.has(b.dataset.id) ? sel.delete(b.dataset.id) : sel.add(b.dataset.id); }
  else sel = new Set([b.dataset.id]);
  setTool('select'); requestRender();
});
document.querySelectorAll('[data-newshape]').forEach(b => b.addEventListener('click', () => {
  S.settings.newShape = b.dataset.newshape; syncSettingsUI(); scheduleSave();
}));
document.querySelectorAll('[data-colorby]').forEach(b => b.addEventListener('click', () => {
  S.settings.colorBy = b.dataset.colorby; syncSettingsUI(); scheduleSave(); requestRender();
}));
document.querySelectorAll('[data-units]').forEach(b => b.addEventListener('click', () => {
  S.units = b.dataset.units; syncSettingsUI(); lastInspKey = ''; lastPanelSig = ''; scheduleSave(); requestRender();
}));
document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#btnArrange').addEventListener('click', arrange);
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redo);
$('#btnSave').addEventListener('click', saveProject);
$('#btnOpen').addEventListener('click', () => $('#fileProj').click());
$('#btnPng').addEventListener('click', exportPNG);
$('#btnSvg').addEventListener('click', exportSVG);
$('#btnNew').addEventListener('click', () => {
  const btn = $('#btnNew');
  if ((S.objects.length || S.backdrop) && !btn.dataset.armed) {
    btn.dataset.armed = '1'; btn.textContent = 'Clear all?'; btn.classList.add('danger');
    toast('Press “Clear all?” again to start an empty project. Save first to keep this one.');
    setTimeout(() => { delete btn.dataset.armed; btn.textContent = 'New'; btn.classList.remove('danger'); }, 3500);
    return;
  }
  delete btn.dataset.armed; btn.textContent = 'New'; btn.classList.remove('danger');
  const keep = { settings: S.settings, pathStyle: S.pathStyle, units: S.units };
  S = Object.assign(freshState(), keep); sel.clear(); hist = []; hIdx = -1;
  $('#projName').value = S.name; commit(); syncSettingsUI(); zoomFit();
});
$('#projName').addEventListener('input', e => { S.name = e.target.value; scheduleSave(); });
$('#fileProj').addEventListener('change', e => { const f = e.target.files[0]; if (f) loadProject(f); e.target.value = ''; });
$('#fileBd').addEventListener('change', e => { const f = e.target.files[0]; if (f) loadBackdropFile(f); e.target.value = ''; });
['#btnLoadBd', '#btnLoadBd2'].forEach(s => $(s).addEventListener('click', () => $('#fileBd').click()));
async function fetchSampleFile() {
  const r = await fetch('samples/clemente_siteplan_3-32_100dpi.png');
  if (!r.ok) throw new Error('sample missing');
  return new File([await r.blob()], 'clemente_siteplan_3-32_100dpi.png', { type: 'image/png' });
}
// First open with nothing saved: a worked example, clearly named as one.
async function loadExample() {
  const file = await fetchSampleFile();
  S = Object.assign(freshState(), { settings: S.settings, pathStyle: S.pathStyle, units: S.units });
  sel.clear();
  const buf = new Uint8Array(await file.arrayBuffer());
  const url = await blobToDataURL(file), img = await loadImg(url);
  setBackdrop({ src: url, name: file.name, w: img.naturalWidth, h: img.naturalHeight, dpi: readDpi(buf) || 100, img });
  const bd = S.backdrop;
  bd.ftPerPx = (32 / 3) / bd.dpi; bd.calibrated = true; bd.calibNote = 'Drawing scale 3/32" = 1\'-0" at ' + bd.dpi + ' dpi';
  S.name = 'Example – community garden';
  // centre the view on the lot before placing programs
  const W = canvasW(), H = canvasH(), lot = { x: 1230 * bd.ftPerPx, y: 1760 * bd.ftPerPx };
  view.z = Math.min(W, H) / 170; view.tx = W / 2 - lot.x * view.z; view.ty = H / 2 - lot.y * view.z;
  addPrograms(['Lobby 1200 @Public', 'Classroom 900 @Learning', 'Teaching kitchen 900 @Learning', 'Greenhouse 1500 @Garden', 'Tool shed 300 @Garden', 'Restroom 120 x2 @Public'].join('\n'));
  const id = n => blocks().find(b => b.name === n).id;
  [['Lobby', 'Classroom', 'required'], ['Lobby', 'Restroom', 'required'], ['Classroom', 'Teaching kitchen', 'preferred'],
   ['Greenhouse', 'Tool shed', 'required'], ['Teaching kitchen', 'Greenhouse', 'preferred'], ['Restroom', 'Teaching kitchen', 'avoid']]
    .forEach(([a, b, r]) => makeConnector(id(a), id(b), r));
  sel.clear(); $('#projName').value = S.name;
  hist = []; hIdx = -1; commit();
  arrange();
  setTimeout(() => toast('This is an example. Press New to start your own, or drop your site plan on the canvas.'), 600);
}
$('#btnSample').addEventListener('click', async () => {
  try { await loadBackdropFile(await fetchSampleFile()); } catch (e) { toast('The sample loads when the app is served (run serve.bat). You can also drop the PNG from the samples folder.'); }
});
$('#btnCalib').addEventListener('click', () => setTool('scale'));
$('#btnApplyPreset').addEventListener('click', () => {
  const bd = S.backdrop; if (!bd) return;
  const dpi = +$('#bdDpi').value;
  if (!(dpi > 0)) { toast('Enter the image resolution in dpi (it is filled in automatically for PDFs and most PNGs).'); return; }
  const ftPerIn = +$('#bdPreset').value;
  const lab = SCALES.find(s => Math.abs(s[1] - ftPerIn) < 1e-9)[0];
  bd.dpi = dpi; bd.ftPerPx = ftPerIn / dpi; bd.calibrated = true; bd.calibNote = `Drawing scale ${lab} at ${dpi} dpi`;
  commit(); toast(`Scale set from ${lab} at ${dpi} dpi.`);
});
$('#bdOpacity').addEventListener('input', e => { if (S.backdrop) { S.backdrop.opacity = +e.target.value; requestRender(); } });
$('#bdOpacity').addEventListener('change', () => commit());
$('#bdVisible').addEventListener('change', e => { if (S.backdrop) { S.backdrop.visible = e.target.checked; commit(); } });
$('#bdLocked').addEventListener('change', e => { if (S.backdrop) { S.backdrop.locked = e.target.checked; commit(); if (!e.target.checked) toast('Site plan unlocked: drag it with the select tool. Lock it again when placed.'); } });
$('#btnRemoveBd').addEventListener('click', () => { S.backdrop = null; commit(); });
$('#btnFit').addEventListener('click', zoomFit);
$('#setGrid').addEventListener('change', e => { S.settings.grid = e.target.checked; scheduleSave(); requestRender(); });
$('#setGridSize').addEventListener('input', e => { const v = +e.target.value; if (v > 0) { S.settings.gridSize = v; scheduleSave(); requestRender(); } });
$('#setSnap').addEventListener('change', e => { S.settings.snap = e.target.checked; scheduleSave(); });
$('#setHulls').addEventListener('change', e => { S.settings.hulls = e.target.checked; scheduleSave(); requestRender(); });
$('#setLegend').addEventListener('change', e => { S.settings.legend = e.target.checked; scheduleSave(); requestRender(); });
$('#setFill').addEventListener('input', e => { S.settings.fillOpacity = +e.target.value; $('#fillOut').textContent = Math.round(S.settings.fillOpacity * 100) + '%'; scheduleSave(); requestRender(); });
$('#setLabel').addEventListener('input', e => { S.settings.labelSize = +e.target.value; $('#labelOut').textContent = S.settings.labelSize + ' px'; scheduleSave(); requestRender(); });

function syncSettingsUI() {
  const st = S.settings;
  $('#setGrid').checked = st.grid; $('#setGridSize').value = st.gridSize; $('#setSnap').checked = st.snap;
  $('#setHulls').checked = st.hulls; $('#setLegend').checked = st.legend;
  $('#setFill').value = st.fillOpacity; $('#fillOut').textContent = Math.round(st.fillOpacity * 100) + '%';
  $('#setLabel').value = st.labelSize; $('#labelOut').textContent = st.labelSize + ' px';
  $('#gridUnit').textContent = lenUnit();
  document.querySelectorAll('[data-newshape]').forEach(b => b.classList.toggle('on', b.dataset.newshape === st.newShape));
  document.querySelectorAll('[data-colorby]').forEach(b => b.classList.toggle('on', b.dataset.colorby === st.colorBy));
  document.querySelectorAll('[data-units]').forEach(b => b.classList.toggle('on', b.dataset.units === S.units));
  $('#projName').value = S.name;
}

// drag & drop anywhere
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('#dropHint').hidden = false; } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropHint').hidden = true; });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; $('#dropHint').hidden = true;
  const f = e.dataTransfer.files[0]; if (!f) return;
  if (/\.json$/i.test(f.name) || f.type === 'application/json') loadProject(f); else loadBackdropFile(f);
});
window.addEventListener('resize', requestRender);

// ---------------------------------------------------------------- boot
$('#bdPreset').innerHTML = SCALES.map(([l, v]) => `<option value="${v}"${l.startsWith('3/32') ? ' selected' : ''}>${l}</option>`).join('');
(async () => {
  const had = await loadLocal();
  syncSettingsUI();
  hist = []; hIdx = -1; commit();
  setTool('select');
  if (!had) { zoomFit(); try { await loadExample(); } catch (e) { /* no sample (opened from file://): start empty */ } }
  requestRender();
})();

// small hook for automated checks
window.__bubble = { get state() { return S; }, get view() { return view; }, areaOf, targetOf, resolvedPoints, setTool, zoomFit, addPrograms, sel: () => sel };
})();
