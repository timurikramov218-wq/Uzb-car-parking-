import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { CARS, COLORS, buildCarMesh } from './cars.js';
import { Obstacles } from './physics.js';

export const HALF = 420;              // половина размера мира
export const ROAD_W = 14;
export const ROADS = [-360, -240, -120, 0, 120, 240, 360];
export const BLOCKS = [-300, -180, -60, 60, 180, 300];
export const LEVEL_CENTER = { x: 180, z: 60 };
export const SPAWN = { x: 3.5, z: 40, h: Math.PI / 2 };

// детерминированный рандом, чтобы у всех игроков онлайн был одинаковый город
let seed = 20240901;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = a => a[Math.floor(rnd() * a.length)];

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function noise(g, w, h, base, amp, n = 4000) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = Math.floor(Math.random() * amp);
    g.fillStyle = `rgba(${v},${v},${v},0.08)`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

const TEX = {};
function makeTextures() {
  TEX.asphalt = canvasTex(256, 256, (g, w, h) => noise(g, w, h, '#3a3c40', 255, 6000));
  TEX.road = canvasTex(256, 256, (g, w, h) => {
    noise(g, w, h, '#36383c', 255, 6000);
    g.fillStyle = '#e8e8e0';
    g.fillRect(10, 0, 5, h); g.fillRect(w - 15, 0, 5, h);
    g.fillRect(w / 2 - 3, 0, 6, h * 0.5);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillRect(w * 0.27, 0, 3, h * 0.35); g.fillRect(w * 0.73 - 3, 0, 3, h * 0.35);
  });
  TEX.sidewalk = canvasTex(128, 128, (g, w, h) => {
    noise(g, w, h, '#a9a49a', 255, 1500);
    g.strokeStyle = 'rgba(60,55,50,0.35)'; g.lineWidth = 2;
    for (let i = 0; i <= w; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
  });
  TEX.grass = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#5d8a3a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `hsl(${85 + Math.random() * 30},${40 + Math.random() * 20}%,${25 + Math.random() * 20}%)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 3);
    }
  });
  TEX.ground = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#b8a27a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) { g.fillStyle = `hsla(${35 + Math.random() * 15},30%,${45 + Math.random() * 25}%,0.5)`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
  });
  TEX.zebra = canvasTex(128, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.fillStyle = '#f0f0ea';
    for (let i = 4; i < w; i += 16) g.fillRect(i, 0, 9, h);
  }, false);
  const facade = (wall, win, frame, balcony) => canvasTex(64, 64, (g, w, h) => {
    noise(g, w, h, wall, 200, 300);
    g.fillStyle = frame; g.fillRect(14, 12, 36, 34);
    g.fillStyle = win; g.fillRect(17, 15, 30, 28);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(17, 15, 12, 28);
    g.fillStyle = frame; g.fillRect(31, 15, 2, 28);
    if (balcony) { g.fillStyle = balcony; g.fillRect(10, 44, 44, 8); }
  });
  TEX.facades = [
    facade('#d9cdb4', '#36506a', '#f0ece4', '#bfb39c'),   // панельки бежевые
    facade('#e9e6df', '#2f4a63', '#ffffff', '#cfcac0'),
    facade('#c9b48f', '#4a5c70', '#e4d8c0', null),
    facade('#7fa9c4', '#1c3448', '#b9d4e6', null),         // стекло-офис
    facade('#d7a77a', '#3b4b5c', '#f2e2cc', '#b88b62'),
    facade('#efe7cf', '#40627d', '#ffffff', '#0e8fa3'),
  ];
  TEX.tiles = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#0d6f9a'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) for (let y = 0; y < h; y += 16) {
      g.fillStyle = (x + y) % 32 ? '#1b9ec9' : '#e8f4f8';
      g.beginPath(); g.moveTo(x + 8, y + 1); g.lineTo(x + 15, y + 8); g.lineTo(x + 8, y + 15); g.lineTo(x + 1, y + 8); g.fill();
    }
  });
  TEX.brick = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#c9a36c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#a8834f'; g.lineWidth = 2;
    for (let y = 0; y < h; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      for (let x = (y / 12) % 2 ? 0 : 12; x < w; x += 24) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 12); g.stroke(); } }
  });
}

const mats = {};
function mat(key, opts) { if (!mats[key]) mats[key] = new THREE.MeshStandardMaterial(opts); return mats[key]; }

// Склейка статичного объекта в несколько мешей (по материалам) для скорости
export function bake(group) {
  group.updateMatrixWorld(true);
  const byMat = new Map();
  group.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  });
  const out = new THREE.Group();
  for (const [m, list] of byMat) {
    const mesh = new THREE.Mesh(mergeGeometries(list), m);
    mesh.castShadow = m.transparent !== true || m.opacity > 0.5;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

export function makeStaticCar(spec, color, x, z, h) {
  const g = new THREE.Group();
  g.add(buildCarMesh(spec, color));
  g.position.set(x, 0, z); g.rotation.y = h;
  const baked = bake(g);
  return { mesh: baked, obstacle: { x, z, h, hl: spec.len / 2, hw: spec.wid / 2 } };
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.obstacles = new Obstacles();
    this.blocks = [];
    this.trees = [];
    this.lamps = [];
    makeTextures();
    this.root = new THREE.Group();
    scene.add(this.root);
    this.build();
  }

  addBox(x, y, z, sx, sy, sz, material, collide = true, rotY = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    m.position.set(x, y + sy / 2, z); m.rotation.y = rotY;
    m.castShadow = true; m.receiveShadow = true;
    this.root.add(m);
    if (collide) this.obstacles.add({ x, z, h: rotY, hl: sx / 2, hw: sz / 2 });
    return m;
  }

  plane(x, y, z, sx, sz, material, rotY = 0) {
    const g = new THREE.PlaneGeometry(sx, sz); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, material);
    m.position.set(x, y, z); m.rotation.y = rotY; m.receiveShadow = true;
    this.root.add(m); return m;
  }

  build() {
    // Земля
    const gt = TEX.ground.clone(); gt.needsUpdate = true; gt.repeat.set(120, 120);
    this.plane(0, -0.15, 0, 2400, 2400, new THREE.MeshStandardMaterial({ map: gt, roughness: 1 }));

    // Дороги
    const len = HALF * 2 + 40;
    const rt = TEX.road.clone(); rt.needsUpdate = true; rt.repeat.set(1, len / 14);
    const roadMat = new THREE.MeshStandardMaterial({ map: rt, roughness: 0.9 });
    const at = TEX.asphalt.clone(); at.needsUpdate = true; at.repeat.set(2, 2);
    const isecMat = new THREE.MeshStandardMaterial({ map: at, roughness: 0.9 });
    const zebraMat = new THREE.MeshStandardMaterial({ map: TEX.zebra, transparent: true, roughness: 0.8, depthWrite: false });
    for (const r of ROADS) {
      this.plane(r, 0.02, 0, ROAD_W, len, roadMat);
      this.plane(0, 0.025, r, ROAD_W, len, roadMat, Math.PI / 2);
    }
    for (const a of ROADS) for (const b of ROADS) {
      this.plane(a, 0.03, b, ROAD_W, ROAD_W, isecMat);
      for (const [dx, dz, rot] of [[0, 10, 0], [0, -10, 0], [10, 0, Math.PI / 2], [-10, 0, Math.PI / 2]])
        this.plane(a + dx, 0.035, b + dz, ROAD_W - 2, 5, zebraMat, rot);
    }

    // Кварталы
    const special = {
      '-60,-60': 'madrasa', '60,-60': 'square', '-60,60': 'gas', '180,60': 'autodrom',
      '60,60': 'parking', '-180,-60': 'bazaar', '180,-180': 'parking', '-180,180': 'park',
    };
    const randomTypes = ['apartments', 'apartments', 'apartments', 'offices', 'mahalla', 'mahalla', 'park', 'parking'];
    const swt = TEX.sidewalk.clone(); swt.needsUpdate = true; swt.repeat.set(26, 26);
    const swMat = new THREE.MeshStandardMaterial({ map: swt, roughness: 0.95 });
    for (const bx of BLOCKS) for (const bz of BLOCKS) {
      const type = special[`${bx},${bz}`] || pick(randomTypes);
      this.blocks.push({ x: bx, z: bz, type });
      this.plane(bx, 0.04, bz, 106, 106, swMat);
      this.curb(bx, bz);
      this[type](bx, bz);
      this.streetLamps(bx, bz);
    }

    this.mountains();
    this.finishInstances();
  }

  curb(bx, bz) {
    const m = mat('curb', { color: 0xd5d2c8, roughness: 0.8 });
    for (const [x, z, sx, sz] of [[bx, bz - 53, 106, 0.4], [bx, bz + 53, 106, 0.4], [bx - 53, bz, 0.4, 106], [bx + 53, bz, 0.4, 106]]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.12, sz), m);
      c.position.set(x, 0.06, z); c.receiveShadow = true; this.root.add(c);
    }
  }

  inner(bx, bz, tex, rep = 20, size = 96) {
    const t = TEX[tex].clone(); t.needsUpdate = true; t.repeat.set(rep, rep);
    return this.plane(bx, 0.06, bz, size, size, new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
  }

  building(x, z, w, d, floors, facadeIdx, rot = 0, roofColor = 0x8a8a88) {
    const h = floors * 3;
    const t = TEX.facades[facadeIdx].clone(); t.needsUpdate = true;
    t.repeat.set(Math.max(1, Math.round(Math.max(w, d) / 3)), floors);
    const fm = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
    const rm = mat('roof' + roofColor, { color: roofColor, roughness: 0.9 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [fm, fm, rm, rm, fm, fm]);
    m.position.set(x, h / 2, z); m.rotation.y = rot; m.castShadow = true; m.receiveShadow = true;
    this.root.add(m);
    // парапет и техэтаж
    this.addBox(x, h, z, w + 0.4, 0.6, d + 0.4, rm, false, rot);
    if (w > 10) this.addBox(x + (rnd() - 0.5) * w * 0.4, h + 0.6, z, 4, 2.2, 4, rm, false, rot);
    this.obstacles.add({ x, z, h: rot, hl: w / 2, hw: d / 2 });
    return m;
  }

  apartments(bx, bz) {
    this.inner(bx, bz, 'grass', 24);
    const f = pick([0, 1, 4, 5]);
    if (rnd() < 0.5) {
      this.building(bx - 22, bz - 26, 44, 13, 5 + Math.floor(rnd() * 5), f);
      this.building(bx + 28, bz + 6, 13, 50, 5 + Math.floor(rnd() * 5), f);
      this.building(bx - 22, bz + 30, 40, 13, 4 + Math.floor(rnd() * 5), pick([0, 1, 4, 5]));
    } else {
      this.building(bx - 28, bz, 14, 70, 9, f);
      this.building(bx + 18, bz - 30, 34, 14, 5 + Math.floor(rnd() * 4), f);
      this.building(bx + 18, bz + 30, 34, 14, 5 + Math.floor(rnd() * 4), f);
    }
    // дворовая площадка
    for (let i = 0; i < 10; i++) this.tree(bx + (rnd() - 0.5) * 60, bz + (rnd() - 0.5) * 30 + 5);
    for (let i = 0; i < 3; i++) this.parkedRandom(bx + 6 + i * 3, bz - 10, Math.PI / 2);
  }

  offices(bx, bz) {
    this.inner(bx, bz, 'asphalt', 12);
    this.building(bx - 20, bz - 20, 30, 30, 12 + Math.floor(rnd() * 10), 3, 0, 0x55606a);
    this.building(bx + 24, bz + 20, 26, 26, 6 + Math.floor(rnd() * 8), pick([2, 3]), 0, 0x55606a);
    this.building(bx + 24, bz - 26, 22, 18, 4, 2);
    for (let i = 0; i < 5; i++) this.parkedRandom(bx - 30 + i * 3.2, bz + 28, Math.PI / 2);
    for (let i = 0; i < 8; i++) this.tree(bx - 40 + i * 6, bz + 44);
  }

  mahalla(bx, bz) {
    this.inner(bx, bz, 'ground', 14);
    const wallMat = mat('mwall', { color: 0xcaa978, roughness: 1 });
    const gateMats = [mat('gate1', { color: 0x1f7a4a }), mat('gate2', { color: 0x2b5ea8 }), mat('gate3', { color: 0x8a4a1f })];
    const brick = new THREE.MeshStandardMaterial({ map: TEX.brick, roughness: 1 });
    // переулок посередине
    const lane = this.plane(bx, 0.07, bz, 8, 96, new THREE.MeshStandardMaterial({ map: TEX.asphalt, roughness: 1 }));
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
      const hx = bx + side * 27, hz = bz - 36 + i * 24;
      // забор двора
      this.addBox(hx - side * 21, 0, hz, 0.4, 2.2, 22, wallMat);
      this.addBox(hx, 0, hz - 11, 42, 2.2, 0.4, wallMat);
      const gate = this.addBox(hx - side * 21.1, 0, hz + 3, 0.2, 2.4, 3.6, pick(gateMats), false);
      // дом
      const fl = rnd() < 0.4 ? 2 : 1;
      const hm = new THREE.Mesh(new THREE.BoxGeometry(16, fl * 3.2, 9), brick);
      hm.position.set(hx + side * 6, fl * 1.6, hz - 2); hm.castShadow = hm.receiveShadow = true; this.root.add(hm);
      this.obstacles.add({ x: hx + side * 6, z: hz - 2, h: 0, hl: 8, hw: 4.5 });
      // шиферная крыша
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 6, 2.2, 4, 1), mat('slate', { color: 0x8c9196, roughness: 0.9 }));
      roof.scale.set(1.9, 1, 1.1); roof.rotation.y = Math.PI / 4;
      roof.position.set(hx + side * 6, fl * 3.2 + 1.1, hz - 2); roof.castShadow = true; this.root.add(roof);
      // виноградник/дерево во дворе
      this.tree(hx - side * 10, hz + 6, 0.8);
    }
  }

  park(bx, bz) {
    this.inner(bx, bz, 'grass', 24);
    const path = new THREE.MeshStandardMaterial({ map: TEX.sidewalk, roughness: 1 });
    this.plane(bx, 0.07, bz, 6, 96, path); this.plane(bx, 0.075, bz, 96, 6, path);
    for (let i = 0; i < 46; i++) {
      const x = bx + (rnd() - 0.5) * 90, z = bz + (rnd() - 0.5) * 90;
      if (Math.abs(x - bx) < 5 || Math.abs(z - bz) < 5) continue;
      this.tree(x, z, 0.8 + rnd() * 0.7);
    }
    this.fountain(bx, bz);
    const bench = mat('bench', { color: 0x7a4f2a });
    for (const [dx, dz, r] of [[8, 4, 0], [-8, -4, 0], [4, -8, Math.PI / 2], [-4, 8, Math.PI / 2]]) this.addBox(bx + dx, 0, bz + dz, 2.4, 0.5, 0.6, bench, true, r);
  }

  fountain(x, z) {
    const stone = mat('stone', { color: 0xdedad0, roughness: 0.7 });
    const water = mat('water', { color: 0x3fa7d6, metalness: 0.3, roughness: 0.1, transparent: true, opacity: 0.85 });
    const b = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.3, 0.7, 32), stone); b.position.set(x, 0.35, z); b.receiveShadow = b.castShadow = true;
    const w = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.1, 32), water); w.position.set(x, 0.65, z);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.8, 3, 12), stone); c.position.set(x, 1.5, z); c.castShadow = true;
    this.root.add(b, w, c);
    this.obstacles.add({ x, z, h: 0, hl: 4.6, hw: 4.6 });
  }

  square(bx, bz) {
    this.inner(bx, bz, 'grass', 24);
    const path = new THREE.MeshStandardMaterial({ map: TEX.sidewalk, roughness: 1 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(10, 18, 48).rotateX(-Math.PI / 2), path);
    ring.position.set(bx, 0.07, bz); ring.receiveShadow = true; this.root.add(ring);
    for (const r of [0, Math.PI / 2]) this.plane(bx, 0.068, bz, 6, 96, path, r);
    // памятник-колонна с куполом
    const stone = mat('stone', { color: 0xdedad0, roughness: 0.7 });
    this.addBox(bx, 0, bz, 6, 1.2, 6, stone);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 14, 20), stone); col.position.set(bx, 8, bz); col.castShadow = true; this.root.add(col);
    const gold = mat('gold', { color: 0xd4a72c, metalness: 1, roughness: 0.3 });
    const top = new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 16), gold); top.position.set(bx, 16, bz); top.castShadow = true; this.root.add(top);
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      this.tree(bx + Math.cos(ang) * 24, bz + Math.sin(ang) * 24, 1.1);
      this.tree(bx + Math.cos(ang) * 40, bz + Math.sin(ang) * 40, 1.3);
    }
  }

  madrasa(bx, bz) {
    this.inner(bx, bz, 'sidewalk', 30);
    const brick = new THREE.MeshStandardMaterial({ map: TEX.brick, roughness: 1 });
    const tiles = new THREE.MeshStandardMaterial({ map: TEX.tiles, roughness: 0.4 });
    const dark = mat('archdark', { color: 0x14324a, roughness: 0.6 });
    // основное здание
    this.addBox(bx, 0, bz - 10, 60, 11, 34, brick);
    // портал-пештак
    const px = bx, pz = bz + 8;
    this.addBox(px, 0, pz, 22, 22, 4, brick);
    const arch = new THREE.Shape();
    arch.moveTo(-6, 0); arch.lineTo(-6, 11); arch.quadraticCurveTo(-6, 17, 0, 19); arch.quadraticCurveTo(6, 17, 6, 11); arch.lineTo(6, 0); arch.closePath();
    const am = new THREE.Mesh(new THREE.ExtrudeGeometry(arch, { depth: 0.3, bevelEnabled: false }), tiles);
    am.position.set(px, 0, pz + 2.01); this.root.add(am);
    const inner = new THREE.Mesh(new THREE.ShapeGeometry(arch).scale(0.75, 0.85, 1), dark);
    inner.position.set(px, 0, pz + 2.33); this.root.add(inner);
    // купола
    for (const [dx, r] of [[-18, 6], [18, 6], [0, 9]]) {
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r * 0.85, 4, 32), tiles);
      drum.position.set(bx + dx, 13, bz - 12); drum.castShadow = true; this.root.add(drum);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), tiles);
      dome.scale.y = 1.25; dome.position.set(bx + dx, 15, bz - 12); dome.castShadow = true; this.root.add(dome);
    }
    // минареты
    for (const dx of [-31, 31]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.6, 30, 24), brick);
      m.position.set(bx + dx, 15, bz + 7); m.castShadow = true; this.root.add(m);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.2, 3, 24), tiles); band.position.set(bx + dx, 26, bz + 7); this.root.add(band);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(2.3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), tiles); cap.position.set(bx + dx, 30, bz + 7); this.root.add(cap);
      this.obstacles.add({ x: bx + dx, z: bz + 7, h: 0, hl: 2.6, hw: 2.6 });
    }
    for (let i = 0; i < 8; i++) { this.tree(bx - 42 + i * 12, bz + 32, 1); }
  }

  gas(bx, bz) {
    this.inner(bx, bz, 'asphalt', 12);
    const white = mat('white', { color: 0xf3f3f3, roughness: 0.5 });
    const green = mat('gasgreen', { color: 0x1e9e4a, roughness: 0.5, emissive: 0x0a3a1a });
    // навес
    const can = this.addBox(bx, 6, bz + 10, 34, 1.2, 18, white, false);
    this.addBox(bx, 5.6, bz + 10, 34.2, 0.4, 18.2, green, false);
    for (const dx of [-12, 12]) for (const dz of [4, 16]) this.addBox(bx + dx, 0, bz + dz, 0.8, 6, 0.8, white);
    for (const dx of [-8, 0, 8]) {
      this.addBox(bx + dx, 0, bz + 10, 2.4, 0.3, 1.2, white);
      this.addBox(bx + dx, 0.3, bz + 10, 1.2, 1.8, 0.8, green);
    }
    // магазин
    this.building(bx, bz - 30, 26, 12, 1, 3, 0, 0x1e9e4a);
    this.sign(bx, 9.4, bz + 19.3, 'METAN · BENZIN', '#1e9e4a');
    this.addBox(bx + 40, 0, bz + 40, 1, 12, 1, white);
    this.sign(bx + 40, 12, bz + 40.6, 'AZS 24/7', '#0f6b31', 6);
  }

  bazaar(bx, bz) {
    this.inner(bx, bz, 'ground', 14);
    const awn = ['#c8202a', '#0f9fb3', '#1eb53a', '#f1c40f', '#e67e22'].map(c => mat('awn' + c, { color: c, roughness: 0.8, side: THREE.DoubleSide }));
    const wood = mat('wood', { color: 0x8a5a2b });
    for (let r = 0; r < 4; r++) for (let i = 0; i < 7; i++) {
      const x = bx - 36 + i * 12, z = bz - 30 + r * 18;
      this.addBox(x, 0, z, 8, 1, 3, wood);
      const a = new THREE.Mesh(new THREE.BoxGeometry(9, 0.15, 5), pick(awn));
      a.position.set(x, 2.8, z); a.rotation.x = 0.15; a.castShadow = true; this.root.add(a);
      // фрукты
      const fruit = new THREE.Mesh(new THREE.BoxGeometry(7, 0.4, 2.4), pick([mat('melon', { color: 0xd9c040 }), mat('apple', { color: 0xb32020 }), mat('grape', { color: 0x5a2a6a }), mat('carrot', { color: 0xe07b1a })]));
      fruit.position.set(x, 1.2, z); this.root.add(fruit);
    }
    this.sign(bx, 6, bz + 46, 'BOZOR', '#0f9fb3', 14);
    this.addBox(bx - 8, 0, bz + 46, 0.6, 6, 0.6, wood); this.addBox(bx + 8, 0, bz + 46, 0.6, 6, 0.6, wood);
  }

  parking(bx, bz) {
    this.inner(bx, bz, 'asphalt', 12);
    const lineMat = mat('pline', { color: 0xf2f2f2, roughness: 0.6 });
    for (const row of [-30, -6, 18, 40]) for (let i = 0; i < 26; i++) {
      const x = bx - 45 + i * 3.6, z = bz + row;
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 5.5).rotateX(-Math.PI / 2), lineMat);
      l.position.set(x, 0.08, z); this.root.add(l);
      if (i < 25 && rnd() < 0.35) this.parkedRandom(x + 1.8, z, rnd() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    }
    this.sign(bx, 4, bz + 50, 'P', '#1d4fa8', 3);
  }

  autodrom(bx, bz) {
    this.inner(bx, bz, 'asphalt', 12, 100);
    const fence = mat('fence', { color: 0xc8202a, roughness: 0.6 });
    const white = mat('white', { color: 0xf3f3f3, roughness: 0.5 });
    // ограждение с въездом с запада
    for (let i = -50; i < 50; i += 4) {
      const m = (i / 4) % 2 ? fence : white;
      this.addBox(bx + i + 2, 0, bz - 50, 4, 0.9, 0.4, m);
      this.addBox(bx + i + 2, 0, bz + 50, 4, 0.9, 0.4, m);
      this.addBox(bx + 50, 0, bz + i + 2, 0.4, 0.9, 4, m);
      if (Math.abs(i + 2) > 8) this.addBox(bx - 50, 0, bz + i + 2, 0.4, 0.9, 4, m);
    }
    this.sign(bx - 50, 4, bz - 10, 'AVTODROM', '#c8202a', 10, Math.PI / 2);
    this.addBox(bx - 50, 0, bz - 15, 0.4, 4, 0.4, white, false); this.addBox(bx - 50, 0, bz - 5, 0.4, 4, 0.4, white, false);
  }

  sign(x, y, z, text, color, w = 16, rot = 0) {
    const t = canvasTex(512, 96, (g, W, H) => {
      g.fillStyle = color; g.fillRect(0, 0, W, H);
      g.fillStyle = '#fff'; g.font = 'bold 64px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, W / 2, H / 2 + 4);
    }, false);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 96 / 512), new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.25, side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = rot; this.root.add(m);
  }

  parkedRandom(x, z, h) {
    const spec = pick(CARS), col = pick(COLORS).hex;
    const c = makeStaticCar(spec, col, x, z, h);
    this.root.add(c.mesh); this.obstacles.add(c.obstacle);
  }

  tree(x, z, s = 1) { this.trees.push({ x, z, s: s * (0.8 + rnd() * 0.5) }); this.obstacles.add({ x, z, h: 0, hl: 0.35, hw: 0.35 }); }

  streetLamps(bx, bz) {
    for (let i = -45; i <= 45; i += 30) {
      for (const [x, z] of [[bx + i, bz - 51], [bx + i, bz + 51], [bx - 51, bz + i], [bx + 51, bz + i]]) {
        if (Math.abs(x - LEVEL_CENTER.x) < 52 && Math.abs(z - LEVEL_CENTER.z) < 52) continue;
        this.lamps.push({ x, z, ang: Math.atan2(bz - z, bx - x) });
        this.obstacles.add({ x, z, h: 0, hl: 0.15, hw: 0.15 });
      }
    }
  }

  finishInstances() {
    const dummy = new THREE.Object3D();
    const trunkG = new THREE.CylinderGeometry(0.18, 0.28, 3, 6);
    const crownG = new THREE.IcosahedronGeometry(2.2, 1);
    const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 }), this.trees.length);
    const crowns = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), this.trees.length);
    const col = new THREE.Color();
    this.trees.forEach((t, i) => {
      dummy.position.set(t.x, 1.5 * t.s, t.z); dummy.scale.setScalar(t.s); dummy.rotation.set(0, t.x, 0); dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.y = 3.8 * t.s; dummy.scale.set(t.s, t.s * 1.2, t.s); dummy.updateMatrix();
      crowns.setMatrixAt(i, dummy.matrix);
      crowns.setColorAt(i, col.setHSL(0.24 + Math.random() * 0.08, 0.5, 0.25 + Math.random() * 0.1));
    });
    trunks.castShadow = crowns.castShadow = true; crowns.receiveShadow = true;
    this.root.add(trunks, crowns);

    const poleG = new THREE.CylinderGeometry(0.1, 0.14, 8, 6);
    const armG = new THREE.BoxGeometry(2, 0.12, 0.12); armG.translate(1, 0, 0);
    const lampG = new THREE.BoxGeometry(0.7, 0.15, 0.35); lampG.translate(1.8, -0.12, 0);
    const steel = new THREE.MeshStandardMaterial({ color: 0x5a6068, metalness: 0.7, roughness: 0.4 });
    this.lampLightMat = new THREE.MeshStandardMaterial({ color: 0xfff1c0, emissive: 0xffd27a, emissiveIntensity: 0.2 });
    const n = this.lamps.length;
    const poles = new THREE.InstancedMesh(poleG, steel, n), arms = new THREE.InstancedMesh(armG, steel, n), heads = new THREE.InstancedMesh(lampG, this.lampLightMat, n);
    this.lamps.forEach((l, i) => {
      dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0);
      dummy.position.set(l.x, 4, l.z); dummy.updateMatrix(); poles.setMatrixAt(i, dummy.matrix);
      dummy.position.set(l.x, 7.9, l.z); dummy.rotation.set(0, -l.ang + Math.PI, 0); dummy.updateMatrix();
      arms.setMatrixAt(i, dummy.matrix); heads.setMatrixAt(i, dummy.matrix);
    });
    poles.castShadow = true;
    this.root.add(poles, arms, heads);
  }

  mountains() {
    const m = new THREE.MeshStandardMaterial({ color: 0x7d7a86, roughness: 1, flatShading: true });
    const snow = new THREE.MeshStandardMaterial({ color: 0xf4f6fa, roughness: 0.8, flatShading: true });
    for (let i = 0; i < 40; i++) {
      const ang = (i / 40) * Math.PI * 2 + rnd() * 0.1;
      const r = 760 + rnd() * 200, h = 80 + rnd() * 160, w = 120 + rnd() * 120;
      const g = new THREE.ConeGeometry(w, h, 7, 1);
      const cm = new THREE.Mesh(g, m); cm.position.set(Math.cos(ang) * r, h / 2 - 2, Math.sin(ang) * r); this.root.add(cm);
      const sg = new THREE.ConeGeometry(w * 0.3, h * 0.3, 7, 1);
      const sm = new THREE.Mesh(sg, snow); sm.position.set(cm.position.x, h - h * 0.15 - 2, cm.position.z); this.root.add(sm);
    }
  }
}
