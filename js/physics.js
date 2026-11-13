// 2D физика машины (вид сверху: x, z) и столкновения OBB по SAT.
// Угол h: вперёд = (cos h, -sin h).

export class Obstacles {
  constructor(cell = 24) { this.cell = cell; this.map = new Map(); this.list = []; }
  key(i, j) { return i * 100003 + j; }
  add(o) {
    o.r = Math.hypot(o.hl, o.hw);
    this.list.push(o);
    const c = this.cell;
    const i0 = Math.floor((o.x - o.r) / c), i1 = Math.floor((o.x + o.r) / c);
    const j0 = Math.floor((o.z - o.r) / c), j1 = Math.floor((o.z + o.r) / c);
    o._cells = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j);
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(o); o._cells.push(k);
    }
    return o;
  }
  remove(o) {
    for (const k of o._cells || []) {
      const a = this.map.get(k); if (!a) continue;
      const idx = a.indexOf(o); if (idx >= 0) a.splice(idx, 1);
    }
    const i = this.list.indexOf(o); if (i >= 0) this.list.splice(i, 1);
  }
  query(x, z, r) {
    const c = this.cell, out = new Set();
    const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c);
    const j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = this.map.get(this.key(i, j)); if (a) for (const o of a) out.add(o);
    }
    return out;
  }
}

function axes(h) { const c = Math.cos(h), s = Math.sin(h); return [[c, -s], [s, c]]; }

// Возвращает вектор выталкивания A из B или null
export function satOBB(a, b) {
  const A = axes(a.h), B = axes(b.h);
  const dx = b.x - a.x, dz = b.z - a.z;
  let best = Infinity, bx = 0, bz = 0;
  for (const ax of [A[0], A[1], B[0], B[1]]) {
    const ra = a.hl * Math.abs(A[0][0] * ax[0] + A[0][1] * ax[1]) + a.hw * Math.abs(A[1][0] * ax[0] + A[1][1] * ax[1]);
    const rb = b.hl * Math.abs(B[0][0] * ax[0] + B[0][1] * ax[1]) + b.hw * Math.abs(B[1][0] * ax[0] + B[1][1] * ax[1]);
    const d = dx * ax[0] + dz * ax[1];
    const o = ra + rb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; const sg = d > 0 ? -1 : 1; bx = ax[0] * sg * o; bz = ax[1] * sg * o; }
  }
  return { x: bx, z: bz, depth: best };
}

export class Vehicle {
  constructor(spec) { this.setSpec(spec); this.reset(0, 0, 0); }
  setSpec(spec) {
    this.spec = spec;
    this.hl = spec.len / 2; this.hw = spec.wid / 2;
    this.wheelBase = spec.len * 0.6;
  }
  reset(x, z, h) { this.x = x; this.z = z; this.h = h; this.speed = 0; this.steer = 0; this.braking = false; this.hits = 0; this.wheelRot = 0; }

  update(dt, inp, obstacles, bounds) {
    const s = this.spec;
    const steerIn = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
    this.braking = false;
    if (inp.up) {
      if (this.speed < -0.3) { this.speed += 14 * dt; this.braking = true; }
      else this.speed += s.accel * (1 - Math.max(0, this.speed) / s.maxSpeed) * dt;
    }
    if (inp.down) {
      if (this.speed > 0.3) { this.speed -= 14 * dt; this.braking = true; }
      else this.speed = Math.max(-9, this.speed - s.accel * 0.6 * dt);
    }
    if (!inp.up && !inp.down) {
      const f = 1.6 * dt;
      this.speed = Math.abs(this.speed) < f ? 0 : this.speed - Math.sign(this.speed) * f;
    }
    if (inp.brake) {
      const f = 16 * dt; this.braking = true;
      this.speed = Math.abs(this.speed) < f ? 0 : this.speed - Math.sign(this.speed) * f;
    }
    this.speed -= this.speed * 0.02 * dt;

    const maxSteer = 0.6 * (1 - Math.min(Math.abs(this.speed) / s.maxSpeed, 1) * 0.7);
    const target = steerIn * maxSteer;
    const rate = 2.8 * dt;
    this.steer += Math.max(-rate, Math.min(rate, target - this.steer));

    const drift = inp.brake && Math.abs(this.speed) > 8 ? 1.4 : 1;
    this.h += (this.speed / this.wheelBase) * Math.tan(this.steer) * dt * drift;
    this.x += Math.cos(this.h) * this.speed * dt;
    this.z -= Math.sin(this.h) * this.speed * dt;
    this.wheelRot -= (this.speed / s.len) * dt * 4.5;

    // столкновения
    let hit = 0;
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      for (const o of obstacles.query(this.x, this.z, this.hl + 2)) {
        const m = satOBB(this, o);
        if (!m) continue;
        any = true;
        this.x += m.x; this.z += m.z;
        const fx = Math.cos(this.h), fz = -Math.sin(this.h);
        const n = Math.hypot(m.x, m.z) || 1;
        const into = -(fx * m.x + fz * m.z) / n * this.speed;
        if (into > 0) { hit = Math.max(hit, Math.abs(this.speed)); this.speed *= -0.25; }
      }
      if (this.extra) for (const o of this.extra) {
        const m = satOBB(this, o); if (!m) continue;
        any = true; this.x += m.x; this.z += m.z;
        hit = Math.max(hit, Math.abs(this.speed) * 0.5); this.speed *= 0.5;
      }
      if (!any) break;
    }
    if (bounds) {
      const b = bounds - this.hl;
      if (Math.abs(this.x) > b || Math.abs(this.z) > b) {
        hit = Math.max(hit, Math.abs(this.speed));
        this.x = Math.max(-b, Math.min(b, this.x)); this.z = Math.max(-b, Math.min(b, this.z));
        this.speed *= -0.25;
      }
    }
    return hit;
  }
}
