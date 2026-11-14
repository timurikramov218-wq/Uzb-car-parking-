import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CARS, addCarToBuckets, extraModels } from './cars.js';
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

export const LEVEL_CENTER = { x: 1020, z: 980 };          // автодром (в новом городе)
// Двухуровневые узлы: тоннель на пр. Амира Темура под улицей у Tashkent City и эстакада на пр. Навои
export const STRUCTS = [
  { axis: 'v', line: 0, node: -290, D: -6.5, name: 'Тоннель' },
  { axis: 'h', line: 0, node: -420, D: 7.2, name: 'Эстакада' },
];
export const S_FLAT = 22, S_RAMP = 75, S_BAND = 12;
export const structProfile = (S, v) => { const d = Math.abs(v - S.node); if (d <= S_FLAT) return S.D; if (d >= S_FLAT + S_RAMP) return 0; return S.D * (0.5 + 0.5 * Math.cos(Math.PI * (d - S_FLAT) / S_RAMP)); };
// координаты вдоль/поперёк линии узла
export const structUV = (S, x, z) => (S.axis === 'v' ? { u: x - S.line, v: z } : { u: -(z - S.line), v: x });
// старт: проспект Амира Темура, едем на юг к скверу
export const SPAWN = { x: -7.5, z: -175, h: -Math.PI / 2 };

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
// Карта нормалей из яркости текстуры: тёмное — углубление (окна, швы, трещины)
function normalFrom(tex, strength = 2) {
  const src = tex.image, w = src.width, h = src.height;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const L = (x, y) => { x = (x + w) % w; y = (y + h) % h; const i = (y * w + x) * 4; return (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255; };
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), out = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (L(x + 1, y) - L(x - 1, y)) * strength, dy = (L(x, y + 1) - L(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    out.data[i] = (-dx / len * 0.5 + 0.5) * 255; out.data[i + 1] = (dy / len * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / len * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = tex.wrapS; t.wrapT = tex.wrapT; t.anisotropy = 8;
  return t;
}
function makeTextures() {
  // Асфальт высокого разрешения: многослойный шум, щебень, заплатки, трещины и накатанная колея по полосам
  const asphalt = (w, h, lanesM, widthM) => canvasTex(w, h, (g) => {
    g.fillStyle = '#3d3f43'; g.fillRect(0, 0, w, h);
    for (const [n, sz, a] of [[400, 160, 0.05], [1800, 50, 0.05], [9000, 10, 0.07]]) for (let i = 0; i < n; i++) {
      const v = Math.random() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},${a * Math.random()})`;
      g.beginPath(); g.arc(Math.random() * w, Math.random() * h, sz * (0.3 + Math.random()), 0, 7); g.fill();
    }
    for (let i = 0; i < 45000; i++) { const v = 90 + Math.random() * 120 | 0; g.fillStyle = `rgba(${v},${v},${v - 4},${0.25 + Math.random() * 0.35})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
    if (lanesM) {          // колея: темнее и глаже в местах, где ездят колёса
      for (const c of lanesM) for (const off of [-0.8, 0.8]) {
        const x = ((c + off) / widthM) * w, gr = g.createLinearGradient(x - 28, 0, x + 28, 0);
        gr.addColorStop(0, 'rgba(20,20,22,0)'); gr.addColorStop(0.5, 'rgba(20,20,22,0.22)'); gr.addColorStop(1, 'rgba(20,20,22,0)');
        g.fillStyle = gr; g.fillRect(x - 28, 0, 56, h);
      }
    }
    for (let i = 0; i < 3; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '25,25,27' : '80,80,82'},0.18)`; g.fillRect(Math.random() * w * 0.8, Math.random() * h * 0.8, 60 + Math.random() * 180, 40 + Math.random() * 140); }   // заплатки
    g.strokeStyle = 'rgba(15,15,16,0.55)'; g.lineWidth = 1.4;
    for (let i = 0; i < 7; i++) { let x = Math.random() * w, y = Math.random() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 12; k++) { x += (Math.random() - 0.5) * 40; y += Math.random() * 22; g.lineTo(x, y); } g.stroke(); }
    for (let i = 0; i < 2; i++) { const x = Math.random() * w, y = Math.random() * h, gr = g.createRadialGradient(x, y, 2, x, y, 30); gr.addColorStop(0, 'rgba(10,10,12,0.35)'); gr.addColorStop(1, 'rgba(10,10,12,0)'); g.fillStyle = gr; g.fillRect(x - 30, y - 30, 60, 60); }   // масляные пятна
  });
  T.ave = asphalt(1024, 1024, [11 / 6, 11 / 2, 55 / 6], 11);          // 3 полосы по 3,67 м
  T.st = asphalt(1024, 1024, [1.75, 5.25, 8.75, 12.25], 14);           // 4 полосы по 3,5 м
  T.asphalt = asphalt(1024, 1024, null, 12);
  T.lane = canvasTex(256, 256, (g, w, h) => speckle(g, w, h, '#57544e', 9000));
  T.zebra = canvasTex(1024, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = '#f2f2ec';
    for (let x = 24; x < w; x += 96) { g.fillRect(x, 4, 52, h - 8); }
    g.globalCompositeOperation = 'destination-out';                     // потёртости
    for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.6})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 3, 2 + Math.random() * 3); }
    g.globalCompositeOperation = 'source-over';
  }, false);
  // тротуарная плитка «кирпичик» с разными оттенками и швами
  T.sidewalk = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#8f897f'; g.fillRect(0, 0, w, h);
    const bw = 64, bh = 32;
    for (let y = 0; y < h; y += bh) for (let x = -((y / bh) % 2) * bw / 2; x < w; x += bw) {
      const v = 172 + Math.random() * 26 | 0, red = Math.random() < 0.12;
      g.fillStyle = red ? `rgb(${v - 10},${v - 52},${v - 62})` : `rgb(${v},${v - 6},${v - 14})`;
      g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; g.fillRect(x + 2 + Math.random() * (bw - 6), y + 2 + Math.random() * (bh - 6), 2, 2); }
    }
  });
  T.granite = canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#b9b8b2'; g.fillRect(0, 0, w, h); for (let i = 0; i < 4000; i++) { const v = Math.random() * 255 | 0; g.fillStyle = `rgba(${v},${v},${v},0.25)`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); } });
  T.manhole = canvasTex(128, 128, (g) => {
    g.fillStyle = '#2b2c2e'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill();
    g.strokeStyle = '#4a4b4e'; g.lineWidth = 6; g.beginPath(); g.arc(64, 64, 56, 0, 7); g.stroke();
    g.lineWidth = 3; for (let r = 14; r < 50; r += 10) { g.beginPath(); g.arc(64, 64, r, 0, 7); g.stroke(); }
    for (let a = 0; a < 8; a++) { g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a * Math.PI / 4) * 50, 64 + Math.sin(a * Math.PI / 4) * 50); g.stroke(); }
  }, false);
  T.grate = canvasTex(128, 64, (g) => { g.fillStyle = '#1d1e20'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#4b4c50'; g.fillRect(0, 0, 128, 6); g.fillRect(0, 58, 128, 6); for (let x = 0; x < 128; x += 12) g.fillRect(x, 0, 5, 64); }, false);
  const arrow = (draw) => canvasTex(128, 512, (g) => { g.clearRect(0, 0, 128, 512); g.fillStyle = '#f2f2ec'; draw(g); }, false);
  const shaft = g => { g.fillRect(56, 150, 16, 362); g.beginPath(); g.moveTo(64, 10); g.lineTo(104, 150); g.lineTo(24, 150); g.closePath(); g.fill(); };
  T.arrowS = arrow(shaft);
  T.arrowSL = arrow(g => { shaft(g); g.fillRect(16, 300, 48, 14); g.beginPath(); g.moveTo(4, 307); g.lineTo(30, 280); g.lineTo(30, 334); g.closePath(); g.fill(); });
  T.arrowSR = arrow(g => { shaft(g); g.fillRect(64, 300, 48, 14); g.beginPath(); g.moveTo(124, 307); g.lineTo(98, 280); g.lineTo(98, 334); g.closePath(); g.fill(); });
  T.zigzag = canvasTex(512, 64, (g) => { g.clearRect(0, 0, 512, 64); g.strokeStyle = '#f2c230'; g.lineWidth = 7; g.beginPath(); for (let x = 0; x <= 512; x += 32) g.lineTo(x, (x / 32) % 2 ? 8 : 56); g.stroke(); });
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
  const panelVar = (wall, frame) => facade((g, w, h) => {
    speckle(g, w, h, wall, 400, 0.05);
    g.fillStyle = '#2f3c48'; g.fillRect(22, 26, 84, 62);
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(22, 26, 30, 62);
    g.fillStyle = frame; g.fillRect(0, 92, w, 10);
    g.strokeStyle = frame; g.lineWidth = 4;
    for (let x = 22; x < 106; x += 14) { g.beginPath(); g.moveTo(x, 92); g.lineTo(x + 7, 128); g.lineTo(x + 14, 92); g.stroke(); }
  });
  T.panelPeach = panelVar('#e8c8a6', '#f4e3cf'); T.panelBlue = panelVar('#c9d8e2', '#eef3f6'); T.panelYellow = panelVar('#ead9a2', '#f6eed2');
  const modern = (wall, accent) => facade((g, w, h) => {
    g.fillStyle = wall; g.fillRect(0, 0, w, h);
    g.fillStyle = '#5d7d94'; g.fillRect(8, 8, 76, 104); g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(8, 8, 76, 30);
    g.fillStyle = accent; g.fillRect(88, 8, 32, 104);
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(0, 112, w, 4);
  });
  T.modernA = modern('#e9e4dc', '#c46b3f'); T.modernB = modern('#d9d6cf', '#4f5a63'); T.modernC = modern('#efe7d4', '#8aa37b');
  T.redBrick = facade((g, w, h) => { g.fillStyle = '#a5523b'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(70,30,20,0.4)'; g.lineWidth = 1; for (let y = 0; y < h; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } g.fillStyle = '#e8e2d4'; g.fillRect(26, 22, 76, 66); g.fillStyle = '#3c4b58'; g.fillRect(30, 26, 68, 58); g.fillStyle = '#e8e2d4'; g.fillRect(62, 26, 4, 58); });
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
  T.hotel = facade((g, w, h) => {      // отель «Узбекистан»: солнцезащитный экран из прямоугольных бетонных панелей
    g.fillStyle = '#f1ede3'; g.fillRect(0, 0, w, h);
    for (const x of [16, 80]) {
      g.fillStyle = '#7a8894'; g.fillRect(x, 16, 32, 94);
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, 16, 5, 94); g.fillRect(x, 16, 32, 5);
    }
    g.fillStyle = '#cfc8b8'; g.fillRect(0, 118, w, 10);
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
  T.ganch = canvasTex(256, 256, (g, w, h) => {      // резной ганч: светлый с геометрическим орнаментом
    g.fillStyle = '#efe8d6'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(150,130,100,0.45)'; g.lineWidth = 3;
    for (let x = 0; x < w; x += 64) for (let y = 0; y < h; y += 64) {
      g.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, r = k % 2 ? 14 : 28; g.lineTo(x + 32 + Math.cos(a) * r, y + 32 + Math.sin(a) * r); } g.closePath(); g.stroke();
      g.strokeRect(x + 4, y + 4, 56, 56);
    }
  });
  T.lattice = canvasTex(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.strokeStyle = '#a9b3bd'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.moveTo(0, 2); g.lineTo(w, 2); g.stroke();
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
    ave: std({ map: T.ave, normalMap: normalFrom(T.ave, 3), roughness: 0.92 }), st: std({ map: T.st, normalMap: normalFrom(T.st, 3), roughness: 0.92 }),
    asphalt: std({ map: T.asphalt, normalMap: normalFrom(T.asphalt, 3), roughness: 0.92 }),
    mark: std({ color: 0xeeeee6, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    yellowMark: std({ map: T.zigzag, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    arrowS: std({ map: T.arrowS, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    arrowSL: std({ map: T.arrowSL, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    arrowSR: std({ map: T.arrowSR, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    manhole: std({ map: T.manhole, transparent: true, metalness: 0.5, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
    grate: std({ map: T.grate, metalness: 0.5, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
    granite: std({ map: T.granite, roughness: 0.75 }),
    wallD: std({ color: 0xbdb8ad, roughness: 0.9, side: THREE.DoubleSide }),
    tunnelLight: std({ color: 0xffffff, emissive: 0xfff1d0, emissiveIntensity: 1.5, side: THREE.DoubleSide }),
    aveMarked: std({ map: (() => { const c = document.createElement('canvas'); c.width = 1024; c.height = 1024; const g = c.getContext('2d'); g.drawImage(T.ave.image, 0, 0, 1024, 1024); g.fillStyle = '#eeeee6'; g.fillRect(16, 0, 14, 1024); g.fillRect(994, 0, 14, 1024); for (const x of [341, 683]) g.fillRect(x - 6, 0, 12, 280); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; })(), roughness: 0.9 }),
    gutter: std({ color: 0x8a8780, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }),
    zebra: std({ map: T.zebra, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    sidewalk: std({ map: T.sidewalk, normalMap: normalFrom(T.sidewalk, 4) }), plaza: std({ map: T.plaza }), grass: std({ map: T.grass, roughness: 1 }),
    dirt: std({ map: T.dirt, roughness: 1 }), lane: std({ map: T.lane }),
    water: std({ map: T.water, roughness: 0.15, metalness: 0.2 }),
    curb: std({ color: 0xd9d6cc }), concrete: std({ color: 0xc9c4b8 }), white: std({ color: 0xf2efe8, roughness: 0.6 }),
    roof: std({ color: 0x77777a }), roofDark: std({ color: 0x55575c }), slate: std({ color: 0x8e9398 }),
    panel: std({ map: T.panel, normalMap: normalFrom(T.panel, 5) }), panel2: std({ map: T.panel2, normalMap: normalFrom(T.panel2, 5) }), brick: std({ map: T.brick, normalMap: normalFrom(T.brick, 4) }), glass: std({ map: T.glass, roughness: 0.25, metalness: 0.4 }),
    panelPeach: std({ map: T.panelPeach, normalMap: normalFrom(T.panelPeach, 5) }), panelBlue: std({ map: T.panelBlue, normalMap: normalFrom(T.panelBlue, 5) }), panelYellow: std({ map: T.panelYellow, normalMap: normalFrom(T.panelYellow, 5) }),
    modernA: std({ map: T.modernA, normalMap: normalFrom(T.modernA, 4), roughness: 0.5 }), modernB: std({ map: T.modernB, normalMap: normalFrom(T.modernB, 4), roughness: 0.5 }), modernC: std({ map: T.modernC, normalMap: normalFrom(T.modernC, 4), roughness: 0.5 }),
    mesh: std({ map: T.lattice, color: 0xc8ccd2, metalness: 0.8, roughness: 0.35 }),
    redBrick: std({ map: T.redBrick, normalMap: normalFrom(T.redBrick, 4) }), crane: std({ color: 0xf2b705, metalness: 0.4, roughness: 0.5 }), fenceBlue: std({ color: 0x2f5fa8, metalness: 0.5, roughness: 0.5 }),
    rug: std({ color: 0xa42a2a }), track: std({ color: 0xb4543c }), court: std({ color: 0x3b7a5a }), rail: std({ color: 0x6b6f75, metalness: 0.7, roughness: 0.4 }),
    office: std({ map: T.office, normalMap: normalFrom(T.office, 5) }), hotel: std({ map: T.hotel, normalMap: normalFrom(T.hotel, 6), roughness: 0.6 }), house: std({ map: T.house, normalMap: normalFrom(T.house, 3) }),
    tiles: std({ map: T.tiles, normalMap: normalFrom(T.tiles, 2), roughness: 0.35 }), ribs: std({ map: T.ribs, roughness: 0.3 }), mbrick: std({ map: T.mbrick, normalMap: normalFrom(T.mbrick, 4) }),
    bronze: std({ color: 0x6b4a2a, metalness: 0.8, roughness: 0.45 }), gold: std({ color: 0xd6a83a, metalness: 1, roughness: 0.3 }),
    steel: std({ color: 0x9aa1a9, metalness: 0.7, roughness: 0.4 }), darkSteel: std({ color: 0x3c4148, metalness: 0.6, roughness: 0.5 }),
    wall: std({ color: 0xcfb58a }), gate: std({ color: 0x2e6b4d, metalness: 0.4 }), gateBlue: std({ color: 0x2a5596, metalness: 0.4 }),
    wood: std({ color: 0x7d5532 }), red: std({ color: 0xc23a2b }), green: std({ color: 0x2e8a4e }),
    lightOn: std({ color: 0xfff3cf, emissive: 0xffe2a0, emissiveIntensity: 0.4 }),
    tlRed: std({ color: 0xff3b2f, emissive: 0xff2010, emissiveIntensity: 1.2 }), tlGreen: std({ color: 0x2bd46a, emissive: 0x20c060, emissiveIntensity: 1.2 }),
    tlBody: std({ color: 0x1e2226 }), seats: std({ color: 0xe8e4dc }), field: std({ map: T.grass }),
    lattice: std({ map: T.lattice, alphaTest: 0.4, transparent: false, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 }),
    shopGlass: std({ color: 0x24313b, metalness: 0.5, roughness: 0.15 }),
    aryk: std({ map: T.water, roughness: 0.2, polygonOffset: true, polygonOffsetFactor: -1 }),
    stopRoof: std({ color: 0x1f56a8, roughness: 0.5 }), stopGlass: std({ color: 0xbcd3df, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2 }),
    stopFrame: std({ color: 0x3a3f46, metalness: 0.7, roughness: 0.35 }), stopBoard: std({ color: 0x0c0c0d }),
  });
  M.signs = [0xc23a2b, 0x2b5ea8, 0x2e8a4e, 0xe0a92e, 0xf2efe8].map(c => std({ color: c, emissive: c, emissiveIntensity: 0.15 }));
  // магазины в стиле korzinka: глянцевый красный фасад, белые объёмные буквы, логотип-тележка
  M.kRed = std({ color: 0xe3172f, roughness: 0.18, metalness: 0.15, emissive: 0xc20f24, emissiveIntensity: 0.35 });
  M.kGlass = std({ color: 0x2a2620, metalness: 0.55, roughness: 0.08, emissive: 0x6a4a22, emissiveIntensity: 0.35 });
  M.kFrame = std({ color: 0x1c1c1e, metalness: 0.6, roughness: 0.4 });
  M.kWall = std({ color: 0xe9e2d6, roughness: 0.8 });
  M.kSign = (() => {
    const t = canvasTex(1024, 256, (g, Wd, H) => {
      const logo = (dx, dy, col) => {
        g.fillStyle = col;
        const bar = (x, y, w) => { const h = 26, r = h / 2; g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2); g.lineTo(x + r, y + h); g.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5); g.fill(); };
        bar(40 + dx, 40 + dy, 80); bar(58 + dx, 80 + dy, 170); bar(68 + dx, 120 + dy, 150); bar(76 + dx, 160 + dy, 130);
        for (const cx of [92, 168]) { g.beginPath(); g.arc(cx + dx, 214 + dy, 15, 0, Math.PI * 2); g.fill(); }
        g.font = "900 168px 'Arial Black', 'Arial', sans-serif"; g.textBaseline = 'alphabetic'; g.fillText('korzinka', 270 + dx, 196 + dy);
      };
      logo(6, 7, 'rgba(110,8,20,0.9)');  // тень от объёмных букв
      logo(3, 4, '#b8b8bc');            // торец букв
      logo(0, 0, '#f4f4f6');
    }, false);
    return std({ map: t, transparent: true, alphaTest: 0.4, roughness: 0.35, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.12 });
  })();
  const label = (w, h, draw) => canvasTex(w, h, draw, false);
  M.bekat = new THREE.MeshBasicMaterial({ map: label(512, 64, g => { g.fillStyle = '#1f56a8'; g.fillRect(0, 0, 512, 64); g.fillStyle = '#fff'; g.font = '600 40px Arial'; g.textBaseline = 'middle'; g.fillText('BEKAT · ОСТАНОВКА', 14, 34); }) });
  M.routes = new THREE.MeshBasicMaterial({ map: label(512, 96, g => { g.fillStyle = '#080808'; g.fillRect(0, 0, 512, 96); g.fillStyle = '#ffb21a'; g.font = 'bold 54px monospace'; g.textBaseline = 'middle'; g.fillText('11  45  67  93', 18, 50); }) });
  M.ad = new THREE.MeshStandardMaterial({ map: label(256, 400, g => {
    const gr = g.createLinearGradient(0, 0, 0, 400); gr.addColorStop(0, '#f6c445'); gr.addColorStop(1, '#e0702a'); g.fillStyle = gr; g.fillRect(0, 0, 256, 400);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(128, 150, 70, 0, 7); g.fill(); g.fillStyle = '#e0702a'; g.beginPath(); g.arc(128, 150, 46, 0, 7); g.fill();
    g.fillStyle = '#1b1b1b'; g.font = 'bold 40px Arial'; g.textAlign = 'center'; g.fillText('NON', 128, 290); g.font = '26px Arial'; g.fillText('issiq · yangi', 128, 330);
  }), emissive: 0xffffff, emissiveIntensity: 0.35 });
  M.ad.emissiveMap = M.ad.map;
  M.busSign = new THREE.MeshStandardMaterial({ map: label(128, 128, g => {
    g.fillStyle = '#1f56a8'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#fff'; g.fillRect(6, 6, 116, 116); g.fillStyle = '#1f56a8'; g.fillRect(12, 12, 104, 104);
    g.fillStyle = '#fff'; g.fillRect(28, 40, 72, 40); g.fillStyle = '#1f56a8'; g.fillRect(34, 46, 26, 14); g.fillRect(66, 46, 28, 14);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(44, 86, 8, 0, 7); g.arc(84, 86, 8, 0, 7); g.fill();
  }) });
  M.metro = new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, g => { g.fillStyle = '#1f4fb4'; g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 92px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('M', 64, 70); }, false), transparent: true, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.1 });
  M.metro.emissiveMap = M.metro.map;
}
const SIG_ON = { r: 0xff3b2f, y: 0xffc21a, g: 0x2bff6a }, SIG_OFF = { r: 0x3a1512, y: 0x3a3112, g: 0x123a1c };
function drawTimer(c, text, color) {
  const g = c.getContext('2d'); g.fillStyle = '#050505'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = color; g.font = 'bold 44px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, c.width / 2, c.height / 2 + 2);
}
function makeSignalMaterials(world) {
  M.signalPole = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.75, roughness: 0.35 });
  M.signalBorder = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 });
  M.sig = {}; M.timer = {}; world.timerCanvas = {}; world.timerKey = {};
  for (const grp of ['NS', 'EW']) {
    M.sig[grp] = {};
    for (const c of ['r', 'y', 'g']) M.sig[grp][c] = new THREE.MeshStandardMaterial({ color: SIG_OFF[c], emissive: SIG_ON[c], emissiveIntensity: 0.02, roughness: 0.3 });
    const cv = document.createElement('canvas'); cv.width = 96; cv.height = 60; world.timerCanvas[grp] = cv;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    M.timer[grp] = new THREE.MeshBasicMaterial({ map: tex });
  }
}
const FLAT = () => [M.aveMarked, M.tunnelLight, M.ave, M.st, M.asphalt, M.sidewalk, M.grass, M.dirt, M.plaza, M.lane, M.water, M.zebra, M.field, M.mark, M.yellowMark, M.arrowS, M.arrowSL, M.arrowSR, M.manhole, M.grate, M.gutter, M.aryk];

export class World {
  constructor(scene) {
    this.scene = scene;
    this.obstacles = new Obstacles();
    this.root = new THREE.Group(); scene.add(this.root);
    this.batches = new Map(); this.carBuckets = new Map();
    this.trees = []; this.lamps = []; this.labels = [];
    makeTextures(); makeMaterials(); makeSignalMaterials(this);
    if (!new.target.lazy) { this.generate(); this.finish(); }     // город строится позже, по частям
  }
  generate() { this.ground(); this.roads(); this.ringAndSquare(); this.canal(); this.cells(); this.mountains(); }

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
  building(x, z, w, d, floors, mat, rot = 0, roof = M.roof, floorH = 3, opts = {}) {
    const h = floors * floorH;
    for (const [ox, oz, len, r] of [[0, d / 2, w, 0], [0, -d / 2, w, Math.PI], [w / 2, 0, d, Math.PI / 2], [-w / 2, 0, d, -Math.PI / 2]]) {
      const g = new THREE.PlaneGeometry(len, h);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(len / 3)), uv.getY(i) * floors);
      g.rotateY(r); g.translate(ox, h / 2, oz); g.rotateY(rot); g.translate(x, 0, z); this.push(mat, g);
    }
    // локальная деталь здания (координаты относительно центра, с учётом поворота)
    const part = (m, g, lx, ly, lz, ry = 0) => { g.rotateY(ry); g.translate(lx, ly, lz); g.rotateY(rot); g.translate(x, 0, z); this.push(m, g); };
    // парапет и крыша
    this.box(roof, x, h, z, w + 0.5, 0.7, d + 0.5, rot);
    if (w * d > 300) {
      part(roof, new THREE.BoxGeometry(5, 2.6, 4), w * 0.2, h + 0.7 + 1.3, 0);                       // машинное отделение лифта
      part(M.concrete, new THREE.BoxGeometry(1.2, 1.4, 1.2), -w * 0.25, h + 0.7 + 0.7, d * 0.2);    // вентшахта
      part(M.steel, new THREE.CylinderGeometry(0.04, 0.04, 3, 4), w * 0.2, h + 4.6, 0);              // антенна
    }
    const living = [M.panel, M.panel2, M.brick, M.office, M.panelPeach, M.panelBlue, M.panelYellow, M.modernA, M.modernB, M.modernC, M.redBrick].includes(mat);
    if (living && floors >= 3) {
      const long = w >= d, L = long ? w : d, D = long ? d : w;
      const side = opts.face !== undefined ? -opts.face : (Math.floor(x * 7 + z * 3) & 1) ? 1 : -1;
      // подъезды с козырьками и дверями
      const n = Math.max(1, Math.floor(L / 18));
      for (let k = 0; k < n; k++) {
        const t = -L / 2 + (k + 0.5) * (L / n);
        const [lx, lz, ry] = long ? [t, side * (D / 2), 0] : [side * (D / 2), t, Math.PI / 2];
        const out = 0.9;
        const ox = long ? 0 : side * out, oz = long ? side * out : 0;
        part(M.concrete, new THREE.BoxGeometry(2.8, 0.18, 1.8), lx + ox, 2.7, lz + oz, ry);
        part(M.darkSteel, new THREE.BoxGeometry(1.4, 2.3, 0.1), lx + (long ? 0 : side * 0.06), 1.15, lz + (long ? side * 0.06 : 0), ry);
        part(M.concrete, new THREE.BoxGeometry(2.8, 0.25, 1.8), lx + ox, 0.12, lz + oz, ry);
      }
      // кондиционеры на фасадах
      const ac = Math.floor(L * floors / 40);
      for (let k = 0; k < ac; k++) {
        const t = rr(-L / 2 + 1, L / 2 - 1), fl = Math.floor(rr(1, floors)), sd = rnd() < 0.5 ? 1 : -1;
        const [lx, lz] = long ? [t, sd * (D / 2 + 0.25)] : [sd * (D / 2 + 0.25), t];
        part(M.white, new THREE.BoxGeometry(long ? 0.8 : 0.4, 0.55, long ? 0.4 : 0.8), lx, fl * floorH + 0.9, lz);
      }
      // магазины на первом этаже: витрины и вывески
      if (opts.shops) this.korzinkaFront(part, long, -side, L, D);
    }
    this.collide(x, z, w, d, rot);
  }

  // фасад магазина korzinka на первом этаже: стекло с тёплым светом, красный козырёк-короб, вывеска, вход
  korzinkaFront(part, long, sd, L, D, SLmax = 32, sign = true) {
    const SL = Math.min(L - 3, SLmax); if (SL < 8) return;
    const ry = long ? (sd > 0 ? 0 : Math.PI) : (sd > 0 ? Math.PI / 2 : -Math.PI / 2);
    const at = (t, n) => (long ? [t, sd * (D / 2 + n)] : [sd * (D / 2 + n), -t * sd]);   // t вдоль фасада, n наружу
    const P = (m, g, t, y, n) => { const [lx, lz] = at(t, n); part(m, g, lx, y, lz, ry); };
    P(M.kGlass, new THREE.BoxGeometry(SL, 3.1, 0.1), 0, 1.55, 0.06);                         // витрина
    for (let t = -SL / 2; t <= SL / 2 + 0.01; t += SL / Math.max(2, Math.round(SL / 2.6))) P(M.kFrame, new THREE.BoxGeometry(0.12, 3.1, 0.16), t, 1.55, 0.1);
    P(M.kFrame, new THREE.BoxGeometry(SL, 0.12, 0.18), 0, 3.06, 0.1);
    P(M.kRed, new THREE.BoxGeometry(SL + 0.8, 1.8, 1.2), 0, 4.0, 0.6);                      // красный короб
    P(M.kRed, new THREE.BoxGeometry(1.4, 3.1, 1.2), SL / 2 - 0.3, 1.55, 0.6);                // красный пилон у края
    const sw = Math.min(SL * 0.62, 13);
    if (sign) {
      const g = new THREE.PlaneGeometry(sw, sw / 4 > 1.6 ? 1.6 : sw / 4); P(M.kSign, g, -SL * 0.08, 4.0, 1.215);
      const a = g.attributes.position, nn = g.attributes.normal; (this.shops = this.shops || []).push({ x: (a.getX(0) + a.getX(3)) / 2, z: (a.getZ(0) + a.getZ(3)) / 2, nx: nn.getX(0), nz: nn.getZ(0) });
    }
    // вход: автоматические двери с козырьком и зелёными стрелками
    const dt = -SL * 0.08;
    P(M.kFrame, new THREE.BoxGeometry(3.2, 2.8, 0.25), dt, 1.4, 0.14);
    P(M.glass, new THREE.BoxGeometry(2.8, 2.5, 0.1), dt, 1.27, 0.28);
    P(M.kFrame, new THREE.BoxGeometry(3.6, 0.35, 0.9), dt, 2.95, 0.5);
    for (const o of [-0.7, 0.7]) P(M.green, new THREE.CylinderGeometry(0.16, 0.16, 0.04, 16).rotateX(Math.PI / 2), dt + o, 1.3, 0.35);
  }

  ground() {
    const far = new THREE.Mesh(new THREE.PlaneGeometry(24000, 24000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xa8956f, roughness: 1 }));
    far.position.y = -9; far.receiveShadow = true; this.root.add(far);
    const R = 2400;
    for (const [x, z, w, d] of [[0, -HALF - R / 2, 2 * HALF + 2 * R, R], [0, HALF + R / 2, 2 * HALF + 2 * R, R], [-HALF - R / 2, 0, R, 2 * HALF], [HALF + R / 2, 0, R, 2 * HALF]])
      this.quad(M.dirt, x, -0.25, z, w, d, 0, w / 40, d / 40);
    const e = HALF - 580 - W.ave / 2 - SW;
    for (const s of [-1, 1]) {
      this.quad(M.dirt, 0, -0.02, s * (HALF - e / 2), 2 * HALF, e, 0, 2 * HALF / 40, e / 40);
      this.quad(M.dirt, s * (HALF - e / 2), -0.02, 0, e, 2 * HALF - 2 * e, 0, e / 40, (2 * HALF - 2 * e) / 40);
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
    const reach = S_FLAT + S_RAMP;
    const seg = (axis, line, c, len, t, za, zb) => {
      const S = STRUCTS.find(S => S.axis === axis && S.line === line && Math.abs(c - S.node) < len / 2 + reach);
      if (!S) return axis === 'v' ? this.segment(line, c, len, t, 'v', za, zb) : this.segment(c, line, len, t, 'h', za, zb);
      const v0 = c - len / 2, v1 = c + len / 2, nearA = Math.abs(v0 - S.node) < reach, nearB = Math.abs(v1 - S.node) < reach;
      if (axis === 'v') this.segment(line, c, len, t, 'v', za && !nearA, zb && !nearB, { noCarriage: true });
      else this.segment(c, line, len, t, 'h', za && !nearA, zb && !nearB, { noCarriage: true });
      for (const [a, b] of [[v0, Math.min(v1, S.node - reach)], [Math.max(v0, S.node + reach), v1]]) if (b - a > 1) {
        if (axis === 'v') this.carriage(line, (a + b) / 2, b - a, t, 'v'); else this.carriage((a + b) / 2, line, b - a, t, 'h');
      }
    };
    run(VLINES, HLINES.map(h => ({ pos: h.z, t: h.t })), L => L.x, (L, c, len, za, zb) => seg('v', L.x, c, len, L.t, za, zb));
    run(HLINES, VLINES.map(v => ({ pos: v.x, t: v.t })), L => L.z, (L, c, len, za, zb) => seg('h', L.z, c, len, L.t, za, zb));
    for (const S of STRUCTS) this.structure(S);
    for (const [axis, line, v] of [['h', 0, 200], ['h', 0, 500], ['v', 0, 380], ['v', 580, -330], ['h', -580, 300]]) this.footbridge(axis, line, v);
    for (const V of VLINES) for (const H of HLINES) {
      if (V.x === 0 && H.z === 0) continue;
      const wx = W[V.t], wz = W[H.t];
      this.quad(M.asphalt, V.x, 0.06, H.z, wx + 2 * SW, wz + 2 * SW, 0, (wx + 2 * SW) / 12, (wz + 2 * SW) / 12);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.quad(M.sidewalk, V.x + sx * (wx / 2 + SW / 2), 0.1, H.z + sz * (wz / 2 + SW / 2), SW, SW, 0, 1.5, 1.5);
      if ((V.x === 0 || H.z === 0) && V.t !== H.t) this.metroSign(V.x + wx / 2 + SW - 1, H.z - wz / 2 - SW + 1);
      for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) this.signal(V.x, H.z, dx, dz, dz ? wx / 2 : wz / 2, dz ? wz / 2 : wx / 2);
    }
  }

  // Отрезок дороги: проезжая часть, разметка, водостоки, бордюры, тротуары, чинары, фонари, остановки, зебры
  // Проезжая часть отрезка: асфальт, разметка, водостоки, разделитель с кустами и фонарями, люки и решётки
  carriage(cx, cz, len, t, dir) {
    if (len <= 1) return;
    const rot = dir === 'v' ? 0 : Math.PI / 2;
    const w = W[t];
    const at = (u, v) => (dir === 'v' ? [cx + u, cz + v] : [cx + v, cz - u]);
    const line = (u, v0, v1, width = 0.15, mat = M.mark) => { const [x, z] = at(u, (v0 + v1) / 2); this.quad(mat, x, 0.062, z, width, v1 - v0, rot); };
    const dashed = (u, from, to, dash = 3, gap = 6) => { for (let v = from; v + dash <= to; v += dash + gap) line(u, v, v + dash); };
    const v0 = -len / 2 + 1, v1 = len / 2 - 1, vd0 = -len / 2 + 9, vd1 = len / 2 - 9;
    if (t === 'ave') {
      for (const sd of [-1, 1]) {
        const [x, z] = at(sd * 7.5, 0); this.quad(M.ave, x, 0.05, z, 11, len, rot + (sd > 0 ? 0 : Math.PI), 1, len / 11);
        line(sd * 2.35, v0, v1); line(sd * 12.6, v0, v1);                                   // края
        dashed(sd * (2 + 11 / 3), vd0, vd1); dashed(sd * (2 + 22 / 3), vd0, vd1);           // между полосами
        const [gx, gz] = at(sd * 12.8, 0); this.quad(M.gutter, gx, 0.058, gz, 0.4, len, rot);
      }
      // разделитель: гранитный бордюр, газон, стриженый кустарник, фонари, деревца
      const [mx, mz] = at(0, 0);
      this.box(M.granite, mx, 0, mz, 4, 0.22, len, rot);
      this.quad(M.grass, mx, 0.23, mz, 3.5, len, rot, 1, len / 6);
      this.obstacles.add({ x: mx, z: mz, h: dir === 'v' ? Math.PI / 2 : 0, hl: len / 2, hw: 2 });
      for (let v = -len / 2 + 15; v < len / 2 - 10; v += 30) { const [lx, lz] = at(0, v); this.lamps.push({ x: lx, z: lz, double: true, rot }); }
      for (let v = -len / 2 + 8; v < len / 2 - 5; v += 15) { const [tx, tz] = at(0, v + 7); this.trees.push({ x: tx, z: tz, s: 0.75, kind: 'thin', noCollide: true }); }
      for (let v = -len / 2 + 4; v < len / 2 - 3; v += 3.2) { const [hx, hz] = at(0, v); (this.shrubs ||= []).push({ x: hx, z: hz, s: rr(0.9, 1.15) }); }
    } else {
      const [x, z] = at(0, 0); this.quad(M.st, x, 0.05, z, w, len, rot, 1, len / 14);
      line(-0.18, v0, v1, 0.13); line(0.18, v0, v1, 0.13);                                 // двойная сплошная
      line(-6.6, v0, v1); line(6.6, v0, v1);
      dashed(-3.5, vd0, vd1); dashed(3.5, vd0, vd1);
      for (const sd of [-1, 1]) { const [gx, gz] = at(sd * 6.8, 0); this.quad(M.gutter, gx, 0.058, gz, 0.4, len, rot); }
    }
    for (let v = -len / 2 + rr(10, 30); v < len / 2 - 10; v += rr(35, 60)) {
      const u = (rnd() < 0.5 ? -1 : 1) * (t === 'ave' ? pick([3.8, 7.5, 11]) : pick([1.75, 5.25]));
      const [x, z] = at(u, v); this.geo(M.manhole, new THREE.CircleGeometry(0.4, 20).rotateX(-Math.PI / 2), x, 0.064, z);
    }
    for (let v = -len / 2 + 12; v < len / 2 - 8; v += 28) for (const sd of [-1, 1]) {
      const [x, z] = at(sd * (w / 2 - 0.35), v); this.quad(M.grate, x, 0.064, z, 0.5, 0.9, rot);
    }
  }

  segment(cx, cz, len, t, dir, zebraA = true, zebraB = true, opts = {}) {
    if (len <= 1) return;
    const rot = dir === 'v' ? 0 : Math.PI / 2;
    const w = W[t];
    const at = (u, v) => (dir === 'v' ? [cx + u, cz + v] : [cx + v, cz - u]);   // u — поперёк, v — вдоль
    if (!opts.noCarriage) this.carriage(cx, cz, len, t, dir);
    // остановка: на проспектах с обеих сторон, на улицах — с одной
    const stopV = 18;
    const stopSides = opts.noCarriage ? [] : t === 'ave' ? (len > 90 ? [-1, 1] : []) : (len > 100 ? [((Math.round(cx + cz) / 10) & 1) ? 1 : -1] : []);
    for (const sd of [-1, 1]) {
      const [x, z] = at(sd * (w / 2 + SW / 2), 0);
      this.quad(M.sidewalk, x, 0.1, z, SW, len, rot, SW / 3.5, len / 3.5);
      const [bx, bz] = at(sd * (w / 2 + 0.15), 0); this.box(M.granite, bx, 0, bz, 0.3, 0.16, len, rot);
      const hasStop = stopSides.includes(sd);
      for (let v = -len / 2 + 6; v < len / 2 - 4; v += 12) {
        if (hasStop && Math.abs(v - sd * stopV) < 7) continue;
        const [tx, tz] = at(sd * (w / 2 + SW - 1.4), v + rr(-1, 1));
        this.trees.push({ x: tx, z: tz, s: rr(0.85, 1.25), kind: 'chinar' });
      }
      if (t === 'st') for (let v = -len / 2 + 18; v < len / 2 - 6; v += 36) { const [lx, lz] = at(sd * (w / 2 + 0.8), v); this.lamps.push({ x: lx, z: lz, side: sd, rot: dir === 'v' ? 0 : -Math.PI / 2 }); }
      const [ax, az] = at(sd * (w / 2 + SW - 0.45), 0); this.quad(M.aryk, ax, 0.1, az, 0.6, len - 2, rot, 1, len / 8);
      if (hasStop) {
        const [sx, sz] = at(sd * (w / 2 + 2.3), sd * stopV);
        this.busStop(sx, sz, dir === 'v' ? (sd > 0 ? -Math.PI / 2 : Math.PI / 2) : (sd > 0 ? 0 : Math.PI));
        const [yx, yz] = at(sd * (w / 2 - 1.2), sd * stopV);                              // жёлтый зигзаг «остановка»
        this.quad(M.yellowMark, yx, 0.066, yz, 20, 1.6, rot + Math.PI / 2, 1, 1);
      }
    }
    for (const [ok, sgn] of [[zebraA, -1], [zebraB, 1]]) {
      if (!ok) continue;
      const [x, z] = at(0, sgn * (len / 2 - 3));
      this.quad(M.zebra, x, 0.068, z, w - 1, 4, rot, 1, 1);
    }
  }

  // ---------- тоннель / эстакада ----------
  structure(S) {
    const reach = S_FLAT + S_RAMP, tunnel = S.D < 0, LAYER = 10 + STRUCTS.indexOf(S);
    const P = (u, v, y) => (S.axis === 'v' ? [S.line + u, y, v] : [v, y, S.line - u]);
    const prof = v => structProfile(S, v);
    const range = (a, b, step = 3) => { const out = []; for (let v = a; v < b; v += step) out.push(v); out.push(b); return out; };
    const all = range(S.node - reach, S.node + reach);
    const outside = [range(S.node - reach, S.node - S_BAND), range(S.node + S_BAND, S.node + reach)];
    const strip = (mat, vs, u0, u1, yf, up = true, uvs2 = 11) => {        // горизонтальная лента поперёк u0..u1
      const pos = [], uv = [], idx = [];
      vs.forEach((v, i) => { pos.push(...P(u0, v, yf(v)), ...P(u1, v, yf(v))); uv.push(0, (v - vs[0]) / uvs2, 1, (v - vs[0]) / uvs2); if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      if ((g.attributes.normal.getY(0) > 0) !== up) { const ix = g.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k]; ix[k] = ix[k + 2]; ix[k + 2] = t; } g.computeVertexNormals(); }
      this.push(mat, g);
    };
    const wall = (mat, vs, u, yb, yt) => {                                 // вертикальная стенка вдоль v
      const pos = [], uv = [], idx = [];
      vs.forEach((v, i) => { pos.push(...P(u, v, yb(v)), ...P(u, v, yt(v))); uv.push((v - vs[0]) / 4, 0, (v - vs[0]) / 4, 1); if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      this.push(M.wallD, g);
    };
    const obb = (u, vc, halfLen, hw, layer) => { const [x, , z] = P(u, vc, 0); this.obstacles.add({ x, z, h: S.axis === 'v' ? Math.PI / 2 : 0, hl: halfLen, hw, layer }); };
    // полотно с разметкой
    for (const sd of [-1, 1]) strip(M.aveMarked, all, sd * 2, sd * 13, v => prof(v) + 0.05);
    if (tunnel) {
      for (const sd of [-1, 1]) { wall(M.wallD, all, sd * 13, v => prof(v), () => 0.3); wall(M.wallD, all, sd * 2, v => prof(v), () => 0.25); }
      for (const vs of outside) { strip(M.grass, vs, -2, 2, () => 0.24); strip(M.concrete, vs, -2.05, -1.95, () => 0.25); }
      // перекрытие под перекрёстком
      const [dx, , dz] = P(0, S.node, 0);
      this.box(M.concrete, dx, -1.2, dz, S.axis === 'v' ? 27 : S_BAND * 2 + 0.4, 1.2, S.axis === 'v' ? S_BAND * 2 + 0.4 : 27);
      // ограждения поверху и свет в тоннеле
      for (const vs of outside) for (const sd of [-1, 1]) {
        wall(M.signalPole, vs, sd * 13.15, () => 0.3, () => 1.25);
        const a = vs[0], b = vs[vs.length - 1]; obb(sd * 13.15, (a + b) / 2, (b - a) / 2, 0.3, 0);
      }
      for (const vs of outside) { const a = vs[0], b = vs[vs.length - 1]; obb(0, (a + b) / 2, (b - a) / 2, 2.1, 0); }
      for (const sd of [-1, 1]) strip(M.tunnelLight, range(S.node - S_FLAT - 30, S.node + S_FLAT + 30), sd * 12.95, sd * 12.9, v => prof(v) + 4.4, true, 4);
    } else {
      strip(M.concrete, all, -2, 2, v => prof(v) + 0.05);
      strip(M.concrete, all, -13.6, 13.6, v => prof(v) - 1.0, false);                // низ пролёта
      for (const sd of [-1, 1]) wall(M.wallD, all, sd * 13.6, v => prof(v) - 1.0, v => prof(v) + 1.1);
      wall(M.wallD, all, 0, v => prof(v), v => prof(v) + 0.9);
      for (const sd of [-1, 1]) wall(M.wallD, all.filter(v => prof(v) < 5), sd * 13.6, () => 0, v => Math.max(0, prof(v) - 1));   // подпорные стенки насыпи
      for (const vs of outside) strip(M.asphalt, vs, -13, 13, () => 0.04);          // земля под мостом
      for (const v of all) if (prof(v) > 4.6 && Math.abs(v - S.node) > S_BAND + 3 && Math.round(v) % 15 < 3) for (const u of [-7.5, 7.5]) {
        const [px, , pz] = P(u, v, 0), h = prof(v) - 1;
        this.geo(M.concrete, new THREE.CylinderGeometry(0.9, 1.05, h, 16), px, h / 2, pz);
        this.box(M.concrete, px, h - 0.8, pz, S.axis === 'v' ? 9 : 2.4, 0.8, S.axis === 'v' ? 2.4 : 9);
        this.obstacles.add({ x: px, z: pz, h: 0, hl: 1.1, hw: 1.1, layer: 0 });
      }
      // насыпь: ниже ~4.5 м под пролётом не проехать
      for (const sg of [-1, 1]) obb(0, S.node + sg * 68, 15, 13.6, 0);
    }
    // стенки и ограждения для того, кто внутри тоннеля / на эстакаде
    for (const u of tunnel ? [-13.1, -1.9, 1.9, 13.1] : [-13.6, 0, 13.6]) obb(u, S.node, reach, 0.3, LAYER);
    const [lx, , lz] = P(0, S.node, 0);
    this.labels.push({ x: lx, z: lz, text: S.name });
  }

  footbridge(axis, line, v) {       // надземный пешеходный переход: лестницы на тротуарах, пролёт с ограждением и крышей
    const t = (axis === 'v' ? VLINES.find(l => l.x === line) : HLINES.find(l => l.z === line)).t, half = W[t] / 2 + SW;
    const P = (u, vv, y) => (axis === 'v' ? [line + u, y, vv] : [vv, y, line - u]);
    const rot = axis === 'v' ? 0 : Math.PI / 2, H = 6;
    const bx = (mat, u, vv, y, su, sy, sv) => { const [x, , z] = P(u, vv, 0); this.box(mat, x, y, z, axis === 'v' ? su : sv, sy, axis === 'v' ? sv : su); };
    bx(M.concrete, 0, v, H, half * 2, 0.45, 2.6);                                   // пролёт
    for (const sd of [-1, 1]) { bx(M.stopGlass, 0, v + sd * 1.25, H + 0.45, half * 2, 1.1, 0.06); bx(M.signalPole, 0, v + sd * 1.25, H + 1.55, half * 2, 0.08, 0.1); }
    bx(M.stopRoof, 0, v, H + 3.1, half * 2 + 0.6, 0.15, 3.2);                        // крыша
    for (const u of [-half + 1, -half / 2, 0, half / 2, half - 1]) for (const sd of [-1, 1]) bx(M.signalPole, u, v + sd * 1.25, H + 0.45, 0.1, 2.65, 0.1);
    for (const sd of [-1, 1]) {                                                      // лестницы вдоль тротуара
      const u = sd * (half - 1.3);
      for (let k = 0; k < 20; k++) bx(M.concrete, u, v + 2 + k * 0.42, 0, 2.2, (k + 1) * (H / 20), 0.42);
      bx(M.signalPole, u + 1.15, v + 6.2, 0, 0.08, H + 1, 8.6);
      const [x, , z] = P(u, v + 6.2, 0); this.obstacles.add({ x, z, h: axis === 'v' ? Math.PI / 2 : 0, hl: 4.4, hw: 1.2, layer: 0 });
      for (const k of [0, 1]) { const [px, , pz] = P(sd * (half - 0.3), v + (k ? 1.3 : -1.3), 0); this.box(M.signalPole, px, 0, pz, 0.35, H, 0.35, 0, true); }
    }
  }

  // Остановка (как новые ташкентские павильоны): каркас, стеклянные стенки, крыша с синим фризом и названием,
  // табло маршрутов, рекламный лайтбокс, скамья со спинкой, урна и знак остановки у бордюра
  busStop(x, z, face) {
    const part = (m, g, lx, ly, lz) => { g.translate(lx, ly, lz); g.rotateY(face); g.translate(x, 0, z); this.push(m, g); };
    const L = 6.4, D = 2.2, H = 2.75;
    part(M.sidewalk, new THREE.BoxGeometry(L + 1.2, 0.12, D + 0.6), 0, 0.12, -0.1);                 // площадка
    for (const sx of [-L / 2, L / 2]) for (const sz of [-D / 2 + 0.1, D / 2 - 0.2]) part(M.stopFrame, new THREE.BoxGeometry(0.12, H, 0.12), sx, H / 2 + 0.18, sz);
    part(M.stopFrame, new THREE.BoxGeometry(0.1, H - 0.3, 0.1), 0, H / 2 + 0.1, -D / 2 + 0.1);
    part(M.white, new THREE.BoxGeometry(L + 0.6, 0.12, D + 0.5), 0, H + 0.24, 0);                    // крыша
    part(M.stopRoof, new THREE.BoxGeometry(L + 0.62, 0.42, 0.08), 0, H + 0.05, D / 2 + 0.25);        // синий фриз спереди
    part(M.stopRoof, new THREE.BoxGeometry(L + 0.62, 0.42, 0.08), 0, H + 0.05, -D / 2 - 0.25);
    part(M.bekat, new THREE.PlaneGeometry(2.6, 0.32), -L / 2 + 1.6, H + 0.05, D / 2 + 0.3);          // название
    part(M.stopBoard, new THREE.BoxGeometry(1.6, 0.36, 0.08), L / 2 - 1.2, H - 0.3, D / 2 - 0.1);    // табло маршрутов
    part(M.routes, new THREE.PlaneGeometry(1.5, 0.28), L / 2 - 1.2, H - 0.3, D / 2 - 0.05);
    part(M.stopGlass, new THREE.BoxGeometry(L, H - 0.6, 0.04), 0, H / 2 + 0.25, -D / 2 + 0.1);       // задняя стенка
    part(M.stopGlass, new THREE.BoxGeometry(0.04, H - 0.6, D - 0.4), L / 2, H / 2 + 0.25, -0.1);     // боковая
    part(M.stopFrame, new THREE.BoxGeometry(L, 0.06, 0.06), 0, H - 0.05, -D / 2 + 0.1);
    part(M.stopFrame, new THREE.BoxGeometry(L, 0.06, 0.06), 0, 0.5, -D / 2 + 0.1);
    part(M.stopFrame, new THREE.BoxGeometry(0.2, H - 0.3, 1.5), -L / 2, H / 2 + 0.1, -0.15);         // лайтбокс
    part(M.ad, new THREE.PlaneGeometry(1.4, 2.2).rotateY(Math.PI / 2), -L / 2 + 0.11, H / 2 + 0.15, -0.15);
    part(M.ad, new THREE.PlaneGeometry(1.4, 2.2).rotateY(-Math.PI / 2), -L / 2 - 0.11, H / 2 + 0.15, -0.15);
    // скамья: сиденье и спинка из реек, металлические ножки
    for (let k = 0; k < 3; k++) part(M.wood, new THREE.BoxGeometry(3.6, 0.05, 0.12), 0.6, 0.58, -D / 2 + 0.38 + k * 0.14);
    for (let k = 0; k < 3; k++) part(M.wood, new THREE.BoxGeometry(3.6, 0.1, 0.04), 0.6, 0.75 + k * 0.14, -D / 2 + 0.24);
    for (const lx of [-1, 0.6, 2.2]) part(M.stopFrame, new THREE.BoxGeometry(0.06, 0.55, 0.45), lx, 0.4, -D / 2 + 0.45);
    part(M.stopFrame, new THREE.CylinderGeometry(0.2, 0.18, 0.75, 12), L / 2 + 0.6, 0.55, D / 2 - 0.3);  // урна
    // знак остановки у бордюра
    part(M.stopFrame, new THREE.CylinderGeometry(0.05, 0.05, 2.8, 6), -L / 2 - 0.8, 1.55, D / 2 + 0.4);
    part(M.busSign, new THREE.PlaneGeometry(0.6, 0.6), -L / 2 - 0.8, 2.75, D / 2 + 0.44);
    part(M.busSign, new THREE.PlaneGeometry(0.6, 0.6).rotateY(Math.PI), -L / 2 - 0.8, 2.75, D / 2 + 0.36);
    this.obstacles.add({ x, z, h: face, hl: L / 2 + 0.3, hw: D / 2 });
  }

  metroSign(x, z) {
    this.geo(M.darkSteel, new THREE.CylinderGeometry(0.08, 0.08, 3.6, 6), x, 1.8, z);
    for (const r of [0, Math.PI / 2]) this.geo(M.metro, new THREE.CircleGeometry(0.6, 24), x, 3.9, z, r);
    this.collide(x, z, 0.3, 0.3);
  }

  // Светофор для подъезда к перекрёстку (cx, cz) с направлением движения (dx, dz).
  // Столб справа перед перекрёстком, консоль над полосами, вторая секция на столбе и табло с отсчётом.
  signal(cx, cz, dx, dz, laneHalf, crossHalf, opts = {}) {
    const group = opts.grp || (dz ? 'NS' : 'EW');
    const rx = -dz, rz = dx;                                   // вправо от направления движения
    const px = cx - dx * (crossHalf + 2) + rx * (laneHalf + 1.2), pz = cz - dz * (crossHalf + 2) + rz * (laneHalf + 1.2);
    const face = Math.atan2(-dx, -dz);                         // лицевая сторона смотрит на подъезжающих
    const arm = laneHalf * 0.85;
    // опора: оцинкованная труба с основанием, консоль с подкосом над полосами
    this.geo(M.signalPole, new THREE.CylinderGeometry(0.16, 0.22, 7.6, 12), px, 3.8, pz);
    this.geo(M.signalPole, new THREE.CylinderGeometry(0.34, 0.4, 0.5, 12), px, 0.25, pz);
    const armRot = Math.atan2(-rx, -rz);
    const ag = new THREE.CylinderGeometry(0.1, 0.13, arm, 10); ag.rotateX(Math.PI / 2); ag.translate(0, 0, arm / 2); ag.rotateY(armRot); ag.translate(px, 7.2, pz); this.push(M.signalPole, ag);
    const br = new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6); br.rotateX(Math.PI / 2); br.translate(0, 0, 1.5); br.rotateX(-0.42); br.rotateY(armRot); br.translate(px, 6.0, pz); this.push(M.signalPole, br);
    this.collide(px, pz, 0.45, 0.45);
    // светофорная секция: корпус, щит со светлой каймой, линзы с козырьками
    const head = (hx, hy, hz, withTimer, scale = 1) => {
      const add = (mat, g, lx, ly, lz) => { g.scale(scale, scale, scale); g.translate(lx * scale, ly * scale, lz * scale); this.geo(mat, g, hx, hy, hz, face); };
      add(M.tlBody, new THREE.BoxGeometry(0.5, 1.5, 0.36), 0, 0, 0);
      add(M.signalBorder, new THREE.BoxGeometry(0.98, 1.98, 0.03), 0, 0, -0.2);
      add(M.tlBody, new THREE.BoxGeometry(0.88, 1.88, 0.04), 0, 0, -0.17);
      [['r', 0.47], ['y', 0], ['g', -0.47]].forEach(([c, ly]) => {
        add(M.tlBody, new THREE.CylinderGeometry(0.2, 0.2, 0.04, 20).rotateX(Math.PI / 2), 0, ly, 0.19);
        add(M.sig[group][c], new THREE.CircleGeometry(0.17, 24), 0, ly, 0.215);
        add(M.tlBody, new THREE.CylinderGeometry(0.21, 0.21, 0.32, 16, 1, true, -Math.PI / 2 - 0.9, Math.PI + 1.8).rotateX(Math.PI / 2), 0, ly + 0.02, 0.37);   // козырёк
      });
      if (withTimer) {
        add(M.tlBody, new THREE.BoxGeometry(0.66, 0.46, 0.14), 0, -1.08, 0.02);
        add(M.timer[group], new THREE.PlaneGeometry(0.6, 0.4), 0, -1.08, 0.095);
      }
    };
    head(px - rx * arm, 6.3, pz - rz * arm, false);              // над левыми полосами
    head(px - rx * arm * 0.45, 6.3, pz - rz * arm * 0.45, false); // над правыми полосами
    head(px + dx * 0.05 - rx * 0.32, 3.6, pz + dz * 0.05 - rz * 0.32, true, 0.9);
    // пешеходный светофор и кнопка вызова на той же опоре, смотрит поперёк
    const pf = face + Math.PI / 2;
    const ped = (mat, g, ly, lz = 0.22) => { g.translate(0, ly, lz); this.geo(mat, g, px, 0, pz, pf); };
    const other = M.sig[group === 'NS' ? 'EW' : 'NS'];
    ped(M.tlBody, new THREE.BoxGeometry(0.4, 0.8, 0.22), 2.1);
    ped(other.r, new THREE.PlaneGeometry(0.28, 0.28), 2.7, 0.335);
    ped(other.g, new THREE.PlaneGeometry(0.28, 0.28), 2.3, 0.335);
    ped(M.crane, new THREE.BoxGeometry(0.14, 0.22, 0.1), 1.1);
    // стоп-линия и стрелки направлений на полосах правой половины дороги
    const inner = laneHalf > 10 ? 2.2 : 0.3, outer = laneHalf - 0.4, mid = (inner + outer) / 2;
    const at = (back, u) => [cx - dx * back + rx * u, cz - dz * back + rz * u];
    const [slx, slz] = at(crossHalf + (opts.stop || 11), mid);
    if (opts.grp) this.quad(M.mark, slx, 0.066 + (opts.y || 0), slz, outer - inner, 0.5, face, 1, 1);
    else this.quad(M.mark, slx, 0.066, slz, dz ? outer - inner : 0.5, dz ? 0.5 : outer - inner, 0, 1, 1);
    const lanes = laneHalf > 10 ? 3 : 2, lw = (outer - inner) / lanes;
    for (let i = 0; i < lanes; i++) {
      const mat = i === 0 ? M.arrowSL : i === lanes - 1 ? M.arrowSR : M.arrowS;
      const [ax, az] = at(crossHalf + (opts.arrow || 19), inner + lw * (i + 0.5));
      this.quad(mat, ax, 0.067 + (opts.y || 0), az, 1.3, 5, face, 1, 1);
    }
  }

  // Фазы: 0–14 с зелёный север–юг, 3 с жёлтый, 1 с всем красный, затем то же для восток–запад
  updateSignals(t) {
    const T = 36, p = t % T;
    const state = q => (q < 14 ? 'g' : q < 17 ? 'y' : 'r');
    for (const [grp, q] of [['NS', p], ['EW', (p + 18) % T]]) {
      const st = state(q);
      for (const c of ['r', 'y', 'g']) {
        const m = M.sig[grp][c], on = c === st;
        m.emissiveIntensity = on ? 2.4 : 0.02;
        m.color.setHex(on ? SIG_ON[c] : SIG_OFF[c]);
      }
      const left = st === 'g' ? Math.ceil(14 - q) : st === 'r' ? Math.ceil(T - q) : 0;
      (this.signalLeft ||= {})[grp] = st === 'y' ? '' : String(left);
      const key = st + left;
      if (this.timerKey[grp] !== key) { this.timerKey[grp] = key; drawTimer(this.timerCanvas[grp], st === 'y' ? '' : String(left).padStart(2, '0'), st === 'g' ? '#3cff7a' : '#ff3b2f'); M.timer[grp].map.needsUpdate = true; }
    }
    this.signalState = { NS: state(p), EW: state((p + 18) % T) };
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

  // Конная статуя Амира Темура (1994): конь на дыбах, правая рука поднята, шлем-корона, плащ; постамент с девизом
  temurStatue(x, z) {
    // постамент: ступени, тёмный полированный гранит, бронзовый пояс, таблички с надписью
    const granite = new THREE.MeshStandardMaterial({ color: 0x3b302c, roughness: 0.35, metalness: 0.1 });
    const red = new THREE.MeshStandardMaterial({ color: 0x8a5a4a, roughness: 0.7 });
    this.geo(M.concrete, new THREE.CylinderGeometry(9.5, 10, 0.5, 48), x, 0.25, z);
    this.box(red, x, 0.5, z, 12, 0.5, 12); this.box(red, x, 1.0, z, 10.5, 0.5, 10.5); this.box(red, x, 1.5, z, 9, 0.5, 9);
    this.box(granite, x, 2.0, z, 5.4, 0.6, 8.6);
    this.box(granite, x, 2.6, z, 4.8, 4.4, 8.0);
    this.box(M.bronze, x, 7.0, z, 5.2, 0.35, 8.4);
    this.box(granite, x, 7.35, z, 5.0, 0.4, 8.2);
    const plaque = canvasTex(512, 160, g => { g.fillStyle = '#2a211e'; g.fillRect(0, 0, 512, 160); g.fillStyle = '#d9b46a'; g.textAlign = 'center'; g.font = '600 34px Georgia, serif'; g.fillText('KUCH — ADOLATDA', 256, 52); g.font = '22px Georgia, serif'; g.fillText('СИЛА — В СПРАВЕДЛИВОСТИ', 256, 92); g.fillText('STRENGTH IS IN JUSTICE', 256, 124); }, false);
    const pm = new THREE.MeshStandardMaterial({ map: plaque, metalness: 0.3, roughness: 0.5 });
    for (const [ox, oz, r] of [[0, 4.01, 0], [0, -4.01, Math.PI], [2.41, 0, Math.PI / 2], [-2.41, 0, -Math.PI / 2]])
      { const g = new THREE.PlaneGeometry(3.6, 1.1); g.rotateY(r); g.translate(x + ox, 4.6, z + oz); this.push(pm, g); }
    // бронзовая скульптура: строим иерархией, потом запекаем в общую пачку
    const B = M.bronze, root = new THREE.Group();
    const mesh = (g, parent, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(g, B); m.position.set(px, py, pz); m.rotation.set(rx, ry, rz); parent.add(m); return m; };
    const grp = (parent, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0) => { const g = new THREE.Group(); g.position.set(px, py, pz); g.rotation.set(rx, ry, rz); parent.add(g); return g; };
    const limb = (parent, len, r0, r1) => { const g = new THREE.CylinderGeometry(r1, r0, len, 12); g.translate(0, -len / 2, 0); return mesh(g, parent); };
    // конь: локально x — вперёд, y — вверх. Опора — задние копыта, корпус поднят на ~28°
    const horse = grp(root, 0, 0, 0);
    const hip = grp(horse, -1.0, 2.15, 0, 0, 0, 0.5);               // поворот всего корпуса вокруг крупа
    mesh(new THREE.SphereGeometry(1, 28, 18).scale(1.75, 0.85, 0.72), hip, 1.15, 0, 0);       // туловище
    mesh(new THREE.SphereGeometry(1, 24, 16).scale(0.85, 0.9, 0.74), hip, 0, 0.05, 0);        // круп
    mesh(new THREE.SphereGeometry(1, 24, 16).scale(0.8, 0.9, 0.7), hip, 2.35, 0.1, 0);        // грудь
    const neck = grp(hip, 2.7, 0.55, 0, 0, 0, 0.75);
    mesh(new THREE.CylinderGeometry(0.42, 0.62, 1.7, 16).translate(0, 0.85, 0), neck);
    for (let k = 0; k < 7; k++) mesh(new THREE.BoxGeometry(0.12, 0.34, 0.08), neck, -0.4, 0.2 + k * 0.22, 0, 0, 0, 0.3);   // грива
    const head = grp(neck, 0.05, 1.75, 0, 0, 0, -1.55);
    mesh(new THREE.CylinderGeometry(0.2, 0.36, 1.15, 14).translate(0, 0.55, 0), head);
    mesh(new THREE.SphereGeometry(0.24, 14, 10), head, 0, 1.12, 0.0);
    for (const sd of [-1, 1]) mesh(new THREE.ConeGeometry(0.08, 0.32, 6), head, -0.12, -0.05, sd * 0.16, 0, 0, 0.5);       // уши
    // задние ноги (опора) — компенсируем наклон корпуса
    for (const sd of [-1, 1]) {
      const th = grp(hip, -0.25, -0.15, sd * 0.42, 0, 0, -0.5 + (sd > 0 ? 0.1 : -0.25));
      limb(th, 1.1, 0.34, 0.22);
      const sh = grp(th, 0, -1.1, 0, 0, 0, 0.55); limb(sh, 1.05, 0.15, 0.11);
      mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.2, 10), sh, 0, -1.12, 0);
    }
    // передние ноги подняты и согнуты
    for (const sd of [-1, 1]) {
      const up = grp(hip, 2.3, -0.35, sd * 0.38, 0, 0, sd > 0 ? 0.9 : 0.4);
      limb(up, 0.95, 0.24, 0.15);
      const lo = grp(up, 0, -0.95, 0, 0, 0, sd > 0 ? -1.7 : -1.2); limb(lo, 0.9, 0.12, 0.1);
      mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.18, 10), lo, 0, -0.95, 0);
    }
    const tail = grp(hip, -0.75, 0.25, 0, 0, 0, 2.3);
    mesh(new THREE.CylinderGeometry(0.08, 0.26, 1.7, 10).translate(0, 0.85, 0), tail);
    // седло и попона
    mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.6, 20, 1, true, -Math.PI / 2 - 0.9, 1.8).rotateX(Math.PI / 2), hip, 1.0, 0.25, 0);
    // всадник
    const rider = grp(hip, 1.05, 0.85, 0, 0, 0, -0.42);               // держит корпус почти вертикально
    mesh(new THREE.CapsuleGeometry(0.42, 0.95, 6, 14), rider, 0, 0.75, 0);                   // торс в доспехе
    mesh(new THREE.TorusGeometry(0.44, 0.08, 8, 20).rotateX(Math.PI / 2), rider, 0, 0.35, 0); // пояс
    mesh(new THREE.SphereGeometry(0.27, 16, 12), rider, 0.02, 1.62, 0);                     // голова
    mesh(new THREE.SphereGeometry(0.2, 12, 8).scale(1, 1.1, 1), rider, 0.12, 1.5, 0);        // борода
    mesh(new THREE.CylinderGeometry(0.3, 0.31, 0.22, 16), rider, 0, 1.86, 0);               // шлем-корона
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; mesh(new THREE.ConeGeometry(0.06, 0.22, 4), rider, Math.cos(a) * 0.28, 2.05, Math.sin(a) * 0.28); }
    mesh(new THREE.ConeGeometry(0.16, 0.55, 12), rider, 0, 2.25, 0);
    // плащ за спиной, развевается
    mesh(new THREE.CylinderGeometry(0.5, 1.05, 1.9, 18, 1, true, Math.PI * 0.55, Math.PI * 0.9), rider, -0.1, 0.55, 0, 0, 0, 0.35);
    // правая рука поднята (ладонь вперёд), левая держит поводья
    const ra = grp(rider, 0.05, 1.25, 0.5, -0.25, 0, 2.5); limb(ra, 0.75, 0.13, 0.11);
    const rf = grp(ra, 0, -0.75, 0, 0, 0, -0.35); limb(rf, 0.65, 0.1, 0.08);
    mesh(new THREE.BoxGeometry(0.06, 0.24, 0.16), rf, 0, -0.75, 0);
    const la = grp(rider, 0.05, 1.2, -0.5, 0.2, 0, 0.5); limb(la, 0.7, 0.13, 0.11);
    const lf = grp(la, 0, -0.7, 0, 0, 0, 1.0); limb(lf, 0.6, 0.1, 0.08);
    // ноги всадника по бокам коня
    for (const sd of [-1, 1]) { const th = grp(rider, 0.1, 0.1, sd * 0.45, sd * 0.35, 0, 1.25); limb(th, 0.85, 0.17, 0.13); const sh = grp(th, 0, -0.85, 0, 0, 0, -1.4); limb(sh, 0.75, 0.12, 0.1); mesh(new THREE.BoxGeometry(0.34, 0.14, 0.14), sh, 0.1, -0.8, 0); }
    root.position.set(x - 0.4, 7.75, z - 1.6); root.rotation.y = -Math.PI / 2;    // смотрит на юг, по проспекту
    root.scale.setScalar(1.7);
    root.updateMatrixWorld(true);
    root.traverse(o => { if (o.isMesh) { const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); g.applyMatrix4(o.matrixWorld); this.push(B, g); } });
    this.obstacles.add({ x, z, h: 0, hl: 10, hw: 10 });
  }

  // Ташкентские куранты: две одинаковые башни (1947 и копия 2009) с аркой между ними
  chimes(cx, cz, rot) {
    const cream = this.creamMat || (this.creamMat = new THREE.MeshStandardMaterial({ map: T.ganch, normalMap: normalFrom(T.ganch, 4), roughness: 0.8 }));
    const part = (m, g, lx, ly, lz, ry = 0) => { g.rotateY(ry); g.translate(lx, ly, lz); g.rotateY(rot); g.translate(cx, 0, cz); this.push(m, g); };
    const clock = this.clockMat || (this.clockMat = new THREE.MeshStandardMaterial({ map: canvasTex(256, 256, g => {
      g.fillStyle = '#f6f1e2'; g.beginPath(); g.arc(128, 128, 122, 0, 7); g.fill();
      g.strokeStyle = '#b8902f'; g.lineWidth = 10; g.stroke(); g.fillStyle = '#1d1d1d'; g.font = 'bold 22px Georgia'; g.textAlign = 'center'; g.textBaseline = 'middle';
      ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'].forEach((n, i) => { const a = i * Math.PI / 6 - Math.PI / 2; g.fillText(n, 128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92); });
      g.strokeStyle = '#1d1d1d'; g.lineWidth = 7; g.beginPath(); g.moveTo(128, 128); g.lineTo(128, 52); g.stroke(); g.lineWidth = 5; g.beginPath(); g.moveTo(128, 128); g.lineTo(178, 150); g.stroke();
    }, false), roughness: 0.4 }));
    const archShape = (w, h) => { const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(-w / 2, h - w / 2); sh.quadraticCurveTo(-w / 2, h, 0, h + w * 0.15); sh.quadraticCurveTo(w / 2, h, w / 2, h - w / 2); sh.lineTo(w / 2, 0); sh.closePath(); return sh; };
    const dark = M.darkSteel;
    for (const sd of [-1, 1]) {
      const tx = sd * 14;
      part(cream, new THREE.BoxGeometry(8, 9, 8), tx, 4.5, 0);                         // основание
      part(cream, new THREE.BoxGeometry(8.6, 0.6, 8.6), tx, 9.2, 0);
      part(cream, new THREE.BoxGeometry(6.2, 13, 6.2), tx, 16, 0);                     // ствол башни
      part(cream, new THREE.BoxGeometry(7.2, 6, 7.2), tx, 25.5, 0);                    // часовой ярус
      part(cream, new THREE.BoxGeometry(7.8, 0.7, 7.8), tx, 28.8, 0);                  // карниз
      for (let k = 0; k < 4; k++) {
        const r = k * Math.PI / 2, ox = Math.sin(r), oz = Math.cos(r);
        part(dark, new THREE.ShapeGeometry(archShape(3, 5.5)), tx + ox * 4.02, 0.6, oz * 4.02, r);        // арочный вход
        part(dark, new THREE.ShapeGeometry(archShape(1.4, 8.5)), tx + ox * 3.12, 11.2, oz * 3.12, r);     // высокие ниши
        part(clock, new THREE.CircleGeometry(2.3, 40), tx + ox * 3.62, 25.5, oz * 3.62, r);             // циферблаты
        part(M.gold, new THREE.TorusGeometry(2.35, 0.12, 8, 40), tx + ox * 3.63, 25.5, oz * 3.63, r);
      }
      // ажурная беседка-фонарь с арками на столбиках
      for (const [px, pz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) part(cream, new THREE.BoxGeometry(0.9, 4.5, 0.9), tx + px, 31.4, pz);
      part(cream, new THREE.BoxGeometry(6.6, 1, 6.6), tx, 34.1, 0);
      part(M.tiles, uvs(new THREE.SphereGeometry(3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), 6, 2), tx, 34.6, 0);   // купол
      part(M.gold, new THREE.CylinderGeometry(0.05, 0.25, 3.2, 8), tx, 38.8, 0);
      part(M.gold, new THREE.SphereGeometry(0.35, 12, 8), tx, 37.4, 0);
      this.obstacles.add({ x: cx + Math.cos(rot) * tx, z: cz - Math.sin(rot) * tx, h: rot, hl: 4.2, hw: 4.2 });
    }
    // арка-проход между башнями
    part(cream, new THREE.BoxGeometry(20, 2, 4), 0, 8, 0);
    part(M.tiles, new THREE.BoxGeometry(20.2, 0.5, 4.2), 0, 7.7, 0);
    this.labels.push({ x: cx, z: cz, text: 'Куранты' });
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
      '1,6': 'stadium', '6,6': 'boburPark', '7,6': 'autodrom', '5,5': 'ecopark', '8,4': 'gas',
      '1,2': 'tcBoulevard', '2,1': 'tcCongress', '1,1': 'tcMall', '2,6': 'navoiPark', '4,1': 'japaneseGarden', '3,4': 'gafurGulom', '3,5': 'ankhorPark', '8,1': 'botanical', '7,2': 'megaPlanet', '1,5': 'samarqandDarvoza',
      '4,5': 'navoiTheatre', '1,3': 'circus', '6,0': 'shahidlar', '7,1': 'humoArena', '6,7': 'railway', '5,6': 'magicCity',
    };
    const pools = {
      old: ['mahalla', 'mahalla', 'mosqueBlock', 'choyxona', 'mahalla', 'school'],
      chil: ['chilanzar', 'courtyard', 'school', 'garages', 'supermarket', 'sportPark', 'construction', 'mosqueBlock', 'chilanzar'],
      yun: ['yunusabad', 'modernTowers', 'school', 'supermarket', 'sportPark', 'construction', 'hospital', 'yunusabad'],
      outer: ['chilanzar', 'yunusabad', 'modernTowers', 'courtyard', 'school', 'garages', 'sportPark', 'supermarket', 'choyxona'],
      center: ['center', 'courtyard', 'modernTowers', 'officeGlass', 'school', 'supermarket', 'construction', 'choyxona', 'hospital', 'center'],
    };
    const grid = {};
    for (let i = 0; i < XS.length - 1; i++) for (let j = 0; j < ZS.length - 1; j++) {
      const r = this.cellRect(i, j);
      let type = special[`${i},${j}`];
      if (!type) {
        const pool = r.cx < -290 && r.cz < 150 ? pools.old : r.cx < -110 && r.cz >= 150 ? pools.chil : r.cx > 270 && r.cz < -150 ? pools.yun : (r.cz < -290 || r.cz > 290) ? pools.outer : pools.center;
        const near = [grid[`${i - 1},${j}`], grid[`${i},${j - 1}`], grid[`${i - 1},${j - 1}`], grid[`${i + 1},${j - 1}`]];
        const options = pool.filter(t => !near.includes(t));
        type = pick(options.length ? options : pool);
      }
      grid[`${i},${j}`] = type;
      r.type = type;
      this.groundFor(r, type);
      this[type](r);
    }
  }

  groundFor(r, type) {
    const mat = { tcBoulevard: M.plaza, tcCongress: M.plaza, tcMall: M.asphalt, megaPlanet: M.asphalt, samarqandDarvoza: M.asphalt, mahalla: M.dirt, mosqueBlock: M.dirt, choyxona: M.dirt, autodrom: M.asphalt, gas: M.asphalt, supermarket: M.asphalt, railway: M.plaza, navoiTheatre: M.plaza, circus: M.plaza, humoArena: M.plaza, construction: M.dirt, garages: M.dirt, chorsu: M.plaza, khastImam: M.plaza, kukeldash: M.plaza, sayilgoh: M.plaza, tashkentCity: M.plaza, forums: M.plaza, hotel: M.plaza }[type] || M.grass;
    if (Math.abs(r.cx) < 140 && Math.abs(r.cz) < 160) {      // кварталы у кольца: контур квартала с дугой по краю тротуара кольца
      const R = RING_OUT + SW;
      const ix = Math.abs(r.x0) < Math.abs(r.x1) ? r.x0 : r.x1, ox = ix === r.x0 ? r.x1 : r.x0;
      const iz = Math.abs(r.z0) < Math.abs(r.z1) ? r.z0 : r.z1, oz = iz === r.z0 ? r.z1 : r.z0;
      const A = [ix, Math.sign(iz) * Math.sqrt(R * R - ix * ix)], B2 = [Math.sign(ix) * Math.sqrt(R * R - iz * iz), iz];
      const pts = [A, [ix, oz], [ox, oz], [ox, iz], B2];
      const a0 = Math.atan2(B2[1], B2[0]), a1 = Math.atan2(A[1], A[0]);
      let da = a1 - a0; if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
      for (let k = 1; k < 24; k++) { const an = a0 + (da * k) / 24; pts.push([Math.cos(an) * R, Math.sin(an) * R]); }
      this.flatPoly(mat, pts, 0.08, 12);
    } else this.quad(mat, r.cx, 0.08, r.cz, r.w, r.d, 0, r.w / 12, r.d / 12);
  }

  // Плоский многоугольник на земле (точки [x, z]); UV в метрах / uvScale
  flatPoly(mat, pts, y, uvScale) {
    const v2 = pts.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(v2, []);
    const pos = [], uv = [];
    for (const t of tris) {
      let [a, b, c] = t; const A = pts[a], B = pts[b], C = pts[c];
      if ((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]) > 0) [b, c] = [c, b];   // нормаль вверх
      for (const k of [a, b, c]) { pos.push(pts[k][0], y, pts[k][1]); uv.push(pts[k][0] / uvScale, pts[k][1] / uvScale); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
    this.push(mat, g);
  }

  inRing(x, z, pad = 0) { return Math.hypot(x, z) < RING_OUT + SW + pad; }

  // ---- жилые кварталы ----
  center(r) {
    const mats = [M.brick, M.office, M.panel2, M.panelPeach, M.redBrick, M.panelYellow];
    for (const [x, z, len, dep, rot] of [[r.cx, r.z0 + 9, r.w - 24, 12, 0], [r.cx, r.z1 - 9, r.w - 24, 12, 0], [r.x0 + 9, r.cz, r.d - 44, 12, 1], [r.x1 - 9, r.cz, r.d - 44, 12, 1]]) {
      let pos = -len / 2;
      while (pos < len / 2 - 15) {
        const bl = Math.min(rr(24, 46), len / 2 - pos), off = pos + bl / 2;
        const bx = rot ? x : x + off, bz = rot ? z + off : z;
        if (!this.inRing(bx, bz, 30)) this.building(bx, bz, rot ? dep : bl, rot ? bl : dep, Math.floor(rr(4, 7)), pick(mats), 0, M.roof, 3, { shops: true });
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
        this.building(bx, z, bl, 12, pick([4, 5, 9, 9]), pick([M.panel, M.panel2, M.panelPeach, M.panelBlue, M.panelYellow]));
      }
    }
    this.yardTrees(r, 22);
    this.playground(r.cx + rr(-10, 10), r.cz + rr(-4, 4));
    this.parkedRow(r);
  }

  yunusabad(r) {
    for (const [fx, fz] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const x = r.x0 + r.w * fx, z = r.z0 + r.d * fz;
      if (rnd() < 0.55) this.building(x, z, 20, 20, pick([12, 16, 16, 20]), pick([M.panel2, M.panel, M.office, M.panelBlue, M.modernB]));
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
    const pool = CARS.flatMap(c => Array(c.parked || 1).fill(c));       // Matiz и Nexia встречаются чаще всего
    const spec = pick(pool);
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
    this.geo(M.gold, new THREE.CylinderGeometry(0.15, 0.4, 3, 8), x, 35, z);
    for (let a = 0; a < 16; a++) {   // высокие арочные окна между колоннами
      const ang = (a / 16) * Math.PI * 2 + 0.1;
      const g = new THREE.PlaneGeometry(2.4, 10); g.translate(0, 7, 0); g.rotateY(-ang + Math.PI / 2); g.translate(x + Math.cos(ang) * 19.05, 0, z + Math.sin(ang) * 19.05); this.push(M.shopGlass, g);
    }
    this.geo(M.tiles, uvs(new THREE.CylinderGeometry(19.3, 19.3, 1.2, 48, 1, true), 24, 1), x, 15.6, z);   // майоликовый пояс
    this.box(M.white, x + 20, 0, z + 6, 8, 12, 14);                              // портик входа
    this.collide(x, z, 38, 38);
    this.labels.push({ x, z, text: 'Музей Темуридов' });
    this.chimes(r.x0 + 12, r.z1 - 40, Math.PI / 2);
    this.yardTrees(r, 10);
  }

  hotel() {         // отель «Узбекистан» (1974): плавно изогнутый 17-этажный корпус с экраном, стилобат, козырёк
    const R = 122;
    for (let k = 0; k < 9; k++) {
      const th = -1.08 + k * 0.071;
      this.building(Math.cos(th) * R, Math.sin(th) * R, 8.9, 17, 17, M.hotel, -th - Math.PI / 2, M.roofDark);
    }
    for (let k = 0; k < 9; k++) {      // стилобат: два этажа стекла, шире корпуса
      const th = -1.08 + k * 0.071, rr2 = R - 6;
      this.box(M.office, Math.cos(th) * rr2, 0, Math.sin(th) * rr2, 9, 6.5, 12, -th - Math.PI / 2, true);
      this.box(M.white, Math.cos(th) * rr2, 6.5, Math.sin(th) * rr2, 9.2, 0.6, 12.4, -th - Math.PI / 2);
    }
    const th0 = -0.79;
    this.box(M.white, Math.cos(th0) * (R - 15), 4, Math.sin(th0) * (R - 15), 14, 0.5, 7, -th0 - Math.PI / 2);   // козырёк входа
    for (const s2 of [-1, 1]) this.box(M.white, Math.cos(th0 + s2 * 0.045) * (R - 17.5), 0, Math.sin(th0 + s2 * 0.045) * (R - 17.5), 0.5, 4, 0.5, 0, true);
    this.sign(Math.cos(th0) * (R - 8.7), 53.5, Math.sin(th0) * (R - 8.7), 'UZBEKISTAN', '#1f2a33', 22, Math.atan2(-Math.cos(th0), -Math.sin(th0)));
    this.labels.push({ x: 86, z: -86, text: 'Отель «Узбекистан»' });
  }

  // Аисты (символ Мустакиллик и Дворца форумов)
  stork(x, y, z, rot, mat, k = 1) {
    const part = (g, lx, ly, lz, rx = 0, rz = 0) => { g.scale(k, k, k); g.rotateX(rx); g.rotateZ(rz); g.translate(lx * k, ly * k, lz * k); g.rotateY(rot); g.translate(x, y, z); this.push(mat, g); };
    part(new THREE.SphereGeometry(0.55, 14, 10).scale(1.6, 0.8, 0.8), 0, 0, 0);
    part(new THREE.CylinderGeometry(0.1, 0.16, 1.4, 8), 0.95, 0.6, 0, 0, -0.6);
    part(new THREE.SphereGeometry(0.2, 10, 8), 1.35, 1.25, 0);
    part(new THREE.ConeGeometry(0.07, 0.8, 6), 1.75, 1.2, 0, 0, -Math.PI / 2 - 0.2);
    for (const s2 of [-1, 1]) part(new THREE.BoxGeometry(1.5, 0.06, 1.6), -0.1, 0.55, s2 * 0.95, s2 * 0.5, 0);   // поднятые крылья
    part(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 5), -0.1, -0.85, 0.15);
    part(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 5), 0.1, -0.85, -0.15);
  }

  forums(r) {       // Дворец форумов (2009): колоннада по периметру, купол высотой 48 м, на вершине гнездо с тремя аистами
    const x = r.x1 - 42, z = r.z1 - 40;
    const W2 = 62, D2 = 48, H = 22;
    this.box(M.white, x, 0, z, W2 + 10, 1.6, D2 + 10);                         // стилобат и ступени
    this.box(M.white, x, 0, z + D2 / 2 + 6, W2 * 0.6, 0.8, 4);
    this.box(M.shopGlass, x, 1.6, z, W2 - 6, H - 2, D2 - 6, 0, true);          // стеклянные стены за колоннами
    const col = (cx, cz) => {
      this.geo(M.white, new THREE.CylinderGeometry(0.75, 0.85, H - 2.4, 16), cx, 1.6 + (H - 2.4) / 2, cz);
      this.geo(M.white, new THREE.BoxGeometry(2, 0.6, 2), cx, H - 0.5, cz);    // капитель
      this.geo(M.white, new THREE.BoxGeometry(1.8, 0.5, 1.8), cx, 1.85, cz);   // база
    };
    for (let k = 0; k <= 15; k++) for (const s2 of [-1, 1]) col(x - W2 / 2 + k * (W2 / 15), z + s2 * D2 / 2);
    for (let k = 1; k < 11; k++) for (const s2 of [-1, 1]) col(x + s2 * W2 / 2, z - D2 / 2 + k * (D2 / 11));
    this.box(M.white, x, H, z, W2 + 4, 2.2, D2 + 4);                           // антаблемент
    this.box(M.tiles, x, H + 2.2, z, W2 + 3, 0.5, D2 + 3);
    this.geo(M.white, new THREE.CylinderGeometry(19, 20, 5, 48), x, H + 5, z);  // барабан
    this.geo(M.tiles, uvs(new THREE.SphereGeometry(19, 48, 18, 0, Math.PI * 2, 0, Math.PI / 2), 16, 4), x, H + 7.5, z, 0, 1, 0.95, 1);
    this.geo(M.gold, new THREE.CylinderGeometry(1.8, 2.4, 1.2, 16), x, 48.2, z);
    for (let k = 0; k < 3; k++) this.stork(x + Math.cos(k * 2.1) * 1.2, 50.2, z + Math.sin(k * 2.1) * 1.2, k * 2.1, M.gold, 1.2);
    this.collide(x, z, W2 + 6, D2 + 6);
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
    this.box(M.tiles, ax, 17.8, az, 4.1, 0.7, 70.2);                             // орнаментальный пояс
    for (let k = 0; k < 16; k++) this.box(M.white, ax, 16.4, az - 33 + k * 4.4, 2.2, 0.6, 2.2);   // капители
    for (let k = 0; k < 4; k++) this.stork(ax, 21.6, az - 24 + k * 16, Math.PI / 2 + (k % 2 ? 0.4 : -0.4), M.white, 1.5);
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
    this.independenceMonument(r.cx, r.z0 + 12);
    this.yardTrees(r, 14);
  }

  // ---------- Tashkent City ----------
  tashkentCity(r) {  // башни: NEST ONE (51 эт.), Hilton (21 эт.), JW Marriott, Ritz-Carlton (136 м, стальной экзоскелет)
    const xa = r.x0 + 18, xb = r.x1 - 18, za = r.z0 + 26, zb = r.z1 - 30;
    // NEST ONE: стеклянная башня со ступенчатым верхом и шпилем
    this.building(xa, zb, 24, 24, 44, M.glass, 0, M.roofDark, 3.6);
    this.building(xa, zb, 18, 18, 51, M.glass, 0, M.roofDark, 3.6);
    this.geo(M.steel, new THREE.CylinderGeometry(0.3, 0.7, 26, 8), xa, 51 * 3.6 + 13, zb);
    this.sign(xa, 51 * 3.6 - 6, zb + 9.1, 'NEST ONE', '#13202c', 12);
    // Hilton: 21 этаж, нижние этажи в алюминиевой сетке
    this.building(xa, za, 26, 18, 21, M.glass, 0, M.roofDark, 3.8);
    this.box(M.mesh, xa, 0, za, 27, 12, 19, 0, false);
    this.sign(xa, 21 * 3.8 - 4, za + 9.2, 'HILTON', '#1b2a44', 11);
    // JW Marriott
    this.building(xb, za + 4, 22, 22, 33, M.modernB, 0, M.roofDark, 3.6);
    this.sign(xb, 33 * 3.6 - 5, za + 15.2, 'JW MARRIOTT', '#3a2a1e', 13);
    // Ritz-Carlton: стальной решётчатый экзоскелет поверх стекла
    const rx = xb, rz = zb, H = 136;
    this.geo(M.glass, new THREE.BoxGeometry(20, H, 20), rx, H / 2, rz);
    for (let y = 0; y < H; y += 8) for (const [ox, oz, sx, sz] of [[0, 10.3, 20.8, 0.5], [0, -10.3, 20.8, 0.5], [10.3, 0, 0.5, 20.8], [-10.3, 0, 0.5, 20.8]]) this.box(M.darkSteel, rx + ox, y, rz + oz, sx, 0.6, sz);
    for (const k of [-10.3, -3.4, 3.4, 10.3]) for (const sd of [-10.3, 10.3]) { this.box(M.darkSteel, rx + k, 0, rz + sd, 0.6, H, 0.6); this.box(M.darkSteel, rx + sd, 0, rz + k, 0.6, H, 0.6); }
    this.collide(rx, rz, 21, 21);
    this.sign(rx, H - 8, rz + 10.9, 'RITZ-CARLTON', '#1a1a1a', 13);
    this.labels.push({ x: r.cx, z: r.cz, text: 'Tashkent City' });
  }

  tcCongress(r) {    // Конгресс-холл в сетке, крытый мост через улицу к Hilton
    const x = r.x0 + 18, z = r.z1 - 26;
    this.box(M.mesh, x, 0, z, 30, 18, 40, 0, true);
    this.box(M.shopGlass, x + 15.05, 0.5, z, 0.1, 10, 30);
    this.sign(x + 15.2, 15, z, 'CONGRESS HALL', '#1b2a44', 14, Math.PI / 2);
    // мост на уровне 3 этажа через улицу z = -290 до Hilton
    const zh = HLINES.find(h => h.z === -290).z, z1 = z + 20, z2 = zh + W.st / 2 + SW + 26 - 9;   // до северного фасада Hilton
    this.box(M.shopGlass, x, 9, (z1 + z2) / 2, 5, 4, z2 - z1);
    this.box(M.mesh, x, 13, (z1 + z2) / 2, 5.4, 0.5, z2 - z1 + 0.4);
    this.yardTrees(r, 10);
    this.fountain(r.x1 - 18, r.cz, 4);
  }

  tcBoulevard(r) {   // бульвар: девять семиэтажных домов, между ними пешеходный променад с фонтанами
    const cz = r.cz, n = 5, step = (r.w - 10) / n;
    for (let k = 0; k < n; k++) {
      const x = r.x0 + 5 + step * (k + 0.5);
      this.building(x, cz - 24, step - 4, 16, 7, pick([M.modernA, M.modernC]), 0, M.roofDark, 3.4, { shops: true });
      if (k < 4) this.building(x + step / 2, cz + 24, step - 4, 16, 7, pick([M.modernA, M.modernC]), 0, M.roofDark, 3.4, { shops: true });
    }
    this.quad(M.plaza, r.cx, 0.11, cz, r.w - 6, 30, 0, 10, 3);
    for (let k = 0; k < 4; k++) this.fountain(r.x0 + 18 + k * ((r.w - 36) / 3), cz, 2.6);
    for (let k = 0; k < 10; k++) { this.trees.push({ x: r.x0 + 10 + k * (r.w - 20) / 9, z: cz - 11, s: 0.9, kind: 'chinar' }); this.trees.push({ x: r.x0 + 10 + k * (r.w - 20) / 9, z: cz + 11, s: 0.9, kind: 'chinar' }); }
    this.sign(r.x0 + 4, 5, cz, 'BOULEVARD', '#2a2a2a', 10, -Math.PI / 2);
    this.labels.push({ x: r.cx, z: cz, text: 'Boulevard' });
  }

  mall(r, name, color, x = r.cx, z = r.cz - 10, w = 90, d = 56) {   // торговый центр: стеклянный атриум, вывеска, парковка
    this.box(M.white, x, 0, z, w, 16, d, 0, true);
    this.box(M.shopGlass, x, 0.3, z + d / 2 + 0.05, w * 0.6, 12, 0.12);
    this.geo(M.shopGlass, new THREE.CylinderGeometry(10, 12, 6, 24), x, 19, z);
    this.box(M.steel, x, 16, z, w + 1, 0.8, d + 1);
    this.sign(x, 13.5, z + d / 2 + 0.3, name, color, Math.min(30, w * 0.4));
    for (let k = 0; k < 16; k++) { const px = r.x0 + 10 + k * ((r.w - 20) / 15); if (rnd() < 0.6) this.parkedCar(px, r.z1 - 8, Math.PI / 2); }
    this.labels.push({ x, z, text: name });
  }
  tcMall(r) { this.mall(r, 'TASHKENT CITY MALL', '#7a1f2b', r.cx, r.cz, 96, 64); }
  megaPlanet(r) { this.mall(r, 'MEGA PLANET', '#e2382b'); this.yardTrees(r, 10); }
  samarqandDarvoza(r) { this.mall(r, 'SAMARQAND DARVOZA', '#1f56a8', r.cx, r.cz - 8, 84, 50); this.yardTrees(r, 10); }

  cityPark(r) {      // Tashkent City Park: входная арка, озеро с поющими фонтанами, мостики, амфитеатр
    const lx = r.cx, lz = r.cz;
    this.geo(M.water, new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), lx, 0.12, lz, 0, r.w * 0.34, 1, r.d * 0.3);
    this.obstacles.add({ x: lx, z: lz, h: 0, hl: r.w * 0.3, hw: r.d * 0.27 });
    for (let k = 0; k < 9; k++) this.geo(M.white, new THREE.CylinderGeometry(0.15, 0.4, rr(3, 9), 8), lx - 14 + k * 3.5, 1.5, lz);   // струи фонтана
    // входная арка с юга
    const gx = r.cx, gz = r.z1 - 2;
    for (const sd of [-1, 1]) this.box(M.steel, gx + sd * 11, 0, gz, 2.2, 12, 2.2, 0, true);
    this.box(M.steel, gx, 12, gz, 25, 2.4, 2.4);
    this.sign(gx, 13.2, gz + 1.3, 'TASHKENT CITY PARK', '#13202c', 22);
    // амфитеатр
    for (let k = 0; k < 5; k++) this.box(M.concrete, r.x0 + 14, k * 0.45, r.z0 + 12 + k * 1.6, 18, 0.45, 1.6);
    for (let k = 0; k < 44; k++) { const a = rnd() * 7, x = lx + Math.cos(a) * r.w * rr(0.4, 0.47), z = lz + Math.sin(a) * r.d * rr(0.36, 0.45); this.trees.push({ x, z, s: rr(0.8, 1.2), kind: pick(['willow', 'chinar', 'sakura']) }); }
    this.labels.push({ x: lx, z: lz, text: 'Tashkent City Park' });
  }

  // ---------- парки ----------
  ferris(wx, wz, R) {
    const cy = R + 3;
    this.geo(M.white, new THREE.TorusGeometry(R, 0.35, 8, 48), wx, cy, wz, Math.PI / 2);
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2;
      const sp = new THREE.CylinderGeometry(0.12, 0.12, R, 4); sp.translate(0, R / 2, 0); sp.rotateX(a); sp.translate(wx, cy, wz); this.push(M.white, sp);
      this.box(pick([M.red, M.gateBlue, M.green, M.crane]), wx, cy + Math.cos(a) * R - 1.6, wz + Math.sin(a) * R, 1.6, 1.6, 1.8);
    }
    for (const sd of [-1, 1]) { const leg = new THREE.CylinderGeometry(0.4, 0.6, cy + 1, 8); leg.translate(0, (cy + 1) / 2, 0); leg.rotateX(sd * 0.25); leg.translate(wx + 1.2, -0.5, wz); this.push(M.white, leg); }
    this.collide(wx, wz, 4, R * 0.6);
  }

  lake(x, z, rx, rz) {
    this.geo(M.water, new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), x, 0.12, z, 0, rx, 1, rz);
    this.geo(M.concrete, new THREE.RingGeometry(1, 1.04, 48).rotateX(-Math.PI / 2), x, 0.13, z, 0, rx, 1, rz);
    this.obstacles.add({ x, z, h: 0, hl: rx * 0.85, hw: rz * 0.85 });
  }

  parkTrees(r, n, kinds, avoid = () => false) {
    for (let k = 0; k < n; k++) { const x = rr(r.x0 + 4, r.x1 - 4), z = rr(r.z0 + 4, r.z1 - 4); if (!avoid(x, z)) this.trees.push({ x, z, s: rr(0.8, 1.35), kind: pick(kinds) }); }
  }

  navoiPark(r) {     // Национальный парк им. Навои: большое озеро, ротонда с памятником поэту, клумбы тюльпанов
    const lx = r.cx, lz = r.cz + 18;
    this.lake(lx, lz, r.w * 0.36, r.d * 0.26);
    const mx = r.cx, mz = r.z0 + 22;
    this.geo(M.white, new THREE.CylinderGeometry(9, 9.5, 1.2, 32), mx, 0.6, mz);
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; this.geo(M.white, new THREE.CylinderGeometry(0.4, 0.45, 9, 12), mx + Math.cos(a) * 6.5, 5.7, mz + Math.sin(a) * 6.5); }
    this.geo(M.tiles, uvs(new THREE.SphereGeometry(7, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), 6, 2), mx, 10.2, mz);
    this.geo(M.bronze, new THREE.CapsuleGeometry(0.6, 1.6, 4, 10), mx, 3.2, mz);
    this.geo(M.bronze, new THREE.SphereGeometry(0.4, 12, 10), mx, 4.6, mz);
    this.collide(mx, mz, 14, 14);
    for (let k = 0; k < 6; k++) this.quad(M.rug, r.x0 + 10, 0.12, r.z0 + 40 + k * 6, 10, 2.4, 0, 1, 1);     // тюльпаны
    this.parkTrees(r, 50, ['chinar', 'willow', 'poplar'], (x, z) => Math.hypot((x - lx) / (r.w * 0.4), (z - lz) / (r.d * 0.3)) < 1 || Math.hypot(x - mx, z - mz) < 12);
    this.labels.push({ x: r.cx, z: r.cz, text: 'Парк Навои' });
  }

  japaneseGarden(r) { // Японский сад: пруды с островами, красные мостики, пагода, каменные фонари, сакура
    const lx = r.cx - 8, lz = r.cz;
    this.lake(lx, lz, r.w * 0.3, r.d * 0.22);
    this.geo(M.grass, new THREE.CircleGeometry(6, 24).rotateX(-Math.PI / 2), lx + 6, 0.16, lz - 3);
    const red = this.redLacquer || (this.redLacquer = new THREE.MeshStandardMaterial({ color: 0xb8262a, roughness: 0.5 }));
    for (const [bx, bz] of [[lx - r.w * 0.22, lz], [lx + r.w * 0.24, lz + 4]]) {
      const arc = new THREE.TorusGeometry(4, 0.35, 8, 24, Math.PI); this.geo(red, arc, bx, -1.2, bz, Math.PI / 2);
      this.box(M.wood, bx, 1.6, bz, 2.4, 0.2, 7);
    }
    const px = r.x1 - 18, pz = r.z0 + 20;       // пагода в три яруса с загнутыми крышами
    for (let k = 0; k < 3; k++) {
      const s = 1 - k * 0.22, y = k * 4.2;
      this.box(M.white, px, y, pz, 7 * s, 3.4, 7 * s);
      this.geo(M.darkSteel, new THREE.ConeGeometry(6.6 * s, 1.6, 4, 1, true).rotateY(Math.PI / 4), px, y + 4, pz);
    }
    this.geo(M.gold, new THREE.CylinderGeometry(0.1, 0.25, 3, 8), px, 14.6, pz);
    this.collide(px, pz, 8, 8);
    for (let k = 0; k < 6; k++) { const x = lx - 12 + k * 6, z = lz + r.d * 0.27; this.box(M.concrete, x, 0, z, 0.6, 0.8, 0.6); this.box(M.concrete, x, 0.8, z, 1, 0.5, 1); this.box(M.concrete, x, 1.3, z, 1.2, 0.2, 1.2); }
    this.parkTrees(r, 46, ['sakura', 'sakura', 'willow', 'chinar'], (x, z) => Math.hypot((x - lx) / (r.w * 0.34), (z - lz) / (r.d * 0.26)) < 1 || Math.hypot(x - px, z - pz) < 7);
    this.labels.push({ x: r.cx, z: r.cz, text: 'Японский сад' });
  }

  gafurGulom(r) {    // парк Гафура Гуляма: колесо обозрения, карусель, американские горки, озеро
    this.lake(r.cx - r.w * 0.2, r.cz + r.d * 0.18, r.w * 0.22, r.d * 0.16);
    this.ferris(r.x1 - 14, r.z0 + 26, 16);
    const cx = r.cx - 8, cz = r.z0 + 22;          // карусель
    this.geo(M.white, new THREE.CylinderGeometry(6, 6, 0.6, 24), cx, 0.3, cz);
    this.geo(M.red, new THREE.ConeGeometry(7, 3, 24), cx, 6, cz);
    this.geo(M.gold, new THREE.CylinderGeometry(0.4, 0.4, 5, 8), cx, 2.8, cz);
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; this.box(pick([M.gateBlue, M.crane, M.green]), cx + Math.cos(a) * 4.5, 1, cz + Math.sin(a) * 4.5, 1, 1.2, 0.6, -a); }
    this.collide(cx, cz, 12, 12);
    const tx = r.cx + 6, tz = r.z1 - 26;          // горки: петляющий трек на опорах
    const pts = []; for (let k = 0; k <= 40; k++) { const t = k / 40 * Math.PI * 2; pts.push(new THREE.Vector3(tx + Math.cos(t) * 18, 6 + Math.sin(t * 3) * 4 + 3, tz + Math.sin(t) * 9)); }
    this.push(M.crane, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 120, 0.4, 6, true));
    for (let k = 0; k < 40; k += 3) this.box(M.white, pts[k].x, 0, pts[k].z, 0.3, pts[k].y, 0.3, 0, true);
    this.parkTrees(r, 34, ['chinar', 'poplar'], (x, z) => Math.hypot(x - (r.x1 - 14), z - (r.z0 + 26)) < 12 || Math.hypot(x - cx, z - cz) < 10 || Math.abs(z - tz) < 12);
    this.labels.push({ x: r.cx, z: r.cz, text: 'Парк Гафура Гуляма' });
  }

  ankhorPark(r) {    // Анхор-Локомотив: детская железная дорога по кругу, паровозик, озеро
    this.lake(r.cx, r.cz, r.w * 0.2, r.d * 0.14);
    const rx = r.w * 0.38, rz = r.d * 0.38;
    for (const d of [-0.7, 0.7]) this.geo(M.rail, new THREE.TorusGeometry(1, 0.012, 4, 96).rotateX(Math.PI / 2), r.cx, 0.15, r.cz, 0, rx + d, 1, rz + d);
    const ang = 0.7, x = r.cx + Math.cos(ang) * rx, z = r.cz + Math.sin(ang) * rz, rot = -ang - Math.PI / 2;
    this.box(M.green, x, 0.3, z, 4, 2.2, 1.6, rot, true); this.geo(M.red, new THREE.CylinderGeometry(0.4, 0.4, 1, 8), x, 2.8, z);
    for (let k = 1; k <= 3; k++) { const a2 = ang - k * 0.14; this.box(pick([M.crane, M.gateBlue, M.red]), r.cx + Math.cos(a2) * rx, 0.3, r.cz + Math.sin(a2) * rz, 3.4, 1.6, 1.5, -a2 - Math.PI / 2, true); }
    this.parkTrees(r, 40, ['willow', 'chinar', 'poplar'], (x2, z2) => Math.abs(Math.hypot((x2 - r.cx) / rx, (z2 - r.cz) / rz) - 1) < 0.08 || Math.hypot((x2 - r.cx) / (r.w * 0.24), (z2 - r.cz) / (r.d * 0.18)) < 1);
    this.labels.push({ x: r.cx, z: r.cz, text: 'Анхор-Локомотив' });
  }

  botanical(r) {     // Ботанический сад: оранжереи-купола, аллеи, разные деревья
    for (const [ox, oz, s] of [[-0.22, -0.2, 1], [0.2, -0.22, 0.75], [0, 0.24, 0.85]]) {
      const x = r.cx + r.w * ox, z = r.cz + r.d * oz;
      this.geo(M.stopGlass, new THREE.SphereGeometry(12 * s, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), x, 0, z);
      for (let k = 0; k < 8; k++) { const g = new THREE.TorusGeometry(12 * s, 0.12, 4, 24, Math.PI); g.rotateY(k * Math.PI / 8); g.translate(x, 0, z); this.push(M.white, g); }
      this.collide(x, z, 22 * s, 22 * s);
    }
    this.parkTrees(r, 70, ['chinar', 'poplar', 'willow', 'sakura', 'fruit']);
    this.labels.push({ x: r.cx, z: r.cz, text: 'Ботанический сад' });
  }

  ecopark(r) {       // Экопарк: беговая дорожка, велодорожки, пруды, площадки
    this.geo(M.track, new THREE.RingGeometry(1, 1.06, 64).rotateX(-Math.PI / 2), r.cx, 0.11, r.cz, 0, r.w * 0.42, 1, r.d * 0.42);
    this.lake(r.cx + r.w * 0.15, r.cz - r.d * 0.12, r.w * 0.14, r.d * 0.1);
    this.quad(M.court, r.cx - r.w * 0.18, 0.11, r.cz + r.d * 0.15, 18, 28, 0, 1, 2);
    this.playground(r.cx - r.w * 0.2, r.cz - r.d * 0.2);
    this.parkTrees(r, 80, ['chinar', 'poplar', 'willow'], (x, z) => Math.abs(Math.hypot((x - r.cx) / (r.w * 0.42), (z - r.cz) / (r.d * 0.42)) - 1) < 0.06);
    this.labels.push({ x: r.cx, z: r.cz, text: 'Экопарк' });
  }

  boburPark(r) {     // парк Бобура: озеро, холм, ротонда
    this.lake(r.cx - r.w * 0.1, r.cz, r.w * 0.24, r.d * 0.2);
    const x = r.x1 - 20, z = r.z0 + 20;
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; this.geo(M.white, new THREE.CylinderGeometry(0.3, 0.35, 5, 10), x + Math.cos(a) * 4, 2.5, z + Math.sin(a) * 4); }
    this.geo(M.white, new THREE.SphereGeometry(4.6, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), x, 5, z, 0, 1, 0.5, 1);
    this.collide(x, z, 9, 9);
    this.parkTrees(r, 60, ['chinar', 'willow', 'poplar'], (x2, z2) => Math.hypot((x2 - r.cx + r.w * 0.1) / (r.w * 0.28), (z2 - r.cz) / (r.d * 0.24)) < 1);
    this.fountain(r.x0 + 16, r.z1 - 16, 3);
    this.labels.push({ x: r.cx, z: r.cz, text: 'Парк Бобура' });
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

  tvTower(r) {      // телебашня (1985): 375 м, три конические опоры по 93 м, смотровая площадка 97 м, ресторан выше
    const x = r.cx, z = r.cz, tw = extraModels.get('tashkent_tower');
    this.tvPos = { x, z };
    if (tw) {                       // готовая модель башни
      const g = tw.clone(true), wrap = new THREE.Group(); wrap.add(g);
      let b = new THREE.Box3().setFromObject(wrap); const k = 375 / (b.max.y - b.min.y); g.scale.setScalar(k);
      b = new THREE.Box3().setFromObject(wrap); const c = b.getCenter(new THREE.Vector3());
      g.position.set(-c.x, -b.min.y, -c.z); wrap.position.set(x, 0, z);
      wrap.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) o.material.side = THREE.FrontSide; } });
      this.root.add(wrap); wrap.updateMatrixWorld(true);
      b = new THREE.Box3().setFromObject(wrap);
      const foot = Math.max(b.max.x - x, b.max.z - z) * 0.75;
      for (let k2 = 0; k2 < 3; k2++) { const a = (k2 / 3) * Math.PI * 2 + 0.3; this.collide(x + Math.cos(a) * foot, z + Math.sin(a) * foot, 12, 12); }
    } else {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.3, R0 = 34;
      const bx = x + Math.cos(a) * R0, bz = z + Math.sin(a) * R0;
      const len = Math.hypot(R0 - 4, 93), tilt = Math.atan2(R0 - 4, 93);
      const g = new THREE.CylinderGeometry(1.6, 4.2, len, 16); g.translate(0, len / 2, 0);
      g.rotateZ(tilt); g.rotateY(-a); g.translate(bx, 0, bz); this.push(M.steel, g);
      this.geo(M.concrete, new THREE.CylinderGeometry(7.5, 7.5, 1.5, 24), bx, 0.75, bz);
      this.collide(bx, bz, 12, 12);
    }
    this.geo(M.lattice, uvs(new THREE.CylinderGeometry(3.2, 6.5, 240, 24, 1, true), 8, 60), x, 120, z);   // решётчатый ствол
    this.geo(M.darkSteel, new THREE.CylinderGeometry(1.8, 2.6, 240, 12), x, 120, z);                      // шахта лифтов
    for (let y = 10; y < 240; y += 12) this.geo(M.steel, new THREE.TorusGeometry(6.5 - y * 0.0137, 0.18, 6, 24).rotateX(Math.PI / 2), x, y, z);
    // смотровая площадка 97 м и ресторан 98–104 м
    this.geo(M.steel, new THREE.CylinderGeometry(13, 9, 3, 32), x, 95, z);
    this.geo(M.glass, new THREE.CylinderGeometry(12.4, 12.4, 3.2, 32), x, 98.1, z);
    this.geo(M.steel, new THREE.CylinderGeometry(13.5, 13.5, 0.8, 32), x, 100, z);
    this.geo(M.glass, new THREE.CylinderGeometry(11.6, 12.6, 4.5, 32), x, 102.6, z);
    this.geo(M.steel, new THREE.CylinderGeometry(8, 12.6, 3, 32), x, 106.3, z);
    this.geo(M.steel, new THREE.CylinderGeometry(5.5, 5.5, 3, 24), x, 180, z);                            // техническая площадка
    this.geo(M.steel, new THREE.CylinderGeometry(0.6, 2.2, 135, 10), x, 240 + 67.5, z);                   // антенна до 375 м
    for (const y of [260, 300, 340, 372]) this.geo(M.red, new THREE.SphereGeometry(0.9, 8, 6), x, y, z);  // заградительные огни
    }
    if (tw) this.collide(x, z, 16, 16); else this.box(M.concrete, x, 0, z, 16, 8, 16, 0, true);
    this.labels.push({ x, z, text: 'Телебашня' });
    for (let k = 0; k < 40; k++) { const a = rnd() * 7, d = rr(44, 56); this.trees.push({ x: x + Math.cos(a) * d, z: z + Math.sin(a) * d, s: rr(0.9, 1.3), kind: 'poplar' }); }
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
    for (let a = 0; a < 28; a++) {       // аркада по кругу
      const ang = (a / 28) * Math.PI * 2;
      const g = new THREE.PlaneGeometry(4.6, 6); g.translate(0, 3, 0); g.rotateY(-ang + Math.PI / 2); g.translate(x + Math.cos(ang) * 38.05, 0, z + Math.sin(ang) * 38.05); this.push(M.shopGlass, g);
    }
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

  // ---------- разнообразные кварталы ----------
  courtyard(r) {     // двор буквой П, детский сад, парковка во дворе
    const m = pick([M.panelPeach, M.panelBlue, M.panel, M.panelYellow]), fl = pick([5, 9, 9, 12]);
    this.building(r.cx, r.z0 + 9, r.w - 20, 12, fl, m);
    this.building(r.x0 + 9, r.cz + 6, 12, r.d - 40, fl, m);
    this.building(r.x1 - 9, r.cz + 6, 12, r.d - 40, Math.max(5, fl - 4), m);
    this.building(r.cx + rr(-8, 8), r.z1 - 22, 26, 12, 2, M.redBrick, 0, M.roof, 3.2);
    this.fence(r.cx - 16, r.z1 - 34, r.cx + 16, r.z1 - 8);
    this.playground(r.cx, r.cz);
    for (let k = 0; k < 6; k++) this.parkedCar(r.x0 + 22 + k * 3.2, r.z0 + 22, Math.PI / 2);
    this.yardTrees(r, 16);
  }

  modernTowers(r) {  // новые ЖК: стилобат с магазинами и 2–3 башни
    const m = pick([M.modernA, M.modernB, M.modernC]);
    this.building(r.cx, r.cz, r.w - 26, r.d - 40, 2, M.shopGlass, 0, M.roofDark, 4.5);
    const n = rnd() < 0.5 ? 2 : 3;
    for (let k = 0; k < n; k++) {
      const fx = n === 2 ? (k ? 0.68 : 0.32) : [0.22, 0.5, 0.78][k];
      this.building(r.x0 + r.w * fx, r.cz + rr(-6, 6), 20, 20, Math.floor(rr(14, 24)), m, 0, M.roofDark, 3.2);
    }
    for (let k = 0; k < 8; k++) this.parkedCar(r.x0 + 14 + k * 3.2, r.z1 - 6, Math.PI / 2);
    this.yardTrees(r, 8);
  }

  officeGlass(r) {   // бизнес-центр
    this.building(r.cx - r.w * 0.15, r.cz - 10, 28, 28, Math.floor(rr(18, 28)), M.glass, 0, M.roofDark, 3.6);
    this.building(r.cx + r.w * 0.22, r.cz + 10, 36, 16, 5, M.office, 0, M.roofDark, 3.6, { shops: true });
    this.quad(M.plaza, r.cx, 0.1, r.z1 - 18, r.w - 20, 20, 0, 6, 2);
    this.fountain(r.cx - r.w * 0.15, r.z1 - 18, 4);
    this.yardTrees(r, 10);
  }

  school(r) {        // школа буквой П, стадион с беговой дорожкой, забор
    const x = r.cx - r.w * 0.18, z = r.cz;
    this.building(x, z - 18, 40, 12, 3, M.redBrick, 0, M.roof, 3.4);
    this.building(x - 14, z + 2, 12, 28, 3, M.redBrick, 0, M.roof, 3.4);
    this.building(x + 14, z + 2, 12, 28, 3, M.redBrick, 0, M.roof, 3.4);
    this.sign(x, 9.5, z - 11.9, 'MAKTAB', '#2b5ea8', 7);
    const fx = r.x1 - 30, fz = r.cz, fd = Math.min(56, r.d * 0.56);
    this.geo(M.track, new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), fx, 0.1, fz, 0, 24, 1, fd * 0.72);
    this.quad(M.field, fx, 0.12, fz, 30, fd, 0, 4, 6);
    for (const sd of [-1, 1]) { const gz = fz + sd * fd * 0.48; this.box(M.white, fx - 3, 0, gz, 0.12, 2.2, 0.12); this.box(M.white, fx + 3, 0, gz, 0.12, 2.2, 0.12); this.box(M.white, fx, 2.2, gz, 6.1, 0.12, 0.12); }
    this.fence(r.x0 + 3, r.z0 + 3, r.x1 - 3, r.z1 - 3);
    this.yardTrees(r, 14);
  }

  supermarket(r) {   // супермаркет и парковка
    const x = r.cx, z = r.z0 + 26;
    this.box(M.kWall, x, 0, z, 62, 7, 34, 0, true);
    this.box(M.roofDark, x, 7, z, 62.4, 0.5, 34.4);
    const part = (m, g, lx, ly, lz, ry = 0) => { g.rotateY(ry); g.translate(x + lx, ly, z + lz); this.push(m, g); };
    this.korzinkaFront(part, true, 1, 62, 34, 58, false);
    this.box(M.kRed, x, 4.9, z + 17.6, 62.8, 3.2, 1.2);                                   // широкий красный пояс по верху
    this.box(M.kSign, x - 6, 5.05, z + 18.22, 12, 3, 0.02);
    for (let k = 0; k < 14; k++) {
      const px = r.x0 + 12 + k * 3.6;
      this.quad(M.mark, px, 0.11, r.z1 - 18, 0.12, 5.5); this.quad(M.mark, px, 0.11, r.z1 - 34, 0.12, 5.5);
      if (rnd() < 0.55) this.parkedCar(px + 1.8, r.z1 - 18, rnd() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      if (rnd() < 0.45) this.parkedCar(px + 1.8, r.z1 - 34, Math.PI / 2);
    }
    for (let k = 0; k < 3; k++) this.lamps.push({ x: r.x0 + 20 + k * 30, z: r.z1 - 26, side: 1, rot: 0 });
  }

  construction(r) {  // стройка: синий забор, каркас, башенный кран
    this.fence(r.x0 + 4, r.z0 + 4, r.x1 - 4, r.z1 - 4, M.fenceBlue, 2.4);
    const x = r.cx, z = r.cz, fl = Math.floor(rr(6, 11));
    for (let f = 0; f < fl; f++) {
      this.box(M.concrete, x, f * 3.2 + 3, z, 30, 0.3, 18);
      if (f < fl - 1) for (let i = -2; i <= 2; i++) for (const zz of [-8, 8]) this.box(M.concrete, x + i * 7, f * 3.2, z + zz, 0.5, 3.0, 0.5);
    }
    for (let i = -2; i <= 2; i++) for (const zz of [-8, 8]) this.box(M.concrete, x + i * 7, 0, z + zz, 0.5, 3.0, 0.5);
    this.collide(x, z, 30, 18);
    const cx = x + 22, cz = z - 4, H = fl * 3.2 + 18;     // кран
    for (let y = 0; y < H; y += 3) { this.box(M.crane, cx, y, cz, 1.6, 0.15, 1.6); for (const [ox, oz] of [[-0.75, -0.75], [0.75, -0.75], [-0.75, 0.75], [0.75, 0.75]]) this.box(M.crane, cx + ox, y, cz + oz, 0.12, 3, 0.12); }
    this.box(M.crane, cx - 14, H, cz, 44, 0.9, 1.2);
    this.box(M.concrete, cx + 7, H - 1.2, cz, 4, 2, 2.2);
    this.box(M.white, cx + 0.8, H - 3, cz, 2.2, 2.2, 2.2);
    this.box(M.darkSteel, cx - 26, H - 12, cz, 0.05, 12, 0.05);
    this.collide(cx, cz, 2, 2);
    for (let k = 0; k < 4; k++) this.box(pick([M.red, M.wood, M.concrete]), r.x0 + 14 + k * 6, 0, r.z1 - 14, 4, 1.2, 2.5, 0, true);
  }

  choyxona(r) {      // чайхана: айван на деревянных колоннах, топчаны с курпачами, хауз
    const x = r.cx, z = r.cz;
    this.building(x, z - 20, 30, 10, 1, M.house, 0, M.slate, 3.6);
    this.box(M.wood, x, 3.6, z - 11, 30, 0.3, 8);
    for (let k = -3; k <= 3; k++) this.geo(M.wood, new THREE.CylinderGeometry(0.18, 0.2, 3.6, 8), x + k * 4.6, 1.8, z - 7.4);
    for (let k = 0; k < 6; k++) {
      const tx = x - 20 + (k % 3) * 18, tz = z + 6 + Math.floor(k / 3) * 12;
      this.box(M.wood, tx, 0, tz, 4, 0.6, 3, 0, true); this.box(M.rug, tx, 0.6, tz, 3.8, 0.1, 2.8); this.box(M.wood, tx, 0.7, tz, 1.4, 0.35, 0.9);
      this.trees.push({ x: tx + 3, z: tz - 3, s: 1.2, kind: 'chinar' });
    }
    this.box(M.concrete, x + 22, 0, z - 2, 11, 0.4, 7, 0, true); this.quad(M.water, x + 22, 0.42, z - 2, 10, 6);
    this.sign(x, 5, z - 6.8, 'CHOYXONA', '#7d5532', 8);
    this.yardTrees(r, 8);
  }

  sportPark(r) {     // мини-футбол, баскетбол, площадка
    this.quad(M.court, r.cx - r.w * 0.2, 0.1, r.cz, 26, 40, 0, 2, 3);
    this.quad(M.court, r.cx + r.w * 0.22, 0.1, r.cz - 15, 16, 26, 0, 1, 2);
    for (const sd of [-1, 1]) { this.box(M.white, r.cx + r.w * 0.22, 0, r.cz - 15 + sd * 11, 0.15, 3, 0.15); this.box(M.white, r.cx + r.w * 0.22, 3, r.cz - 15 + sd * 10.7, 1.2, 0.8, 0.06); }
    this.fence(r.cx - r.w * 0.2 - 14, r.cz - 22, r.cx - r.w * 0.2 + 14, r.cz + 22, M.court, 3);
    this.playground(r.cx + r.w * 0.22, r.cz + 22);
    this.yardTrees(r, 26);
  }

  garages(r) {       // ряды гаражей и хрущёвка
    for (let row = 0; row < 3; row++) for (let k = 0; k < 14; k++) {
      const x = r.x0 + 10 + k * 3.6, z = r.z0 + 14 + row * 14;
      this.box(M.concrete, x, 0, z, 3.4, 2.4, 6, 0, true);
      this.box(pick([M.gate, M.gateBlue, M.red, M.darkSteel]), x, 0.1, z + 3.02, 2.6, 2.1, 0.06);
    }
    this.building(r.x1 - 12, r.cz + 10, 12, r.d - 50, 5, M.brick);
    this.yardTrees(r, 12);
  }

  mosqueBlock(r) {   // махаллинская мечеть и дома вокруг
    this.mahalla(r);
    const x = r.cx, z = r.z0 + 14;
    this.box(M.white, x, 0, z, 14, 7, 10, 0, true);
    this.geo(M.green, uvs(new THREE.SphereGeometry(4, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), 4, 1), x, 7, z, 0, 1, 1.2, 1);
    this.geo(M.white, new THREE.CylinderGeometry(0.9, 1.1, 18, 12), x + 8.5, 9, z - 3);
    this.geo(M.green, new THREE.ConeGeometry(1.1, 2.4, 12), x + 8.5, 19.2, z - 3);
    this.collide(x + 8.5, z - 3, 2.2, 2.2);
  }

  hospital(r) {      // больница: главный корпус с крыльями, скорые
    const x = r.cx, z = r.cz;
    this.building(x, z - 10, 60, 14, 6, M.panel2, 0, M.roof, 3.4);
    this.building(x - 24, z + 14, 12, 34, 4, M.panel2);
    this.building(x + 24, z + 14, 12, 34, 4, M.panel2);
    const cross = canvasTex(128, 128, g => { g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#d21f2b'; g.fillRect(48, 16, 32, 96); g.fillRect(16, 48, 96, 32); }, false);
    this.geo(new THREE.MeshStandardMaterial({ map: cross, emissive: 0xffffff, emissiveMap: cross, emissiveIntensity: 0.2 }), new THREE.PlaneGeometry(4, 4), x, 15, z - 2.9);
    for (let k = 0; k < 3; k++) this.parkedCar(x - 6 + k * 3.4, z + 6, Math.PI / 2);
    this.yardTrees(r, 14);
  }

  fence(x0, z0, x1, z1, mat = M.darkSteel, h = 1.4) {
    for (const [x, z, sx, sz] of [[(x0 + x1) / 2, z0, x1 - x0, 0.08], [(x0 + x1) / 2, z1, x1 - x0, 0.08], [x0, (z0 + z1) / 2, 0.08, z1 - z0], [x1, (z0 + z1) / 2, 0.08, z1 - z0]]) {
      this.box(mat, x, 0, z, sx, h, sz);
      this.obstacles.add({ x, z, h: 0, hl: sx / 2 + 0.05, hw: sz / 2 + 0.05 });
    }
  }

  // ---------- новые достопримечательности ----------
  navoiTheatre(r) {  // театр им. Навои: трёхарочный портал на сдвоенных колоннах, аркады, башенки, мозаика; фонтан «хлопок»
    const x = r.cx, z = r.z0 + 34;
    const beige = this.beigeMat || (this.beigeMat = new THREE.MeshStandardMaterial({ map: T.ganch, normalMap: normalFrom(T.ganch, 3), color: 0xe6d3b0, roughness: 0.85 }));
    this.box(beige, x, 0, z, 62, 15, 40, 0, true);
    this.box(beige, x, 15, z - 4, 34, 6, 26);
    this.box(beige, x, 0, z + 22, 26, 22, 6);
    this.box(M.tiles, x, 19, z + 25.05, 26, 2.2, 0.2);
    const arch = new THREE.Shape(); arch.moveTo(-3, 0); arch.lineTo(-3, 11); arch.quadraticCurveTo(-3, 15, 0, 16.5); arch.quadraticCurveTo(3, 15, 3, 11); arch.lineTo(3, 0); arch.closePath();
    for (const ox of [-7.5, 0, 7.5]) {
      this.geo(M.darkSteel, new THREE.ShapeGeometry(arch), x + ox, 0, z + 25.06);
      for (const s2 of [-1, 1]) for (const d2 of [-0.45, 0.45]) this.geo(beige, new THREE.CylinderGeometry(0.35, 0.4, 11, 10), x + ox + s2 * 3.4 + d2, 5.5, z + 25.6);
    }
    for (const s2 of [-1, 1]) {
      this.geo(beige, new THREE.CylinderGeometry(1.2, 1.4, 6, 12), x + s2 * 12, 25, z + 22);
      this.geo(M.tiles, uvs(new THREE.SphereGeometry(1.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 3, 1), x + s2 * 12, 28, z + 22);
      for (let k = 0; k < 6; k++) this.geo(M.darkSteel, new THREE.ShapeGeometry(arch).scale(0.35, 0.45, 1), x + s2 * 31.06, 0.5, z - 16 + k * 6.4, s2 * Math.PI / 2);
    }
    const fx = x, fz = r.z1 - 26;
    this.geo(M.concrete, new THREE.CylinderGeometry(9, 9.4, 0.8, 40), fx, 0.4, fz);
    this.geo(M.water, new THREE.CylinderGeometry(8.4, 8.4, 0.1, 40), fx, 0.82, fz);
    for (let k = 0; k < 5; k++) this.geo(M.white, new THREE.SphereGeometry(1.4, 16, 12).scale(1, 0.8, 1), fx + Math.cos(k * 1.256) * 1.3, 3.2, fz + Math.sin(k * 1.256) * 1.3);
    for (let k = 0; k < 5; k++) { const a = k * 1.256 + 0.6; this.geo(M.bronze, new THREE.SphereGeometry(2.2, 12, 8, 0, Math.PI, 0, Math.PI / 2).rotateZ(-0.5), fx + Math.cos(a) * 1.8, 2.2, fz + Math.sin(a) * 1.8, -a); }
    this.geo(M.concrete, new THREE.CylinderGeometry(0.7, 1, 2.2, 12), fx, 1.1, fz);
    this.obstacles.add({ x: fx, z: fz, h: 0, hl: 9, hw: 9 });
    this.labels.push({ x, z, text: 'Театр Навои' });
    this.yardTrees(r, 10);
  }

  circus(r) {        // Госцирк (1976): ребристый бирюзовый купол-пиала на вынесенных опорах
    const x = r.cx, z = r.cz;
    this.geo(M.shopGlass, new THREE.CylinderGeometry(30, 30, 8, 48), x, 4, z);
    const bowl = new THREE.LatheGeometry([...Array(14)].map((_, k) => { const t = k / 13; return new THREE.Vector2(Math.max(0.5, 36 - Math.pow(t, 2.2) * 34), 8 + Math.sin(t * Math.PI / 2) * 16); }), 64);
    this.geo(this.turqRibs || (this.turqRibs = new THREE.MeshStandardMaterial({ map: canvasTex(256, 64, (g, w, h) => { for (let x2 = 0; x2 < w; x2 += 16) { const gr = g.createLinearGradient(x2, 0, x2 + 16, 0); gr.addColorStop(0, '#0f8f8f'); gr.addColorStop(0.5, '#3fd0c6'); gr.addColorStop(1, '#0f8f8f'); g.fillStyle = gr; g.fillRect(x2, 0, 16, h); } }), roughness: 0.3, metalness: 0.3 })), uvs(bowl, 4, 1), x, 0, z);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const g = new THREE.BoxGeometry(1.2, 10, 2.2); g.rotateZ(0.28); g.translate(36.5, 5, 0); g.rotateY(-a); g.translate(x, 0, z); this.push(M.white, g);
    }
    this.geo(M.gold, new THREE.CylinderGeometry(2, 2.4, 1.2, 24), x, 24.4, z);
    this.collide(x, z, 70, 70);
    this.labels.push({ x, z, text: 'Цирк' });
  }

  shahidlar(r) {     // «Шахидлар хотираси»: бирюзовый ребристый купол на 8 мраморных колоннах и музей
    const x = r.cx - 18, z = r.cz;
    this.geo(M.white, new THREE.CylinderGeometry(13, 13.5, 1, 32), x, 0.5, z);
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + Math.PI / 8; this.geo(M.white, new THREE.CylinderGeometry(0.75, 0.85, 22, 14), x + Math.cos(a) * 10, 12, z + Math.sin(a) * 10); this.collide(x + Math.cos(a) * 10, z + Math.sin(a) * 10, 1.8, 1.8); }
    this.geo(M.white, new THREE.CylinderGeometry(11.6, 11.6, 1.6, 32), x, 23.6, z);
    this.geo(M.ribs, uvs(new THREE.SphereGeometry(11, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2), 2, 1), x, 24.4, z, 0, 1, 0.75, 1);
    this.geo(M.gold, new THREE.CylinderGeometry(0.1, 0.5, 3, 8), x, 33.5, z);
    this.box(M.white, x + 38, 0, z, 26, 8, 20, 0, true);
    this.geo(M.tiles, uvs(new THREE.SphereGeometry(7, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), 6, 2), x + 38, 8, z);
    this.labels.push({ x, z, text: 'Шахидлар хотираси' });
    this.yardTrees(r, 18);
  }

  humoArena(r) {     // Humo Arena: эллипс, стеклянные фасады, серебристая кровля
    const x = r.cx, z = r.cz;
    this.geo(M.shopGlass, new THREE.CylinderGeometry(1, 1, 16, 48), x, 8, z, 0, 50, 1, 34);
    const roof = new THREE.SphereGeometry(1, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2); roof.scale(54, 10, 38);
    this.geo(M.steel, roof, x, 16, z);
    for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; this.box(M.white, x + Math.cos(a) * 51, 0, z + Math.sin(a) * 35, 0.8, 17, 0.8); }
    this.sign(x, 20, z + 36.5, 'HUMO ARENA', '#1d2a3a', 18);
    this.collide(x, z, 104, 72);
    this.labels.push({ x, z, text: 'Humo Arena' });
  }

  railway(r) {       // Ташкентский вокзал: высокий арочный вход, крылья, перроны с навесами и поезда
    const x = r.cx, z = r.z0 + 12;
    this.building(x - 30, z, 30, 16, 3, M.office, 0, M.roofDark, 4);
    this.building(x + 30, z, 30, 16, 3, M.office, 0, M.roofDark, 4);
    this.box(M.white, x, 0, z, 30, 20, 18, 0, true);
    const arch = new THREE.Shape(); arch.moveTo(-9, 0); arch.lineTo(-9, 10); arch.quadraticCurveTo(-9, 17, 0, 18); arch.quadraticCurveTo(9, 17, 9, 10); arch.lineTo(9, 0); arch.closePath();
    this.geo(M.shopGlass, new THREE.ShapeGeometry(arch), x, 0, z - 9.05, Math.PI);
    this.sign(x, 21.5, z - 9.3, 'TOSHKENT', '#1d4f91', 16, Math.PI);
    for (let k = 0; k < 3; k++) {
      const pz = z + 20 + k * 20;
      this.box(M.concrete, x, 0, pz, r.w - 16, 0.9, 6, 0, true);
      this.box(M.white, x, 4.2, pz, r.w - 18, 0.25, 7);
      for (let q = -4; q <= 4; q++) this.box(M.darkSteel, x + q * 12, 0.9, pz, 0.25, 3.3, 0.25);
      const tz = pz + 7;
      for (const sd of [-0.75, 0.75]) this.box(M.rail, x, 0.05, tz + sd, r.w - 10, 0.15, 0.12);
      if (k < 2) for (let c = 0; c < 4; c++) { this.box(k ? M.red : M.gateBlue, x - 36 + c * 24, 0.5, tz, 22, 3.8, 3.1, 0, true); this.box(M.shopGlass, x - 36 + c * 24, 2.3, tz + 1.56, 20, 1, 0.05); }
    }
    this.labels.push({ x, z, text: 'Вокзал' });
  }

  magicCity(r) {     // Magic City: сказочный замок и колесо обозрения
    const x = r.cx - 14, z = r.cz;
    const pinkM = this.pinkMat || (this.pinkMat = new THREE.MeshStandardMaterial({ color: 0xf2d2dc, roughness: 0.7 }));
    this.box(pinkM, x, 0, z, 30, 14, 18, 0, true);
    for (const [ox, oz, h] of [[-15, -9, 22], [15, -9, 22], [-15, 9, 18], [15, 9, 18], [0, 0, 30]]) {
      this.geo(pinkM, new THREE.CylinderGeometry(3, 3, h, 20), x + ox, h / 2, z + oz);
      this.geo(M.gateBlue, new THREE.ConeGeometry(3.6, 7, 20), x + ox, h + 3.5, z + oz);
      this.collide(x + ox, z + oz, 6, 6);
    }
    this.ferris(r.x1 - 16, r.cz, 18);
    this.labels.push({ x, z, text: 'Magic City' });
    this.yardTrees(r, 16);
  }

  independenceMonument(x, z) {   // монумент Независимости: золотой глобус на постаменте
    this.box(M.white, x, 0, z, 8, 1, 8); this.box(M.white, x, 1, z, 5, 9, 5, 0, true);
    const globe = canvasTex(256, 128, g => { g.fillStyle = '#c9a23a'; g.fillRect(0, 0, 256, 128); g.fillStyle = '#ecd07a'; g.beginPath(); g.moveTo(120, 50); g.lineTo(150, 42); g.lineTo(170, 55); g.lineTo(160, 70); g.lineTo(135, 66); g.closePath(); g.fill(); g.strokeStyle = 'rgba(80,60,20,0.4)'; for (let i = 0; i < 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); } }, false);
    this.geo(new THREE.MeshStandardMaterial({ map: globe, metalness: 0.9, roughness: 0.3 }), new THREE.SphereGeometry(3.4, 32, 20), x, 13.4, z);
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
      if (x > 200 && z < -200) continue;             // северо-восток — настоящий рельеф (terrain.js)
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
    const TILE = 500, tiles = new Map();          // режем город на квадраты — невидимые не рисуются
    for (const [mat, list] of this.batches) for (const g of list) {
      const p = g.attributes.position, k = Math.floor(p.getX(0) / TILE) + ':' + Math.floor(p.getZ(0) / TILE);
      const key = mat.uuid + k; if (!tiles.has(key)) tiles.set(key, [mat, []]); tiles.get(key)[1].push(g);
    }
    for (const [, [mat, list]] of tiles) {
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
    const ctiles = new Map();
    for (const [mat, list] of this.carBuckets) for (const g of list) {
      const p = g.attributes.position, key = mat.uuid + Math.floor(p.getX(0) / TILE) + ':' + Math.floor(p.getZ(0) / TILE);
      if (!ctiles.has(key)) ctiles.set(key, [mat, []]); ctiles.get(key)[1].push(g);
    }
    for (const [, [mat, list]] of ctiles) { const m = new THREE.Mesh(mergeGeometries(list), mat); m.castShadow = m.receiveShadow = true; this.root.add(m); }
    this.carBuckets.clear();
    this.instancedTrees(); this.instancedLamps();
  }

  instancedTrees() {
    const d = new THREE.Object3D(), col = new THREE.Color();
    const trees = this.isCity ? this.trees : this.trees.filter(t => t.noCollide || Math.hypot(t.x, t.z) > RING_OUT + 1);
    // ствол с двумя ветвями
    const trunkParts = [new THREE.CylinderGeometry(0.2, 0.32, 4.2, 8).translate(0, 2.1, 0)];
    for (const [a, t] of [[0.6, 0.5], [-0.7, 2.6]]) { const b = new THREE.CylinderGeometry(0.06, 0.12, 2.0, 6); b.translate(0, 1, 0); b.rotateZ(0.7); b.rotateY(t); b.translate(0, 3.2 + a * 0.4, 0); trunkParts.push(b); }
    const trunkG = mergeGeometries(trunkParts.map(g => g.toNonIndexed()));
    const whiteG = new THREE.CylinderGeometry(0.34, 0.36, 1.2, 8); whiteG.translate(0, 0.6, 0);   // побелённые стволы
    // крона: несколько мягких «облаков» листвы, снизу темнее (вершинные цвета умножаются на цвет экземпляра)
    const lobes = [[0, 0.2, 0, 0.8], [0.5, -0.08, 0.28, 0.62], [-0.48, -0.02, 0.24, 0.62], [0.05, -0.05, -0.55, 0.62]];
    const crownG = mergeGeometries(lobes.map(([x, y, z, r]) => {
      const g = new THREE.SphereGeometry(r, this.isCity ? 7 : 10, this.isCity ? 5 : 7);          // индексированная — сглаженные нормали
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) { const f = 1 + Math.sin(p.getX(k) * 19 + p.getY(k) * 13) * 0.05 + Math.cos(p.getZ(k) * 17) * 0.05; p.setXYZ(k, p.getX(k) * f, p.getY(k) * f, p.getZ(k) * f); }
      g.computeVertexNormals(); g.translate(x, y, z); return g.toNonIndexed();
    }));
    { const p = crownG.attributes.position, c = new Float32Array(p.count * 3); for (let k = 0; k < p.count; k++) { const v = 0.62 + 0.38 * Math.min(1, Math.max(0, (p.getY(k) + 0.7) / 1.4)); c.set([v, v, v], k * 3); } crownG.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
    const n = trees.length;
    const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x7a6650, roughness: 1 }), n);
    const whites = new THREE.InstancedMesh(whiteG, new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.9 }), n);
    const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, vertexColors: true }), n);
    trees.forEach((t, i) => {
      const s = t.s;
      d.rotation.set(0, (t.x * 13.7) % 6.28, 0);
      const ty = t.y || 0;
      d.position.set(t.x, ty, t.z); d.scale.set(s, t.kind === 'poplar' ? s * 1.6 : s, s); d.updateMatrix();
      trunks.setMatrixAt(i, d.matrix); whites.setMatrixAt(i, d.matrix);
      let cy = 6 * s, sx = 3.4 * s, sy = 2.8 * s;
      if (t.kind === 'poplar') { cy = 8.5 * s; sx = 1.5 * s; sy = 5.5 * s; }
      if (t.kind === 'thin') { cy = 4.5 * s; sx = 1.8 * s; sy = 1.9 * s; }
      if (t.kind === 'willow') { cy = 4.5 * s; sx = 3.6 * s; sy = 2.6 * s; }
      if (t.kind === 'fruit') { cy = 3.2 * s; sx = 2.4 * s; sy = 1.8 * s; }
      if (t.kind === 'shrub') {          // стриженый кустарник: без ствола
        d.position.set(t.x, -5, t.z); d.scale.set(0.01, 0.01, 0.01); d.updateMatrix(); trunks.setMatrixAt(i, d.matrix); whites.setMatrixAt(i, d.matrix);
        d.position.set(t.x, 0.5, t.z); cy = 0.62; sx = 0.8 * s; sy = 0.5 * s;
      }
      if (t.kind === 'pine') { cy = 5.5 * s; sx = 2.2 * s; sy = 4.6 * s; }
      d.position.y = cy + ty; d.scale.set(sx, sy, sx); d.updateMatrix(); crowns.setMatrixAt(i, d.matrix);
      const hue = t.kind === 'willow' ? 0.2 : t.kind === 'poplar' || t.kind === 'shrub' || t.kind === 'pine' ? 0.28 : 0.23;
      if (t.kind === 'sakura') crowns.setColorAt(i, col.setHSL(0.93 + Math.random() * 0.03, 0.55, 0.78 + Math.random() * 0.06));
      else crowns.setColorAt(i, col.setHSL(hue + Math.random() * 0.04, 0.45, 0.22 + Math.random() * 0.08));
      if (!t.noCollide) this.obstacles.add({ x: t.x, z: t.z, h: 0, hl: 0.35, hw: 0.35 });
    });
    trunks.castShadow = crowns.castShadow = true; crowns.receiveShadow = true;
    this.root.add(trunks, whites, crowns);
    // стриженый кустарник на разделителях: отдельная лёгкая модель
    const sh = this.shrubs || [], sg = new THREE.SphereGeometry(1, 9, 6);
    const shrubs = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }), sh.length);
    sh.forEach((t, i) => { d.position.set(t.x, 0.6, t.z); d.rotation.set(0, t.x, 0); d.scale.set(1.3 * t.s, 0.55 * t.s, 1.1 * t.s); d.updateMatrix(); shrubs.setMatrixAt(i, d.matrix); shrubs.setColorAt(i, col.setHSL(0.27 + Math.random() * 0.04, 0.42, 0.2 + Math.random() * 0.06)); });
    shrubs.castShadow = true; shrubs.receiveShadow = true; this.root.add(shrubs);
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
      if (l.a !== undefined) { items.push({ x: l.x, z: l.z, a: l.a, y: l.y || 0 }); if (l.double) items.push({ x: l.x, z: l.z, a: l.a + Math.PI, y: l.y || 0 }); }
      else if (l.double) { items.push({ x: l.x, z: l.z, a: across }); items.push({ x: l.x, z: l.z, a: across + Math.PI }); }
      else items.push({ x: l.x, z: l.z, a: across + ((l.side > 0) === (l.rot === 0) ? Math.PI : 0) });
      this.obstacles.add({ x: l.x, z: l.z, h: 0, hl: 0.15, hw: 0.15, y0: (l.y || 0) - 2, y1: (l.y || 0) + 9 });
    }
    const n = items.length;
    const poles = new THREE.InstancedMesh(poleG, steel, n), arms = new THREE.InstancedMesh(armG, steel, n), heads = new THREE.InstancedMesh(headG, M.lightOn, n);
    items.forEach((it, i) => { d.position.set(it.x, it.y || 0, it.z); d.rotation.set(0, it.a, 0); d.updateMatrix(); poles.setMatrixAt(i, d.matrix); arms.setMatrixAt(i, d.matrix); heads.setMatrixAt(i, d.matrix); });
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

export { M, T, rnd, rr, pick, uvs, canvasTex, normalFrom };
