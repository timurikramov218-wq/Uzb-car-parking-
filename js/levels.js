import * as THREE from 'three';
import { CARS, COLORS } from './cars.js';
import { makeStaticCar, LEVEL_CENTER } from './world.js';

const N = Math.PI / 2, S = -Math.PI / 2, E = 0;
const line = (x0, z0, x1, z1, step = 2) => {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / step)), out = [];
  for (let i = 0; i <= n; i++) out.push([x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]);
  return out;
};
const row = (x0, z, step, n, h, skip = []) => {
  const out = [];
  for (let i = 0; i < n; i++) if (!skip.includes(i)) out.push([x0 + i * step, z, h]);
  return out;
};
const garage = (x, z, dir) => {
  // dir: куда открыт гараж: 'E','W','N','S'. Внутренний размер 4.4 x 6.4
  const w = [];
  if (dir === 'S' || dir === 'N') {
    const back = dir === 'S' ? z - 3.4 : z + 3.4;
    w.push([x, back, 2.6, 0.2, 0], [x - 2.4, z, 0.2, 3.4, 0], [x + 2.4, z, 0.2, 3.4, 0]);
  } else {
    const back = dir === 'E' ? x - 3.4 : x + 3.4;
    w.push([back, z, 0.2, 2.6, 0], [x, z - 2.4, 3.4, 0.2, 0], [x, z + 2.4, 3.4, 0.2, 0]);
  }
  return w;
};

export const LEVELS = [
  { name: 'Первый шаг', desc: 'Заедь на свободное место передом', time: 60, reward: 300,
    start: [-36, 0, E], target: [10.8, -12, N], cars: row(-3.6, -12, 3.6, 7, N, [4]) },
  { name: 'Задний ход', desc: 'Припаркуйся задом между машинами', time: 75, reward: 400,
    start: [-36, 0, E], target: [7.2, -12, S], cars: row(-3.6, -12, 3.6, 7, S, [3]) },
  { name: 'Параллельная', desc: 'Параллельная парковка у бордюра', time: 90, reward: 500,
    start: [-40, 2, E], target: [-12, 8, E], cars: [[-30, 8, E], [-18.2, 8, E], [-5.8, 8, E], [6, 8, E]],
    cones: line(-40, 10.6, 20, 10.6, 1.6) },
  { name: 'Змейка', desc: 'Объедь конусы и заедь в гараж', time: 90, reward: 600,
    start: [-42, 0, E], target: [38, 0, E],
    cones: [...line(-46, -7, 30, -7), ...line(-46, 7, 30, 7), [-26, 2.5], [-26, 7], [-14, -2.5], [-14, -7], [-2, 2.5], [-2, 7], [10, -2.5], [10, -7]],
    walls: garage(38, 0, 'W') },
  { name: 'Под углом', desc: 'Парковка ёлочкой под 45°', time: 70, reward: 600,
    start: [-40, 2, E], target: [-2.4, -12, Math.PI / 4], cars: row(-15, -12, 4.2, 8, Math.PI / 4, [3]),
    cones: line(-40, -17, 25, -17, 2) },
  { name: 'Узкий проезд', desc: 'Проедь по коридору и встань на место', time: 100, reward: 800,
    start: [-40, -35, E], target: [20, 34, S],
    cones: [...line(-46, -39, 24, -39), ...line(-46, -31, 16, -31), ...line(24, -39, 24, 40), ...line(16, -31, 16, 30),
      ...line(16, 30, 18, 30), [22, 30], [16, 40], [18, 40], [20, 40], [22, 40]] },
  { name: 'Тесный двор', desc: 'Задом между машинами, мало места', time: 90, reward: 900,
    start: [-40, 0, E], target: [6, 9, N],
    cars: [...row(-15, -9, 3.0, 12, N, []), ...row(-15, 9, 3.0, 12, N, [7])],
    cones: [...line(-46, -13, 25, -13, 2.5), ...line(-46, 13, 25, 13, 2.5)] },
  { name: 'Гараж задом', desc: 'Развернись и заедь в гараж задом', time: 100, reward: 1000,
    start: [-36, 20, E], target: [30, -26, S], walls: garage(30, -26, 'S'),
    cars: [[22, -26, N], [38, -26, N]] },
  { name: 'Ташкентский центр', desc: 'Параллельная задом, места впритык', time: 80, reward: 1200,
    start: [-40, 2, E], target: [0, 8, E], cars: [[-24, 8, E], [-17.5, 8, E], [-6.2, 8, E], [6.0, 8, E], [12.5, 8, E]],
    cones: line(-40, 10.4, 25, 10.4, 1.4) },
  { name: 'Финал', desc: 'Лабиринт и парковка задом в гараж', time: 150, reward: 2000,
    start: [-42, -40, E], target: [-34, 38, E],
    walls: [[-14, -32, 36, 0.3, 0], [14, -16, 36, 0.3, 0], [-14, 0, 36, 0.3, 0], [14, 16, 36, 0.3, 0], ...garage(-34, 38, 'E')],
    cars: [[-34, 46, E], [-20, 44, N]] },
];

const coneGeo = new THREE.ConeGeometry(0.28, 0.75, 14); coneGeo.translate(0, 0.375, 0);
const coneMat = new THREE.MeshStandardMaterial({ color: 0xff5a10, roughness: 0.6 });
const wallMat = new THREE.MeshStandardMaterial({ color: 0xc9c5bb, roughness: 0.9 });

function targetTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(40,220,110,0.28)'; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#3dff8c'; g.lineWidth = 8; g.strokeRect(4, 4, 248, 120);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath(); g.moveTo(200, 64); g.lineTo(150, 30); g.lineTo(150, 50); g.lineTo(70, 50); g.lineTo(70, 78); g.lineTo(150, 78); g.lineTo(150, 98); g.closePath(); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 30px Arial'; g.fillText('P', 20, 74);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const tTex = targetTexture();

export class LevelRunner {
  constructor(scene, obstacles) { this.scene = scene; this.obstacles = obstacles; this.group = null; this.active = null; }

  start(idx, playerSpec) {
    this.clear();
    const L = LEVELS[idx], cx = LEVEL_CENTER.x, cz = LEVEL_CENTER.z;
    this.idx = idx; this.active = L; this.group = new THREE.Group(); this.added = [];
    this.timeLeft = L.time; this.hits = 0; this.holdTime = 0; this.done = false; this.hitCooldown = 0;
    const add = o => { this.obstacles.add(o); this.added.push(o); };
    let k = 0;
    for (const [x, z, h] of L.cars || []) {
      const spec = CARS[(k + idx) % CARS.length], col = (k * 7 + idx) % 5 === 0 ? COLORS[1 + (k % 3)].hex : COLORS[0].hex; k++;
      const c = makeStaticCar(spec, col, cx + x, cz + z, h);
      this.group.add(c.mesh); add(c.obstacle);
    }
    const cones = L.cones || [];
    if (cones.length) {
      const im = new THREE.InstancedMesh(coneGeo, coneMat, cones.length);
      const d = new THREE.Object3D();
      cones.forEach(([x, z], i) => { d.position.set(cx + x, 0, cz + z); d.updateMatrix(); im.setMatrixAt(i, d.matrix); add({ x: cx + x, z: cz + z, h: 0, hl: 0.25, hw: 0.25 }); });
      im.castShadow = true; this.group.add(im);
    }
    for (const [x, z, hl, hw, h] of L.walls || []) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(hl * 2, 1.4, hw * 2), wallMat);
      m.position.set(cx + x, 0.7, cz + z); m.rotation.y = h; m.castShadow = m.receiveShadow = true;
      this.group.add(m); add({ x: cx + x, z: cz + z, h, hl, hw });
    }
    const [tx, tz, th] = L.target;
    this.spot = { x: cx + tx, z: cz + tz, h: th, len: playerSpec.len + 1.1, wid: playerSpec.wid + 0.9 };
    const tm = new THREE.Mesh(new THREE.PlaneGeometry(this.spot.len, this.spot.wid).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tTex, transparent: true, depthWrite: false }));
    tm.position.set(this.spot.x, 0.09, this.spot.z); tm.rotation.y = th;
    this.targetMesh = tm; this.group.add(tm);
    // маяк над местом
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 30, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0x3dff8c, transparent: true, opacity: 0.18, depthWrite: false }));
    beam.position.set(this.spot.x, 15, this.spot.z); this.beam = beam; this.group.add(beam);
    this.scene.add(this.group);
    const [sx, sz, sh] = L.start;
    return { x: cx + sx, z: cz + sz, h: sh };
  }

  clear() {
    if (this.group) { this.scene.remove(this.group); this.group.traverse(o => o.geometry && o.geometry !== coneGeo && o.geometry.dispose()); }
    for (const o of this.added || []) this.obstacles.remove(o);
    this.added = []; this.group = null; this.active = null;
  }

  // возвращает 'win' | 'lose' | null
  update(dt, car, hit, t) {
    if (!this.active || this.done) return null;
    this.timeLeft -= dt;
    this.hitCooldown -= dt;
    if (hit > 0.8 && this.hitCooldown <= 0) { this.hits++; this.hitCooldown = 0.6; }
    this.targetMesh.material.opacity = 0.75 + Math.sin(t * 5) * 0.25;
    const s = this.spot;
    const dx = car.x - s.x, dz = car.z - s.z;
    const fx = Math.cos(s.h), fz = -Math.sin(s.h);
    const along = dx * fx + dz * fz, side = dx * -fz + dz * fx;
    let dh = Math.abs(((car.h - s.h) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    this.inside = Math.abs(along) < (s.len - car.spec.len) / 2 + 0.2 && Math.abs(side) < (s.wid - car.spec.wid) / 2 + 0.2 && dh < 0.18;
    this.targetMesh.material.color.set(this.inside ? 0xffffff : 0xaaffcc);
    if (this.inside && Math.abs(car.speed) < 0.4) this.holdTime += dt; else this.holdTime = 0;
    if (this.holdTime > 1.0) { this.done = true; return 'win'; }
    if (this.timeLeft <= 0) { this.done = true; return 'lose'; }
    return null;
  }

  stars() {
    const L = this.active;
    if (this.hits === 0 && this.timeLeft > L.time * 0.35) return 3;
    if (this.hits <= 2) return 2;
    return 1;
  }
}
