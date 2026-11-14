import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CARS, COLORS, buildCarMesh } from './cars.js';

// Гараж-студия: тёмный зал с глянцевым полом, сотовыми светильниками на потолке,
// поворотным подиумом в центре и витринами с остальными машинами по бокам.
// Стоит далеко за городом; пока открыт гараж или меню, город скрыт.
export const HANGAR = { x: -2600, z: 2600 };
const ST_L = 44, ST_W = 30, ST_H = 7.2;            // длина (x), ширина (z), высота

function stex(w, h, draw, rep = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Hangar {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); this.root.position.set(HANGAR.x, 0, HANGAR.z);
    this.root.visible = false; scene.add(this.root);
    this.parts = new Map();
    this.build();
  }
  add(m, g) { if (!this.parts.has(m)) this.parts.set(m, []); this.parts.get(m).push(g.index ? g.toNonIndexed() : g); }
  box(m, x, y, z, sx, sy, sz, ry = 0) { const g = new THREE.BoxGeometry(sx, sy, sz); g.rotateY(ry); g.translate(x, y + sy / 2, z); this.add(m, g); }

  build() {
    const std = o => new THREE.MeshStandardMaterial({ roughness: 0.8, ...o });
    // пол: тёмная глянцевая эпоксидка с тонкой сеткой швов
    const floorTex = stex(1024, 1024, (g, w, h) => {
      g.fillStyle = '#1d1f24'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 20000; i++) { const v = 30 + Math.random() * 30 | 0; g.fillStyle = `rgba(${v},${v},${v + 6},0.35)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 3;
      for (let x = 0; x <= w; x += 256) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); g.beginPath(); g.moveTo(0, x); g.lineTo(w, x); g.stroke(); }
    });
    floorTex.repeat.set(ST_L / 8, ST_W / 8);
    const fl = new THREE.PlaneGeometry(ST_L, ST_W); fl.rotateX(-Math.PI / 2);
    this.add(std({ map: floorTex, roughness: 0.18, metalness: 0.35 }), fl);
    // стены: графитовые панели и вертикальные световые полосы
    const wallTex = stex(512, 512, (g, w, h) => {
      g.fillStyle = '#2a2d33'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 128) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, 0, 3, h); }
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, h / 2, w, 3);
      for (let i = 0; i < 6000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.03})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    });
    const wallM = std({ map: wallTex, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide });
    const led = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdfeaff, emissiveIntensity: 2.2 });
    const blueLed = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4ede2, emissiveIntensity: 1.3 });   // нейтральный тёплый белый
    for (const sd of [-1, 1]) {
      const g = new THREE.PlaneGeometry(ST_L, ST_H); g.translate(0, ST_H / 2, 0); g.rotateY(sd > 0 ? Math.PI : 0); g.translate(0, 0, sd * ST_W / 2);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ST_L / 6, uv.getY(i) * ST_H / 6); this.add(wallM, g);
      for (let x = -ST_L / 2 + 4; x < ST_L / 2; x += 6) this.box(led, x, 0.4, sd * (ST_W / 2 - 0.06), 0.12, ST_H - 1.2, 0.06);
    }
    for (const sd of [-1, 1]) {
      const g = new THREE.PlaneGeometry(ST_W, ST_H); g.translate(0, ST_H / 2, 0); g.rotateY(sd > 0 ? -Math.PI / 2 : Math.PI / 2); g.translate(sd * ST_L / 2, 0, 0);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * ST_W / 6, uv.getY(i) * ST_H / 6); this.add(wallM, g);
    }
    // плинтус-подсветка по периметру
    for (const sd of [-1, 1]) { this.box(blueLed, 0, 0.02, sd * (ST_W / 2 - 0.08), ST_L, 0.06, 0.1); this.box(blueLed, sd * (ST_L / 2 - 0.08), 0.02, 0, 0.1, 0.06, ST_W); }
    // потолок и сотовые светильники
    const ceil = new THREE.PlaneGeometry(ST_L, ST_W); ceil.rotateX(Math.PI / 2); ceil.translate(0, ST_H, 0); this.add(std({ color: 0x15161a, roughness: 0.9 }), ceil);
    const R = 1.25, seen = new Set(), hx = R * Math.sqrt(3);
    for (let row = -5; row <= 5; row++) for (let col = -7; col <= 7; col++) {
      const cx = col * hx + (row & 1 ? hx / 2 : 0), cz = row * R * 1.5;
      if (Math.abs(cx) > 15 || Math.abs(cz) > 8.6) continue;
      for (let k = 0; k < 6; k++) {
        const a0 = Math.PI / 6 + k * Math.PI / 3, a1 = a0 + Math.PI / 3;
        const x0 = cx + Math.cos(a0) * R, z0 = cz + Math.sin(a0) * R, x1 = cx + Math.cos(a1) * R, z1 = cz + Math.sin(a1) * R;
        const key = [Math.round((x0 + x1) * 50), Math.round((z0 + z1) * 50)].join(':'); if (seen.has(key)) continue; seen.add(key);
        const len = Math.hypot(x1 - x0, z1 - z0), g = new THREE.BoxGeometry(len, 0.05, 0.09);
        g.rotateY(-Math.atan2(z1 - z0, x1 - x0)); g.translate((x0 + x1) / 2, ST_H - 0.08, (z0 + z1) / 2); this.add(led, g);
      }
    }
    // поворотный подиум
    this.turn = new THREE.Group(); this.root.add(this.turn);
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.75, 0.24, 72), std({ color: 0x101114, metalness: 0.7, roughness: 0.25 }));
    plat.position.y = 0.12; plat.receiveShadow = true; this.turn.add(plat);
    const lines = new THREE.Mesh(new THREE.RingGeometry(1.2, 3.4, 72, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: stex(512, 64, (g, w, h) => { g.fillStyle = '#0d0e11'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,0.06)'; for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 2, h); }), metalness: 0.7, roughness: 0.3 }));
    lines.position.y = 0.245; this.turn.add(lines);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.045, 8, 128).rotateX(Math.PI / 2), blueLed); ring.position.y = 0.2; this.root.add(ring);
    const glow = new THREE.Mesh(new THREE.RingGeometry(3.75, 4.6, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, depthWrite: false }));
    glow.position.y = 0.01; this.root.add(glow);
    // витрины: остальные машины на низких платформах вдоль стен
    const podium = std({ color: 0x17181c, metalness: 0.5, roughness: 0.3 });
    const spots = [[-14, -9.6], [-5, -10.2], [5, -10.2], [14, -9.6], [-14, 9.6], [14, 9.6]];
    spots.forEach(([x, z], i) => {
      const r = Math.atan2(z, -x);                 // мордой к подиуму
      this.box(podium, x, 0, z, 5.6, 0.16, 2.9, r);
      for (const [lx, lz, sx, sz] of [[0, 1.46, 5.62, 0.04], [0, -1.46, 5.62, 0.04], [2.8, 0, 0.04, 2.9], [-2.8, 0, 0.04, 2.9]]) {
        const g = new THREE.BoxGeometry(sx, 0.05, sz); g.translate(lx, 0.14, lz); g.rotateY(r); g.translate(x, 0, z); this.add(blueLed, g);
      }
      const m = buildCarMesh(CARS[(i + 1) % CARS.length], COLORS[[0, 2, 1, 4, 3, 0][i] % COLORS.length].hex, undefined, true);
      m.position.set(x, 0.16, z); m.rotation.y = r; this.root.add(m);
    });
    // задняя стена: светящаяся вывеска
    const sign = stex(1024, 192, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = "300 84px 'Manrope', 'Helvetica Neue', Arial"; g.letterSpacing = '24px'; g.fillStyle = '#ffffff'; g.fillText('UZB CAR PARKING', w / 2, h / 2 - 6, w - 40);
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(w / 2 - 60, h - 20, 120, 3);
    }, false);
    const sg = new THREE.PlaneGeometry(12, 2.25); sg.rotateY(Math.PI / 2); sg.translate(-ST_L / 2 + 0.06, 4.4, 0);
    this.add(new THREE.MeshStandardMaterial({ map: sign, transparent: true, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 1.2 }), sg);
    // стойка с шинами и инструментальная тумба у правой стены
    const rubber = std({ color: 0x141414, roughness: 0.9 }), steel = std({ color: 0x8c939c, metalness: 0.7, roughness: 0.35 });
    for (let r = 0; r < 3; r++) { this.box(steel, 19, r * 1.1 + 0.5, 4, 1.2, 0.06, 5); for (let i = 0; i < 6; i++) { const t = new THREE.TorusGeometry(0.33, 0.13, 8, 16); t.translate(19, r * 1.1 + 0.99, 2 + i * 0.8); this.add(rubber, t); } }
    const tool = std({ color: 0x2f6bff, metalness: 0.4, roughness: 0.35 });
    for (let i = 0; i < 3; i++) { this.box(tool, 19.3, 0, -3 + i * 1.3, 1, 1.05, 1.25); for (let d = 0; d < 4; d++) this.box(steel, 18.78, 0.18 + d * 0.22, -3 + i * 1.3, 0.02, 0.03, 1.05); }
    for (const [m, list] of this.parts) { const mesh = new THREE.Mesh(mergeGeometries(list), m); mesh.receiveShadow = true; this.root.add(mesh); }
    // свет
    this.lights = new THREE.Group(); this.root.add(this.lights);
    for (const [x, z] of [[-10, 0], [10, 0], [0, -6], [0, 6]]) { const p = new THREE.PointLight(0xe8f0ff, 60, 26, 1.6); p.position.set(x, ST_H - 0.6, z); this.lights.add(p); }
    for (const [x, z] of [[5, 5], [-5, -5], [5, -5]]) { const s = new THREE.SpotLight(0xffffff, 260, 22, 0.45, 0.6, 1.3); s.position.set(x, ST_H - 0.4, z); s.target.position.set(0, 0.5, 0); this.lights.add(s, s.target); }
    const hemi = new THREE.HemisphereLight(0xbfd2ff, 0x101216, 0.6); hemi.position.y = 5; this.lights.add(hemi);
  }

  show(on) { this.root.visible = on; }

  setCar(mesh) {
    if (this.car) this.turn.remove(this.car);
    this.car = mesh; mesh.position.set(0, 0.24, 0); mesh.rotation.set(0, 0, 0); this.turn.add(mesh);
  }

  update(dt) { this.turn.rotation.y += dt * 0.22; }

  // кадр камеры: 'menu' — машина по центру, 'garage' — облёт, машина смещена влево от панели
  camera(cam, mode, t, wide) {
    const ox = HANGAR.x, oz = HANGAR.z;
    cam.up.set(0, 1, 0);
    if (mode === 'menu') {
      const a = 0.62 + Math.sin(t * 0.08) * 0.08, R = wide ? 8.6 : 11;
      cam.position.set(ox + Math.cos(a) * R, 2.1, oz + Math.sin(a) * R);
      cam.lookAt(ox, wide ? 0.55 : 0.2, oz);
    } else {
      const a = t * 0.16, R = wide ? 8.2 : 10.5;
      cam.position.set(ox + Math.cos(a) * R, 1.9, oz + Math.sin(a) * R);
      cam.lookAt(ox, wide ? 0.55 : 0.1, oz);
    }
  }
}
