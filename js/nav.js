import * as THREE from 'three';

// Навигатор: маршрут по графу дорог (Дейкстра), линия на дороге, на картах и стрелка с расстоянием.
function navOnEdge(world, x, z) {
  const q = world.roadHash.dist(x, z, 120, d => d.e.kind !== 'hwy' || true);
  if (!q.seg) return null;
  const d = q.seg.data; return { e: d.e, s: d.s0 + (d.s1 - d.s0) * q.t };
}
function navPts(e, s0, s1) {          // точки ребра от s0 к s1 (в любую сторону)
  const out = [], P = e.P, fwd = s1 >= s0, lo = Math.min(s0, s1), hi = Math.max(s0, s1);
  const at = s => { let i = P.findIndex(p => p.s >= s); if (i <= 0) i = 1; const a = P[i - 1], b = P[i] || a, t = (s - a.s) / ((b.s - a.s) || 1); return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: e.prof(s) }; };
  out.push(at(lo)); for (const p of P) if (p.s > lo && p.s < hi) out.push({ x: p.x, z: p.z, y: e.prof(p.s) }); out.push(at(hi));
  return fwd ? out : out.reverse();
}
export class Navigator {
  constructor(scene, world) {
    this.scene = scene; this.world = world; this.route = null; this.dest = null;
    this.mat = new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
  }
  setDest(x, z, from) { const t = navOnEdge(this.world, x, z); if (!t) return false; this.dest = t; return this.plan(from); }
  clear() { this.dest = null; this.route = null; if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; } }
  plan(from) {
    const st = navOnEdge(this.world, from.x, from.z), de = this.dest; if (!st || !de) return false;
    let pts;
    if (st.e === de.e) pts = navPts(st.e, st.s, de.s);
    else {
      const dist = new Map(), prev = new Map(), open = [];
      const push = (n, d, p) => { if (d < (dist.get(n) ?? Infinity)) { dist.set(n, d); prev.set(n, p); open.push([d, n]); } };
      push(st.e.a, st.s, { start: true, s: 0 }); push(st.e.b, st.e.P.len - st.s, { start: true, s: st.e.P.len });
      const done = new Set();
      while (open.length) {
        open.sort((a, b) => a[0] - b[0]); const [d, n] = open.shift(); if (done.has(n)) continue; done.add(n);
        for (const e of n.e) { const o = e.a === n ? e.b : e.a; push(o, d + e.P.len, { e, from: n }); }
      }
      const ca = (dist.get(de.e.a) ?? Infinity) + de.s, cb = (dist.get(de.e.b) ?? Infinity) + de.e.P.len - de.s;
      if (!isFinite(Math.min(ca, cb))) return false;
      const endN = ca <= cb ? de.e.a : de.e.b, chain = [];
      for (let n = endN; ;) { const p = prev.get(n); if (p.start) { chain.unshift({ e: st.e, s0: st.s, s1: p.s }); break; } chain.unshift({ e: p.e, s0: p.e.a === p.from ? 0 : p.e.P.len, s1: p.e.a === p.from ? p.e.P.len : 0 }); n = p.from; }
      chain.push({ e: de.e, s0: endN === de.e.a ? 0 : de.e.P.len, s1: de.s });
      pts = chain.flatMap(c => navPts(c.e, c.s0, c.s1));
    }
    let L = 0; pts.forEach((p, i) => { if (i) L += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z); p.d = L; });
    this.route = pts; this.idx = 0; this.build(); return true;
  }
  build() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    const R = this.route, pos = [], idx = [], W = 1.1;
    for (let i = 0; i < R.length; i++) {
      const a = R[Math.max(0, i - 1)], b = R[Math.min(R.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1, nx = -dz / l * W, nz = dx / l * W;
      pos.push(R[i].x + nx, R[i].y + 0.12, R[i].z + nz, R[i].x - nx, R[i].y + 0.12, R[i].z - nz);
      if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.renderOrder = 3; this.mesh.frustumCulled = false; this.scene.add(this.mesh);
  }
  // обновление: ближайшая точка маршрута, отклонение, остаток пути, точка «куда рулить»
  update(p) {
    const R = this.route; if (!R) return null;
    let best = this.idx, bd = Infinity;
    for (let i = Math.max(0, this.idx - 5); i < Math.min(R.length, this.idx + 60); i++) { const d = Math.hypot(R[i].x - p.x, R[i].z - p.z); if (d < bd) { bd = d; best = i; } }
    this.idx = best;
    const left = R[R.length - 1].d - R[best].d + bd;
    let k = best; while (k < R.length - 1 && R[k].d - R[best].d < 22) k++;
    return { off: bd, left, ahead: R[k], arrived: left < 14 };
  }
}
