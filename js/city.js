// Вымышленный открытый город: извилистая сеть улиц разной плотности, река с мостами,
// эстакада над городом, тоннель через холм, кольцевая дорога, районы с разной застройкой.
import * as THREE from 'three';
import { World, M, T, rnd, rr, pick, uvs, canvasTex, normalFrom } from './world.js';
import { CARS, extraModels, addCarToBuckets } from './cars.js';
import { satOBB } from './physics.js';

export const CITY_HALF = 1600;                         // граница, дальше машина не уедет
export const CITY_LEVEL = { x: 1020, z: 980 };          // автодром для уровней
const GSTEP = 8, G0 = -1840, GN2 = 461;                 // сетка рельефа: -1840..1840
const SWK = 4;                                          // ширина тротуара
const ROADW = { main: 15, street: 9, hwy: 22 };         // ширина проезжей части

const cClamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cSmooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// ---------- геометрия на плоскости ----------
function cSegDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
  const t = cClamp(((px - ax) * vx + (pz - az) * vz) / L2, 0, 1);
  const qx = ax + vx * t, qz = az + vz * t;
  return { d: Math.hypot(px - qx, pz - qz), t, side: Math.sign(vx * (pz - az) - vz * (px - ax)) };
}
function cCross(a, b, c, d) {          // пересекаются ли отрезки ab и cd (без общих концов)
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
function cPoly(pts) {                  // ломаная с длиной дуги и касательными
  let s = 0; const out = [];
  pts.forEach((p, i) => { if (i) s += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z); out.push({ x: p.x, z: p.z, s }); });
  out.forEach((p, i) => { const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.z - a.z) || 1; p.tx = (b.x - a.x) / l; p.tz = (b.z - a.z) / l; });
  out.len = s; return out;
}
function cAt(P, s) {
  s = cClamp(s, 0, P.len);
  let lo = 0, hi = P.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m; }
  const a = P[lo], b = P[hi], t = (s - a.s) / ((b.s - a.s) || 1);
  const tx = a.tx + (b.tx - a.tx) * t, tz = a.tz + (b.tz - a.tz) * t, l = Math.hypot(tx, tz) || 1;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: tx / l, tz: tz / l };
}
function cSpline(ctrl, step = 6) {      // гладкая кривая через точки
  const c = new THREE.CatmullRomCurve3(ctrl.map(p => new THREE.Vector3(p[0] ?? p.x, 0, p[1] ?? p.z)), false, 'centripetal');
  const n = Math.max(2, Math.ceil(c.getLength() / step));
  return cPoly(c.getSpacedPoints(n).map(v => ({ x: v.x, z: v.z })));
}

// Пространственный хеш отрезков: дороги, река, полотна эстакад
class SegHash {
  constructor(cell = 40) { this.c = cell; this.m = new Map(); }
  add(ax, az, bx, bz, data) {
    const c = this.c, s = { ax, az, bx, bz, data };
    for (let i = Math.floor(Math.min(ax, bx) / c); i <= Math.floor(Math.max(ax, bx) / c); i++)
      for (let j = Math.floor(Math.min(az, bz) / c); j <= Math.floor(Math.max(az, bz) / c); j++) {
        const k = i * 4096 + j; if (!this.m.has(k)) this.m.set(k, []); this.m.get(k).push(s);
      }
  }
  addPoly(P, data, from = 0, to = P.len) {
    for (let i = 1; i < P.length; i++) if (P[i].s >= from && P[i - 1].s <= to) this.add(P[i - 1].x, P[i - 1].z, P[i].x, P[i].z, { ...data, s0: P[i - 1].s, s1: P[i].s });
  }
  near(x, z, r) {
    const c = this.c, out = new Set();
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++)
      for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) { const a = this.m.get(i * 4096 + j); if (a) for (const s of a) out.add(s); }
    return out;
  }
  dist(x, z, r = 60, filter) {
    let best = { d: Infinity };
    for (const s of this.near(x, z, r)) { if (filter && !filter(s.data)) continue; const q = cSegDist(x, z, s.ax, s.az, s.bx, s.bz); if (q.d < best.d) best = { d: q.d, seg: s, t: q.t, side: q.side }; }
    return best;
  }
}

// ---------- план города ----------
const RIVER = cSpline([[-420, -1900], [-330, -1350], [-430, -900], [-300, -480], [-90, -120], [-60, 250], [-210, 620], [-380, 980], [-300, 1400], [-180, 1900]], 8);
const RIVER_W = 58;                                   // ширина воды
const HILL = { x: -1010, z: 210, R: 330, H: 72 };
const EXPRESS = [[-1500, -560], [-1300, -600], [-1000, -680], [-640, -760], [-260, -700], [120, -580], [520, -520], [900, -420], [1240, -300], [1500, -250]];
const EXP_RAMP = 190, EXP_H = 9.5;
const DISTRICTS = [
  { name: 'Центр', x: 330, z: -170, r: 470, rad: 88, kind: 'down' },
  { name: 'Старый город', x: -720, z: -470, r: 380, rad: 104, kind: 'old' },
  { name: 'Промзона', x: 520, z: 860, r: 430, rad: 175, kind: 'ind' },
  { name: 'Северный', x: 600, z: -1050, r: 520, rad: 140, kind: 'sub' },
  { name: 'Заречье', x: -760, z: 820, r: 480, rad: 140, kind: 'sub' },
  { name: 'Восточный', x: 1080, z: 160, r: 380, rad: 120, kind: 'mid' },
];
const district = (x, z) => { let best = null, bd = Infinity; for (const d of DISTRICTS) { const q = Math.hypot(x - d.x, z - d.z) / d.r; if (q < bd) { bd = q; best = d; } } return bd < 1.25 ? best : { kind: 'mid', rad: 135, name: '' }; };
// Крупные места: узлы дорог их обходят
const PLACES = [
  { id: 'park', x: 560, z: -330, r: 125, name: 'Центральный парк' },
  { id: 'stadium', x: 880, z: 420, r: 105, name: 'Стадион' },
  { id: 'mall', x: -560, z: 470, r: 95, name: 'Торговый центр' },
  { id: 'port', x: -160, z: 1180, r: 150, name: 'Порт' },
  { id: 'autodrom', x: CITY_LEVEL.x, z: CITY_LEVEL.z, r: 92, name: 'Автодром' },
  { id: 'tower', x: -640, z: -120, r: 70, name: 'Телебашня' },
  { id: 'arena', x: 160, z: 260, r: 80, name: 'Арена' },
  { id: 'station', x: 1130, z: -620, r: 85, name: 'Вокзал' },
];
const ringR = a => { const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)); return 1380 / Math.pow(c ** 4 + s ** 4, 0.25) * (1 + 0.035 * Math.sin(3 * a + 0.6)); };

// Рельеф: равнина, русло реки, холм, горы за кольцом
function rawHeight(x, z, riverD) {
  let h = 0;
  const dh = Math.hypot(x - HILL.x, z - HILL.z);
  if (dh < HILL.R) { const t = 1 - dh / HILL.R; h += HILL.H * (0.5 - 0.5 * Math.cos(Math.PI * t)) * (1 + 0.08 * Math.sin(x * 0.03) * Math.cos(z * 0.027)); }
  const e = Math.max(Math.abs(x), Math.abs(z)) - 1540;
  if (e > 0) {                          // предгорья вокруг города, долина реки уходит сквозь них
    const n = 0.6 + 0.4 * Math.sin(x * 0.009 + z * 0.006) * Math.cos(x * 0.004 - z * 0.011) + 0.15 * Math.sin(x * 0.05 + z * 0.043);
    h += (e * 0.22 + Math.max(0, e - 80) * 0.35) * n * cSmooth((riverD - 30) / 220);
  }
  const m = Math.max(Math.abs(x), Math.abs(z));
  if (m > 1690) h += (40 - h) * cSmooth((m - 1690) / 140);          // за гребнем склон уходит к дальней равнине
  if (riverD < RIVER_W / 2 + 14) h = Math.min(h, -6 * (1 - cSmooth((riverD - RIVER_W / 2 + 2) / 16)));
  return h;
}

function cHull(pts) {                 // выпуклая оболочка (монотонная цепь)
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export class City extends World {
  generate() {
    this.isCity = true;
    this.cityTextures();
    this.riverHash = new SegHash(60); this.riverHash.addPoly(RIVER, { river: true });
    this.planNetwork();
    this.buildTerrain();
    this.buildRoads();
    this.buildPlaces();
    this.fillLots();
    this.scatter();
    this.signals();
    this.spawnPoint();
  }

  // ---------- текстуры дорог с разметкой ----------
  cityTextures() {
    const road = (w, lines) => {             // lines: [позиция м, 'solid'|'dash'|'double']
      const t = canvasTex(512, 1024, (g, Wd, H) => {
        g.drawImage(T.asphalt.image, 0, 0, Wd, H);
        const k = Wd / w; g.fillStyle = '#ecebe4';
        for (const [x, kind] of lines) {
          const px = x * k;
          if (kind === 'solid') g.fillRect(px - 0.075 * k, 0, 0.15 * k, H);
          else if (kind === 'double') { g.fillRect(px - 0.25 * k, 0, 0.13 * k, H); g.fillRect(px + 0.12 * k, 0, 0.13 * k, H); }
          else g.fillRect(px - 0.075 * k, 0, 0.15 * k, H * 0.25);
        }
      });
      t.wrapS = THREE.ClampToEdgeWrapping;
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, normalMap: normalFrom(T.asphalt, 2) });
    };
    M.rMain = road(15, [[0.35, 'solid'], [3.95, 'dash'], [7.5, 'double'], [11.05, 'dash'], [14.65, 'solid']]);
    M.rStreet = road(9, [[0.3, 'solid'], [4.5, 'dash'], [8.7, 'solid']]);
    M.rHwy = road(10, [[0.5, 'solid'], [4.5, 'dash'], [9.4, 'solid']]);
    M.jAsph = new THREE.MeshStandardMaterial({ map: T.asphalt, roughness: 0.92, normalMap: normalFrom(T.asphalt, 2), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    M.walk = new THREE.MeshStandardMaterial({ map: T.sidewalk, roughness: 0.9 });
    M.bridgeC = new THREE.MeshStandardMaterial({ color: 0xc4bfb4, roughness: 0.85 });
    M.bridgeDark = new THREE.MeshStandardMaterial({ color: 0x8d8981, roughness: 0.9, side: THREE.DoubleSide });
    M.cable = new THREE.MeshStandardMaterial({ color: 0xe9e9e6, metalness: 0.5, roughness: 0.4 });
    M.archRed = new THREE.MeshStandardMaterial({ color: 0xb8352d, metalness: 0.4, roughness: 0.45 });
    M.riverW = new THREE.MeshStandardMaterial({ color: 0x3f7f8c, roughness: 0.12, metalness: 0.3, transparent: true, opacity: 0.92 });
    M.ground = new THREE.MeshStandardMaterial({ map: T.grass, roughness: 1, vertexColors: true });
    M.hRoofRed = new THREE.MeshStandardMaterial({ color: 0x9c4a36, roughness: 0.8 });
    M.hRoofGrey = new THREE.MeshStandardMaterial({ color: 0x5b6067, roughness: 0.7 });
    M.hRoofBrown = new THREE.MeshStandardMaterial({ color: 0x6b4b36, roughness: 0.8 });
    M.wallsH = [0xe9dcc3, 0xd9c7a8, 0xf0ece4, 0xc9d3cf, 0xe7d1c1, 0xd6d0bf].map(c => new THREE.MeshStandardMaterial({ map: T.house, color: c, roughness: 0.85 }));
    M.corr = new THREE.MeshStandardMaterial({ map: canvasTex(256, 64, (g, w, h) => { for (let x = 0; x < w; x += 8) { const v = 150 + (x / 8 % 2) * 25; g.fillStyle = `rgb(${v},${v + 4},${v + 8})`; g.fillRect(x, 0, 8, h); } }), roughness: 0.6, metalness: 0.3 });
    M.contCols = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd68910, 0x7d3c98, 0x566573].map(c => new THREE.MeshStandardMaterial({ map: M.corr.map, color: c, roughness: 0.6, metalness: 0.3 }));
  }

  // ---------- сеть дорог ----------
  planNetwork() {
    const nodes = this.nodes = [], edges = this.edges = [];
    const node = (x, z, o = {}) => { const n = { id: nodes.length, x, z, e: [], ...o }; nodes.push(n); return n; };
    const riverD = (x, z) => this.riverHash.dist(x, z, 140).d;
    this.expPoly = cSpline(EXPRESS, 4);
    const expHash = new SegHash(60); expHash.addPoly(this.expPoly, {});
    const expD = (x, z) => expHash.dist(x, z, 80).d;
    // кольцевая
    const RN = 64, ring = [];
    for (let i = 0; i < RN; i++) {
      const a = (i / RN) * Math.PI * 2, r = ringR(a), x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (riverD(x, z) < 70 || expD(x, z) < 40) continue;
      ring.push(node(x, z, { ring: true, a }));
    }
    const forced = [];
    const addEdge = (a, b, o = {}) => { const e = { a, b, type: 'street', kind: 'ground', ...o }; edges.push(e); return e; };
    for (let i = 0; i < ring.length; i++) {
      const A = ring[i], B = ring[(i + 1) % ring.length];
      let a1 = B.a; if (a1 < A.a) a1 += Math.PI * 2;
      const pts = []; for (let k = 0; k <= 12; k++) { const a = A.a + (a1 - A.a) * k / 12, r = ringR(a); pts.push({ x: Math.cos(a) * r, z: Math.sin(a) * r }); }
      forced.push(addEdge(A, B, { type: 'main', ring: true, pts, forced: true }));
    }
    // эстакада: съезды за кольцом, от них дорога к кольцу
    const E1 = node(EXPRESS[0][0], EXPRESS[0][1], { exp: true }), E2 = node(EXPRESS.at(-1)[0], EXPRESS.at(-1)[1], { exp: true });
    forced.push(addEdge(E1, E2, { type: 'hwy', kind: 'hwy', P: this.expPoly, forced: true }));
    const nearRing = (x, z, notDir) => ring.filter(n => !notDir || ((n.x - x) * notDir[0] + (n.z - z) * notDir[1]) / Math.hypot(n.x - x, n.z - z) < 0.3)
      .reduce((b, n) => (Math.hypot(n.x - x, n.z - z) < Math.hypot(b.x - x, b.z - z) ? n : b));
    for (const [E, dir, off] of [[E1, [1, -0.2], -230], [E2, [-1, 0.2], -230]]) {
      const R = nearRing(E.x, E.z + off, dir);
      const mid = { x: (E.x + R.x) / 2 + (E === E1 ? -60 : 60), z: (E.z + R.z) / 2 };
      forced.push(addEdge(E, R, { type: 'main', forced: true, pts: cSpline([[E.x, E.z], [mid.x, mid.z], [R.x, R.z]], 6) }));
    }
    // тоннель через холм
    const T1 = ring.filter(n => n.x < 0).reduce((b, n) => (Math.abs(n.z - HILL.z) < Math.abs(b.z - HILL.z) ? n : b));
    const T2 = node(-600, T1.z + 10);
    const tun = addEdge(T1, T2, { type: 'main', kind: 'tunnel', forced: true }); forced.push(tun);
    // внутренние узлы: выборка Пуассона с плотностью по районам
    const grid = new Map(), gk = (x, z) => Math.floor(x / 80) * 1000 + Math.floor(z / 80);
    const gAdd = n => { const k = gk(n.x, n.z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n); };
    const gNear = (x, z, r) => { const out = []; for (let i = Math.floor((x - r) / 80); i <= Math.floor((x + r) / 80); i++) for (let j = Math.floor((z - r) / 80); j <= Math.floor((z + r) / 80); j++) { const a = grid.get(i * 1000 + j); if (a) out.push(...a); } return out; };
    for (const n of nodes) gAdd(n);
    for (let k = 0; k < 30000; k++) {
      const x = rr(-1340, 1340), z = rr(-1340, 1340), a = Math.atan2(z, x);
      if (Math.hypot(x, z) > ringR(a) - 85) continue;
      const D = district(x, z), rad = D.rad * rr(0.92, 1.15);
      if (riverD(x, z) < 62 || Math.hypot(x - HILL.x, z - HILL.z) < HILL.R + 50 || expD(x, z) < 34) continue;
      if (PLACES.some(p => Math.hypot(x - p.x, z - p.z) < p.r + 28)) continue;
      if (cSegDist(x, z, T1.x, T1.z, T2.x, T2.z).d < 40) continue;
      if (gNear(x, z, rad).some(n => Math.hypot(n.x - x, n.z - z) < rad)) continue;
      const n = node(x, z, { rad }); gAdd(n);
    }
    // граф относительного соседства: планарный и «живой», без сетки
    const inner = nodes.filter(n => !n.exp);
    const has = new Set(edges.map(e => Math.min(e.a.id, e.b.id) + ':' + Math.max(e.a.id, e.b.id)));
    const cand = [];
    for (const p of inner) for (const q of gNear(p.x, p.z, 340)) {
      if (q.id <= p.id || q.exp) continue;
      const d = Math.hypot(p.x - q.x, p.z - q.z); if (d > 330) continue;
      if (p.ring && q.ring) continue;
      if (has.has(p.id + ':' + q.id)) continue;
      const mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
      if (gNear(mx, mz, d).some(r => r !== p && r !== q && !r.exp && Math.max(Math.hypot(r.x - p.x, r.z - p.z), Math.hypot(r.x - q.x, r.z - q.z)) < d)) continue;
      cand.push({ a: p, b: q, d });
    }
    const crossesForced = c => forced.some(f => f.kind !== 'hwy' && f.a !== c.a && f.a !== c.b && f.b !== c.a && f.b !== c.b && (f.pts ? f.pts.some((p, i) => i && cCross(c.a, c.b, f.pts[i - 1], p)) : cCross(c.a, c.b, f.a, f.b)));
    const riverX = c => { for (let i = 1; i < RIVER.length; i++) if (cCross(c.a, c.b, RIVER[i - 1], RIVER[i])) return { i, t: RIVER[i].s, dot: Math.abs(((c.b.x - c.a.x) * RIVER[i].tx + (c.b.z - c.a.z) * RIVER[i].tz) / c.d) }; return null; };
    const nearRiver = c => { for (let k = 0; k <= 20; k++) { const t = k / 20; if (riverD(c.a.x + (c.b.x - c.a.x) * t, c.a.z + (c.b.z - c.a.z) * t) < 52) return true; } return false; };
    const hillHit = c => cSegDist(HILL.x, HILL.z, c.a.x, c.a.z, c.b.x, c.b.z).d < HILL.R + 30;
    const placeHit = c => PLACES.some(p => cSegDist(p.x, p.z, c.a.x, c.a.z, c.b.x, c.b.z).d < p.r + 6);
    const keep = [], bridges = [];
    for (const c of cand) {
      if (crossesForced(c) || hillHit(c) || placeHit(c)) continue;
      const rx = riverX(c);
      if (rx) { if (rx.dot < 0.55) bridges.push({ ...c, rs: rx.t }); continue; }
      if (nearRiver(c)) continue;
      keep.push(c);
    }
    // мосты: не чаще, чем раз в 330 м по реке (кольцо уже даёт два)
    const used = forced.filter(f => f.ring).map(f => { const r = riverX({ a: f.a, b: f.b, d: Math.hypot(f.a.x - f.b.x, f.a.z - f.b.z) }); return r && r.t; }).filter(v => v !== null && v !== undefined);
    bridges.sort((a, b) => a.d - b.d);
    for (const b of bridges) if (used.every(t => Math.abs(t - b.rs) > 330)) { used.push(b.rs); keep.push({ ...b, bridge: true }); }
    for (const c of keep) addEdge(c.a, c.b, { bridge: c.bridge });
    // связи узлов, разведение острых углов
    const link = () => { for (const n of nodes) n.e = []; for (const e of edges) { e.a.e.push(e); e.b.e.push(e); } };
    link();
    const ang = (n, e) => { const o = e.a === n ? e.b : e.a; const p = e.pts ? (e.a === n ? e.pts[1] : e.pts[e.pts.length - 2]) : e.P ? (e.a === n ? e.P[4] : e.P[e.P.length - 5]) : o; return Math.atan2(p.z - n.z, p.x - n.x); };
    const len = e => Math.hypot(e.a.x - e.b.x, e.a.z - e.b.z);
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of nodes) {
        if (n.e.length < 2) continue;
        const list = n.e.map(e => ({ e, a: ang(n, e) })).sort((p, q) => p.a - q.a);
        for (let i = 0; i < list.length; i++) {
          const p = list[i], q = list[(i + 1) % list.length];
          let d = q.a - p.a; if (d <= 0) d += Math.PI * 2;
          if (d < 0.6 && list.length > 1) {
            const victim = [p.e, q.e].filter(e => !e.forced).sort((x, y) => len(y) - len(x))[0];
            if (victim) { edges.splice(edges.indexOf(victim), 1); link(); changed = true; break; }
          }
        }
      }
    }
    // связность: кусочки без выхода соединяем отброшенными рёбрами
    const par = nodes.map((_, i) => i), find = i => (par[i] === i ? i : (par[i] = find(par[i])));
    for (const e of edges) par[find(e.a.id)] = find(e.b.id);
    for (const c of cand.filter(c => !crossesForced(c) && !hillHit(c) && !riverX(c)).sort((a, b) => a.d - b.d)) {
      if (find(c.a.id) === find(c.b.id)) continue;
      if (edges.some(e => e.a !== c.a && e.a !== c.b && e.b !== c.a && e.b !== c.b && cCross(c.a, c.b, e.a, e.b) && !e.pts && !e.P)) continue;
      addEdge(c.a, c.b); par[find(c.a.id)] = find(c.b.id);
    }
    link();
    this.nodes = nodes.filter(n => n.e.length);
    // типы улиц: в центре и у кольца — проспекты
    for (const e of edges) {
      if (e.type !== 'street') continue;
      const mx = (e.a.x + e.b.x) / 2, mz = (e.a.z + e.b.z) / 2, D = district(mx, mz);
      if (e.bridge || e.a.ring || e.b.ring || (D.kind === 'down' && rnd() < 0.55) || ((D.kind === 'mid' || D.kind === 'ind') && rnd() < 0.3)) e.type = 'main';
      if (e.bridge) e.kind = 'bridge';
      if (!e.pts) {        // лёгкий изгиб: в старом городе и пригородах сильнее
        const bend = D.kind === 'down' || e.bridge ? 0 : (D.kind === 'old' || D.kind === 'sub' ? 0.1 : 0.05) * (rnd() < 0.5 ? -1 : 1) * rr(0.4, 1);
        const L = len(e), nx = -(e.b.z - e.a.z) / L, nz = (e.b.x - e.a.x) / L;
        const cx = mx + nx * L * bend, cz = mz + nz * L * bend, pts = [];
        for (let k = 0; k <= 16; k++) { const t = k / 16, u = 1 - t; pts.push({ x: u * u * e.a.x + 2 * u * t * cx + t * t * e.b.x, z: u * u * e.a.z + 2 * u * t * cz + t * t * e.b.z }); }
        e.pts = pts;
      }
    }
    for (const e of edges) {
      if (!e.P && !e.pts) e.pts = Array.from({ length: 17 }, (_, k) => ({ x: e.a.x + (e.b.x - e.a.x) * k / 16, z: e.a.z + (e.b.z - e.a.z) * k / 16 }));
      if (!e.P) e.P = e.pts.length > 2 ? cSpline(e.pts.map(p => [p.x, p.z]), 4) : cPoly(e.pts);
      e.hw = ROADW[e.type] / 2;
      e.sw = e.kind === 'hwy' ? 0.8 : SWK;
    }
    // радиус перекрёстка: чтобы края дорог не налезали друг на друга
    for (const n of this.nodes) {
      const list = n.e.map(e => { const out = e.a === n, P = e.P, p = out ? cAt(P, 6) : cAt(P, P.len - 6); return { e, a: Math.atan2(p.z - n.z, p.x - n.x), hw: e.hw + e.sw }; }).sort((p, q) => p.a - q.a);
      let R = list.length > 2 ? Math.max(...list.map(l => l.hw)) + 1.5 : list.length === 2 ? 2 : 0;
      if (list.length > 1) for (let i = 0; i < list.length; i++) {
        const p = list[i], q = list[(i + 1) % list.length];
        let d = q.a - p.a; if (d <= 0) d += Math.PI * 2;
        if (d < Math.PI - 0.15) R = Math.max(R, (Math.max(p.hw, q.hw) + Math.min(p.hw, q.hw) * Math.cos(d)) / Math.sin(d) + 1);
      }
      n.R = Math.min(32, R); n.dirs = list;
    }
    // профили высоты: мосты горбом над рекой, эстакада на опорах
    for (const e of edges) {
      const P = e.P;
      if (e.kind === 'hwy') { const L = P.len; e.prof = s => EXP_H * cSmooth(s / EXP_RAMP) * cSmooth((L - s) / EXP_RAMP); continue; }
      if (e.kind === 'bridge' || (e.ring && P.some(p => riverD(p.x, p.z) < RIVER_W / 2))) {
        e.kind = 'bridge';
        let s0 = Infinity, s1 = -Infinity; for (const p of P) if (riverD(p.x, p.z) < RIVER_W / 2 + 16) { s0 = Math.min(s0, p.s); s1 = Math.max(s1, p.s); }
        const H = 3.2, ra = 40; e.span = [s0, s1];
        e.prof = s => H * (s < s0 ? cSmooth((s - s0 + ra) / ra) : s > s1 ? cSmooth((s1 + ra - s) / ra) : 1);
        continue;
      }
      e.prof = () => 0;
    }
    this.tunnel = tun; this.express = edges.find(e => e.kind === 'hwy');
  }


  // ---------- рельеф ----------
  buildTerrain() {
    const N = GN2, H = this.gH = new Float32Array(N * N);
    const tHash = new SegHash(40); tHash.addPoly(this.tunnel.P, {});
    const tw = this.tunnel.hw + this.tunnel.sw + 2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = G0 + i * GSTEP, z = G0 + j * GSTEP;
      let h = rawHeight(x, z, this.riverHash.dist(x, z, 90).d);
      if (h > 0 && h < 9.5 && tHash.dist(x, z, 30).d < tw) h = 0;              // выемка у порталов тоннеля
      H[j * N + i] = h;
    }
    const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2), col = new Float32Array(N * N * 3), c = new THREE.Color();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, x = G0 + i * GSTEP, z = G0 + j * GSTEP, h = H[k];
      pos.set([x, h - 0.08, z], k * 3); uv.set([x / 14, z / 14], k * 2);
      const nn = Math.sin(x * 0.013) * Math.cos(z * 0.017) * 0.5 + Math.sin(x * 0.051 + z * 0.043) * 0.25;
      if (h < -0.5) c.setRGB(0.78, 0.72, 0.58);                                  // берег: песок и ил
      else if (h > 18) { const t = Math.min(1, (h - 18) / 60); c.setRGB(0.92 + t * 0.2 + nn * 0.05, 0.95 - t * 0.05, 0.8 + t * 0.1); }   // склоны: выгоревшая трава и камень
      else c.setRGB(0.92 + nn * 0.08, 1, 0.9 + nn * 0.06);
      col.set([c.r, c.g, c.b], k * 3);
    }
    const idx = new Uint32Array((N - 1) * (N - 1) * 6); let q = 0;
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i, b = a + 1, d = a + N, e = d + 1; idx.set([a, d, b, b, d, e], q); q += 6; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
    const ground = new THREE.Mesh(g, M.ground); ground.receiveShadow = true; this.root.add(ground);
    const far = new THREE.Mesh(new THREE.RingGeometry(1700, 16000, 64, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8f9a76, roughness: 1 }));
    far.position.y = 40; this.root.add(far);
    // вода
    this.ribbon(M.riverW, RIVER, 0, RIVER.len, -(RIVER_W / 2 + 8), RIVER_W / 2 + 8, () => -2.1, { uS: 0.05, vS: 0.05 });
  }
  groundAt(x, z) {
    const fx = (x - G0) / GSTEP, fz = (z - G0) / GSTEP, N = GN2;
    const i = cClamp(Math.floor(fx), 0, N - 2), j = cClamp(Math.floor(fz), 0, N - 2), u = cClamp(fx - i, 0, 1), v = cClamp(fz - j, 0, 1), H = this.gH;
    const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  // высота опоры под машиной: земля или полотно моста/эстакады/тоннеля, ближайшее к текущей высоте
  surfaceAt(x, z, y = 0) {
    // опора — самая высокая поверхность, на которую можно въехать (не выше текущей + 0,6 м)
    const g = this.groundAt(x, z); let best = g <= y + 0.6 ? g : -Infinity, low = g;
    for (const sg of this.deckHash.near(x, z, 14)) {
      const q = cSegDist(x, z, sg.ax, sg.az, sg.bx, sg.bz); if (q.d > sg.data.hw) continue;
      const h = sg.data.h0 + (sg.data.h1 - sg.data.h0) * q.t;
      if (h <= y + 0.6) { if (h > best) best = h; } else if (h < low) low = h;
    }
    return best > -Infinity ? best : low;
  }

  // ---------- строители лент ----------
  ribbon(mat, P, s0, s1, l0, l1, yf, o = {}) {
    if (s1 - s0 < 0.5) return;
    const step = o.step || 4, n = Math.max(1, Math.ceil((s1 - s0) / step)), pos = [], uv = [], idx = [];
    for (let k = 0; k <= n; k++) {
      const s = s0 + (s1 - s0) * k / n, p = cAt(P, s), nx = -p.tz, nz = p.tx, y = yf(s);
      for (const [l, u] of [[l0, 0], [l1, 1]]) { pos.push(p.x + nx * l, y, p.z + nz * l); uv.push(o.uS ? l * o.uS : u, s * (o.vS || 1 / 12)); }
      if (k) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    if ((g.attributes.normal.getY(0) > 0) === !!o.down) { const ix = g.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k]; ix[k] = ix[k + 2]; ix[k + 2] = t; } g.computeVertexNormals(); }
    this.push(mat, g);
  }
  wallStrip(mat, P, s0, s1, l, yb, yt, step = 4) {
    if (s1 - s0 < 0.5) return;
    const n = Math.max(1, Math.ceil((s1 - s0) / step)), pos = [], uv = [], idx = [];
    for (let k = 0; k <= n; k++) {
      const s = s0 + (s1 - s0) * k / n, p = cAt(P, s), x = p.x - p.tz * l, z = p.z + p.tx * l;
      pos.push(x, yb(s), z, x, yt(s), z); uv.push(s / 4, 0, s / 4, (yt(s) - yb(s)) / 4);
      if (k) { const a = (k - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    this.push(mat, g);
  }
  obsAlong(P, s0, s1, l, hw, y0f, y1f, step = 8) {
    for (let s = s0; s < s1 - 0.5; s += step) {
      const b = Math.min(s1, s + step), m = (s + b) / 2, p = cAt(P, m);
      this.obstacles.add({ x: p.x - p.tz * l, z: p.z + p.tx * l, h: Math.atan2(-p.tz, p.tx), hl: (b - s) / 2 + 0.3, hw, y0: y0f(m), y1: y1f(m) });
    }
  }
  roadRot(p) { return Math.atan2(-p.tz, p.tx); }

  // ---------- дороги, тротуары, мосты, эстакада, тоннель ----------
  buildRoads() {
    this.deckHash = new SegHash(30); this.roadHash = new SegHash(40);
    for (const e of this.edges) this.roadHash.addPoly(e.P, { e, hw: e.hw + e.sw });
    const bridges = this.edges.filter(e => e.kind === 'bridge').sort((a, b) => (b.span[1] - b.span[0]) - (a.span[1] - a.span[0]));
    bridges.forEach((e, i) => (e.style = i === 0 ? 'cable' : i === 1 ? 'arch' : 'girder'));
    for (const e of this.edges) this.buildEdge(e);
    for (const n of this.nodes) this.buildJunction(n);
  }

  buildEdge(e) {
    const P = e.P, sa = e.a.R, sb = P.len - e.b.R, y = s => e.prof(s), D = district((e.a.x + e.b.x) / 2, (e.a.z + e.b.z) / 2);
    const hwT = e.hw + e.sw, deck = e.kind !== 'ground';
    if (deck) this.deckHash.addPoly(P, { hw: hwT + 0.3 }, 0, P.len), this.deckHash.m.forEach(a => a.forEach(sg => { if (sg.data.h0 === undefined) { sg.data.h0 = y(sg.data.s0); sg.data.h1 = y(sg.data.s1); } }));
    if (e.kind === 'hwy') return this.buildExpress(e, sa, sb);
    // полотно и тротуары с бордюром
    this.ribbon(e.type === 'main' ? M.rMain : M.rStreet, P, sa, sb, -e.hw, e.hw, s => y(s) + 0.05);
    for (const sd of [-1, 1]) {
      this.ribbon(M.walk, P, sa, sb, sd * e.hw, sd * hwT, s => y(s) + 0.17, { uS: 0.25, vS: 0.25 });
      this.wallStrip(M.curb, P, sa, sb, sd * e.hw, s => y(s) + 0.02, s => y(s) + 0.17);
    }
    // фонари и деревья на тротуарах
    if (e.kind !== 'tunnel') {
      for (let s = sa + 10, k = 0; s < sb - 6; s += 30, k++) {
        const sd = k % 2 ? 1 : -1, p = cAt(P, s), l = sd * (hwT - 0.5);
        this.lamps.push({ x: p.x - p.tz * l, z: p.z + p.tx * l, a: Math.atan2(sd * p.tx, sd * p.tz), y: y(s) });
      }
      const treeStep = D.kind === 'down' ? 22 : D.kind === 'ind' ? 40 : 13;
      if (e.kind === 'ground') for (let s = sa + 16; s < sb - 10; s += treeStep) for (const sd of [-1, 1]) {
        if (Math.abs(((s - sa - 10) % 30) - 15) > 13) continue;
        const p = cAt(P, s), l = sd * (hwT - 1.3);
        this.trees.push({ x: p.x - p.tz * l, z: p.z + p.tx * l, s: rr(0.75, 1.05), kind: D.kind === 'sub' ? pick(['chinar', 'thin', 'fruit']) : pick(['chinar', 'thin', 'poplar']) });
      }
    }
    // зебры у перекрёстков
    for (const [n, s] of [[e.a, sa + 2.2], [e.b, sb - 2.2]]) {
      if (n.e.length < 3 || sb - sa < 14) continue;
      const p = cAt(P, s); this.quad(M.zebra, p.x, y(s) + 0.07, p.z, e.hw * 2 - 0.6, 3, Math.atan2(-p.tx, -p.tz), 1, 1);
    }
    if (e.kind === 'bridge') this.buildBridge(e, hwT);
    if (e.kind === 'tunnel') this.buildTunnel(e, hwT);
  }

  buildBridge(e, hwT) {
    const P = e.P, y = s => e.prof(s), [c0, c1] = e.span, a0 = c0 - 40, a1 = c1 + 40, mid = (c0 + c1) / 2;
    this.ribbon(M.bridgeDark, P, a0, a1, -hwT - 0.4, hwT + 0.4, s => y(s) - 1.1, { down: true, uS: 0.2, vS: 0.2 });
    for (const sd of [-1, 1]) {
      this.wallStrip(M.bridgeC, P, a0, a1, sd * (hwT + 0.4), s => y(s) - 1.1, s => y(s) + 0.6);
      this.wallStrip(M.bridgeC, P, a0, a1, sd * (hwT + 0.1), s => y(s) + 0.17, s => y(s) + 0.6);
      for (let s = a0; s < a1; s += 2.5) { const p = cAt(P, s), l = sd * (hwT + 0.25); this.geo(M.steel, new THREE.BoxGeometry(0.08, 0.6, 0.08), p.x - p.tz * l, y(s) + 0.9, p.z + p.tx * l); }
      this.ribbon(M.steel, P, a0, a1, sd * (hwT + 0.18), sd * (hwT + 0.32), s => y(s) + 1.22);
      // перила: машине не упасть в реку; на подходах — стенка до земли
      this.obsAlong(P, a0, a1, sd * (hwT + 0.3), 0.3, s => (s > c0 - 2 && s < c1 + 2 ? y(s) - 0.6 : -3), s => y(s) + 1.3);
      this.wallStrip(M.bridgeC, P, a0, c0, sd * (hwT + 0.4), () => -0.5, s => y(s) - 1.1);
      this.wallStrip(M.bridgeC, P, c1, a1, sd * (hwT + 0.4), () => -0.5, s => y(s) - 1.1);
    }
    // опоры в воде
    for (let s = c0 + 14; s < c1 - 8; s += 24) for (const l of [-hwT * 0.55, hwT * 0.55]) {
      const p = cAt(P, s), x = p.x - p.tz * l, z = p.z + p.tx * l, h = y(s) - 1.1 + 6;
      this.geo(M.bridgeC, new THREE.CylinderGeometry(1.1, 1.3, h, 14), x, -6 + h / 2, z);
    }
    if (e.style === 'cable') {          // вантовый: пилон в форме «А» и ванты
      const p = cAt(P, mid), H = 46, hy = y(mid), r = this.roadRot(p);
      for (const sd of [-1, 1]) { const l = sd * (hwT + 1.2), g = new THREE.BoxGeometry(1.6, H, 2.2); g.translate(0, H / 2, 0); g.rotateX(0); g.rotateZ(0); g.rotateY(r); g.translate(p.x - p.tz * l, hy - 1, p.z + p.tx * l); this.push(M.white, g); }
      const bg = new THREE.BoxGeometry(2, 2, (hwT + 1.2) * 2 + 1.6); bg.rotateY(r); bg.translate(p.x, hy + H - 6, p.z); this.push(M.white, bg);
      for (const sd of [-1, 1]) for (let k = 1; k <= 8; k++) for (const dir of [-1, 1]) {
        const s = mid + dir * k * 7, q = cAt(P, s), l = sd * (hwT + 0.6), top = new THREE.Vector3(p.x - p.tz * sd * (hwT + 1.2), hy + H - 4 - k * 2.6, p.z + p.tx * sd * (hwT + 1.2));
        const bot = new THREE.Vector3(q.x - q.tz * l, y(s) + 0.5, q.z + q.tx * l), len = top.distanceTo(bot);
        const c = new THREE.CylinderGeometry(0.07, 0.07, len, 5); c.translate(0, len / 2, 0);
        c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bot).normalize())); c.translate(bot.x, bot.y, bot.z); this.push(M.cable, c);
      }
      this.obstacles.add({ x: p.x - p.tz * (hwT + 1.2), z: p.z + p.tx * (hwT + 1.2), h: r, hl: 1, hw: 1.3 });
      this.obstacles.add({ x: p.x + p.tz * (hwT + 1.2), z: p.z - p.tx * (hwT + 1.2), h: r, hl: 1, hw: 1.3 });
      this.labels.push({ x: p.x, z: p.z, text: 'Вантовый мост' });
    } else if (e.style === 'arch') {     // две красные арки над пролётом
      const L = c1 - c0 + 10, A = 16;
      for (const sd of [-1, 1]) {
        const pts = [];
        for (let k = 0; k <= 24; k++) { const s = c0 - 5 + L * k / 24, p = cAt(P, s), l = sd * (hwT + 0.7); pts.push(new THREE.Vector3(p.x - p.tz * l, y(s) + 0.4 + A * Math.sin(Math.PI * k / 24), p.z + p.tx * l)); }
        this.push(M.archRed, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.55, 8));
        for (let k = 2; k <= 22; k += 2) { const v = pts[k], s = c0 - 5 + L * k / 24; const h = v.y - y(s) - 0.4; this.geo(M.cable, new THREE.CylinderGeometry(0.05, 0.05, h, 4), v.x, y(s) + 0.4 + h / 2, v.z); }
      }
      const p = cAt(P, mid); this.labels.push({ x: p.x, z: p.z, text: 'Арочный мост' });
    }
  }

  buildTunnel(e, hwT) {
    const P = e.P, wl = hwT + 0.3;
    let t0 = Infinity, t1 = -Infinity;
    for (let s = 0; s < P.len; s += 2) { const p = cAt(P, s); if (rawHeight(p.x, p.z, 999) >= 9.5) { t0 = Math.min(t0, s); t1 = Math.max(t1, s); } }
    if (!isFinite(t0)) return;
    const CEIL = 6.6;
    for (const sd of [-1, 1]) {
      this.wallStrip(M.wallD, P, t0, t1, sd * wl, () => 0, () => CEIL);
      this.ribbon(M.tunnelLight, P, t0, t1, sd * 2.6, sd * 3.0, () => CEIL - 0.05, { down: true });
      this.obsAlong(P, t0, t1, sd * (wl + 0.2), 0.3, () => -3, () => CEIL);
      // подпорные стенки выемки снаружи порталов
      for (const [a, b] of [[Math.max(0, t0 - 90), t0], [t1, Math.min(P.len, t1 + 90)]]) {
        const top = s => { const p = cAt(P, s), l = sd * (wl + 2); return Math.max(0.3, Math.min(10, rawHeight(p.x - p.tz * l, p.z + p.tx * l, 999))); };
        this.wallStrip(M.wallD, P, a, b, sd * wl, () => -0.2, top);
        this.obsAlong(P, a, b, sd * (wl + 0.2), 0.3, () => -3, s => top(s) + 0.5);
      }
    }
    this.ribbon(M.wallD, P, t0, t1, -wl, wl, () => CEIL, { down: true, uS: 0.25, vS: 0.25 });
    for (const t of [t0, t1]) {          // порталы: опоры и перемычка
      const p = cAt(P, t), r = this.roadRot(p);
      for (const sd of [-1, 1]) { const l = sd * (wl + 1.6), g = new THREE.BoxGeometry(2.4, 14, 3.2); g.translate(0, 7, 0); g.rotateY(r); g.translate(p.x - p.tz * l, 0, p.z + p.tx * l); this.push(M.bridgeC, g); }
      const g = new THREE.BoxGeometry(2.4, 14 - CEIL, (wl + 2.8) * 2); g.translate(0, CEIL + (14 - CEIL) / 2, 0); g.rotateY(r); g.translate(p.x, 0, p.z); this.push(M.bridgeC, g);
      const sg = new THREE.BoxGeometry(0.3, 1.6, 9); sg.translate(-1.35 * (t === t0 ? 1 : -1), CEIL + 2.4, 0); sg.rotateY(r); sg.translate(p.x, 0, p.z); this.push(M.green, sg);
    }
    const p = cAt(P, (t0 + t1) / 2); this.labels.push({ x: p.x, z: p.z, text: 'Тоннель' });
  }

  buildExpress(e, sa, sb) {
    const P = e.P, y = s => e.prof(s), W2 = 11, LOW = 5.6;
    for (const sd of [-1, 1]) this.ribbon(M.rHwy, P, sa, sb, sd * 0.5, sd * 10.5, s => y(s) + 0.05);
    for (const sd of [-1, 1]) this.ribbon(M.concrete, P, sa, sb, sd * 10.5, sd * W2, s => y(s) + 0.05);
    this.ribbon(M.concrete, P, sa, sb, -0.5, 0.5, s => y(s) + 0.05);
    this.ribbon(M.bridgeDark, P, sa, sb, -W2 - 0.3, W2 + 0.3, s => y(s) - 1.4, { down: true, uS: 0.2, vS: 0.2 });
    for (const sd of [-1, 1]) {
      this.wallStrip(M.bridgeC, P, sa, sb, sd * (W2 + 0.3), s => y(s) - 1.4, s => y(s) + 1.0);
      this.wallStrip(M.bridgeC, P, sa, sb, sd * (W2 - 0.1), s => y(s), s => y(s) + 1.0);
      this.ribbon(M.bridgeC, P, sa, sb, sd * (W2 - 0.1), sd * (W2 + 0.3), s => y(s) + 1.0);
      this.wallStrip(M.bridgeC, P, sa, sb, sd * 0.35, s => y(s), s => y(s) + 0.85);
    }
    this.ribbon(M.bridgeC, P, sa, sb, -0.35, 0.35, s => y(s) + 0.85);
    // стенки съездов до земли и опоры под высокой частью
    const lowA = [], lowB = [];
    for (let s = sa; s < sb; s += 2) if (y(s) < LOW) (s < P.len / 2 ? lowA : lowB).push(s);
    for (const r of [lowA, lowB]) if (r.length) for (const sd of [-1, 1]) {
      const a = r[0], b = r[r.length - 1];
      this.wallStrip(M.bridgeC, P, a, b, sd * (W2 + 0.3), () => -0.3, s => y(s) - 1.3);
      this.obsAlong(P, a, b, sd * (W2 + 0.2), 0.4, () => -3, s => y(s) + 1.2);
    }
    for (const sd of [-1, 1]) this.obsAlong(P, sa, sb, sd * (W2 + 0.1), 0.35, s => (y(s) < LOW ? -3 : y(s) - 0.5), s => y(s) + 1.3);
    this.obsAlong(P, sa, sb, 0, 0.4, s => y(s) - 0.3, s => y(s) + 1.1);
    for (let s = sa + 20; s < sb - 20; s += 34) {
      if (y(s) < LOW + 0.5) continue;
      let ok = null;
      for (const ds of [0, 6, -6, 12, -12]) { const p = cAt(P, s + ds), q = this.roadHash.dist(p.x, p.z, 40, d => d.e.kind !== 'hwy'); if (q.d > (q.seg ? q.seg.data.hw : 0) + 2.2 && this.riverHash.dist(p.x, p.z, 60).d > RIVER_W / 2 - 4) { ok = s + ds; break; } }
      if (ok === null) continue;
      const p = cAt(P, ok), h = y(ok) - 1.4, r = this.roadRot(p);
      this.geo(M.bridgeC, new THREE.CylinderGeometry(1.25, 1.45, h, 16), p.x, h / 2, p.z);
      const cap = new THREE.BoxGeometry(2.6, 1.6, 16); cap.translate(0, h - 0.8, 0); cap.rotateY(r); cap.translate(p.x, 0, p.z); this.push(M.bridgeC, cap);
      this.obstacles.add({ x: p.x, z: p.z, h: 0, hl: 1.5, hw: 1.5, y0: -3, y1: h });
    }
    for (let s = sa + 30; s < sb - 30; s += 46) { const p = cAt(P, s); this.lamps.push({ x: p.x, z: p.z, a: this.roadRot(p) + Math.PI / 2, y: y(s) + 0.85, double: true }); }
    const p = cAt(P, P.len / 2); this.labels.push({ x: p.x, z: p.z, text: 'Эстакада' });
  }

  buildJunction(n) {
    const list = n.dirs; if (!list.length) return;
    const y = 0.055;
    if (list.length === 1) {               // тупик: разворотный круг
      const e = list[0].e, r = e.hw + 3;
      this.geo(M.jAsph, uvs(new THREE.CircleGeometry(r, 28).rotateX(-Math.PI / 2), r / 6, r / 6), n.x, y, n.z);
      this.geo(M.walk, uvs(new THREE.RingGeometry(r, r + SWK, 28).rotateX(-Math.PI / 2), r / 2, r / 2), n.x, 0.17, n.z);
      return;
    }
    const pts = w => { const out = []; for (const l of list) { const cx = n.x + Math.cos(l.a) * n.R, cz = n.z + Math.sin(l.a) * n.R, px = -Math.sin(l.a), pz = Math.cos(l.a), hw = l.e.hw + w; out.push([cx + px * hw, cz + pz * hw], [cx - px * hw, cz - pz * hw]); } return cHull(out); };
    const inner = pts(0), outer = pts(SWK);
    const shape = h => new THREE.Shape(h.map(([x, z]) => new THREE.Vector2(x, -z)));
    const ag = new THREE.ShapeGeometry(shape(inner)); ag.rotateX(-Math.PI / 2); uvs(ag, 1 / 12, 1 / 12); ag.translate(0, y, 0); this.push(M.jAsph, ag);
    const os = shape(outer); os.holes.push(new THREE.Path(inner.map(([x, z]) => new THREE.Vector2(x, -z)).reverse()));
    const sg = new THREE.ShapeGeometry(os); sg.rotateX(-Math.PI / 2); uvs(sg, 1 / 4, 1 / 4); sg.translate(0, 0.17, 0); this.push(M.walk, sg);
  }


  // ---------- крупные места ----------
  buildPlaces() {
    const rect = (p, w, d) => ({ cx: p.x, cz: p.z, w, d, x0: p.x - w / 2, x1: p.x + w / 2, z0: p.z - d / 2, z1: p.z + d / 2 });
    const relabel = (n, text) => { const l = this.labels.at(-1); if (l) l.text = text; };
    for (const p of PLACES) {
      if (p.id === 'park') {
        this.geo(M.water, new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), p.x, 0.12, p.z, 0, 52, 1, 38);
        this.obstacles.add({ x: p.x, z: p.z, h: 0, hl: 47, hw: 34 });
        this.geo(M.walk, uvs(new THREE.RingGeometry(66, 71, 64).rotateX(-Math.PI / 2), 10, 10), p.x, 0.1, p.z, 0, 1, 1, 0.8);
        for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; this.quad(M.walk, p.x + Math.cos(a) * 96, 0.09, p.z + Math.sin(a) * 76, 5, 50, Math.atan2(-Math.sin(a), Math.cos(a)) + Math.PI / 2, 1, 10); }
        for (let k = 0; k < 140; k++) { const a = rnd() * 7, r = rr(74, 122); this.trees.push({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r * 0.85, s: rr(0.9, 1.4), kind: pick(['chinar', 'chinar', 'willow', 'poplar', 'sakura']) }); }
        this.fountain(p.x, p.z - 52, 4);
        this.labels.push({ x: p.x, z: p.z, text: p.name });
      } else if (p.id === 'stadium') { this.stadium(rect(p, 160, 130)); relabel(0, p.name); this.parkingLot(p.x, p.z + 88, 0, 90, 26); }
      else if (p.id === 'mall') { this.mall(rect(p, 170, 150), 'GALEREYA', '#7a1f2b', p.x, p.z - 20, 120, 70); this.parkingLot(p.x, p.z + 50, 0, 140, 40, true); }
      else if (p.id === 'tower') { this.tvTower({ cx: p.x, cz: p.z }); }
      else if (p.id === 'autodrom') this.cityAutodrom(p);
      else if (p.id === 'arena') this.arena(p);
      else if (p.id === 'station') this.station(p);
      else if (p.id === 'port') this.port(p);
    }
    for (const d of DISTRICTS) this.labels.push({ x: d.x, z: d.z - 30, text: d.name, district: true });
  }

  cityAutodrom(p) {
    const x = p.x, z = p.z;
    this.quad(M.asphalt, x, 0.04, z, 104, 104, 0, 9, 9);
    for (let i = -50; i < 50; i += 4) {
      const m = (i / 4) % 2 ? M.red : M.white;
      this.box(m, x + i + 2, 0, z - 50, 4, 0.9, 0.4, 0, true);
      this.box(m, x + i + 2, 0, z + 50, 4, 0.9, 0.4, 0, true);
      this.box(m, x + 50, 0, z + i + 2, 0.4, 0.9, 4, 0, true);
      if (Math.abs(i + 2) > 8) this.box(m, x - 50, 0, z + i + 2, 0.4, 0.9, 4, 0, true);
    }
    this.sign(x - 50.3, 3.6, z - 14, 'AVTODROM', '#c23a2b', 9, -Math.PI / 2);
    this.labels.push({ x, z, text: p.name });
  }

  arena(p) {
    this.geo(M.shopGlass, new THREE.CylinderGeometry(1, 1, 14, 48), p.x, 7, p.z, 0, 44, 1, 30);
    const roof = new THREE.SphereGeometry(1, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2); roof.scale(47, 9, 33); this.geo(M.steel, roof, p.x, 14, p.z);
    for (let k = 0; k < 20; k++) { const a = k / 20 * Math.PI * 2; this.box(M.white, p.x + Math.cos(a) * 45, 0, p.z + Math.sin(a) * 31, 0.8, 15, 0.8); }
    this.sign(p.x, 17, p.z + 32, 'ARENA', '#1d2a3a', 16);
    this.collide(p.x, p.z, 90, 62);
    this.labels.push({ x: p.x, z: p.z, text: p.name });
  }

  station(p) {
    const x = p.x, z = p.z - 30;
    this.building(x - 32, z, 30, 16, 3, M.office, 0, M.roofDark, 4);
    this.building(x + 32, z, 30, 16, 3, M.office, 0, M.roofDark, 4);
    this.box(M.white, x, 0, z, 34, 18, 18, 0, true);
    this.sign(x, 19.5, z + 9.2, 'VOKZAL', '#1d4f91', 16);
    for (let k = 0; k < 3; k++) {
      const pz = z - 22 - k * 18;
      this.box(M.concrete, x, 0, pz, 150, 0.9, 6, 0, true);
      this.box(M.white, x, 4.2, pz, 140, 0.25, 7);
      for (let q = -5; q <= 5; q++) this.box(M.darkSteel, x + q * 13, 0.9, pz, 0.25, 3.3, 0.25);
      for (const dz of [-7, 7]) for (const r of [-0.75, 0.75]) this.box(M.rail, x, 0.02, pz + dz + r, 170, 0.15, 0.1);
    }
    this.parkingLot(x, z + 34, 0, 80, 22);
    this.labels.push({ x: p.x, z: p.z, text: p.name });
  }

  port(p) {
    this.quad(M.concrete, p.x, 0.05, p.z, 230, 250, 0, 20, 20);
    for (let k = 0; k < 40; k++) {
      const x = p.x - 40 + (k % 8) * 14, z = p.z - 90 + Math.floor(k / 8) * 40, n = 1 + Math.floor(rnd() * 3);
      for (let h = 0; h < n; h++) this.box(pick(M.contCols), x, h * 2.6, z, 6.1, 2.6, 12.2, 0, h === 0);
    }
    for (let k = 0; k < 3; k++) {           // портальные краны у воды
      const x = p.x - 95, z = p.z - 70 + k * 60;
      for (const dz of [-6, 6]) for (const dx of [-5, 5]) this.box(M.crane, x + dx, 0, z + dz, 1, 26, 1, 0, true);
      this.box(M.crane, x - 10, 26, z, 46, 2.4, 14); this.box(M.white, x + 2, 22, z, 6, 4, 6);
    }
    this.building(p.x + 70, p.z + 80, 60, 30, 3, M.corr, 0, M.roof, 4);
    this.labels.push({ x: p.x, z: p.z, text: p.name });
  }

  parkingLot(x, z, rot, w, d, many = false) {
    this.quad(M.asphalt, x, 0.04, z, w, d, rot, w / 12, d / 12);
    const c = Math.cos(rot), s = Math.sin(rot), P = (lx, lz) => [x + c * lx + s * lz, z - s * lx + c * lz];
    const rows = d >= 36 ? [-d / 2 + 3, d / 2 - 3] : [-d / 2 + 3];
    for (const rz of rows) for (let lx = -w / 2 + 3; lx < w / 2 - 3; lx += 3) {
      const [mx, mz] = P(lx, rz); this.quad(M.mark, mx, 0.07, mz, 0.12, 5, rot, 1, 1);
      if (lx + 3 < w / 2 - 3 && rnd() < (many ? 0.35 : 0.2)) { const [cx, cz] = P(lx + 1.5, rz); this.parkedCar(cx, cz, rot + (rz < 0 ? -Math.PI / 2 : Math.PI / 2)); }
    }
  }

  // ---------- застройка вдоль улиц ----------
  lotFree(x, z, w, d, rot, margin = 1.5) {
    const c = Math.cos(rot), s = Math.sin(rot), W2 = w / 2 + margin, D2 = d / 2 + margin;
    const nx = Math.max(2, Math.ceil(W2 * 2 / 6)), nz = Math.max(2, Math.ceil(D2 * 2 / 6));
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
      const lx = -W2 + (2 * W2) * i / nx, lz = -D2 + (2 * D2) * j / nz, px = x + c * lx + s * lz, pz = z - s * lx + c * lz;
      const q = this.roadHash.dist(px, pz, 30); if (q.seg && q.d < q.seg.data.hw + 1) return false;
      if (this.riverHash.dist(px, pz, 60).d < RIVER_W / 2 + 16) return false;
      const g = this.groundAt(px, pz); if (g > 0.8 || g < -0.3) return false;
      if (Math.abs(px) > 1500 || Math.abs(pz) > 1500) return false;
    }
    if (PLACES.some(p => Math.hypot(x - p.x, z - p.z) < p.r + Math.max(w, d) / 2)) return false;
    const me = { x, z, h: rot, hl: w / 2 + margin, hw: d / 2 + margin };
    for (const o of this.lotGrid.near(x, z, Math.max(w, d) + 40)) if (satOBB(me, o.data)) return false;
    return true;
  }
  addLot(x, z, w, d, rot) { const o = { x, z, h: rot, hl: w / 2, hw: d / 2 }; this.lotGrid.add(x, z, x, z, o); this.lots.push(o); }

  fillLots() {
    this.lots = []; this.lotGrid = new SegHash(60);
    // крупные места и автодром — тоже заняты
    let gas = 0;
    const edges = this.edges.filter(e => e.kind === 'ground' || e.kind === 'bridge').sort(() => rnd() - 0.5);
    for (const e of edges) {
      const P = e.P, sa = e.a.R + 6, sb = P.len - e.b.R - 6, hwT = e.hw + e.sw;
      for (const sd of [-1, 1]) {
        let s = sa + rr(0, 6);
        while (s < sb - 8) {
          const p = cAt(P, s), D = district(p.x, p.z), kind = this.lotKind(D, e, gas);
          const { w, d, back } = kind;
          if (s + w > sb) break;
          const pm = cAt(P, s + w / 2), off = hwT + back + d / 2, nx = -pm.tz * sd, nz = pm.tx * sd;
          const x = pm.x + nx * off, z = pm.z + nz * off, rot = this.roadRot(pm);
          if (this.lotFree(x, z, w, d, rot)) {
            this.addLot(x, z, w, d, rot);
            if (kind.type === 'gas') gas++;
            this.buildLot(kind, x, z, w, d, rot, -sd, D, e);
            // второй ряд в плотных районах
            if ((D.kind === 'down' || D.kind === 'mid' || D.kind === 'old') && kind.type !== 'parking' && kind.type !== 'gas') {
              const k2 = this.lotKind(D, null, 99), off2 = off + d / 2 + 10 + k2.d / 2, x2 = pm.x + nx * off2, z2 = pm.z + nz * off2;
              if (k2.w <= w + 10 && this.lotFree(x2, z2, k2.w, k2.d, rot)) { this.addLot(x2, z2, k2.w, k2.d, rot); this.buildLot(k2, x2, z2, k2.w, k2.d, rot, -sd, D, null); }
            }
            s += w + rr(3, 9);
          } else s += 7;
        }
      }
    }
  }

  lotKind(D, e, gas) {
    const main = e && e.type === 'main', r = rnd();
    if (main && gas < 7 && r < 0.035) return { type: 'gas', w: 38, d: 30, back: 2 };
    if (e && r > 0.965) return { type: 'parking', w: rr(30, 50), d: rr(20, 34), back: 1 };
    switch (D.kind) {
      case 'down':
        if (r < 0.5) return { type: 'tower', w: rr(26, 40), d: rr(24, 34), back: 4, fl: Math.floor(rr(14, 38)), mat: pick([M.glass, M.modernA, M.modernB, M.modernC, M.office]) };
        return { type: 'mid', w: rr(30, 52), d: rr(14, 18), back: 3, fl: Math.floor(rr(6, 12)), mat: pick([M.modernA, M.modernC, M.office, M.panel2]), shops: main };
      case 'old':
        if (r < 0.35) return { type: 'mid', w: rr(18, 30), d: rr(12, 15), back: 1.5, fl: Math.floor(rr(2, 5)), mat: pick([M.brick, M.redBrick, M.house]), shops: main && r < 0.2 };
        return { type: 'house', w: rr(11, 15), d: rr(9, 12), back: 5, fl: rnd() < 0.5 ? 2 : 1 };
      case 'sub':
        if (main && r < 0.12) return { type: 'shop', w: 34, d: 22, back: 6 };
        return { type: 'house', w: rr(10, 14), d: rr(9, 11), back: 8, fl: rnd() < 0.4 ? 2 : 1 };
      case 'ind':
        if (r < 0.25) return { type: 'yard', w: rr(40, 60), d: rr(30, 40), back: 4 };
        return { type: 'warehouse', w: rr(40, 70), d: rr(26, 40), back: 6 };
      default:
        if (main && r < 0.14) return { type: 'shop', w: 36, d: 24, back: 5 };
        if (r < 0.62) return { type: 'mid', w: rr(32, 56), d: rr(12, 15), back: 5, fl: Math.floor(rr(4, 10)), mat: pick([M.panel, M.panel2, M.panelPeach, M.panelBlue, M.panelYellow, M.brick]), shops: main };
        return { type: 'house', w: rr(11, 14), d: rr(9, 11), back: 8, fl: 2 };
    }
  }

  buildLot(k, x, z, w, d, rot, face, D, e) {
    const c = Math.cos(rot), s = Math.sin(rot), P = (lx, lz) => [x + c * lx + s * lz, z - s * lx + c * lz];
    switch (k.type) {
      case 'tower': {
        this.quad(M.plaza, x, 0.03, z, w + 8, d + 8, rot, (w + 8) / 8, (d + 8) / 8);
        if (rnd() < 0.5) {             // стилобат с магазинами и башня поменьше
          this.building(x, z, w, d, 2, M.shopGlass, rot, M.roofDark, 4.5);
          const [tx, tz] = P(rr(-w * 0.15, w * 0.15), 0); this.building(tx, tz, w * 0.62, d * 0.7, k.fl, k.mat, rot, M.roofDark, 3.4, {});
          this.box(M.roofDark, tx, 9, tz, w * 0.62 + 0.1, 0.01, d * 0.7 + 0.1, rot);
        } else this.building(x, z, w, d, k.fl, k.mat, rot, M.roofDark, 3.4, { face, shops: w >= d && rnd() < 0.5 });
        break;
      }
      case 'mid':
        this.building(x, z, w, d, k.fl, k.mat, rot, M.roof, 3, { face, shops: !!k.shops });
        if (rnd() < 0.5) { const [tx, tz] = P(rr(-w / 3, w / 3), -face * (d / 2 + 6)); this.trees.push({ x: tx, z: tz, s: rr(0.8, 1.2), kind: 'chinar' }); }
        break;
      case 'shop': {
        this.box(M.kWall, x, 0, z, w, 6, d, rot, true);
        this.box(M.roofDark, x, 6, z, w + 0.4, 0.5, d + 0.4, rot);
        const part = (m, g, lx, ly, lz, ry = 0) => { g.rotateY(ry); g.translate(lx, ly, lz); g.rotateY(rot); g.translate(x, 0, z); this.push(m, g); };
        this.korzinkaFront(part, true, face, w, d, w - 4);
        const [px, pz] = P(0, face * (d / 2 + 9)); this.parkingLot(px, pz, rot, w, 12);
        break;
      }
      case 'house': this.house(x, z, w, d, rot, face, k.fl); break;
      case 'warehouse': {
        this.box(M.corr, x, 0, z, w, 9, d, rot, true);
        this.box(M.roof, x, 9, z, w + 0.4, 0.4, d + 0.4, rot);
        for (let lx = -w / 2 + 6; lx < w / 2 - 4; lx += 9) { const [gx, gz] = P(lx, face * (d / 2 + 0.05)); this.box(M.darkSteel, gx, 0, gz, 4.2, 4.6, 0.12, rot); }
        if (rnd() < 0.3) { const [cx, cz] = P(w * 0.35, 0); this.geo(M.redBrick, new THREE.CylinderGeometry(1.2, 1.8, 26, 12), cx, 13, cz); }
        const [ax, az] = P(0, face * (d / 2 + 6)); this.quad(M.asphalt, ax, 0.035, az, w, 12, rot, w / 12, 1);
        break;
      }
      case 'yard':
        this.quad(M.concrete, x, 0.035, z, w, d, rot, w / 10, d / 10);
        for (let lx = -w / 2 + 5; lx < w / 2 - 5; lx += 7) for (let lz = -d / 2 + 8; lz < d / 2 - 8; lz += 14) if (rnd() < 0.7) {
          const [bx, bz] = P(lx, lz), n = 1 + Math.floor(rnd() * 3); for (let h = 0; h < n; h++) this.box(pick(M.contCols), bx, h * 2.6, bz, 2.45, 2.6, 12.2, rot, h === 0);
        }
        this.fenceRot(x, z, w, d, rot, face);
        break;
      case 'gas': this.gasStation(x, z, w, d, rot, face); break;
      case 'parking': this.parkingLot(x, z, rot, w, d); break;
    }
  }

  fenceRot(x, z, w, d, rot, face) {
    const c = Math.cos(rot), s = Math.sin(rot), P = (lx, lz) => [x + c * lx + s * lz, z - s * lx + c * lz];
    for (const [lx, lz, sx, sz] of [[0, -face * d / 2, w, 0.1], [-w / 2, 0, 0.1, d], [w / 2, 0, 0.1, d], [-w * 0.3, face * d / 2, w * 0.4, 0.1], [w * 0.3, face * d / 2, w * 0.4, 0.1]]) {
      const [fx, fz] = P(lx, lz); this.box(M.darkSteel, fx, 0, fz, sx, 1.8, sz, rot, true);
    }
  }

  house(x, z, w, d, rot, face, fl) {
    const c = Math.cos(rot), s = Math.sin(rot), P = (lx, lz) => [x + c * lx + s * lz, z - s * lx + c * lz];
    const part = (m, g, lx, ly, lz) => { g.translate(lx, ly, lz); g.rotateY(rot); g.translate(x, 0, z); this.push(m, g); };
    const H = fl * 3, wall = pick(M.wallsH), roofM = pick([M.hRoofRed, M.hRoofRed, M.hRoofGrey, M.hRoofBrown]);
    const hw = w * 0.62, hd = d * 0.7, hz = -face * d * 0.1;
    part(wall, new THREE.BoxGeometry(hw, H, hd), 0, H / 2, hz);
    part(M.concrete, new THREE.BoxGeometry(hw + 0.3, 0.5, hd + 0.3), 0, 0.25, hz);
    const tri = new THREE.Shape(); tri.moveTo(-hd / 2 - 0.5, 0); tri.lineTo(0, 2.6); tri.lineTo(hd / 2 + 0.5, 0); tri.closePath();
    const roof = new THREE.ExtrudeGeometry(tri, { depth: hw + 0.8, bevelEnabled: false }); roof.translate(0, 0, -(hw + 0.8) / 2); roof.rotateY(Math.PI / 2);
    part(roofM, roof, 0, H, hz);
    part(M.kFrame, new THREE.BoxGeometry(1.1, 2.1, 0.1), -hw * 0.2, 1.05, hz + face * (hd / 2 + 0.03));
    for (let f = 0; f < fl; f++) for (const lx of [-hw * 0.32, hw * 0.12, hw * 0.34]) if (f || lx > 0) part(M.shopGlass, new THREE.BoxGeometry(1.3, 1.3, 0.08), lx, f * 3 + 1.7, hz + face * (hd / 2 + 0.03));
    part(M.redBrick, new THREE.BoxGeometry(0.7, 2, 0.7), hw * 0.25, H + 1.8, hz);
    this.collide(...P(0, hz), hw + 0.3, hd + 0.3, rot);
    // двор: забор с воротами, дорожка, дерево и иногда машина
    const fw = w, fd = d;
    for (const [lx, lz, sx, sz] of [[0, -face * fd / 2, fw, 0.08], [-fw / 2, 0, 0.08, fd], [fw / 2, 0, 0.08, fd], [-fw * 0.32, face * fd / 2, fw * 0.36, 0.08], [fw * 0.37, face * fd / 2, fw * 0.26, 0.08]]) {
      const [fx, fz] = P(lx, lz); this.box(M.white, fx, 0, fz, sx, 1.1, sz, rot, false);
    }
    const [dx, dz] = P(fw * 0.1, face * (fd / 2 - 1.5)); this.quad(M.lane, dx, 0.05, dz, 3.4, 3, rot, 1, 1);
    if (rnd() < 0.12) { const [cx, cz] = P(fw * 0.1, face * (fd / 2 + 3.2)); this.parkedCar(cx, cz, rot - Math.PI / 2); }
    if (rnd() < 0.8) { const [tx, tz] = P(-fw * 0.38, -face * fd * 0.3); this.trees.push({ x: tx, z: tz, s: rr(0.6, 0.9), kind: pick(['fruit', 'fruit', 'chinar', 'pine']), noCollide: true }); }
  }

  gasStation(x, z, w, d, rot, face) {
    const c = Math.cos(rot), s = Math.sin(rot), P = (lx, lz) => [x + c * lx + s * lz, z - s * lx + c * lz];
    this.quad(M.asphalt, x, 0.04, z, w, d, rot, w / 12, d / 12);
    const [cx, cz] = P(0, face * 3);
    this.box(M.white, cx, 5.6, cz, 26, 1.0, 14, rot);
    this.box(M.green, cx, 5.4, cz, 26.2, 0.3, 14.2, rot);
    for (const lx of [-9, 9]) for (const lz of [-4, 4]) { const [px, pz] = P(lx, face * 3 + lz); this.box(M.white, px, 0, pz, 0.7, 5.6, 0.7, rot, true); }
    for (const lx of [-6, 0, 6]) { const [px, pz] = P(lx, face * 3); this.box(M.concrete, px, 0, pz, 2.4, 0.25, 1.2, rot, true); this.box(M.green, px, 0.25, pz, 1.1, 1.8, 0.7, rot); }
    const [bx, bz] = P(0, -face * (d / 2 - 6)); this.building(bx, bz, 18, 9, 1, M.kWall, rot, M.green, 3.4);
    const [sx, sz] = P(w / 2 - 2, face * (d / 2 - 2)); this.box(M.darkSteel, sx, 0, sz, 0.4, 7, 0.4, rot); this.box(M.green, sx, 7, sz, 3, 3, 0.5, rot);
    this.labels.push({ x, z, text: 'АЗС', small: true });
  }

  // деревья в пустых местах, сосны на холме
  scatter() {
    for (let k = 0; k < 6000; k++) {
      const x = rr(-1500, 1500), z = rr(-1500, 1500), g = this.groundAt(x, z);
      if (g < -0.2) continue;
      const q = this.roadHash.dist(x, z, 30); if (q.seg && q.d < q.seg.data.hw + 2.5) continue;
      if (PLACES.some(p => Math.hypot(x - p.x, z - p.z) < p.r)) continue;
      let blocked = false; for (const o of this.lotGrid.near(x, z, 60)) if (satOBB({ x, z, h: 0, hl: 2, hw: 2 }, o.data)) { blocked = true; break; }
      if (blocked) continue;
      const D = district(x, z), dense = D.kind === 'sub' || D.kind === 'old' ? 0.75 : D.kind === 'down' ? 0.35 : 0.55;
      if (g > 1 || Math.abs(x) > 1450 || Math.abs(z) > 1450) { if (rnd() < 0.8) this.trees.push({ x, z, y: g - 0.2, s: rr(0.8, 1.4), kind: 'pine', noCollide: g > 30 }); continue; }
      if (rnd() < dense) this.trees.push({ x, z, s: rr(0.8, 1.4), kind: pick(['chinar', 'chinar', 'poplar', 'willow', 'fruit']) });
    }
  }

  // светофоры на крупных перекрёстках
  signals() {
    this.sigNodes = [];
    for (const n of this.nodes) {
      if (n.dirs.length < 3 || !n.e.some(e => e.type === 'main') || n.exp) continue;
      const a0 = n.dirs[0].a; n.grp = new Map();
      for (const l of n.dirs) {
        const grp = Math.abs(Math.sin(l.a - a0)) < 0.7 ? 'NS' : 'EW'; n.grp.set(l.e, grp);
        if (l.e.kind !== 'ground' && l.e.kind !== 'bridge') continue;
        const dx = -Math.cos(l.a), dz = -Math.sin(l.a);
        this.signal(n.x, n.z, dx, dz, l.e.hw, n.R - 2.5, { grp, stop: 7, arrow: 15 });
      }
      this.sigNodes.push(n);
    }
  }
  // светофор впереди по ходу: для подсказки и штрафа
  signalAhead(x, z, fx, fz) {
    let best = null;
    for (const n of this.sigNodes) {
      const vx = n.x - x, vz = n.z - z, d = Math.hypot(vx, vz); if (d > 90 || d < 1) continue;
      if ((vx * fx + vz * fz) / d < 0.8) continue;
      let el = null, bd = -1;
      for (const l of n.dirs) { const k = (-vx * Math.cos(l.a) - vz * Math.sin(l.a)) / d; if (k > bd) { bd = k; el = l; } }
      if (bd < 0.9) continue;
      if (!best || d < best.d) best = { n, d, grp: n.grp.get(el.e), inside: d < n.R };
    }
    return best;
  }

  spawnPoint() {
    const c = DISTRICTS[0];
    const e = this.edges.filter(e => e.kind === 'ground' && e.type === 'main' && e.P.len > 90)
      .reduce((b, e) => { const p = cAt(e.P, e.P.len / 2); return Math.hypot(p.x - c.x, p.z - c.z) < (b ? b.d : Infinity) ? { e, d: Math.hypot(p.x - c.x, p.z - c.z) } : b; }, null).e;
    const p = cAt(e.P, e.P.len / 2), l = e.hw * 0.5;
    this.spawn = { x: p.x - p.tz * l, z: p.z + p.tx * l, h: this.roadRot(p) };
  }

  // стоящие машины: не больше ~240 на весь город, без тяжёлой Damas
  parkedCar(x, z, h) {
    this.parkedN = (this.parkedN || 0) + 1;
    if (this.parkedN > 240) return;
    const pool = CARS.filter(c => c.lod).flatMap(c => Array(c.parked || 1).fill(c)), spec = pick(pool);
    const col = rnd() < 0.7 ? '#f4f4f2' : pick(['#b9bdc3', '#50555c', '#16171a', '#7a1f2b', '#1f3f7a']);
    this.obstacles.add(addCarToBuckets(spec, col, x, z, h, this.carBuckets));
  }

  // деревья пачками по квадратам 400 м: невидимые пачки не рисуются
  instancedTrees() {
    const all = this.trees, buckets = new Map();
    for (const t of all) { const k = Math.floor(t.x / 400) + ':' + Math.floor(t.z / 400); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(t); }
    for (const b of buckets.values()) { this.trees = b; super.instancedTrees(); }
    this.trees = all;
  }

  // ---------- карта ----------
  drawMap(g, X, Z, k) {
    g.fillStyle = '#2d3a2c'; g.beginPath(); g.arc(X(HILL.x), Z(HILL.z), HILL.R * k, 0, 7); g.fill();
    g.lineCap = 'round'; g.lineJoin = 'round';
    const line = (P, w, col) => { g.strokeStyle = col; g.lineWidth = Math.max(1, w * k); g.beginPath(); P.forEach((p, i) => (i ? g.lineTo(X(p.x), Z(p.z)) : g.moveTo(X(p.x), Z(p.z)))); g.stroke(); };
    line(RIVER, RIVER_W, '#245563');
    for (const p of PLACES) { g.fillStyle = p.id === 'park' ? '#2f4a33' : '#303338'; g.beginPath(); g.arc(X(p.x), Z(p.z), p.r * k, 0, 7); g.fill(); }
    g.fillStyle = '#34373d';
    for (const o of this.lots) { g.save(); g.translate(X(o.x), Z(o.z)); g.rotate(-o.h); g.fillRect(-o.hl * k, -o.hw * k, o.hl * 2 * k, o.hw * 2 * k); g.restore(); }
    for (const e of this.edges) if (e.kind !== 'hwy') line(e.P, (e.hw + 1) * 2, e.kind === 'tunnel' ? '#5d5a52' : e.type === 'main' ? '#62656c' : '#4c4f55');
    for (const n of this.nodes) if (n.dirs.length > 2) { g.fillStyle = '#62656c'; g.beginPath(); g.arc(X(n.x), Z(n.z), Math.max(1, (n.R) * k), 0, 7); g.fill(); }
    line(this.express.P, 24, '#a38a4a');
  }

}
