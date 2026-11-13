import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Горы к северо-востоку от города: шоссе Ташкент — Чарвак — Амирсай.
// Расстояния и высоты сжаты (реально ~65–100 км и подъём ~1200 м), чтобы доехать за пару минут.

const X0 = 450, X1 = 4350, Z0 = -4350, Z1 = -450, GN = 391;     // сетка рельефа 10 м
const STEP = (X1 - X0) / (GN - 1);
const CITY = 660;

// --- детерминированный шум ---
function thash(x, y) { let h = x * 374761393 + y * 668265263; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = thash(xi, yi), b = thash(xi + 1, yi), c = thash(xi, yi + 1), d = thash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 5) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
function ridged(x, y, oct = 5) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(vnoise(x * f, y * f) * 2 - 1)) ** 2; f *= 2.1; a *= 0.5; } return s; }
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Маршрут: от северо-восточного угла города через предгорья, вдоль южного берега Чарвака, серпантином к Амирсаю
const CTRL = [[600, -600], [820, -820], [1080, -1060], [1380, -1290], [1690, -1520], [1960, -1760], [2200, -1930], [2460, -2030],
  [2720, -2120], [2900, -2290], [2840, -2470], [2990, -2600], [3160, -2700], [3250, -2860]];
export const LAKE = { x: 2470, z: -2262, rx: 470, rz: 200, rot: -0.34 };

export class Terrain {
  constructor(scene, obstacles) {
    this.scene = scene; this.obstacles = obstacles;
    this.root = new THREE.Group(); scene.add(this.root);
    this.buildPath();
    this.buildHeights();
    this.buildMesh();
    this.buildRoad();
    this.buildLake();
    this.amirsoy();
    this.pines();
    this.signs();
    this.backdrop();
  }

  buildPath() {
    const curve = new THREE.CatmullRomCurve3(CTRL.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    const len = curve.getLength(), n = Math.ceil(len / 4);
    this.path = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, p = curve.getPointAt(t), tg = curve.getTangentAt(t);
      this.path.push({ x: p.x, z: p.z, tx: tg.x, tz: tg.z, s: t * len });
    }
    this.pathLen = len;
    const sLake0 = this.nearestS(2200, -1930), sLake1 = this.nearestS(2720, -2120);
    this.lakeS = [sLake0, sLake1];
    // высота дороги по длине: город → предгорья → берег Чарвака → подъём к Амирсаю
    this.roadH = s => {
      if (s < 500) return 0;
      if (s < sLake0) return 70 * sstep(500, sLake0, s);
      if (s < sLake1) return 70;
      return 70 + 105 * sstep(sLake1, len, s);
    };
    for (const p of this.path) p.y = this.roadH(p.s);
    // хеш точек пути для быстрых запросов расстояния
    this.bucket = new Map();
    const B = 40;
    this.path.forEach((p, i) => { const k = Math.floor(p.x / B) * 100000 + Math.floor(p.z / B); if (!this.bucket.has(k)) this.bucket.set(k, []); this.bucket.get(k).push(i); });
    this.B = B;
    this.end = this.path[this.path.length - 1];
  }

  nearestS(x, z) { let best = 0, bd = Infinity; for (const p of this.path) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = p.s; } } return best; }

  nearPath(x, z, r) {
    const B = this.B, i0 = Math.floor((x - r) / B), i1 = Math.floor((x + r) / B), j0 = Math.floor((z - r) / B), j1 = Math.floor((z + r) / B);
    let bd = Infinity, bp = null;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = this.bucket.get(i * 100000 + j); if (!a) continue;
      for (const k of a) { const p = this.path[k], d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bp = p; } }
    }
    return bp ? { d: Math.sqrt(bd), p: bp } : null;
  }

  lakeD(x, z) {     // нормированное расстояние до центра озера (<1 — внутри)
    const dx = x - LAKE.x, dz = z - LAKE.z, c = Math.cos(LAKE.rot), s = Math.sin(LAKE.rot);
    const u = dx * c - dz * s, v = dx * s + dz * c;
    const wob = 1 + (vnoise(x / 120, z / 120) - 0.5) * 0.35;
    return Math.hypot(u / LAKE.rx, v / LAKE.rz) / wob;
  }

  baseH(x, z) {
    if (Math.abs(x) < CITY && Math.abs(z) < CITY) return 0;
    const p = (x - z) / Math.SQRT2;
    const foot = sstep(900, 1900, p), mount = sstep(1900, 3800, p);
    let h = foot * (8 + 55 * fbm(x / 420, z / 420, 4)) + mount * (50 + 400 * ridged(x / 1000 + 7, z / 1000 - 3, 5));
    // к краям участка рельеф плавно уходит к степи (без обрыва)
    const edge = Math.min(x - X0, Z1 - z, X1 - x, z - Z0);
    h *= sstep(0, 520, edge);
    const ld = this.lakeD(x, z);
    if (ld < 1.6) { const water = 66; h = h * sstep(0.9, 1.6, ld) + (water - 18 * (1 - Math.min(ld, 1))) * (1 - sstep(0.9, 1.6, ld)); }
    // площадка Амирсая
    const e = this.end, de = Math.hypot(x - e.x, z - e.z);
    if (de < 260) h = h * sstep(110, 260, de) + this.roadH(e.s) * (1 - sstep(110, 260, de));
    return h;
  }

  buildHeights() {
    const H = this.H = new Float32Array(GN * GN);
    this.snowMask = new Float32Array(GN * GN);
    this.lift = this.liftLine();
    for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
      const x = X0 + i * STEP, z = Z0 + j * STEP;
      let h = this.baseH(x, z);
      const np = this.nearPath(x, z, 140);
      if (np) h = np.p.y + (h - np.p.y) * sstep(11, 30 + Math.min(110, Math.abs(h - np.p.y) * 0.9), np.d);     // полотно дороги и пологие откосы
      H[j * GN + i] = h;
      // снег на трассе вдоль подъёмника
      const L = this.lift, ax = L.b.x - L.a.x, az = L.b.z - L.a.z, t = Math.max(0, Math.min(1, ((x - L.a.x) * ax + (z - L.a.z) * az) / (ax * ax + az * az)));
      const dl = Math.hypot(x - (L.a.x + ax * t), z - (L.a.z + az * t));
      this.snowMask[j * GN + i] = t > 0.03 ? 1 - sstep(25, 60, dl) : 0;
    }
  }

  liftLine() {        // гондола: от площадки к ближайшей вершине на северо-восток
    const e = this.end;
    let best = null, bh = -1;
    for (let r = 500; r <= 900; r += 50) for (let a = -1.4; a <= 0.2; a += 0.1) {
      const x = e.x + Math.cos(a) * r, z = e.z + Math.sin(a) * r, h = this.baseH(x, z);
      if (h > bh && x < X1 - 60 && z > Z0 + 60) { bh = h; best = { x, z }; }
    }
    return { a: { x: e.x + 40, z: e.z - 30 }, b: best };
  }

  heightAt(x, z) {
    if (x < X0 || x > X1 || z < Z0 || z > Z1) return 0;
    const fx = (x - X0) / STEP, fz = (z - Z0) / STEP;
    const i = Math.min(GN - 2, Math.floor(fx)), j = Math.min(GN - 2, Math.floor(fz)), u = fx - i, v = fz - j;
    const H = this.H, a = H[j * GN + i], b = H[j * GN + i + 1], c = H[(j + 1) * GN + i], d = H[(j + 1) * GN + i + 1];
    return Math.max(0, a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v);
  }

  buildMesh() {
    const g = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0, GN - 1, GN - 1); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
    const dry = new THREE.Color(0xb7a676), green = new THREE.Color(0x6e8a47), dark = new THREE.Color(0x4d6b3a), rock = new THREE.Color(0x9a9184), snow = new THREE.Color(0xf1f4f8), sand = new THREE.Color(0xcdbb8f);
    for (let k = 0; k < pos.count; k++) {
      // PlaneGeometry после поворота: x слева направо, z сверху вниз (от -h/2 до h/2)
      const x = pos.getX(k) + (X0 + X1) / 2, z = pos.getZ(k) + (Z0 + Z1) / 2;
      const i = Math.round((x - X0) / STEP), j = Math.round((z - Z0) / STEP), h = this.H[j * GN + i];
      const inCity = Math.abs(x) < CITY + 20 && Math.abs(z) < CITY + 20;
      pos.setY(k, inCity ? -0.35 : h);
      const hx = this.H[j * GN + Math.min(GN - 1, i + 1)] - this.H[j * GN + Math.max(0, i - 1)], hz = this.H[Math.min(GN - 1, j + 1) * GN + i] - this.H[Math.max(0, j - 1) * GN + i];
      const slope = Math.hypot(hx, hz) / (2 * STEP);
      const n = fbm(x / 60, z / 60, 3);
      c.copy(dry).lerp(green, sstep(10, 60, h) * (0.75 + n * 0.4)).lerp(dark, sstep(140, 280, h) * 0.5);
      c.lerp(rock, sstep(0.6, 1.1, slope) * 0.85);
      const ld = this.lakeD(x, z); if (ld < 1.06 && ld > 0.9) c.lerp(sand, 0.6);
      c.lerp(snow, Math.max(sstep(330 + n * 60, 400 + n * 60, h), this.snowMask[j * GN + i] * sstep(160, 200, h)));
      c.multiplyScalar(0.88 + n * 0.24);
      col.set([c.r, c.g, c.b], k * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.translate((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
    g.computeVertexNormals();
    const detail = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const x = cv.getContext('2d'); x.fillStyle = '#808080'; x.fillRect(0, 0, 256, 256); for (let i = 0; i < 9000; i++) { const v = 90 + Math.random() * 90 | 0; x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); } const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; })();
    const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 400, uv.getY(k) * 400);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: detail, color: 0xb0b0b0 }));
    m.receiveShadow = true; this.root.add(m);
  }

  // Шоссе: лента по пути, 2+2 полосы с обочинами, отбойники в горах
  buildRoad() {
    const tex = (() => {
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512; const g = cv.getContext('2d');
      g.fillStyle = '#3e4044'; g.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 26000; i++) { const v = 80 + Math.random() * 120 | 0; g.fillStyle = `rgba(${v},${v},${v},0.35)`; g.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5); }
      g.fillStyle = '#7d7468'; g.fillRect(0, 0, 40, 512); g.fillRect(472, 0, 40, 512);                    // обочины
      g.fillStyle = '#efefe8'; g.fillRect(42, 0, 8, 512); g.fillRect(462, 0, 8, 512);                    // края
      g.fillRect(250, 0, 5, 512); g.fillRect(258, 0, 5, 512);                                            // двойная сплошная
      for (const x of [148, 360]) g.fillRect(x, 0, 6, 200);                                                // пунктир
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
    })();
    const W = 18, pos = [], uv = [], idx = [];
    this.path.forEach((p, i) => {
      const nx = -p.tz, nz = p.tx;
      for (const sd of [-1, 1]) {
        const x = p.x + nx * sd * W / 2, z = p.z + nz * sd * W / 2;
        pos.push(x, this.heightAt(x, z) + 0.12, z); uv.push(sd < 0 ? 0 : 1, p.s / 18);
      }
      if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k]; ix[k] = ix[k + 2]; ix[k + 2] = t; } g.computeVertexNormals(); }
    const road = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
    road.receiveShadow = true; this.root.add(road);
    // отбойники и столбики после выезда из предгорий
    const rails = [], posts = [];
    for (let i = 0; i < this.path.length - 2; i += 2) {
      const p = this.path[i], q = this.path[i + 2];
      if (p.s < 900) continue;
      const nx = -p.tz, nz = p.tx;
      for (const sd of [-1, 1]) {
        if (p.s > this.lakeS[0] && p.s < this.lakeS[1] && sd < 0) continue;          // со стороны озера — открытый вид
        const ax = p.x + nx * sd * 9.6, az = p.z + nz * sd * 9.6, bx = q.x - q.tz * sd * 9.6, bz = q.z + q.tx * sd * 9.6;
        const ya = this.heightAt(ax, az) + 0.75, yb = this.heightAt(bx, bz) + 0.75;
        const len = Math.hypot(bx - ax, bz - az);
        const r = new THREE.BoxGeometry(len + 0.05, 0.32, 0.06);
        r.rotateZ(Math.atan2(yb - ya, len)); r.rotateY(-Math.atan2(bz - az, bx - ax)); r.translate((ax + bx) / 2, (ya + yb) / 2, (az + bz) / 2); rails.push(r);
        if (i % 4 === 0) { const pg = new THREE.BoxGeometry(0.12, 0.9, 0.12); pg.translate(ax, ya - 0.3, az); posts.push(pg); }
        this.obstacles.add({ x: (ax + bx) / 2, z: (az + bz) / 2, h: -Math.atan2(bz - az, bx - ax), hl: len / 2, hw: 0.2 });
      }
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0xc9cdd2, metalness: 0.7, roughness: 0.35 });
    this.root.add(new THREE.Mesh(mergeGeometries(rails), steel), new THREE.Mesh(mergeGeometries(posts), steel));
  }

  buildLake() {        // Чарвакское водохранилище: бирюзовая вода
    const g = new THREE.CircleGeometry(1, 96); g.rotateX(-Math.PI / 2);
    g.scale(LAKE.rx * 1.45, 1, LAKE.rz * 1.45); g.rotateY(LAKE.rot); g.translate(LAKE.x, 66, LAKE.z);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x2aa6b8, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.92 }));
    this.root.add(m);
    // плотина на западной оконечности
    const c = Math.cos(LAKE.rot), s = Math.sin(LAKE.rot);
    const dx = -LAKE.rx * 1.02, dz = 0, x = LAKE.x + dx * c + dz * s, z = LAKE.z - dx * s + dz * c;
    const dam = new THREE.Mesh(new THREE.BoxGeometry(14, 40, LAKE.rz * 1.2), new THREE.MeshStandardMaterial({ color: 0xa9a59b, roughness: 0.9 }));
    dam.position.set(x, 50, z); dam.rotation.y = LAKE.rot; dam.castShadow = dam.receiveShadow = true; this.root.add(dam);
    this.lakeWater = m;
  }

  amirsoy() {          // курорт Амирсай: лодж, шале, гондола, парковка
    const e = this.end, y0 = this.roadH(e.s);
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5233, roughness: 0.85 });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x4a3221, roughness: 0.85 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x9a9286, roughness: 0.95 });
    const roofM = new THREE.MeshStandardMaterial({ color: 0x2c2f33, metalness: 0.4, roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x1d2b36, metalness: 0.6, roughness: 0.1 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x8e959d, metalness: 0.7, roughness: 0.4 });
    const parts = new Map(); const add = (m, g) => { if (!parts.has(m)) parts.set(m, []); parts.get(m).push(g); };
    const gable = (x, z, w, d, h, rh, rot, wallM) => {      // домик со скатной крышей
      const y = this.heightAt(x, z);
      const b = new THREE.BoxGeometry(w, h, d); b.translate(0, h / 2, 0); b.rotateY(rot); b.translate(x, y, z); add(wallM, b);
      const st = new THREE.BoxGeometry(w + 0.6, 1.2, d + 0.6); st.translate(0, -0.4, 0); st.rotateY(rot); st.translate(x, y, z); add(stone, st);
      const r = new THREE.CylinderGeometry(0.01, (d / 2 + 0.8) * Math.SQRT2, rh, 4, 1); r.rotateY(Math.PI / 4); r.scale(1, 1, (d / 2 + 0.8) / ((d / 2 + 0.8)));
      const roof = new THREE.BufferGeometry().copy(r); roof.scale((w / 2 + 0.8) / ((d / 2 + 0.8)), 1, 1); roof.translate(0, h + rh / 2, 0); roof.rotateY(rot); roof.translate(x, y, z); add(roofM, roof);
      const gl = new THREE.PlaneGeometry(w * 0.7, h * 0.6); gl.translate(0, h * 0.5, d / 2 + 0.02); gl.rotateY(rot); gl.translate(x, y, z); add(glass, gl);
      this.obstacles.add({ x, z, h: rot, hl: w / 2 + 0.3, hw: d / 2 + 0.3 });
    };
    // главный лодж у конца дороги
    const ang = Math.atan2(-e.tz, e.tx);
    const fx = e.tx, fz = e.tz, lx = -fz, lz = fx;
    gable(e.x + fx * 70 + lx * 25, e.z + fz * 70 + lz * 25, 38, 18, 9, 7, ang, wood);
    gable(e.x + fx * 70 - lx * 22, e.z + fz * 70 - lz * 22, 22, 14, 7, 5, ang, darkWood);
    // шале вокруг площадки
    for (let k = 0; k < 16; k++) {
      const a = -1.2 + k * 0.17, r = 140 + (k % 3) * 22;
      const x = e.x + Math.cos(a + ang) * r, z = e.z - Math.sin(a + ang) * r;
      gable(x, z, 7, 6, 4.2, 4.5, ang + a, k % 2 ? wood : darkWood);
    }
    // парковка
    const pk = new THREE.PlaneGeometry(60, 34); pk.rotateX(-Math.PI / 2); pk.rotateY(ang); pk.translate(e.x + fx * 25 - lx * 30, y0 + 0.1, e.z + fz * 25 - lz * 30);
    add(new THREE.MeshStandardMaterial({ color: 0x45474b, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }), pk);
    // гондола: нижняя станция, опоры, канаты и кабины
    const L = this.lift, ya = this.heightAt(L.a.x, L.a.z), yb = this.heightAt(L.b.x, L.b.z);
    const st = (x, z, y, rot) => { const b = new THREE.BoxGeometry(16, 7, 10); b.translate(0, 3.5, 0); b.rotateY(rot); b.translate(x, y, z); add(steel, b); const r = new THREE.BoxGeometry(18, 0.6, 12); r.translate(0, 7.3, 0); r.rotateY(rot); r.translate(x, y, z); add(roofM, r); this.obstacles.add({ x, z, h: rot, hl: 8, hw: 5 }); };
    const lineRot = -Math.atan2(L.b.z - L.a.z, L.b.x - L.a.x);
    st(L.a.x, L.a.z, ya, lineRot); st(L.b.x, L.b.z, yb, lineRot);
    const span = Math.hypot(L.b.x - L.a.x, L.b.z - L.a.z), towers = Math.max(3, Math.round(span / 140));
    const tops = [];
    for (let k = 0; k <= towers; k++) {
      const t = k / towers, x = L.a.x + (L.b.x - L.a.x) * t, z = L.a.z + (L.b.z - L.a.z) * t, y = this.heightAt(x, z);
      const hgt = k === 0 || k === towers ? 7 : 16;
      if (k > 0 && k < towers) {
        const p = new THREE.CylinderGeometry(0.5, 0.9, hgt, 8); p.translate(x, y + hgt / 2, z); add(steel, p);
        const arm = new THREE.BoxGeometry(0.4, 0.4, 7); arm.rotateY(lineRot); arm.translate(x, y + hgt, z); add(steel, arm);
        this.obstacles.add({ x, z, h: 0, hl: 0.8, hw: 0.8 });
      }
      tops.push(new THREE.Vector3(x, y + hgt, z));
    }
    const cables = [], cabins = [];
    for (let k = 0; k < tops.length - 1; k++) for (const sd of [-3, 3]) {
      const ox = Math.sin(lineRot) * sd, oz = Math.cos(lineRot) * sd;
      const a = tops[k].clone().add(new THREE.Vector3(ox, 0, oz)), b = tops[k + 1].clone().add(new THREE.Vector3(ox, 0, oz));
      const len = a.distanceTo(b), c = new THREE.CylinderGeometry(0.05, 0.05, len, 4);
      c.translate(0, len / 2, 0); c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())); c.translate(a.x, a.y, a.z); cables.push(c);
      for (let q = 0.25; q < 1; q += 0.5) {
        const pnt = a.clone().lerp(b, q), cab = new THREE.BoxGeometry(2.2, 2.2, 2); cab.rotateY(lineRot); cab.translate(pnt.x, pnt.y - 2.6, pnt.z); cabins.push(cab);
        const hang = new THREE.CylinderGeometry(0.06, 0.06, 1.4, 4); hang.translate(pnt.x, pnt.y - 0.8, pnt.z); cables.push(hang);
      }
    }
    add(new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6 }), mergeGeometries(cables));
    add(new THREE.MeshStandardMaterial({ color: 0xd8262f, roughness: 0.4 }), mergeGeometries(cabins));
    for (const [m, list] of parts) { const mesh = new THREE.Mesh(mergeGeometries(list.map(g => g.index ? g.toNonIndexed() : g)), m); mesh.castShadow = mesh.receiveShadow = true; this.root.add(mesh); }
    this.sign(e.x + fx * 40 + lx * 12, e.z + fz * 40 + lz * 12, 'AMIRSOY', '#7a5233', ang + Math.PI / 2, 4);
  }

  // Ель/сосна на склонах — отдельный инстансинг
  pines() {
    const spots = [];
    for (let k = 0; k < 9000 && spots.length < 2600; k++) {
      const x = X0 + thash(k, 11) * (X1 - X0), z = Z0 + thash(k, 29) * (Z1 - Z0);
      const p = (x - z) / Math.SQRT2; if (p < 1700) continue;
      const h = this.heightAt(x, z); if (h < 75 || h > 330) continue;
      if (this.lakeD(x, z) < 1.15) continue;
      const np = this.nearPath(x, z, 30); if (np && np.d < 22) continue;
      const e = this.end; if (Math.hypot(x - e.x, z - e.z) < 200) continue;
      const i = Math.round((x - X0) / STEP), j = Math.round((z - Z0) / STEP); if (this.snowMask[j * GN + i] > 0.3) continue;
      spots.push({ x, z, h, s: 0.7 + thash(k, 3) * 0.8 });
    }
    const crown = mergeGeometries([new THREE.ConeGeometry(2.4, 5, 9).translate(0, 4.5, 0), new THREE.ConeGeometry(1.9, 4.2, 9).translate(0, 7, 0), new THREE.ConeGeometry(1.2, 3.4, 9).translate(0, 9.4, 0)]);
    const trunk = new THREE.CylinderGeometry(0.2, 0.3, 3, 6).translate(0, 1.5, 0);
    const ci = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), spots.length);
    const ti = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x5a4330 }), spots.length);
    const d = new THREE.Object3D(), c = new THREE.Color();
    spots.forEach((p, i) => { d.position.set(p.x, p.h - 0.2, p.z); d.scale.setScalar(p.s); d.rotation.y = p.x; d.updateMatrix(); ci.setMatrixAt(i, d.matrix); ti.setMatrixAt(i, d.matrix); ci.setColorAt(i, c.setHSL(0.33 + thash(i, 5) * 0.05, 0.4, 0.16 + thash(i, 7) * 0.07)); });
    ci.castShadow = true; this.root.add(ci, ti);
  }

  sign(x, z, text, color, rot, h = 3, w = 9) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const g = cv.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, 512, 128); g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(8, 8, 496, 112);
    g.fillStyle = '#fff'; g.font = '600 56px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 68);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const y = this.heightAt(x, z);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide }));
    m.position.set(x, y + h + w / 8, z); m.rotation.y = rot; this.root.add(m);
    const steel = new THREE.MeshStandardMaterial({ color: 0x777d84, metalness: 0.6 });
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, h + w / 4, 6), steel); p.position.set(x + Math.cos(rot) * s * w * 0.4, y + (h + w / 4) / 2, z - Math.sin(rot) * s * w * 0.4); this.root.add(p); }
  }

  signs() {   // зелёные указатели на шоссе
    const at = (s, off) => { const p = this.path[Math.round(s / 4)]; return [p.x - p.tz * off, p.z + p.tx * off, Math.atan2(-p.tz, p.tx) + Math.PI / 2]; };
    const put = (s, text) => { const [x, z, r] = at(s, 13); this.sign(x, z, text, '#1f7a3e', r + Math.PI, 3.5, 11); };
    put(60, 'CHORVOQ · AMIRSOY');
    put(this.lakeS[0] - 120, 'CHORVOQ SUV OMBORI');
    put(this.lakeS[1] + 80, 'AMIRSOY 2 KM');
  }

  // дальние хребты за краем участка (Чаткальский и Пскемский хребты)
  backdrop() {
    const rock = new THREE.MeshStandardMaterial({ color: 0x9aa3b4, roughness: 1 }), snow = new THREE.MeshStandardMaterial({ color: 0xf4f6f9, roughness: 0.8 });
    const gs = [], ss = [];
    for (let k = 0; k < 34; k++) {
      const a = -Math.PI * 0.62 + (k / 33) * Math.PI * 0.62 + (thash(k, 1) - 0.5) * 0.05;   // от севера до востока
      const r = 5000 + thash(k, 2) * 900, w = 700 + thash(k, 3) * 600, h = 650 + thash(k, 4) * 650;
      const x = 1500 + Math.cos(a) * r, z = -1500 + Math.sin(a) * r;
      const g = new THREE.ConeGeometry(w, h, 10, 4); const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) < h / 2 - 1) { p.setX(i, p.getX(i) * (0.85 + thash(i, k) * 0.3)); p.setY(i, p.getY(i) + (thash(k, i) - 0.5) * h * 0.08); }
      g.computeVertexNormals(); g.translate(x, h / 2 - 5, z); gs.push(g.toNonIndexed());
      const sg = new THREE.ConeGeometry(w * 0.32, h * 0.32, 10, 1); sg.translate(x, h * 0.84 - 5, z); ss.push(sg.toNonIndexed());
    }
    this.root.add(new THREE.Mesh(mergeGeometries(gs), rock), new THREE.Mesh(mergeGeometries(ss), snow));
  }

  // для миникарты
  mapData() { return { path: this.path, lake: LAKE, end: this.end }; }
}
