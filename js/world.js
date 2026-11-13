import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CARS, addCarToBuckets } from './cars.js';
import { Obstacles } from './physics.js';

// ===================== Схема Ташкента (условная, сжатая) =====================
// x — восток, z — юг (север = -z). Центр (0,0) — сквер Амира Темура.
export const HALF = 640;
export const RING_IN = 56, RING_OUT = 74;              // кольцо вокруг сквера
export const W = { ave: 26, st: 14 };                   // проспект: 11 + разделитель 4 + 11
export const SW = 5;                                    // тротуар
export const CANAL_X = -200, CANAL_W = 16;              // канал Анхор

export const VLINES = [
  { x: -580, t: 'ave' }, { x: -420, t: 'st' }, { x: -290, t: 'st' }, { x: -110, t: 'st' },
  { x: 0, t: 'ave' }, { x: 130, t: 'st' }, { x: 270, t: 'st' }, { x: 430, t: 'st' }, { x: 580, t: 'ave' },
];
export const HLINES = [
  { z: -580, t: 'ave' }, { z: -440, t: 'st' }, { z: -290, t: 'st' }, { z: -150, t: 'st' },
  { z: 0, t: 'ave' }, { z: 150, t: 'st' }, { z: 290, t: 'st' }, { z: 440, t: 'st' }, { z: 580, t: 'ave' },
];
const XS = [-580, -420, -290, CANAL_X, -110, 0, 130, 270, 430, 580];
const ZS = HLINES.map(l => l.z);

export const LEVEL_CENTER = { x: 350, z: 365 };
// старт: проспект Амира Темура, едем на юг к скверу
export const SPAWN = { x: -7.5, z: -200, h: -Math.PI / 2 };

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = a => a[Math.floor(rnd() * a.length)];
const rr = (a, b) => a + rnd() * (b - a);

// ===================== Текстуры =====================
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const uvs = (g, u, v) => { const a = g.attributes.uv; for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * u, a.getY(i) * v); return g; };
function speckle(g, w, h, base, n = 5000, a = 0.07) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) { const v = Math.random() * 255 | 0; g.fillStyle = `rgba(${v},${v},${v},${a})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
}

const T = {};
function makeTextures() {
  T.ave = canvasTex(256, 256, (g, w, h) => {            // одна сторона проспекта: 3 полосы
    speckle(g, w, h, '#3b3d41', 7000);
    g.fillStyle = '#ecece6';
    g.fillRect(6, 0, 5, h); g.fillRect(w - 11, 0, 5, h);
    for (const x of [w / 3, (2 * w) / 3]) g.fillRect(x - 2, 0, 4, h * 0.45);
  });
  T.st = canvasTex(256, 256, (g, w, h) => {             // улица 2+2, двойная сплошная
    speckle(g, w, h, '#3d3f43', 7000);
    g.fillStyle = '#ecece6';
    g.fillRect(5, 0, 4, h); g.fillRect(w - 9, 0, 4, h);
    g.fillRect(w / 2 - 6, 0, 3, h); g.fillRect(w / 2 + 3, 0, 3, h);
    for (const x of [w / 4, (3 * w) / 4]) g.fillRect(x - 1.5, 0, 3, h * 0.4);
  });
  T.asphalt = canvasTex(256, 256, (g, w, h) => speckle(g, w, h, '#3c3e42', 7000));
  T.lane = canvasTex(128, 128, (g, w, h) => speckle(g, w, h, '#57544e', 2500));
  T.zebra = canvasTex(256, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#f1f1ec'; for (let x = 6; x < w; x += 24) g.fillRect(x, 0, 13, h); }, false);
  T.sidewalk = canvasTex(128, 128, (g, w, h) => {
    speckle(g, w, h, '#bab4a8', 1500, 0.05);
    g.strokeStyle = 'rgba(80,72,60,0.25)'; g.lineWidth = 2;
    for (let i = 0; i <= w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
  });
  T.plaza = canvasTex(256, 256, (g, w, h) => {
    speckle(g, w, h, '#d8d2c4', 2000, 0.05);
    g.strokeStyle = 'rgba(120,105,85,0.25)'; g.lineWidth = 2;
    for (let i = 0; i <= w; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
    g.strokeStyle = 'rgba(160,60,40,0.16)'; g.lineWidth = 6; g.strokeRect(32, 32, 192, 192);
  });
  T.grass = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#6a8f45'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `hsl(${80 + Math.random() * 30},${35 + Math.random() * 20}%,${26 + Math.random() * 18}%)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 3); }
  });
  T.dirt = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#b9a47f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) { g.fillStyle = `hsla(${32 + Math.random() * 14},28%,${46 + Math.random() * 22}%,0.5)`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
  });
  T.water = canvasTex(256, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#3e7f8f'); gr.addColorStop(1, '#2f6b7c');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 2;
    for (let i = 0; i < 40; i++) { const y = Math.random() * h, x = Math.random() * w; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 30, y); g.stroke(); }
  });
  // фасады: тайл = 3 м × 1 этаж
  const facade = draw => canvasTex(128, 128, draw);
  T.panel = facade((g, w, h) => {      // панелька с «панджарой» на лоджиях
    speckle(g, w, h, '#e7e1d3', 400, 0.05);
    g.fillStyle = '#2f3c48'; g.fillRect(22, 26, 84, 62);
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(22, 26, 30, 62);
    g.fillStyle = '#d9d1bf'; g.fillRect(0, 92, w, 10);
    g.strokeStyle = '#efe9db'; g.lineWidth = 4;
    for (let x = 22; x < 106; x += 14) { g.beginPath(); g.moveTo(x, 92); g.lineTo(x + 7, 128); g.lineTo(x + 14, 92); g.stroke(); }
  });
  T.panel2 = facade((g, w, h) => {
    speckle(g, w, h, '#efece6', 400, 0.05);
    g.fillStyle = '#34414d'; g.fillRect(18, 20, 92, 70);
    g.strokeStyle = '#f6f3ec'; g.lineWidth = 5;
    for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(18 + i * 18 + 9, 90, 9, Math.PI, 0); g.stroke(); }
    g.fillStyle = '#dcd6ca'; g.fillRect(0, 100, w, 8);
  });
  T.brick = facade((g, w, h) => {
    g.fillStyle = '#d8b981'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(150,110,60,0.35)'; g.lineWidth = 1;
    for (let y = 0; y < h; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = '#3b4652'; g.fillRect(36, 30, 56, 58);
    g.fillStyle = '#efe6d2'; g.fillRect(32, 86, 64, 6);
  });
  T.glass = facade((g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#6f93ad'); gr.addColorStop(1, '#2d4c63');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0, 0, w, 6);
    g.fillStyle = '#9fb3c1'; g.fillRect(0, 118, w, 10); g.fillRect(62, 0, 4, h);
  });
  T.office = facade((g, w, h) => {
    speckle(g, w, h, '#d9d4ca', 300, 0.05);
    g.fillStyle = '#41505d'; g.fillRect(10, 18, 108, 76);
    g.fillStyle = '#e9e5dc'; for (let x = 10; x < 118; x += 27) g.fillRect(x, 18, 6, 76);
  });
  T.hotel = facade((g, w, h) => {      // отель «Узбекистан»: белая решётка стрельчатых ячеек
    g.fillStyle = '#c9cdd0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#56636f'; g.fillRect(12, 24, 40, 96); g.fillRect(76, 24, 40, 96);
    g.strokeStyle = '#f5f2ea'; g.lineWidth = 12;
    for (const x of [0, 64]) { g.beginPath(); g.moveTo(x + 4, h); g.lineTo(x + 4, 50); g.quadraticCurveTo(x + 4, 8, x + 32, 4); g.quadraticCurveTo(x + 60, 8, x + 60, 50); g.lineTo(x + 60, h); g.stroke(); }
    g.fillStyle = '#f3f0e8'; g.fillRect(0, 120, w, 8);
  });
  T.house = facade((g, w, h) => {
    g.fillStyle = '#dcc49a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 600; i++) { g.fillStyle = 'rgba(120,90,50,0.08)'; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    g.fillStyle = '#3b4a3a'; g.fillRect(40, 40, 48, 52);
    g.fillStyle = '#5b8a4a'; g.fillRect(36, 36, 56, 4);
  });
  T.tiles = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#1b6fa8'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) for (let y = 0; y < h; y += 16) {
      g.fillStyle = (x + y) % 32 ? '#2aa3c9' : '#eaf5f7';
      g.beginPath(); g.moveTo(x + 8, y + 1); g.lineTo(x + 15, y + 8); g.lineTo(x + 8, y + 15); g.lineTo(x + 1, y + 8); g.fill();
    }
  });
  T.ribs = canvasTex(256, 64, (g, w, h) => {
    for (let x = 0; x < w; x += 16) { const gr = g.createLinearGradient(x, 0, x + 16, 0); gr.addColorStop(0, '#1d5fa6'); gr.addColorStop(0.5, '#3d8fd0'); gr.addColorStop(1, '#1d5fa6'); g.fillStyle = gr; g.fillRect(x, 0, 16, h); }
  });
  T.mbrick = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#cfa56a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ad8550'; g.lineWidth = 2;
    for (let y = 0; y < h; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); for (let x = (y / 12) % 2 ? 0 : 12; x < w; x += 24) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 12); g.stroke(); } }
  });
}

const M = {};
function makeMaterials() {
  const std = o => new THREE.MeshStandardMaterial({ roughness: 0.9, ...o });
  Object.assign(M, {
    ave: std({ map: T.ave }), st: std({ map: T.st }), asphalt: std({ map: T.asphalt }),
    zebra: std({ map: T.zebra, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    sidewalk: std({ map: T.sidewalk }), plaza: std({ map: T.plaza }), grass: std({ map: T.grass, roughness: 1 }),
    dirt: std({ map: T.dirt, roughness: 1 }), lane: std({ map: T.lane }),
    water: std({ map: T.water, roughness: 0.15, metalness: 0.2 }),
    curb: std({ color: 0xd9d6cc }), concrete: std({ color: 0xc9c4b8 }), white: std({ color: 0xf2efe8, roughness: 0.6 }),
    roof: std({ color: 0x77777a }), roofDark: std({ color: 0x55575c }), slate: std({ color: 0x8e9398 }),
    panel: std({ map: T.panel }), panel2: std({ map: T.panel2 }), brick: std({ map: T.brick }), glass: std({ map: T.glass, roughness: 0.25, metalness: 0.4 }),
    office: std({ map: T.office }), hotel: std({ map: T.hotel, roughness: 0.6 }), house: std({ map: T.house }),
    tiles: std({ map: T.tiles, roughness: 0.35 }), ribs: std({ map: T.ribs, roughness: 0.3 }), mbrick: std({ map: T.mbrick }),
    bronze: std({ color: 0x6b4a2a, metalness: 0.8, roughness: 0.45 }), gold: std({ color: 0xd6a83a, metalness: 1, roughness: 0.3 }),
    steel: std({ color: 0x9aa1a9, metalness: 0.7, roughness: 0.4 }), darkSteel: std({ color: 0x3c4148, metalness: 0.6, roughness: 0.5 }),
    wall: std({ color: 0xcfb58a }), gate: std({ color: 0x2e6b4d, metalness: 0.4 }), gateBlue: std({ color: 0x2a5596, metalness: 0.4 }),
    wood: std({ color: 0x7d5532 }), red: std({ color: 0xc23a2b }), green: std({ color: 0x2e8a4e }),
    lightOn: std({ color: 0xfff3cf, emissive: 0xffe2a0, emissiveIntensity: 0.4 }),
    tlRed: std({ color: 0xff3b2f, emissive: 0xff2010, emissiveIntensity: 1.2 }), tlGreen: std({ color: 0x2bd46a, emissive: 0x20c060, emissiveIntensity: 1.2 }),
    tlBody: std({ color: 0x1e2226 }), seats: std({ color: 0xe8e4dc }), field: std({ map: T.grass }),
  });
}
const FLAT = () => [M.ave, M.st, M.asphalt, M.sidewalk, M.grass, M.dirt, M.plaza, M.lane, M.water, M.zebra, M.field];

export class World {
  constructor(scene) {
    this.scene = scene;
    this.obstacles = new Obstacles();
    this.root = new THREE.Group(); scene.add(this.root);
    this.batches = new Map(); this.carBuckets = new Map();
    this.trees = []; this.lamps = []; this.labels = [];
    makeTextures(); makeMaterials();
    this.ground(); this.roads(); this.ringAndSquare(); this.canal(); this.cells(); this.mountains();
    this.finish();
  }

  // ---------- примитивы, которые склеиваются в общие пачки по материалу ----------
  push(mat, geo) { if (!this.batches.has(mat)) this.batches.set(mat, []); this.batches.get(mat).push(geo); }
  quad(mat, x, y, z, w, d, rot = 0, uw = 1, ud = 1) {
    const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uw, uv.getY(i) * ud);
    g.rotateY(rot); g.translate(x, y, z); this.push(mat, g);
  }
  box(mat, x, y, z, sx, sy, sz, rot = 0, collide = false) {
    const g = new THREE.BoxGeometry(sx, sy, sz); g.rotateY(rot); g.translate(x, y + sy / 2, z); this.push(mat, g);
    if (collide) this.collide(x, z, sx, sz, rot);
  }
  geo(mat, g, x, y, z, rot = 0, sx = 1, sy = 1, sz = 1) { g.scale(sx, sy, sz); g.rotateY(rot); g.translate(x, y, z); this.push(mat, g); }
  collide(x, z, sx, sz, rot = 0) { this.obstacles.add({ x, z, h: rot, hl: sx / 2, hw: sz / 2 }); }

  // Здание: стены с фасадом (тайл 3 м × этаж) и крыша
  building(x, z, w, d, floors, mat, rot = 0, roof = M.roof, floorH = 3) {
    const h = floors * floorH;
    for (const [ox, oz, len, r] of [[0, d / 2, w, 0], [0, -d / 2, w, Math.PI], [w / 2, 0, d, Math.PI / 2], [-w / 2, 0, d, -Math.PI / 2]]) {
      const g = new THREE.PlaneGeometry(len, h);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(len / 3)), uv.getY(i) * floors);
      g.rotateY(r); g.translate(ox, h / 2, oz); g.rotateY(rot); g.translate(x, 0, z); this.push(mat, g);
    }
    this.box(roof, x, h, z, w + 0.5, 0.7, d + 0.5, rot);
    if (w * d > 300) this.box(roof, x, h + 0.7, z, 5, 2.4, 4, rot);
    this.collide(x, z, w, d, rot);
  }

  ground() {
    const far = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xa8956f, roughness: 1 }));
    far.position.y = -3; far.receiveShadow = true; this.root.add(far);
    const R = 2400;
    for (const [x, z, w, d] of [[0, -HALF - R / 2, 2 * HALF + 2 * R, R], [0, HALF + R / 2, 2 * HALF + 2 * R, R], [-HALF - R / 2, 0, R, 2 * HALF], [HALF + R / 2, 0, R, 2 * HALF]])
      this.quad(M.dirt, x, 0, z, w, d, 0, w / 40, d / 40);
    const e = HALF - 580 - W.ave / 2 - SW;
    for (const s of [-1, 1]) {
      this.quad(M.dirt, 0, 0, s * (HALF - e / 2), 2 * HALF, e, 0, 2 * HALF / 40, e / 40);
      this.quad(M.dirt, s * (HALF - e / 2), 0, 0, e, 2 * HALF - 2 * e, 0, e / 40, (2 * HALF - 2 * e) / 40);
    }
  }

  // ---------- дороги ----------
  roads() {
    const cw = t => (t === 'ring' ? 0 : W[t] / 2 + SW);
    const run = (lines, crosses, getPos, mk) => {
      for (const L of lines) {
        const p = getPos(L);
        const nodes = crosses.map(c => ({ v: c.pos, t: c.t }));
        if (p === 0) nodes.push({ v: -RING_OUT - 2, t: 'ring' }, { v: RING_OUT + 2, t: 'ring' });
        nodes.sort((a, b) => a.v - b.v);
        for (let i = 0; i < nodes.length - 1; i++) {
          const a = nodes[i], b = nodes[i + 1];
          if (p === 0 && (a.v === 0 || b.v === 0 || (a.t === 'ring' && b.t === 'ring'))) continue;
          const v0 = a.v + cw(a.t), v1 = b.v - cw(b.t);
          mk(L, (v0 + v1) / 2, v1 - v0, a.t !== 'ring', b.t !== 'ring');
        }
      }
    };
    run(VLINES, HLINES.map(h => ({ pos: h.z, t: h.t })), L => L.x, (L, c, len, za, zb) => this.segment(L.x, c, len, L.t, 'v', za, zb));
    run(HLINES, VLINES.map(v => ({ pos: v.x, t: v.t })), L => L.z, (L, c, len, za, zb) => this.segment(c, L.z, len, L.t, 'h', za, zb));
    for (const V of VLINES) for (const H of HLINES) {
      if (V.x === 0 && H.z === 0) continue;
      const wx = W[V.t], wz = W[H.t];
      this.quad(M.asphalt, V.x, 0.06, H.z, wx + 2 * SW, wz + 2 * SW, 0, (wx + 2 * SW) / 12, (wz + 2 * SW) / 12);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.quad(M.sidewalk, V.x + sx * (wx / 2 + SW / 2), 0.1, H.z + sz * (wz / 2 + SW / 2), SW, SW, 0, 1.5, 1.5);
      if (V.t === 'ave' || H.t === 'ave') for (const [sx, sz] of [[1, 1], [-1, -1]]) this.trafficLight(V.x + sx * (wx / 2 + 1.5), H.z + sz * (wz / 2 + 1.5), sx > 0 ? 0 : Math.PI);
    }
  }

  // Отрезок дороги: проезжая часть, тротуары, чинары, фонари, зебры
  segment(cx, cz, len, t, dir, zebraA = true, zebraB = true) {
    if (len <= 1) return;
    const rot = dir === 'v' ? 0 : Math.PI / 2;
    const w = W[t];
    const at = (u, v) => (dir === 'v' ? [cx + u, cz + v] : [cx + v, cz - u]);   // u — поперёк, v — вдоль
    if (t === 'ave') {
      for (const s of [-1, 1]) { const [x, z] = at(s * 7.5, 0); this.quad(M.ave, x, 0.05, z, 11, len, rot, 1, len / 11); }
      const [mx, mz] = at(0, 0);
      this.box(M.curb, mx, 0, mz, 4, 0.22, len, rot);
      this.quad(M.grass, mx, 0.23, mz, 3.4, len, rot, 1, len / 6);
      this.obstacles.add({ x: mx, z: mz, h: dir === 'v' ? Math.PI / 2 : 0, hl: len / 2, hw: 2 });
      for (let v = -len / 2 + 15; v < len / 2 - 10; v += 30) { const [lx, lz] = at(0, v); this.lamps.push({ x: lx, z: lz, double: true, rot }); }
      for (let v = -len / 2 + 8; v < len / 2 - 5; v += 15) { const [tx, tz] = at(0, v + 7); this.trees.push({ x: tx, z: tz, s: 0.75, kind: 'thin' }); }
    } else {
      const [x, z] = at(0, 0); this.quad(M.st, x, 0.05, z, w, len, rot, 1, len / 14);
    }
    for (const s of [-1, 1]) {
      const [x, z] = at(s * (w / 2 + SW / 2), 0);
      this.quad(M.sidewalk, x, 0.1, z, SW, len, rot, 1.5, len / 3.5);
      const [bx, bz] = at(s * (w / 2 + 0.15), 0); this.box(M.curb, bx, 0, bz, 0.3, 0.14, len, rot);
      for (let v = -len / 2 + 6; v < len / 2 - 4; v += 11) {
        const [tx, tz] = at(s * (w / 2 + SW - 1.4), v + rr(-1, 1));
        this.trees.push({ x: tx, z: tz, s: rr(0.85, 1.25), kind: 'chinar' });
      }
      if (t === 'st') for (let v = -len / 2 + 18; v < len / 2 - 6; v += 36) { const [lx, lz] = at(s * (w / 2 + 0.8), v); this.lamps.push({ x: lx, z: lz, side: s, rot: dir === 'v' ? 0 : -Math.PI / 2 }); }
    }
    for (const [ok, sgn] of [[zebraA, -1], [zebraB, 1]]) {
      if (!ok) continue;
      const [x, z] = at(0, sgn * (len / 2 - 3));
      this.quad(M.zebra, x, 0.075, z, w - 1, 4, rot, 1, 1);
    }
  }

  trafficLight(x, z, rot) {
    this.box(M.tlBody, x, 0, z, 0.18, 4.2, 0.18, 0, true);
    this.box(M.tlBody, x, 3.2, z, 0.5, 1.3, 0.4, rot);
    this.geo(M.tlRed, new THREE.SphereGeometry(0.14, 10, 8), x + Math.cos(rot) * 0.22, 4.2, z - Math.sin(rot) * 0.22);
    this.geo(M.tlGreen, new THREE.SphereGeometry(0.14, 10, 8), x + Math.cos(rot) * 0.22, 3.45, z - Math.sin(rot) * 0.22);
  }

  // ---------- сквер Амира Темура и кольцо ----------
  ringAndSquare() {
    const ringG = new THREE.RingGeometry(RING_IN, RING_OUT, 96, 1).rotateX(-Math.PI / 2);
    const uv = ringG.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 12, uv.getY(i) * 12);
    this.geo(M.asphalt, ringG, 0, 0.05, 0);
    for (const r of [RING_IN + 0.6, RING_OUT - 0.6]) this.geo(M.white, new THREE.RingGeometry(r - 0.12, r + 0.12, 128).rotateX(-Math.PI / 2), 0, 0.07, 0);
    for (let a = 0; a < 96; a += 2) {
      const ang = (a / 96) * Math.PI * 2, r = (RING_IN + RING_OUT) / 2;
      this.quad(M.white, Math.cos(ang) * r, 0.07, Math.sin(ang) * r, 0.25, 2.2, -ang, 1, 1);
    }
    this.geo(M.sidewalk, uvs(new THREE.RingGeometry(RING_OUT, RING_OUT + SW, 96).rotateX(-Math.PI / 2), 40, 40), 0, 0.1, 0);
    this.geo(M.grass, uvs(new THREE.CircleGeometry(RING_IN, 96).rotateX(-Math.PI / 2), 10, 10), 0, 0.12, 0);
    this.geo(M.curb, new THREE.TorusGeometry(RING_IN, 0.25, 6, 96).rotateX(Math.PI / 2), 0, 0.15, 0);
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      this.quad(M.plaza, Math.cos(ang) * (RING_IN / 2 + 6), 0.14, Math.sin(ang) * (RING_IN / 2 + 6), 4, RING_IN - 12, -ang + Math.PI / 2, 1, 6);
    }
    this.geo(M.plaza, uvs(new THREE.RingGeometry(10, 16, 48).rotateX(-Math.PI / 2), 6, 6), 0, 0.15, 0);
    for (let a = 0; a < 32; a++) {
      const ang = (a / 32) * Math.PI * 2;
      this.obstacles.add({ x: Math.cos(ang) * (RING_IN - 1), z: Math.sin(ang) * (RING_IN - 1), h: -ang, hl: 1.2, hw: 6 });
    }
    for (let i = 0; i < 150; i++) {
      const ang = rnd() * Math.PI * 2, r = rr(19, RING_IN - 4);
      const onPath = [...Array(8)].some((_, k) => Math.abs(Math.atan2(Math.sin(ang - k * Math.PI / 4), Math.cos(ang - k * Math.PI / 4))) * r < 4);
      if (!onPath) this.trees.push({ x: Math.cos(ang) * r, z: Math.sin(ang) * r, s: rr(1.1, 1.5), kind: 'chinar', noCollide: true });
    }
    this.temurStatue(0, 0);
    this.labels.push({ x: 0, z: 0, text: 'Сквер Амира Темура' });
  }

  temurStatue(x, z) {
    this.geo(M.concrete, new THREE.CylinderGeometry(8, 8.5, 0.6, 32), x, 0.3, z);
    this.box(M.white, x, 0.6, z, 6, 1.0, 9);
    this.box(M.concrete, x, 1.6, z, 4.6, 4.2, 7.4);
    const y0 = 5.8;
    const part = (g, px, py, pz, rx = 0) => { g.rotateX(rx); g.translate(x + px, y0 + py, z + pz); this.push(M.bronze, g); };
    part(new THREE.CapsuleGeometry(0.9, 2.6, 6, 12), 0, 2.2, 0, Math.PI / 2);          // конь, смотрит на юг
    part(new THREE.CapsuleGeometry(0.45, 1.4, 4, 10), 0, 3.4, 2.0, -0.7);
    part(new THREE.CapsuleGeometry(0.35, 0.9, 4, 10), 0, 4.0, 2.8, -1.9);
    part(new THREE.CylinderGeometry(0.17, 0.13, 2.2, 8), -0.5, 1.6, 2.1, -0.9);       // поднятые передние ноги
    part(new THREE.CylinderGeometry(0.17, 0.13, 2.2, 8), 0.5, 1.4, 2.2, -0.6);
    part(new THREE.CylinderGeometry(0.17, 0.13, 2.2, 8), -0.5, 0.9, -1.3, 0.15);
    part(new THREE.CylinderGeometry(0.17, 0.13, 2.2, 8), 0.5, 0.9, -1.3, -0.1);
    part(new THREE.CylinderGeometry(0.12, 0.3, 1.8, 8), 0, 2.2, -2.3, 0.9);
    part(new THREE.CapsuleGeometry(0.42, 1.1, 4, 10), 0, 3.9, 0.2);                   // всадник
    part(new THREE.SphereGeometry(0.33, 12, 10), 0, 4.95, 0.3);
    part(new THREE.ConeGeometry(0.4, 0.5, 12), 0, 5.35, 0.3);
    part(new THREE.CylinderGeometry(0.1, 0.1, 1.3, 6), 0.45, 4.3, 0.75, -1.2);
    part(new THREE.ConeGeometry(0.9, 2.4, 10, 1, true), 0, 3.6, -0.2, 0.25);
    this.obstacles.add({ x, z, h: 0, hl: 8.5, hw: 8.5 });
  }

  // ---------- канал Анхор ----------
  canal() {
    const x = CANAL_X, w = CANAL_W;
    const zs = [-HALF, ...HLINES.map(h => h.z), HALF];
    for (let i = 0; i < zs.length - 1; i++) {
      const ha = HLINES.find(h => h.z === zs[i]), hb = HLINES.find(h => h.z === zs[i + 1]);
      const z0 = zs[i] + (ha ? W[ha.t] / 2 + SW : 0), z1 = zs[i + 1] - (hb ? W[hb.t] / 2 + SW : 0);
      const len = z1 - z0, cz = (z0 + z1) / 2;
      this.quad(M.water, x, -1.1, cz, w, len, 0, 2, len / 16);
      for (const s of [-1, 1]) {
        const g = new THREE.PlaneGeometry(1.7, len); g.rotateX(-Math.PI / 2); g.rotateZ(-s * 0.95); g.translate(x + s * (w / 2 - 0.35), -0.55, cz); this.push(M.concrete, g);
        this.quad(M.plaza, x + s * (w / 2 + 3), 0.1, cz, 6, len, 0, 2, len / 6);
        this.box(M.white, x + s * (w / 2 + 0.1), 0, cz, 0.25, 1.0, len);
        this.obstacles.add({ x: x + s * (w / 2 + 0.1), z: cz, h: Math.PI / 2, hl: len / 2, hw: 0.4 });
        for (let v = z0 + 5; v < z1 - 3; v += 9) this.trees.push({ x: x + s * (w / 2 + 4.5), z: v, s: rr(1.0, 1.4), kind: rnd() < 0.3 ? 'willow' : 'chinar' });
      }
    }
    for (const H of HLINES) {
      const half = W[H.t] / 2 + SW;
      for (const s of [-1, 1]) this.box(M.white, x, 0.1, H.z + s * (half - 0.2), w + 2, 0.9, 0.25);
    }
    this.labels.push({ x, z: -360, text: 'канал Анхор' });
  }

  // ---------- кварталы ----------
  cellRect(i, j) {
    const hx = x => (x === CANAL_X ? CANAL_W / 2 + 6 : W[VLINES.find(v => v.x === x).t] / 2 + SW);
    const hz = z => W[HLINES.find(h => h.z === z).t] / 2 + SW;
    const r = { x0: XS[i] + hx(XS[i]), x1: XS[i + 1] - hx(XS[i + 1]), z0: ZS[j] + hz(ZS[j]), z1: ZS[j + 1] - hz(ZS[j + 1]) };
    r.cx = (r.x0 + r.x1) / 2; r.cz = (r.z0 + r.z1) / 2; r.w = r.x1 - r.x0; r.d = r.z1 - r.z0;
    return r;
  }

  cells() {
    const special = {
      '4,3': 'museum', '5,3': 'hotel', '5,4': 'forums', '4,4': 'sayilgoh',
      '3,3': 'mustaqillik', '2,3': 'senate', '2,2': 'tashkentCity', '3,2': 'cityPark',
      '3,1': 'minor', '5,0': 'tvTower', '0,3': 'chorsu', '0,4': 'kukeldash', '0,1': 'khastImam',
      '1,6': 'stadium', '6,6': 'park', '7,6': 'autodrom', '5,5': 'park', '8,4': 'gas',
    };
    for (let i = 0; i < XS.length - 1; i++) for (let j = 0; j < ZS.length - 1; j++) {
      const r = this.cellRect(i, j);
      let type = special[`${i},${j}`];
      if (!type) {
        if (r.cx < -290 && r.cz < 150) type = 'mahalla';
        else if (r.cx < -110 && r.cz >= 150) type = 'chilanzar';
        else if (r.cx > 270 && r.cz < -150) type = 'yunusabad';
        else if (r.cz < -290 || r.cz > 290) type = rnd() < 0.5 ? 'chilanzar' : 'yunusabad';
        else type = 'center';
      }
      r.type = type;
      this.groundFor(r, type);
      this[type](r);
    }
  }

  groundFor(r, type) {
    const mat = { mahalla: M.dirt, autodrom: M.asphalt, gas: M.asphalt, chorsu: M.plaza, khastImam: M.plaza, kukeldash: M.plaza, sayilgoh: M.plaza, tashkentCity: M.plaza, forums: M.plaza, hotel: M.plaza }[type] || M.grass;
    if (Math.abs(r.cx) < 140 && Math.abs(r.cz) < 160) {      // кварталы у кольца — с вырезом
      const sh = new THREE.Shape(); sh.moveTo(r.x0, r.z0); sh.lineTo(r.x1, r.z0); sh.lineTo(r.x1, r.z1); sh.lineTo(r.x0, r.z1); sh.closePath();
      const hole = new THREE.Path(); hole.absarc(0, 0, RING_OUT + SW, 0, Math.PI * 2, true); sh.holes.push(hole);
      const g = new THREE.ShapeGeometry(sh, 48); g.rotateX(Math.PI / 2);
      const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / 12, uv.getY(k) / 12);
      const idx = g.index.array; for (let k = 0; k < idx.length; k += 3) { const t = idx[k]; idx[k] = idx[k + 2]; idx[k + 2] = t; }
      g.computeVertexNormals(); g.translate(0, 0.08, 0); this.push(mat, g);
    } else this.quad(mat, r.cx, 0.08, r.cz, r.w, r.d, 0, r.w / 12, r.d / 12);
  }

  inRing(x, z, pad = 0) { return Math.hypot(x, z) < RING_OUT + SW + pad; }

  // ---- жилые кварталы ----
  center(r) {
    const mats = [M.brick, M.office, M.panel2];
    for (const [x, z, len, dep, rot] of [[r.cx, r.z0 + 9, r.w - 24, 12, 0], [r.cx, r.z1 - 9, r.w - 24, 12, 0], [r.x0 + 9, r.cz, r.d - 44, 12, 1], [r.x1 - 9, r.cz, r.d - 44, 12, 1]]) {
      let pos = -len / 2;
      while (pos < len / 2 - 15) {
        const bl = Math.min(rr(24, 46), len / 2 - pos), off = pos + bl / 2;
        const bx = rot ? x : x + off, bz = rot ? z + off : z;
        if (!this.inRing(bx, bz, 30)) this.building(bx, bz, rot ? dep : bl, rot ? bl : dep, Math.floor(rr(4, 7)), pick(mats));
        pos += bl + rr(6, 12);
      }
    }
    this.yardTrees(r, 18); this.parkedRow(r);
  }

  chilanzar(r) {
    const n = r.d > 120 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const z = r.z0 + 14 + k * ((r.d - 28) / (n - 1));
      const len = r.w - 30, parts = len > 90 ? 2 : 1;
      for (let p = 0; p < parts; p++) {
        const bl = len / parts - 8, bx = r.x0 + 15 + bl / 2 + p * (len / parts);
        this.building(bx, z, bl, 12, pick([4, 5, 9, 9]), pick([M.panel, M.panel2, M.panel]));
      }
    }
    this.yardTrees(r, 22);
    this.playground(r.cx + rr(-10, 10), r.cz + rr(-4, 4));
    this.parkedRow(r);
  }

  yunusabad(r) {
    for (const [fx, fz] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const x = r.x0 + r.w * fx, z = r.z0 + r.d * fz;
      if (rnd() < 0.55) this.building(x, z, 20, 20, pick([12, 16, 16, 20]), pick([M.panel2, M.panel, M.office]));
      else this.building(x, z, 42, 12, 9, M.panel, rnd() < 0.5 ? 0 : Math.PI / 2);
    }
    this.yardTrees(r, 16); this.parkedRow(r);
  }

  mahalla(r) {      // старый город: глухие стены, цветные ворота, переулок
    const laneW = 6;
    this.quad(M.lane, r.cx, 0.09, r.cz, laneW, r.d, 0, 1, r.d / 6);
    const plotW = 22, plotD = 24;
    for (const s of [-1, 1]) {
      const xin = r.cx + s * (laneW / 2), xout = s > 0 ? r.x1 : r.x0;
      const cols = Math.max(1, Math.floor(Math.abs(xout - xin) / plotW));
      for (let c = 0; c < cols; c++) for (let z = r.z0 + 2; z + plotD <= r.z1 - 2; z += plotD) {
        const px = xin + s * (c * plotW + plotW / 2), pz = z + plotD / 2;
        this.box(M.wall, px, 0, pz - plotD / 2 + 0.2, plotW - 0.6, 2.3, 0.35, 0, true);
        this.box(M.wall, px, 0, pz + plotD / 2 - 0.2, plotW - 0.6, 2.3, 0.35, 0, true);
        this.box(M.wall, px + s * (plotW / 2 - 0.3), 0, pz, 0.35, 2.3, plotD - 0.6, 0, true);
        this.box(M.wall, px - s * (plotW / 2 - 0.3), 0, pz - 4, 0.35, 2.3, plotD / 2 + 3, 0, true);
        this.box(rnd() < 0.5 ? M.gate : M.gateBlue, px - s * (plotW / 2 - 0.3), 0, pz + 5.5, 0.25, 2.6, 4, 0, true);
        const fl = rnd() < 0.35 ? 2 : 1;
        this.building(px + s * 3, pz - 4, 13, 9, fl, M.house, 0, M.slate, 3.2);
        this.box(M.wood, px - s * 4, 2.6, pz + 6, 6, 0.15, 5);
        if (rnd() < 0.7) this.trees.push({ x: px - s * 6.5, z: pz + 8, s: rr(0.6, 0.9), kind: 'fruit', noCollide: true });
      }
    }
  }

  yardTrees(r, n) {
    for (let k = 0; k < n; k++) {
      const x = rr(r.x0 + 6, r.x1 - 6), z = rr(r.z0 + 6, r.z1 - 6);
      if (this.inRing(x, z, 10)) continue;
      let blocked = false;
      for (const o of this.obstacles.query(x, z, 4)) if (Math.abs(o.x - x) < o.hl + o.hw + 3 && Math.abs(o.z - z) < o.hl + o.hw + 3) { blocked = true; break; }
      if (!blocked) this.trees.push({ x, z, s: rr(0.8, 1.3), kind: rnd() < 0.7 ? 'chinar' : 'poplar' });
    }
  }

  playground(x, z) {
    this.quad(M.dirt, x, 0.1, z, 14, 10, 0, 2, 2);
    this.box(M.red, x - 3, 0, z, 0.2, 2.4, 0.2); this.box(M.red, x + 3, 0, z, 0.2, 2.4, 0.2); this.box(M.red, x, 2.4, z, 6.2, 0.2, 0.2);
    this.box(M.gateBlue, x, 0, z + 3, 3, 1.2, 1.5, 0, true);
  }

  parkedRow(r) {
    if (rnd() < 0.45) return;
    const n = Math.floor(rr(2, 5)), z = r.z1 - 3.5;
    for (let k = 0; k < n; k++) {
      const x = r.x0 + 12 + k * 3.4;
      let blocked = false;
      for (const o of this.obstacles.query(x, z, 3)) if (Math.abs(o.x - x) < o.hl + o.hw + 1.5 && Math.abs(o.z - z) < o.hl + o.hw + 2.5) { blocked = true; break; }
      if (!blocked) this.parkedCar(x, z, Math.PI / 2);
    }
  }

  parkedCar(x, z, h) {
    const spec = pick(CARS);
    const col = rnd() < 0.8 ? '#f4f4f2' : pick(['#b9bdc3', '#50555c', '#16171a']);   // в Ташкенте почти все машины белые
    this.obstacles.add(addCarToBuckets(spec, col, x, z, h, this.carBuckets));
  }

  // ---- достопримечательности ----
  museum(r) {       // музей истории Темуридов + куранты
    const x = r.x0 + 40, z = r.z0 + 38;
    this.geo(M.white, new THREE.CylinderGeometry(19, 19, 15, 48), x, 7.5, z);
    for (let a = 0; a < 32; a++) { const ang = (a / 32) * Math.PI * 2; this.geo(M.white, new THREE.CylinderGeometry(0.5, 0.5, 15, 8), x + Math.cos(ang) * 19.6, 7.5, z + Math.sin(ang) * 19.6); }
    this.geo(M.ribs, uvs(new THREE.SphereGeometry(15, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), 3, 1), x, 15, z, 0, 1, 1.15, 1);
    this.geo(M.gold, new THREE.SphereGeometry(1.2, 16, 12), x, 33, z);
    this.collide(x, z, 38, 38);
    this.labels.push({ x, z, text: 'Музей Темуридов' });
    const cx = r.x0 + 18, cz = r.z1 - 26;
    this.box(M.white, cx, 0, cz, 6, 18, 6, 0, true);
    this.box(M.white, cx, 18, cz, 4.5, 6, 4.5);
    this.geo(M.green, new THREE.ConeGeometry(3.6, 5, 4), cx, 26.5, cz, Math.PI / 4);
    const clock = canvasTex(128, 128, g => { g.fillStyle = '#f7f3ea'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.strokeStyle = '#222'; g.lineWidth = 6; g.stroke(); g.lineWidth = 5; g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 20); g.moveTo(64, 64); g.lineTo(95, 70); g.stroke(); }, false);
    const cm = new THREE.MeshStandardMaterial({ map: clock });
    for (let k = 0; k < 4; k++) { const ang = (k * Math.PI) / 2; this.geo(cm, new THREE.CircleGeometry(1.6, 24), cx + Math.sin(ang) * 2.27, 21, cz + Math.cos(ang) * 2.27, ang); }
    this.labels.push({ x: cx, z: cz, text: 'Куранты' });
    this.yardTrees(r, 10);
  }

  hotel() {         // отель «Узбекистан»: вогнутый фасад к скверу, 17 этажей
    const R = 122;
    for (let k = 0; k < 7; k++) {
      const th = -1.05 + k * 0.087;
      this.building(Math.cos(th) * R, Math.sin(th) * R, 11, 16, 17, M.hotel, -th - Math.PI / 2, M.roofDark);
    }
    this.labels.push({ x: 86, z: -86, text: 'Отель «Узбекистан»' });
  }

  forums(r) {       // Дворец форумов
    const x = r.x1 - 40, z = r.z1 - 36;
    this.box(M.white, x, 0, z, 66, 2, 50);
    this.box(M.white, x, 2, z, 56, 18, 40, 0, true);
    for (let k = 0; k <= 16; k++) for (const s of [-1, 1]) this.geo(M.white, new THREE.CylinderGeometry(0.7, 0.7, 20, 10), x - 30 + k * (60 / 16), 12, z + s * 22.5);
    for (let k = 1; k < 12; k++) for (const s of [-1, 1]) this.geo(M.white, new THREE.CylinderGeometry(0.7, 0.7, 20, 10), x + s * 30, 12, z - 22.5 + k * (45 / 12));
    this.box(M.white, x, 22, z, 64, 1.6, 48);
    this.geo(M.tiles, uvs(new THREE.SphereGeometry(12, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2), 10, 3), x, 23.6, z, 0, 1, 0.8, 1);
    this.geo(M.gold, new THREE.SphereGeometry(0.9, 12, 10), x, 33.5, z);
    this.collide(x, z, 66, 50);
    this.labels.push({ x, z, text: 'Дворец форумов' });
  }

  sayilgoh(r) {     // «Бродвей»
    for (let k = 0; k < 10; k++) {
      const z = r.z0 + 12 + k * ((r.d - 24) / 9);
      for (const s of [-1, 1]) if (!this.inRing(r.cx + s * 12, z, 6)) {
        this.box(M.wood, r.cx + s * 12, 0, z, 3, 1, 2, 0, true);
        this.box(pick([M.red, M.gateBlue, M.green]), r.cx + s * 12, 2.4, z, 3.6, 0.12, 2.6);
      }
    }
    for (let k = 0; k < 30; k++) { const x = rr(r.x0 + 4, r.x1 - 4), z = rr(r.z0 + 4, r.z1 - 4); if (Math.abs(x - r.cx) > 18 && !this.inRing(x, z, 8)) this.trees.push({ x, z, s: rr(1, 1.4), kind: 'chinar' }); }
    this.labels.push({ x: r.cx, z: r.cz + 30, text: 'Сайилгох' });
  }

  mustaqillik(r) {  // арка «Эзгулик» с аистами
    const ax = r.x1 - 10, az = r.cz;
    for (let k = 0; k < 16; k++) this.geo(M.white, new THREE.CylinderGeometry(0.75, 0.9, 17, 12), ax, 8.5, az - 33 + k * 4.4);
    this.box(M.white, ax, 17, az, 4, 2.2, 70);
    this.box(M.white, ax, 19.2, az, 3.2, 0.6, 66);
    for (let k = 0; k < 4; k++) {
      const z = az - 24 + k * 16;
      this.geo(M.white, new THREE.CapsuleGeometry(0.6, 1.4, 4, 8), ax, 21.8, z);
      this.geo(M.white, new THREE.ConeGeometry(0.5, 3.6, 3), ax, 22, z, 0, 0.2, 1, 1.6);
    }
    for (let k = 0; k < 16; k++) this.collide(ax, az - 33 + k * 4.4, 1.8, 1.8);
    this.labels.push({ x: ax, z: az, text: 'Арка Эзгулик' });
    this.quad(M.plaza, r.cx - 6, 0.1, r.cz, r.w - 22, 16, 0, 6, 2);
    for (let k = 0; k < 3; k++) this.fountain(r.x0 + 12 + k * 12, r.cz, 4);
    for (let k = 0; k < 24; k++) { const x = rr(r.x0 + 4, r.x1 - 18), z = rr(r.z0 + 4, r.z1 - 4); if (Math.abs(z - r.cz) > 12) this.trees.push({ x, z, s: rr(1, 1.3), kind: rnd() < 0.5 ? 'chinar' : 'poplar' }); }
  }

  senate(r) {       // площадь Мустакиллик: белое здание с колоннадой и флаг
    const x = r.cx, z = r.cz - 8;
    this.box(M.white, x, 0, z, 50, 16, 28, 0, true);
    for (let k = 0; k < 11; k++) this.geo(M.white, new THREE.CylinderGeometry(0.8, 0.8, 16, 12), x - 22 + k * 4.4, 8, z + 15.5);
    this.box(M.white, x, 16, z, 52, 1.6, 32);
    this.geo(M.tiles, uvs(new THREE.SphereGeometry(8, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), 8, 2), x, 17.6, z);
    this.geo(M.steel, new THREE.CylinderGeometry(0.2, 0.25, 30, 8), x, 15, z + 40);
    const flag = canvasTex(96, 48, g => { g.fillStyle = '#0099b5'; g.fillRect(0, 0, 96, 16); g.fillStyle = '#fff'; g.fillRect(0, 16, 96, 16); g.fillStyle = '#1eb53a'; g.fillRect(0, 32, 96, 16); g.fillStyle = '#ce1126'; g.fillRect(0, 15, 96, 2); g.fillRect(0, 31, 96, 2); }, false);
    this.geo(new THREE.MeshStandardMaterial({ map: flag, side: THREE.DoubleSide }), new THREE.PlaneGeometry(6, 3), x + 3, 28, z + 40);
    this.collide(x, z + 40, 1, 1);
    this.labels.push({ x, z, text: 'Площадь Мустакиллик' });
    this.yardTrees(r, 14);
  }

  tashkentCity(r) {
    for (const [fx, fz, w, d, fl] of [[0.3, 0.32, 24, 24, 51], [0.74, 0.3, 22, 22, 30], [0.3, 0.78, 20, 20, 24], [0.74, 0.76, 22, 18, 35]])
      this.building(r.x0 + r.w * fx, r.z0 + r.d * fz, w, d, fl, M.glass, 0, M.roofDark, 3.6);
    this.geo(M.steel, new THREE.CylinderGeometry(0.4, 0.6, 20, 8), r.x0 + r.w * 0.3, 51 * 3.6 + 10, r.z0 + r.d * 0.32);
    this.labels.push({ x: r.cx, z: r.cz, text: 'Tashkent City' });
  }

  cityPark(r) {
    const lx = r.cx, lz = r.cz;
    this.geo(M.water, new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), lx, 0.12, lz, 0, r.w * 0.33, 1, r.d * 0.3);
    this.obstacles.add({ x: lx, z: lz, h: 0, hl: r.w * 0.3, hw: r.d * 0.27 });
    for (let k = 0; k < 40; k++) { const a = rnd() * 7, x = lx + Math.cos(a) * r.w * rr(0.38, 0.46), z = lz + Math.sin(a) * r.d * rr(0.35, 0.45); this.trees.push({ x, z, s: rr(0.8, 1.2), kind: rnd() < 0.4 ? 'willow' : 'chinar' }); }
  }

  minor(r) {        // мечеть Минор
    const x = r.x1 - 34, z = r.cz;
    this.box(M.white, x, 0, z, 30, 13, 28, 0, true);
    this.box(M.white, x - 17, 0, z, 5, 18, 18, 0, true);
    this.geo(M.tiles, uvs(new THREE.CylinderGeometry(9, 9, 4, 32), 8, 1), x, 15, z);
    this.geo(M.tiles, uvs(new THREE.SphereGeometry(9, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2), 8, 2), x, 17, z, 0, 1, 1.25, 1);
    this.geo(M.white, new THREE.CylinderGeometry(1.4, 1.8, 38, 16), x + 22, 19, z - 18);
    this.geo(M.tiles, new THREE.CylinderGeometry(2, 2, 3, 16), x + 22, 33, z - 18);
    this.geo(M.tiles, new THREE.ConeGeometry(1.8, 4, 16), x + 22, 40, z - 18);
    this.collide(x + 22, z - 18, 4, 4);
    this.labels.push({ x, z, text: 'Мечеть Минор' });
    this.yardTrees(r, 12);
  }

  tvTower(r) {      // телебашня
    const x = r.cx, z = r.cz;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.3;
      const g = new THREE.CylinderGeometry(0.9, 1.6, 64, 8); g.translate(0, 32, 0); g.rotateZ(0.28); g.rotateY(-a); g.translate(x + Math.cos(a) * 18, 0, z + Math.sin(a) * 18); this.push(M.steel, g);
      this.collide(x + Math.cos(a) * 18, z + Math.sin(a) * 18, 3.5, 3.5);
    }
    this.geo(M.steel, new THREE.CylinderGeometry(2.2, 4.5, 190, 16), x, 95, z);
    for (let y = 8; y < 180; y += 8) this.geo(M.darkSteel, new THREE.CylinderGeometry(4.6 - y * 0.012, 4.6 - y * 0.012, 0.5, 16), x, y, z);
    this.geo(M.glass, new THREE.CylinderGeometry(11, 9, 8, 24), x, 96, z);
    this.geo(M.darkSteel, new THREE.CylinderGeometry(12, 12, 1.2, 24), x, 101, z);
    this.geo(M.glass, new THREE.CylinderGeometry(8, 7, 6, 24), x, 120, z);
    this.geo(M.steel, new THREE.CylinderGeometry(0.4, 1.2, 50, 8), x, 210, z);
    this.box(M.concrete, x, 0, z, 14, 6, 14, 0, true);
    this.labels.push({ x, z, text: 'Телебашня' });
    for (let k = 0; k < 40; k++) { const a = rnd() * 7, d = rr(28, 50); this.trees.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, s: rr(0.9, 1.3), kind: 'poplar' }); }
  }

  madrasa(x, z, w, faceRot = 0) {
    const g = new THREE.Group();
    const bx = (mat, px, py, pz, sx, sy, sz) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(px, py + sy / 2, pz); g.add(m); };
    bx(M.mbrick, 0, 0, -8, w, 11, 30);
    bx(M.mbrick, 0, 0, 8, 22, 22, 4);
    const arch = new THREE.Shape(); arch.moveTo(-6, 0); arch.lineTo(-6, 11); arch.quadraticCurveTo(-6, 17, 0, 19); arch.quadraticCurveTo(6, 17, 6, 11); arch.lineTo(6, 0); arch.closePath();
    const am = new THREE.Mesh(new THREE.ShapeGeometry(arch), M.tiles); am.position.set(0, 0, 10.02); g.add(am);
    const ai = new THREE.Mesh(new THREE.ShapeGeometry(arch).scale(0.72, 0.85, 1), M.darkSteel); ai.position.set(0, 0, 10.04); g.add(ai);
    for (const d of [-w * 0.3, w * 0.3]) {
      const drum = new THREE.Mesh(uvs(new THREE.CylinderGeometry(5.5, 5.5, 4, 32), 6, 1), M.tiles); drum.position.set(d, 13, -10); g.add(drum);
      const dome = new THREE.Mesh(uvs(new THREE.SphereGeometry(6, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2), 6, 2), M.tiles); dome.scale.y = 1.3; dome.position.set(d, 15, -10); g.add(dome);
    }
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.6, 16, 20), M.mbrick); t.position.set(s * (w / 2), 8, 6); g.add(t);
      const c = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.tiles); c.position.set(s * (w / 2), 16, 6); g.add(c);
    }
    g.position.set(x, 0, z); g.rotation.y = faceRot; g.updateMatrixWorld(true);
    g.traverse(o => { if (o.isMesh) { const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); geo.applyMatrix4(o.matrixWorld); this.push(o.material, geo); } });
    const fx = Math.sin(faceRot), fz = Math.cos(faceRot);
    this.obstacles.add({ x: x - fx * 8, z: z - fz * 8, h: faceRot, hl: w / 2 + 2, hw: 15 });
    this.obstacles.add({ x: x + fx * 8, z: z + fz * 8, h: faceRot, hl: 11, hw: 2 });
  }

  chorsu(r) {       // базар Чорсу
    const x = r.cx, z = r.cz;
    this.geo(M.white, new THREE.CylinderGeometry(38, 38, 9, 64), x, 4.5, z);
    this.geo(M.tiles, uvs(new THREE.SphereGeometry(36, 64, 18, 0, Math.PI * 2, 0, Math.PI / 2), 28, 6), x, 9, z, 0, 1, 0.55, 1);
    this.geo(M.gold, new THREE.CylinderGeometry(4, 4, 2, 24), x, 29, z);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; this.geo(M.tiles, new THREE.SphereGeometry(5, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), x + Math.cos(a) * 30, 9, z + Math.sin(a) * 30); }
    for (let a = 0; a < 16; a++) { const ang = (a / 16) * Math.PI * 2; this.obstacles.add({ x: x + Math.cos(ang) * 34, z: z + Math.sin(ang) * 34, h: -ang, hl: 4, hw: 7 }); }
    this.obstacles.add({ x, z, h: 0, hl: 30, hw: 30 });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, sx = x + Math.cos(a) * 50, sz = z + Math.sin(a) * 50;
      if (sx > r.x0 + 3 && sx < r.x1 - 3 && sz > r.z0 + 3 && sz < r.z1 - 3) { this.box(M.wood, sx, 0, sz, 4, 1, 2.5, -a, true); this.box(pick([M.red, M.gateBlue, M.green]), sx, 2.6, sz, 4.6, 0.12, 3, -a); }
    }
    this.labels.push({ x, z, text: 'Базар Чорсу' });
  }

  kukeldash(r) { this.madrasa(r.cx, r.cz - 5, 52, Math.PI / 2); this.labels.push({ x: r.cx, z: r.cz, text: 'Медресе Кукельдаш' }); this.yardTrees(r, 10); }

  khastImam(r) {
    this.madrasa(r.cx, r.cz + 4, 60, 0);
    for (const s of [-1, 1]) {
      const x = r.cx + s * 40, z = r.cz + 25;
      this.geo(M.mbrick, new THREE.CylinderGeometry(2.2, 3, 50, 20), x, 25, z);
      this.geo(M.tiles, new THREE.CylinderGeometry(3.2, 2.6, 4, 20), x, 46, z);
      this.geo(M.tiles, new THREE.SphereGeometry(2.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), x, 50, z, 0, 1, 1.4, 1);
      this.collide(x, z, 6, 6);
    }
    this.labels.push({ x: r.cx, z: r.cz, text: 'Хаст-Имам' });
  }

  stadium(r) {      // стадион «Миллий»
    const x = r.cx, z = r.cz;
    const bowl = new THREE.CylinderGeometry(52, 44, 18, 64, 1, true); bowl.scale(1, 1, 0.75);
    this.geo(M.seats, bowl, x, 9, z);
    const outer = new THREE.CylinderGeometry(54, 54, 20, 64, 1, true); outer.scale(1, 1, 0.77);
    this.geo(M.white, outer, x, 10, z);
    this.geo(M.field, new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), x, 0.15, z, 0, 40, 1, 28);
    for (let a = 0; a < 24; a++) { const ang = (a / 24) * Math.PI * 2; this.obstacles.add({ x: x + Math.cos(ang) * 52, z: z + Math.sin(ang) * 40, h: -ang, hl: 2, hw: 8 }); }
    this.obstacles.add({ x, z, h: 0, hl: 44, hw: 32 });
    this.labels.push({ x, z, text: 'Стадион «Миллий»' });
  }

  park(r) {
    const lx = r.cx, lz = r.cz;
    this.geo(M.water, new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), lx, 0.12, lz, 0, r.w * 0.22, 1, r.d * 0.18);
    this.obstacles.add({ x: lx, z: lz, h: 0, hl: r.w * 0.18, hw: r.d * 0.14 });
    for (let k = 0; k < 60; k++) { const x = rr(r.x0 + 4, r.x1 - 4), z = rr(r.z0 + 4, r.z1 - 4); if (Math.hypot((x - lx) / (r.w * 0.25), (z - lz) / (r.d * 0.21)) > 1) this.trees.push({ x, z, s: rr(0.8, 1.4), kind: pick(['chinar', 'chinar', 'poplar', 'willow']) }); }
    this.fountain(r.x0 + 16, r.z0 + 16, 3);
  }

  fountain(x, z, rad) {
    this.geo(M.concrete, new THREE.CylinderGeometry(rad, rad + 0.3, 0.7, 32), x, 0.35, z);
    this.geo(M.water, new THREE.CylinderGeometry(rad - 0.4, rad - 0.4, 0.1, 32), x, 0.7, z);
    this.geo(M.concrete, new THREE.CylinderGeometry(0.3, 0.6, 2.2, 12), x, 1.1, z);
    this.obstacles.add({ x, z, h: 0, hl: rad, hw: rad });
  }

  gas(r) {          // заправка
    const x = r.cx, z = r.z1 - 30;
    this.box(M.white, x, 6, z, 30, 1.2, 16);
    this.box(M.green, x, 5.6, z, 30.2, 0.4, 16.2);
    for (const dx of [-11, 11]) for (const dz of [-5, 5]) this.box(M.white, x + dx, 0, z + dz, 0.8, 6, 0.8, 0, true);
    for (const dx of [-7, 0, 7]) { this.box(M.white, x + dx, 0, z, 2.2, 0.3, 1.2, 0, true); this.box(M.green, x + dx, 0.3, z, 1.1, 1.8, 0.8); }
    this.building(x, r.z0 + 20, 24, 12, 1, M.office, 0, M.green);
    this.sign(x, 9.5, z + 8.2, 'METAN · PROPAN', '#2e8a4e', 14);
    this.yardTrees(r, 10);
  }

  autodrom() {      // площадка автошколы для уровней
    const x = LEVEL_CENTER.x, z = LEVEL_CENTER.z;
    for (let i = -50; i < 50; i += 4) {
      const m = (i / 4) % 2 ? M.red : M.white;
      this.box(m, x + i + 2, 0, z - 50, 4, 0.9, 0.4, 0, true);
      this.box(m, x + i + 2, 0, z + 50, 4, 0.9, 0.4, 0, true);
      this.box(m, x + 50, 0, z + i + 2, 0.4, 0.9, 4, 0, true);
      if (Math.abs(i + 2) > 8) this.box(m, x - 50, 0, z + i + 2, 0.4, 0.9, 4, 0, true);
    }
    this.sign(x - 50.3, 3.6, z - 14, 'AVTOMAKTAB', '#c23a2b', 9, -Math.PI / 2);
    this.labels.push({ x, z, text: 'Автодром' });
  }

  sign(x, y, z, text, color, w = 12, rot = 0) {
    const t = canvasTex(512, 96, (g, Wd, H) => { g.fillStyle = color; g.fillRect(0, 0, Wd, H); g.fillStyle = '#fff'; g.font = '600 58px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, Wd / 2, H / 2 + 3); }, false);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 96 / 512), new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.2, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = rot; this.root.add(m);
  }

  mountains() {     // Чимган и Западный Тянь-Шань на северо-востоке, на остальных сторонах — низкие холмы
    const rock = new THREE.MeshStandardMaterial({ color: 0x9aa3b4, roughness: 1 });
    const snow = new THREE.MeshStandardMaterial({ color: 0xf4f6f9, roughness: 0.8 });
    for (let i = 0; i < 60; i++) {
      const ang = (i / 60) * Math.PI * 2 + rr(-0.03, 0.03);
      const ne = Math.cos(ang + Math.PI / 4);
      const r = rr(1700, 2100), w = rr(420, 700);
      const h = ne > 0.35 ? rr(220, 420) * (0.6 + ne * 0.5) : rr(40, 110);
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      const g = new THREE.ConeGeometry(w, h, 9, 3);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) { const y = p.getY(k); if (y < h / 2 - 1) { p.setX(k, p.getX(k) * rr(0.85, 1.15)); p.setY(k, y + rr(-h * 0.06, h * 0.06)); } }
      g.computeVertexNormals();
      this.geo(rock, g, x, h / 2 - 3, z, rnd() * 3);
      if (h > 260) this.geo(snow, new THREE.ConeGeometry(w * 0.22, h * 0.22, 9, 1), x, h * 0.89 - 3, z, rnd() * 3);
    }
  }

  finish() {
    const flat = FLAT();
    for (const [mat, list] of this.batches) {
      const norm = list.map(g => {
        const n = g.index ? g.toNonIndexed() : g;
        for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
        if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
        if (!n.attributes.normal) n.computeVertexNormals();
        return n;
      });
      const merged = mergeGeometries(norm);
      if (!merged) { console.warn('merge failed', mat); continue; }
      const mesh = new THREE.Mesh(merged, mat);
      mesh.receiveShadow = true; mesh.castShadow = !flat.includes(mat);
      this.root.add(mesh);
    }
    this.batches.clear();
    for (const [mat, list] of this.carBuckets) { const m = new THREE.Mesh(mergeGeometries(list), mat); m.castShadow = m.receiveShadow = true; this.root.add(m); }
    this.carBuckets.clear();
    this.instancedTrees(); this.instancedLamps();
  }

  instancedTrees() {
    const d = new THREE.Object3D(), col = new THREE.Color();
    const trees = this.trees.filter(t => t.noCollide || Math.hypot(t.x, t.z) > RING_OUT + 1);
    const trunkG = new THREE.CylinderGeometry(0.22, 0.32, 4, 7); trunkG.translate(0, 2, 0);
    const whiteG = new THREE.CylinderGeometry(0.34, 0.34, 1.2, 7); whiteG.translate(0, 0.6, 0);   // побелённые стволы
    const crownG = new THREE.IcosahedronGeometry(1, 2);
    { const p = crownG.attributes.position; for (let k = 0; k < p.count; k++) { const f = 1 + Math.sin(p.getX(k) * 7.1 + p.getZ(k) * 5.3) * 0.08 + Math.cos(p.getY(k) * 6.7) * 0.06; p.setXYZ(k, p.getX(k) * f, p.getY(k) * f, p.getZ(k) * f); } const nr = new Float32Array(p.count * 3); for (let k = 0; k < p.count; k++) { const v = new THREE.Vector3(p.getX(k), p.getY(k), p.getZ(k)).normalize(); nr.set([v.x, v.y, v.z], k * 3); } crownG.setAttribute('normal', new THREE.BufferAttribute(nr, 3)); }
    const n = trees.length;
    const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x7a6650, roughness: 1 }), n);
    const whites = new THREE.InstancedMesh(whiteG, new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.9 }), n);
    const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), n);
    trees.forEach((t, i) => {
      const s = t.s;
      d.rotation.set(0, (t.x * 13.7) % 6.28, 0);
      d.position.set(t.x, 0, t.z); d.scale.set(s, t.kind === 'poplar' ? s * 1.6 : s, s); d.updateMatrix();
      trunks.setMatrixAt(i, d.matrix); whites.setMatrixAt(i, d.matrix);
      let cy = 6 * s, sx = 3.4 * s, sy = 2.8 * s;
      if (t.kind === 'poplar') { cy = 8.5 * s; sx = 1.5 * s; sy = 5.5 * s; }
      if (t.kind === 'thin') { cy = 4.5 * s; sx = 1.8 * s; sy = 1.9 * s; }
      if (t.kind === 'willow') { cy = 4.5 * s; sx = 3.6 * s; sy = 2.6 * s; }
      if (t.kind === 'fruit') { cy = 3.2 * s; sx = 2.4 * s; sy = 1.8 * s; }
      d.position.y = cy; d.scale.set(sx, sy, sx); d.updateMatrix(); crowns.setMatrixAt(i, d.matrix);
      const hue = t.kind === 'willow' ? 0.2 : t.kind === 'poplar' ? 0.27 : 0.23;
      crowns.setColorAt(i, col.setHSL(hue + Math.random() * 0.04, 0.45, 0.22 + Math.random() * 0.08));
      if (!t.noCollide) this.obstacles.add({ x: t.x, z: t.z, h: 0, hl: 0.35, hw: 0.35 });
    });
    trunks.castShadow = crowns.castShadow = true; crowns.receiveShadow = true;
    this.root.add(trunks, whites, crowns);
  }

  instancedLamps() {
    const d = new THREE.Object3D();
    const poleG = new THREE.CylinderGeometry(0.1, 0.15, 9, 6); poleG.translate(0, 4.5, 0);
    const armG = new THREE.BoxGeometry(2.2, 0.12, 0.12); armG.translate(1.1, 8.9, 0);
    const headG = new THREE.BoxGeometry(0.8, 0.16, 0.36); headG.translate(2.1, 8.78, 0);
    const steel = new THREE.MeshStandardMaterial({ color: 0x6a7077, metalness: 0.6, roughness: 0.4 });
    const items = [];
    for (const l of this.lamps) {
      // плечо фонаря направлено поперёк дороги: для вертикальной дороги — по оси x
      const across = l.rot === 0 ? 0 : -Math.PI / 2;
      if (l.double) { items.push({ x: l.x, z: l.z, a: across }); items.push({ x: l.x, z: l.z, a: across + Math.PI }); }
      else items.push({ x: l.x, z: l.z, a: across + ((l.side > 0) === (l.rot === 0) ? Math.PI : 0) });
      this.obstacles.add({ x: l.x, z: l.z, h: 0, hl: 0.15, hw: 0.15 });
    }
    const n = items.length;
    const poles = new THREE.InstancedMesh(poleG, steel, n), arms = new THREE.InstancedMesh(armG, steel, n), heads = new THREE.InstancedMesh(headG, M.lightOn, n);
    items.forEach((it, i) => { d.position.set(it.x, 0, it.z); d.rotation.set(0, it.a, 0); d.updateMatrix(); poles.setMatrixAt(i, d.matrix); arms.setMatrixAt(i, d.matrix); heads.setMatrixAt(i, d.matrix); });
    poles.castShadow = true;
    this.root.add(poles, arms, heads);
  }
}

// Стоящая машина для уровней: склеиваем по материалам
export function makeStaticCar(spec, color, x, z, h) {
  const buckets = new Map();
  const obstacle = addCarToBuckets(spec, color, x, z, h, buckets);
  const g = new THREE.Group();
  for (const [mat, list] of buckets) { const m = new THREE.Mesh(mergeGeometries(list), mat); m.castShadow = m.receiveShadow = true; g.add(m); }
  return { mesh: g, obstacle };
}
