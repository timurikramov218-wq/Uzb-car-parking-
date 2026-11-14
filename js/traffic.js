import * as THREE from 'three';
import { CARS, COLORS, buildCarMesh } from './cars.js';

// Машины-NPC: едут по своей полосе, на перекрёстках выбирают случайный поворот,
// стоят на красный, держат дистанцию, тормозят перед игроком. Живут только рядом с игроком.
const TR_N = 34, TR_R = 420, TR_SPAWN_MIN = 120;

function trAt(P, s) {
  s = Math.max(0, Math.min(P.len, s));
  let lo = 0, hi = P.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m; }
  const a = P[lo], b = P[hi], t = (s - a.s) / ((b.s - a.s) || 1);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: a.tx + (b.tx - a.tx) * t, tz: a.tz + (b.tz - a.tz) * t };
}

export class Traffic {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.cars = [];
    this.group = new THREE.Group(); scene.add(this.group);
    this.edges = world.edges.filter(e => e.kind !== 'tunnel' || true);
    this.pool = CARS.filter(c => c.lod).flatMap(c => Array(c.parked || 1).fill(c));
  }
  lane(e) { return e.kind === 'hwy' ? 3 : e.type === 'main' ? 1.9 : 2.2; }
  // поза на ребре: dir=+1 по направлению P, -1 — против
  pose(car) {
    if (car.conn) {                                  // поворот через перекрёсток — квадратичная кривая
      const { a, b, c } = car.conn, t = Math.min(1, car.s / car.conn.len), u = 1 - t;
      const x = u * u * a.x + 2 * u * t * c.x + t * t * b.x, z = u * u * a.z + 2 * u * t * c.z + t * t * b.z;
      const dx = 2 * u * (c.x - a.x) + 2 * t * (b.x - c.x), dz = 2 * u * (c.z - a.z) + 2 * t * (b.z - c.z);
      return { x, z, h: Math.atan2(-dz, dx), y: 0 };
    }
    const e = car.e, P = e.P, sAbs = car.dir > 0 ? car.s : P.len - car.s, p = trAt(P, sAbs), l = this.lane(e) * car.dir;
    const tx = p.tx * car.dir, tz = p.tz * car.dir;
    return { x: p.x - p.tz * l, z: p.z + p.tx * l, h: Math.atan2(-tz, tx), y: e.prof(sAbs) };
  }
  laneStart(e, dir) { const n = dir > 0 ? e.a : e.b, s = n.R + 1; return s; }
  laneEnd(e, dir) { const n = dir > 0 ? e.b : e.a; return e.P.len - n.R - 1; }
  spawn(px, pz) {
    for (let t = 0; t < 20; t++) {
      const e = this.edges[Math.floor(Math.random() * this.edges.length)];
      const mid = trAt(e.P, e.P.len / 2), d = Math.hypot(mid.x - px, mid.z - pz);
      if (d > TR_R - 40 || d < TR_SPAWN_MIN || e.P.len < 40) continue;
      const dir = Math.random() < 0.5 ? 1 : -1, s = this.laneStart(e, dir) + Math.random() * (this.laneEnd(e, dir) - this.laneStart(e, dir));
      if (this.cars.some(c => c.e === e && c.dir === dir && Math.abs(c.s - s) < 14)) continue;
      const spec = this.pool[Math.floor(Math.random() * this.pool.length)];
      const col = Math.random() < 0.55 ? COLORS[0].hex : COLORS[1 + Math.floor(Math.random() * (COLORS.length - 1))].hex;
      const mesh = buildCarMesh(spec, col, undefined, true); this.group.add(mesh);
      const car = { e, dir, s, v: 6, vmax: (e.kind === 'hwy' ? 19 : e.type === 'main' ? 14 : 10) * (0.85 + Math.random() * 0.3), spec, mesh, conn: null, ob: { x: 0, z: 0, h: 0, hl: spec.len / 2, hw: spec.wid / 2 } };
      this.cars.push(car); return car;
    }
    return null;
  }
  // следующий отрезок пути на узле
  nextLeg(car) {
    const e = car.e, node = car.dir > 0 ? e.b : e.a, out = node.e.filter(x => x !== e);
    const ne = out.length ? out[Math.floor(Math.random() * out.length)] : e;
    const ndir = ne.a === node ? 1 : -1;
    const from = this.pose(car), start = { e: ne, dir: ndir, s: this.laneStart(ne, ndir), conn: null };
    const to = this.pose(start);
    const c = { x: node.x, z: node.z }, len = Math.hypot(to.x - from.x, to.z - from.z) * 1.15 + 1;
    car.conn = { a: from, b: to, c, len, next: start }; car.s = 0;
  }
  signalRed(car) {
    const node = car.dir > 0 ? car.e.b : car.e.a, grp = node.grp?.get(car.e);
    if (!grp) return false;
    const st = this.world.signalState?.[grp]; return st === 'r' || st === 'y';
  }
  update(dt, player) {
    const px = player.x, pz = player.z;
    // убираем далёкие, добавляем новые
    for (let i = this.cars.length - 1; i >= 0; i--) { const c = this.cars[i], q = c.last || this.pose(c); if (Math.hypot(q.x - px, q.z - pz) > TR_R + 60) { this.group.remove(c.mesh); this.cars.splice(i, 1); } }
    for (let k = 0; k < 3 && this.cars.length < TR_N; k++) this.spawn(px, pz);
    const pf = { x: Math.cos(player.h), z: -Math.sin(player.h) };
    for (const c of this.cars) {
      const q = c.last || this.pose(c), fx = Math.cos(q.h), fz = -Math.sin(q.h);
      let target = c.vmax;
      // кто впереди: другие NPC и игрок
      let gap = 1e9;
      for (const o of this.cars) { if (o === c || !o.last) continue; const dx = o.last.x - q.x, dz = o.last.z - q.z, along = dx * fx + dz * fz, side = Math.abs(-dx * fz + dz * fx); if (along > 0 && along < gap && side < 2.2 && Math.abs((o.last.y || 0) - (q.y || 0)) < 2) gap = along; }
      { const dx = px - q.x, dz = pz - q.z, along = dx * fx + dz * fz, side = Math.abs(-dx * fz + dz * fx); if (along > 0 && side < 2.6 && Math.abs((player.y || 0) - (q.y || 0)) < 2) gap = Math.min(gap, along); }
      if (gap < 40) target = Math.min(target, Math.max(0, (gap - 7) * 0.8));
      // красный свет: стоп у стоп-линии
      if (!c.conn && this.signalRed(c)) { const left = this.laneEnd(c.e, c.dir) - c.s; if (left < 30) target = Math.min(target, Math.max(0, (left - 5) * 0.7)); }
      if (c.conn) target = Math.min(target, 7);
      c.v += Math.max(-7 * dt, Math.min(2.5 * dt, target - c.v));
      c.s += c.v * dt;
      if (c.conn) { if (c.s >= c.conn.len) { const n = c.conn.next; c.e = n.e; c.dir = n.dir; c.s = n.s; c.conn = null; } }
      else if (c.s >= this.laneEnd(c.e, c.dir)) this.nextLeg(c);
      const p = this.pose(c); c.last = p;
      c.mesh.position.set(p.x, p.y, p.z); c.mesh.rotation.set(0, p.h, 0);
      for (const w of c.mesh.userData.wheels || []) if (w.single) w.pivot.rotation.z -= c.v * dt / 0.31;
      Object.assign(c.ob, { x: p.x, z: p.z, h: p.h, y: p.y });
    }
    player.extra = this.cars.filter(c => Math.abs((c.last?.y || 0) - (player.y || 0)) < 2).map(c => c.ob);
  }
  setVisible(v) { this.group.visible = v; }
}
