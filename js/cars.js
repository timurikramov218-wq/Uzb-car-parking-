import * as THREE from 'three';

// Узбекский автопарк. Скорости в м/с, размеры в метрах.
export const CARS = [
  { id: 'matiz',  name: 'Matiz',   type: 'hatch', len: 3.50, wid: 1.50, hgt: 1.50, price: 0,     maxSpeed: 36, accel: 7.5, desc: 'Маленький, юркий, легко паркуется' },
  { id: 'damas',  name: 'Damas',   type: 'van',   len: 3.40, wid: 1.40, hgt: 1.90, price: 4000,  maxSpeed: 30, accel: 6.0, desc: 'Легенда маршруток' },
  { id: 'spark',  name: 'Spark',   type: 'hatch', len: 3.64, wid: 1.60, hgt: 1.52, price: 7000,  maxSpeed: 40, accel: 8.5, desc: 'Городской хэтчбек' },
  { id: 'nexia',  name: 'Nexia',   type: 'sedan', len: 4.48, wid: 1.66, hgt: 1.42, price: 12000, maxSpeed: 46, accel: 9.0, desc: 'Народный седан' },
  { id: 'cobalt', name: 'Cobalt',  type: 'sedan', len: 4.48, wid: 1.73, hgt: 1.51, price: 18000, maxSpeed: 48, accel: 9.5, desc: 'Самый популярный в Ташкенте' },
  { id: 'gentra', name: 'Gentra',  type: 'sedan', len: 4.52, wid: 1.73, hgt: 1.45, price: 25000, maxSpeed: 52, accel: 10.5, desc: 'Комфорт и скорость' },
  { id: 'tracker',name: 'Tracker', type: 'suv',   len: 4.27, wid: 1.79, hgt: 1.65, price: 35000, maxSpeed: 50, accel: 10.0, desc: 'Кроссовер для всего' },
  { id: 'malibu', name: 'Malibu',  type: 'sedan', len: 4.92, wid: 1.85, hgt: 1.47, price: 55000, maxSpeed: 62, accel: 12.5, desc: 'Бизнес-класс' },
];

export const COLORS = [
  { name: 'Белый',          hex: '#f2f2f0' },
  { name: 'Серебро',        hex: '#b8bcc2' },
  { name: 'Мокрый асфальт', hex: '#4a4f57' },
  { name: 'Чёрный',         hex: '#141518' },
  { name: 'Вишня',          hex: '#6e1022' },
  { name: 'Красный',        hex: '#c8202a' },
  { name: 'Синий',          hex: '#1d4fa8' },
  { name: 'Бирюза',         hex: '#0f9fb3' },
  { name: 'Зелёный',        hex: '#1e7a3a' },
  { name: 'Бежевый',        hex: '#cdb894' },
  { name: 'Жёлтый такси',   hex: '#f1c40f' },
];

export const carById = id => CARS.find(c => c.id === id) || CARS[0];

// Силуэты сбоку: x в долях длины (-0.5 зад .. 0.5 перёд), y в метрах для эталонной высоты
const PROFILES = {
  sedan: {
    body: [[-0.49,0.32],[-0.50,0.48],[-0.50,0.78],[-0.46,0.92],[-0.30,0.96],[0.20,0.92],[0.42,0.84],[0.495,0.72],[0.50,0.48],[0.49,0.32]],
    cabin: [[-0.31,0.94],[-0.17,1.38],[0.05,1.40],[0.21,0.92]],
    ref: 1.45,
  },
  hatch: {
    body: [[-0.49,0.32],[-0.50,0.48],[-0.50,0.94],[-0.45,0.98],[0.24,0.92],[0.42,0.84],[0.495,0.70],[0.50,0.48],[0.49,0.32]],
    cabin: [[-0.47,0.97],[-0.42,1.42],[0.06,1.46],[0.25,0.92]],
    ref: 1.50,
  },
  suv: {
    body: [[-0.49,0.42],[-0.50,0.58],[-0.50,1.04],[-0.45,1.08],[0.24,1.02],[0.43,0.96],[0.50,0.80],[0.50,0.58],[0.49,0.42]],
    cabin: [[-0.47,1.07],[-0.43,1.58],[0.08,1.60],[0.25,1.02]],
    ref: 1.65,
  },
  van: {
    body: [[-0.49,0.32],[-0.50,0.48],[-0.50,1.00],[0.44,1.00],[0.50,0.92],[0.50,0.48],[0.49,0.32]],
    cabin: [[-0.49,0.99],[-0.48,1.84],[0.30,1.86],[0.47,1.00]],
    ref: 1.90,
  },
};

const plateCache = new Map();
function plateTexture(text) {
  if (plateCache.has(text)) return plateCache.get(text);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 56;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 56);
  g.strokeStyle = '#111'; g.lineWidth = 4; g.strokeRect(2, 2, 252, 52);
  g.beginPath(); g.moveTo(52, 4); g.lineTo(52, 52); g.stroke();
  g.fillStyle = '#111'; g.font = 'bold 34px Arial'; g.textBaseline = 'middle';
  g.fillText(text.slice(0, 2), 8, 30);
  g.fillText(text.slice(2), 62, 30);
  // флаг Узбекистана
  const fx = 218, fy = 8;
  g.fillStyle = '#0099b5'; g.fillRect(fx, fy, 30, 8);
  g.fillStyle = '#fff'; g.fillRect(fx, fy + 8, 30, 8);
  g.fillStyle = '#1eb53a'; g.fillRect(fx, fy + 16, 30, 8);
  g.fillStyle = '#ce1126'; g.fillRect(fx, fy + 7.5, 30, 1); g.fillRect(fx, fy + 15.5, 30, 1);
  g.fillStyle = '#0099b5'; g.font = 'bold 15px Arial'; g.fillText('UZ', fx + 4, 44);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  plateCache.set(text, t);
  return t;
}

export function randomPlate() {
  const L = 'ABCDEFHKMOPSTXYZ';
  const r = n => L[Math.floor(Math.random() * L.length)];
  const region = ['01', '10', '20', '30', '40', '50', '60', '70', '75', '80', '85', '90', '95'][Math.floor(Math.random() * 13)];
  return `${region}${r()} ${String(Math.floor(Math.random() * 900) + 100)} ${r()}${r()}`;
}

const shared = {
  glass: new THREE.MeshStandardMaterial({ color: 0x0c1218, metalness: 0.6, roughness: 0.08, transparent: true, opacity: 0.88 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xc9ccd1, metalness: 0.9, roughness: 0.25 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.6 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 1, roughness: 0.15 }),
  head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 0.6 }),
};

function shapeFrom(points, L, sy) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x * L, y * sy) : s.moveTo(x * L, y * sy)));
  s.closePath();
  return s;
}
// Кузов: низ и бамперы прямые, верхний контур (багажник-крыша-капот) сглажен сплайном
function smoothShape(points, L, sy) {
  const P = points.map(([x, y]) => new THREE.Vector2(x * L, y * sy));
  const s = new THREE.Shape();
  s.moveTo(P[0].x, P[0].y); s.lineTo(P[1].x, P[1].y);
  s.splineThru(P.slice(2, P.length - 2));
  s.lineTo(P[P.length - 2].x, P[P.length - 2].y); s.lineTo(P[P.length - 1].x, P[P.length - 1].y);
  s.closePath();
  return s;
}

function extrude(shape, width, bevel = 0.06) {
  const depth = Math.max(0.1, width - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 6,
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return geo;
}

const archCache = new Map();
function archGeo(R) {
  if (!archCache.has(R)) archCache.set(R, new THREE.RingGeometry(R + 0.03, R + 0.11, 20, 1, 0, Math.PI));
  return archCache.get(R);
}

// Строит 3D модель. Передом смотрит по +X.
export function buildCarMesh(spec, colorHex, plate = randomPlate()) {
  const group = new THREE.Group();
  const prof = PROFILES[spec.type];
  const L = spec.len, W = spec.wid, sy = spec.hgt / prof.ref;

  const paint = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(colorHex), metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08,
  });

  const body = new THREE.Mesh(extrude(smoothShape(prof.body, L, sy), W, 0.13), paint);
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);

  // Стекло кабины (чуть уже кузова) + крыша цвета кузова
  const cabinShape = shapeFrom(prof.cabin, L, sy);
  const cabin = new THREE.Mesh(extrude(cabinShape, W - 0.2, 0.1), shared.glass);
  cabin.castShadow = true;
  group.add(cabin);

  const c = prof.cabin;
  const roofY = Math.max(c[1][1], c[2][1]) * sy;
  const roofX0 = c[1][0] * L, roofX1 = c[2][0] * L;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(roofX1 - roofX0 + 0.3, 0.07, W - 0.14), paint);
  roof.position.set((roofX0 + roofX1) / 2, roofY + 0.08, 0);
  roof.castShadow = true;
  group.add(roof);

  // Стойки (A, B, C) цвета кузова
  const belt = c[0][1] * sy;
  const pillar = (xb, xt, side) => {
    const h = roofY - belt;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, h + 0.05, 0.05), paint);
    p.position.set((xb + xt) / 2, belt + h / 2, side * (W / 2 - 0.08));
    p.rotation.z = -Math.atan2(xt - xb, h);
    group.add(p);
  };
  for (const s of [-1, 1]) {
    pillar(c[3][0] * L - 0.05, roofX1, s);
    pillar(c[0][0] * L + 0.05, roofX0, s);
    pillar((roofX0 + roofX1) / 2 - 0.1, (roofX0 + roofX1) / 2 - 0.1, s);
    // зеркала
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.16), paint);
    m.position.set(c[3][0] * L - 0.1, belt + 0.08, s * (W / 2 + 0.06));
    group.add(m);
    // ручки дверей
    const hnd = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), shared.chrome);
    hnd.position.set(0.05 * L, belt - 0.12, s * (W / 2 + 0.005));
    group.add(hnd);
    const hnd2 = hnd.clone(); hnd2.position.x = -0.18 * L; group.add(hnd2);
    // молдинг
    const mold = new THREE.Mesh(new THREE.BoxGeometry(L * 0.8, 0.04, 0.02), shared.dark);
    mold.position.set(0, 0.5 * sy, s * (W / 2 + 0.005));
    group.add(mold);
  }

  // Бамперы
  const fb = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, W - 0.05), shared.dark);
  fb.position.set(L / 2 + 0.08, 0.42 * sy, 0); group.add(fb);
  const rb = fb.clone(); rb.position.x = -L / 2 - 0.08; group.add(rb);

  // Решётка радиатора
  const frontTopY = prof.body.find(p => p[0] >= 0.49)?.[1] ?? 0.7;
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, W * 0.42), shared.dark);
  grille.position.set(L / 2 + 0.11, (frontTopY - 0.12) * sy, 0); group.add(grille);
  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.16), shared.chrome);
  badge.position.set(L / 2 + 0.135, (frontTopY - 0.12) * sy, 0); group.add(badge);

  // Фары
  const lights = { brake: [], head: [] };
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.3), shared.head);
    hl.position.set(L / 2 + 0.14, (frontTopY - 0.07) * sy, s * (W / 2 - 0.25));
    group.add(hl); lights.head.push(hl);
    const tlMat = new THREE.MeshStandardMaterial({ color: 0x8a0000, emissive: 0xff1010, emissiveIntensity: 0.3 });
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.28), tlMat);
    const rearTopY = prof.body[2][1];
    tl.position.set(-L / 2 - 0.14, (rearTopY - 0.12) * sy, s * (W / 2 - 0.22));
    group.add(tl); lights.brake.push(tlMat);
  }

  // Номера
  const pm = new THREE.MeshStandardMaterial({ map: plateTexture(plate), roughness: 0.5 });
  const pg = new THREE.PlaneGeometry(0.52, 0.115);
  const pf = new THREE.Mesh(pg, pm); pf.position.set(L / 2 + 0.145, 0.42 * sy, 0); pf.rotation.y = Math.PI / 2; group.add(pf);
  const pr = new THREE.Mesh(pg, pm); pr.position.set(-L / 2 - 0.145, 0.45 * sy, 0); pr.rotation.y = -Math.PI / 2; group.add(pr);

  // Колёса
  const R = spec.type === 'suv' ? 0.36 : spec.type === 'van' ? 0.28 : 0.31;
  const tireGeo = new THREE.CylinderGeometry(R, R, 0.2, 24); tireGeo.rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(R * 0.62, R * 0.62, 0.21, 12); rimGeo.rotateX(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(R * 1.1, 0.05, 0.215);
  const wheelBase = spec.type === 'van' ? L * 0.62 : L * 0.6;
  const wheels = [];
  for (const [fx, front] of [[wheelBase / 2 + (spec.type === 'van' ? 0.12 : 0.08), true], [-wheelBase / 2 + 0.05, false]]) {
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(fx, R, s * (W / 2 - 0.07));
      const spin = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, shared.tire); tire.castShadow = true;
      const rim = new THREE.Mesh(rimGeo, shared.rim);
      spin.add(tire, rim);
      for (let k = 0; k < 3; k++) {
        const sp = new THREE.Mesh(spokeGeo, shared.rim); sp.rotation.z = (k * Math.PI) / 3; spin.add(sp);
      }
      pivot.add(spin);
      // колёсная арка
      const arch = new THREE.Mesh(archGeo(R), shared.dark);
      arch.position.set(fx, R, s * (W / 2 + 0.006)); if (s < 0) arch.rotation.y = Math.PI;
      group.add(arch);
      group.add(pivot);
      wheels.push({ pivot, spin, front });
    }
  }

  // Мягкая тень под машиной
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.4, W + 0.4), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.03; group.add(shadow);

  group.userData = { wheels, lights, R, paint, wheelBase };
  return group;
}
