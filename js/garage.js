import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CARS, COLORS, buildCarMesh } from './cars.js';

// Гараж-ангар: большой арочный ангар с парковочными местами, автомастерской и поворотным подиумом.
// Стоит далеко за городом; пока открыт гараж или меню, город скрыт.
export const HANGAR = { x: -2600, z: 2600 };
const HG_L = 84, HG_W = 52, HG_H = 15;            // длина (x), ширина (z), высота

function htex(w, h, draw, rep = true) {
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
    // пол: эпоксидка, жёлтая разметка мест, номера, зона мастерской, круг подиума
    const floorTex = htex(2048, 1268, (g, w, h) => {
      g.fillStyle = '#5a5d62'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 26000; i++) { const v = 70 + Math.random() * 60 | 0; g.fillStyle = `rgba(${v},${v},${v + 4},0.25)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      const sx = w / HG_L, sz = h / HG_W, P = (x, z) => [(x + HG_L / 2) * sx, (z + HG_W / 2) * sz];
      g.strokeStyle = '#e8b62c'; g.lineWidth = 6; g.fillStyle = '#e8b62c'; g.font = 'bold 36px Arial'; g.textAlign = 'center';
      for (const sd of [-1, 1]) for (let k = 0; k < 10; k++) {          // места вдоль длинных стен
        const x = -HG_L / 2 + 22 + k * 3.8, z0 = sd * (HG_W / 2 - 1), z1 = sd * (HG_W / 2 - 7);
        const [a, b] = P(x, z0), [, c] = P(x, z1); g.beginPath(); g.moveTo(a, b); g.lineTo(a, c); g.stroke();
        const [nx, nz] = P(x + 1.9, sd * (HG_W / 2 - 6)); g.fillText(String(sd > 0 ? 11 + k : 1 + k), nx, nz + 12);
      }
      const [wx, wz] = P(HG_L / 2 - 20, -HG_W / 2 + 2); g.fillStyle = 'rgba(200,40,50,0.25)'; g.fillRect(wx, wz, 18 * sx, (HG_W - 4) * sz);   // мастерская
      g.setLineDash([24, 16]); g.strokeStyle = '#d8343f'; g.strokeRect(wx, wz, 18 * sx, (HG_W - 4) * sz); g.setLineDash([]);
      const [cx, cz] = P(-6, 0); g.strokeStyle = '#f2f0ea'; g.lineWidth = 8; g.beginPath(); g.arc(cx, cz, 7.5 * sx, 0, 7); g.stroke();
      for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(15,15,15,0.35)'; g.beginPath(); g.ellipse(Math.random() * w, Math.random() * h, 30 + Math.random() * 40, 18 + Math.random() * 20, Math.random() * 3, 0, 7); g.fill(); }   // масляные пятна
    }, false);
    const floorM = std({ map: floorTex, roughness: 0.35, metalness: 0.15 });
    const fl = new THREE.PlaneGeometry(HG_L, HG_W); fl.rotateX(-Math.PI / 2); this.add(floorM, fl);
    // стены из профлиста
    const ribs = htex(256, 256, (g, w, h) => { for (let x = 0; x < w; x += 32) { const gr = g.createLinearGradient(x, 0, x + 32, 0); gr.addColorStop(0, '#9aa0a6'); gr.addColorStop(0.5, '#c9ced3'); gr.addColorStop(1, '#9aa0a6'); g.fillStyle = gr; g.fillRect(x, 0, 32, h); } });
    ribs.repeat.set(HG_L / 4, 3);
    const wallM = std({ map: ribs, metalness: 0.4, roughness: 0.5, side: THREE.DoubleSide });
    for (const sd of [-1, 1]) { const g = new THREE.PlaneGeometry(HG_L, 8); g.translate(0, 4, 0); g.rotateY(sd > 0 ? Math.PI : 0); g.translate(0, 0, sd * HG_W / 2); this.add(wallM, g); }
    // арочная крыша (полуцилиндр по длине) с рёбрами и световыми полосами
    const roof = new THREE.CylinderGeometry(HG_W / 2, HG_W / 2, HG_L, 40, 1, true, 0, Math.PI); roof.rotateZ(Math.PI / 2); roof.scale(1, (HG_H - 8) / (HG_W / 2), 1); roof.translate(0, 8, 0);
    this.add(std({ color: 0xb7bcc2, metalness: 0.5, roughness: 0.45, side: THREE.DoubleSide }), roof);
    const steel = std({ color: 0x3d4248, metalness: 0.7, roughness: 0.4 });
    for (let x = -HG_L / 2; x <= HG_L / 2; x += 6) {
      const arch = new THREE.TorusGeometry(HG_W / 2 - 0.3, 0.18, 6, 32, Math.PI); arch.scale(1, (HG_H - 8) / (HG_W / 2), 1); arch.rotateY(Math.PI / 2); arch.translate(x, 8, 0); this.add(steel, arch);
      for (const sd of [-1, 1]) this.box(steel, x, 0, sd * (HG_W / 2 - 0.3), 0.35, 8, 0.35);
    }
    const lightM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3dc, emissiveIntensity: 1.6 });
    for (const zz of [-8, 0, 8]) { const g = new THREE.BoxGeometry(HG_L - 8, 0.12, 0.5); g.translate(0, HG_H - 0.6 - Math.abs(zz) * 0.12, zz); this.add(lightM, g); }
    // торцы: глухая стена и секционные ворота
    const doorTex = htex(512, 512, (g, w, h) => { g.fillStyle = '#c9ced3'; g.fillRect(0, 0, w, h); g.fillStyle = '#9aa0a6'; for (let y = 0; y < h; y += 64) g.fillRect(0, y, w, 6); g.fillStyle = 'rgba(30,40,50,0.6)'; for (let x = 40; x < w - 40; x += 90) g.fillRect(x, 160, 60, 30); });
    const endShape = () => { const s = new THREE.Shape(); s.moveTo(-HG_W / 2, 0); s.lineTo(HG_W / 2, 0); s.lineTo(HG_W / 2, 8); s.absellipse(0, 8, HG_W / 2, HG_H - 8, 0, Math.PI, false); s.lineTo(-HG_W / 2, 0); return s; };
    for (const sd of [-1, 1]) { const g = new THREE.ShapeGeometry(endShape(), 24); g.rotateY(sd > 0 ? -Math.PI / 2 : Math.PI / 2); g.translate(sd * HG_L / 2, 0, 0); this.add(std({ color: 0xa9afb5, metalness: 0.4, side: THREE.DoubleSide }), g); }
    const door = new THREE.PlaneGeometry(18, 8); door.rotateY(Math.PI / 2); door.translate(-HG_L / 2 + 0.05, 4, 0); this.add(std({ map: doorTex, metalness: 0.4 }), door);
    // подиум
    this.turn = new THREE.Group(); this.turn.position.set(-6, 0, 0); this.root.add(this.turn);
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.8, 0.3, 64), std({ color: 0x1b1c1f, metalness: 0.6, roughness: 0.3 })); plat.position.y = 0.15; plat.receiveShadow = true; this.turn.add(plat);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6.6, 0.07, 6, 96).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8343f, emissive: 0xd8343f, emissiveIntensity: 2 })); ring.position.y = 0.31; this.root.add(ring); ring.position.x = -6;
    this.workshop(std, steel);
    // машины на местах вдоль стен (облегчённые версии)
    let k = 0;
    for (const sd of [-1, 1]) for (let i = 0; i < 10; i++) {
      if ((i + (sd > 0 ? 1 : 0)) % 3 === 2) continue;     // часть мест свободна
      const spec = CARS[k % CARS.length], col = COLORS[(k * 3) % COLORS.length].hex; k++;
      const m = buildCarMesh(spec, col, undefined, true);
      m.position.set(-HG_L / 2 + 23.9 + i * 3.8, 0, sd * (HG_W / 2 - 4)); m.rotation.y = sd > 0 ? Math.PI / 2 : -Math.PI / 2;
      this.root.add(m);
    }
    for (const [m, list] of this.parts) { const mesh = new THREE.Mesh(mergeGeometries(list), m); mesh.receiveShadow = true; this.root.add(mesh); }
    // свет внутри
    this.lights = new THREE.Group(); this.root.add(this.lights);
    for (const x of [-30, -6, 18, 34]) { const p = new THREE.PointLight(0xfff1dc, 120, 40, 1.6); p.position.set(x, HG_H - 2, 0); this.lights.add(p); }
    for (const sd of [-1, 1]) { const s = new THREE.SpotLight(0xffffff, 400, 30, 0.5, 0.5, 1.4); s.position.set(-6 + sd * 6, 11, sd * 5); s.target.position.set(-6, 0, 0); this.lights.add(s, s.target); }
  }

  workshop(std, steel) {   // мастерская у дальнего торца
    const x0 = HG_L / 2 - 11;
    const red = std({ color: 0xc0282f, metalness: 0.4, roughness: 0.4 });
    const blue = std({ color: 0x2a5fb0, metalness: 0.4, roughness: 0.4 });
    const rubber = std({ color: 0x151515, roughness: 0.9 });
    // два двухстоечных подъёмника
    for (const zz of [-12, 6]) {
      for (const sd of [-1, 1]) { this.box(blue, x0, 0, zz + sd * 2.1, 0.5, 4.2, 0.5); this.box(steel, x0, 0, zz + sd * 2.1, 1.2, 0.15, 1.2); }
      this.box(blue, x0, 4.2, zz, 0.4, 0.3, 4.6);
      for (const sd of [-1, 1]) for (const fx of [-1, 1]) { const g = new THREE.BoxGeometry(1.8, 0.12, 0.18); g.rotateY(fx * 0.4); g.translate(x0 + fx * 0.9, 1.8, zz + sd * 1.7); this.add(steel, g); }
    }
    const lifted = buildCarMesh(CARS[2], COLORS[0].hex, undefined, true); lifted.position.set(x0, 1.9, -12); lifted.rotation.y = Math.PI / 2; this.root.add(lifted);
    // стеллаж с шинами
    for (let r = 0; r < 3; r++) { this.box(steel, x0 + 8, r * 1.2 + 0.6, -HG_W / 2 + 1.2, 6, 0.08, 1.2); for (let i = 0; i < 7; i++) { const t = new THREE.TorusGeometry(0.33, 0.13, 8, 16); t.rotateY(Math.PI / 2); t.translate(x0 + 5.4 + i * 0.8, r * 1.2 + 1.08, -HG_W / 2 + 1.2); this.add(rubber, t); } }
    for (const sd of [-1, 1]) for (const xx of [-3, 3]) this.box(steel, x0 + 8 + xx, 0, -HG_W / 2 + 1.2 + sd * 0.55, 0.08, 3.6, 0.08);
    // красные тумбы с инструментами, верстак, компрессор, бочки
    for (let i = 0; i < 4; i++) { this.box(red, x0 + 4 + i * 1.6, 0, HG_W / 2 - 1.2, 1.5, 1.05, 0.7); for (let d = 0; d < 4; d++) this.box(steel, x0 + 4 + i * 1.6, 0.18 + d * 0.22, HG_W / 2 - 1.56, 1.3, 0.03, 0.02); }
    this.box(std({ color: 0x8a6a45 }), x0 - 2, 0.95, HG_W / 2 - 1.2, 4, 0.1, 1); this.box(steel, x0 - 3.8, 0, HG_W / 2 - 1.2, 0.1, 0.95, 0.9); this.box(steel, x0 - 0.2, 0, HG_W / 2 - 1.2, 0.1, 0.95, 0.9);
    this.box(steel, x0 - 2, 1.05, HG_W / 2 - 1.2, 0.3, 0.2, 0.2);
    const pegs = htex(256, 128, g => { g.fillStyle = '#d9d9d4'; g.fillRect(0, 0, 256, 128); g.fillStyle = '#9a9a96'; for (let x = 8; x < 256; x += 16) for (let y = 8; y < 128; y += 16) g.fillRect(x, y, 3, 3); g.fillStyle = '#3d4248'; for (let i = 0; i < 9; i++) g.fillRect(14 + i * 26, 20 + (i % 3) * 8, 6, 70); }, false);
    const pg = new THREE.PlaneGeometry(6, 2.2); pg.rotateY(Math.PI); pg.translate(x0 - 2 + 1.5, 2.4, HG_W / 2 - 0.2); this.add(std({ map: pegs }), pg);
    const comp = new THREE.CylinderGeometry(0.45, 0.45, 1.6, 16); comp.rotateZ(Math.PI / 2); comp.translate(x0 + 8, 0.6, HG_W / 2 - 2); this.add(red, comp);
    for (let i = 0; i < 3; i++) { const d = new THREE.CylinderGeometry(0.35, 0.35, 1, 16); d.translate(HG_L / 2 - 1.5, 0.5, -4 + i * 0.8); this.add(i === 1 ? blue : red, d); }
    // шиномонтажный станок
    this.box(std({ color: 0x2a2d31, metalness: 0.5 }), x0 + 6, 0, 10, 1.2, 1, 1.2);
    const tc = new THREE.CylinderGeometry(0.55, 0.55, 0.15, 24); tc.translate(x0 + 6, 1.08, 10); this.add(steel, tc);
    this.box(std({ color: 0x2a2d31, metalness: 0.5 }), x0 + 6.5, 1, 10, 0.15, 1.4, 0.15);
    // вывеска мастерской
    const sign = htex(512, 128, g => { g.fillStyle = '#d8343f'; g.fillRect(0, 0, 512, 128); g.fillStyle = '#fff'; g.font = 'italic 800 64px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('AVTOSERVIS', 256, 68); }, false);
    const sg = new THREE.PlaneGeometry(10, 2.5); sg.rotateY(-Math.PI / 2); sg.translate(HG_L / 2 - 0.1, 9.5, 0); this.add(new THREE.MeshStandardMaterial({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.4 }), sg);
  }

  show(on) { this.root.visible = on; }

  setCar(mesh) {
    if (this.car) this.turn.remove(this.car);
    this.car = mesh; mesh.position.set(0, 0.3, 0); mesh.rotation.set(0, 0, 0); this.turn.add(mesh);
  }

  update(dt) { this.turn.rotation.y += dt * 0.25; }

  // кадр камеры: 'menu' — общий план ангара, 'garage' — облёт подиума
  camera(cam, mode, t, wide) {
    const ox = HANGAR.x - 6, oz = HANGAR.z;
    cam.up.set(0, 1, 0);
    if (mode === 'menu') {
      const a = Math.sin(t * 0.07) * 0.25;
      cam.position.set(ox - 30 + Math.sin(a) * 4, 5.5, oz + 16 + Math.cos(a) * 2);
      cam.lookAt(ox + (wide ? 2 : 6), 1.6, oz - 2);
    } else {
      const a = t * 0.18, R = wide ? 10 : 12;
      cam.position.set(ox + Math.cos(a) * R, 3, oz + Math.sin(a) * R);
      const sx = wide ? -Math.sin(a) * -2.4 : 0, sz = wide ? Math.cos(a) * -2.4 : 0;
      cam.lookAt(ox + sx, wide ? 0.9 : -0.4, oz + sz);
    }
  }
}
