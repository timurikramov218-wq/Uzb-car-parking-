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

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Машина: «велосипедная» модель с шинами. На малой скорости и задним ходом — кинематика
// (машина едет туда, куда смотрят колёса), на скорости — боковые силы шин с ограниченным сцеплением,
// поэтому появляются недостаточная поворачиваемость, занос на ручнике, крен и клевки кузова.
export class Vehicle {
  constructor(spec) { this.setSpec(spec); this.reset(0, 0, 0); }
  setSpec(spec) {
    this.spec = spec;
    this.hl = spec.len / 2; this.hw = spec.wid / 2;
    this.wheelBase = spec.len * 0.6;
    this.mass = spec.mass || 820 + (spec.len - 3.4) * 380;
    const a = this.wheelBase / 2;
    this.inertia = this.mass * a * a * 1.1;
  }
  reset(x, z, h) {
    this.x = x; this.z = z; this.h = h;
    this.vx = 0; this.vz = 0; this.r = 0; this.layer = 0; this._inStruct = false;
    this.speed = 0; this.lat = 0; this.steer = 0; this.braking = false; this.wheelRot = 0;
    this.roll = 0; this.pitch = 0; this.prevU = 0; this.skid = 0; this.y = 0; this.tPitch = 0; this.tRoll = 0; this.grade = 0;
  }

  update(dt, inp, obstacles, bounds) {
    const n = 4;
    for (let i = 0; i < n; i++) this.step(dt / n, inp);
    // крен и клевок для отрисовки
    const ax = (this.speed - this.prevU) / Math.max(dt, 1e-4); this.prevU = this.speed;
    const ay = this.speed * this.r;
    const k = 1 - Math.exp(-dt * 7);
    this.roll += (clamp(ay * 0.009, -0.075, 0.075) - this.roll) * k;
    this.pitch += (clamp(ax * 0.006, -0.05, 0.05) - this.pitch) * k;
    return this.collide(obstacles, bounds);
  }

  step(dt, inp) {
    const s = this.spec, m = this.mass, L = this.wheelBase, a = L / 2, b = L / 2;
    const fx = Math.cos(this.h), fz = -Math.sin(this.h), lx = fz, lz = -fx;
    let u = this.vx * fx + this.vz * fz;          // вперёд
    let w = this.vx * lx + this.vz * lz;          // вбок (влево +)

    // руль: плавно к цели, быстрее возвращается в ноль; на скорости угол меньше
    const steerIn = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
    const maxSteer = 0.64 / (1 + (u * u) / 220);
    const rate = (steerIn === 0 ? 2.8 : 1.7) * dt;
    this.steer += clamp(steerIn * maxSteer - this.steer, -rate, rate);

    // продольные силы
    let F = 0; this.braking = false;
    const drive = m * s.accel;
    const coasting = !inp.up && !inp.down;
    if (inp.up) { if (u < -0.3) { F += m * 10; this.braking = true; } else F += drive * Math.max(0, 1 - u / s.maxSpeed); }
    if (inp.down) { if (u > 0.3) { F -= m * 10; this.braking = true; } else if (u > -8) F -= drive * 0.55; }
    if (inp.brake) { F -= Math.sign(u) * m * 3.5; this.braking = true; }
    F -= Math.sign(u) * m * (coasting ? 0.7 : 0.15);         // качение и торможение двигателем
    F -= 0.38 * u * Math.abs(u);                              // воздух
    if (this.grade) F -= m * 9.81 * Math.max(-0.35, Math.min(0.35, this.grade));   // подъём и спуск
    let un = u + (F / m + w * this.r) * dt;
    if ((coasting || this.braking) && u * un < 0 && Math.abs(this.grade || 0) < 0.06) un = 0;     // не уезжать назад от торможения (на крутом склоне машина может скатиться)

    // боковая динамика
    const dyn = u > 0 ? smooth(3.5, 8, u) : 0;
    const rKin = (u * Math.tan(this.steer)) / L;
    let rDyn = this.r, wDyn = w;
    this.skid = 0;
    if (dyn > 0) {
      const g = 9.81, mu = 1.0;
      const Nf = (m * g * b) / L, Nr = (m * g * a) / L;
      const Cf = 9 * Nf, Cr = 10 * Nr;
      const af = Math.atan2(w + a * this.r, Math.abs(u)) - this.steer;
      const ar = Math.atan2(w - b * this.r, Math.abs(u));
      const rearMu = inp.brake ? 0.42 : 1;
      const Ffy = clamp(-Cf * af, -mu * Nf, mu * Nf);
      const Fry = clamp(-Cr * ar, -mu * rearMu * Nr, mu * rearMu * Nr);
      this.skid = Math.max(Math.abs(Cf * af) / (mu * Nf), Math.abs(Cr * ar) / (mu * rearMu * Nr));
      rDyn = this.r + ((a * Ffy * Math.cos(this.steer) - b * Fry) / this.inertia) * dt;
      wDyn = w + ((Ffy * Math.cos(this.steer) + Fry) / m - u * this.r) * dt;
    }
    this.r = rKin + (rDyn - rKin) * dyn;
    if (dyn > 0) {
      // угловая скорость не больше, чем позволяет сцепление (иначе машину «разворачивает» на любом повороте)
      const rMax = (9.81 * 1.1 / Math.max(Math.abs(u), 1)) * (inp.brake ? 1.9 : 1.2);
      const rc = clamp(this.r, -rMax, rMax);
      this.r += (rc - this.r) * dyn;
      if (!inp.brake) wDyn *= 1 - dt * 1.5;                 // шины гасят боковое скольжение
      if (this.skid > 1) un -= Math.sign(un) * Math.min(Math.abs(un), Math.min(this.skid - 1, 1.2) * 2.0 * dt);   // скольжение съедает скорость
    }
    w = wDyn * dyn;
    u = un;

    this.h += this.r * dt;
    const nfx = Math.cos(this.h), nfz = -Math.sin(this.h);
    this.vx = nfx * u + nfz * w; this.vz = nfz * u - nfx * w;
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.speed = u; this.lat = w;
    this.wheelRot -= (u / 0.31) * dt;
  }

  collide(obstacles, bounds) {
    let hit = 0;
    const respond = (m, soft) => {
      this.x += m.x; this.z += m.z;
      const d = Math.hypot(m.x, m.z) || 1, nx = m.x / d, nz = m.z / d;
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0) {
        hit = Math.max(hit, -vn * (soft ? 0.5 : 1));
        const e = soft ? 0.6 : 1.25;                       // отскок и потеря скорости
        this.vx -= e * vn * nx; this.vz -= e * vn * nz;
        this.vx *= 0.88; this.vz *= 0.88; this.r *= 0.5;
      }
    };
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      for (const o of obstacles.query(this.x, this.z, this.hl + 2)) { if ((o.layer || 0) !== (this.layer || 0)) continue; if (o.y0 !== undefined && ((this.y || 0) + 1.4 < o.y0 || (this.y || 0) + 0.25 > o.y1)) continue; const m = satOBB(this, o); if (m) { any = true; respond(m, false); } }
      if (this.extra) for (const o of this.extra) { const m = satOBB(this, o); if (m) { any = true; respond(m, true); } }
      if (!any) break;
    }
    if (bounds) {
      const b = bounds - this.hl;
      if (Math.abs(this.x) > b || Math.abs(this.z) > b) {
        hit = Math.max(hit, Math.hypot(this.vx, this.vz));
        this.x = clamp(this.x, -b, b); this.z = clamp(this.z, -b, b);
        this.vx *= -0.25; this.vz *= -0.25;
      }
    }
    const fx = Math.cos(this.h), fz = -Math.sin(this.h);
    this.speed = this.vx * fx + this.vz * fz;
    return hit;
  }
}
