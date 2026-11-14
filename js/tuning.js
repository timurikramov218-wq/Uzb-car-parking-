import * as THREE from 'three';

// Тюнинг: что можно поставить на машину. Цена платится один раз за каждый вариант.
export const TUNE = [
  { key: 'engine', name: 'Двигатель', opts: [[0, 'Сток', 0], [1, 'Stage 1', 400], [2, 'Stage 2', 900], [3, 'Stage 3', 1800]] },
  { key: 'susp', name: 'Подвеска', opts: [[0, 'Стандарт', 0], [-1, 'Занижение', 300], [1, 'Лифт', 300]] },
  { key: 'tint', name: 'Тонировка', opts: [[0, 'Нет', 0], [1, 'Тёмная', 200]] },
  { key: 'siren', name: 'Мигалки и сирена', opts: [[0, 'Нет', 0], [1, 'Красно-синие', 600], [2, 'Оранжевые', 400]] },
  { key: 'glow', name: 'Подсветка днища', opts: [['', 'Нет', 0], ['#3d7bff', 'Синяя', 250], ['#ff2d55', 'Красная', 250], ['#22e07a', 'Зелёная', 250], ['#b04bff', 'Фиолетовая', 250]] },
];
export const RIMS = [null, '#15161a', '#c9ccd1', '#d4a62a', '#e23b3b', '#2f6bff', '#f2f2f0'];

export const tuneOf = (save, id) => Object.assign({ engine: 0, susp: 0, tint: 0, glow: '', rims: null, siren: 0 }, save.tune?.[id]);

// характеристики с учётом мотора и износа
export function tunedSpec(spec, t, damage = 0) {
  const k = 1 + 0.12 * t.engine, slow = damage > 0.6 ? 1 - (damage - 0.6) * 1.2 : 1;
  return { ...spec, accel: spec.accel * k * slow, maxSpeed: spec.maxSpeed * (1 + 0.07 * t.engine) * slow };
}

let glowTex;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return (glowTex = new THREE.CanvasTexture(c));
}

// внешний тюнинг на готовой модели машины
export function applyTune(mesh, spec, t) {
  const body = mesh.userData.body; if (body) { body.position.y = t.susp * 0.05; body.userData.baseY = body.position.y; }
  // тонировка: прозрачные материалы стёкол темнее
  mesh.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m, i) => {
      if (!(m.transparent && m.opacity < 0.98) && !/glass|window|steklo/i.test(m.name || '')) return;
      if (!m.userData.tintOrig) { const c = m.clone(); c.userData.tintOrig = { color: m.color.clone(), opacity: m.opacity }; if (Array.isArray(o.material)) o.material[i] = c; else o.material = c; m = c; }
      const orig = m.userData.tintOrig;
      if (t.tint) { m.color.setHex(0x0b0d10); m.opacity = Math.max(orig.opacity, 0.88); m.transparent = true; } else { m.color.copy(orig.color); m.opacity = orig.opacity; }
    });
  });
  // цвет дисков: красим светлые металлические части колёс (резину не трогаем)
  for (const w of mesh.userData.wheels || []) w.pivot.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m, i) => {
      if (!m.userData.rimOrig) {
        const hsl = {}; m.color.getHSL(hsl);
        if (hsl.l < 0.18 && (m.metalness || 0) < 0.3) return;        // шина
        const c = m.clone(); c.userData.rimOrig = m.color.clone(); if (Array.isArray(o.material)) o.material[i] = c; else o.material = c; m = c;
      }
      if (t.rims) m.color.set(t.rims); else m.color.copy(m.userData.rimOrig);
    });
  });
  // подсветка днища
  if (mesh.userData.glow) { mesh.remove(mesh.userData.glow); mesh.userData.glow = null; }
  if (t.glow) {
    const m = new THREE.MeshBasicMaterial({ map: glowTexture(), color: t.glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(spec.len * 1.6, spec.wid * 2.4).rotateX(-Math.PI / 2), m);
    p.position.y = 0.04; p.renderOrder = 2; mesh.add(p); mesh.userData.glow = p;
  }
  // мигалки на крыше
  if (mesh.userData.lightbar) { (mesh.userData.body || mesh).remove(mesh.userData.lightbar); mesh.userData.lightbar = null; }
  if (t.siren) {
    const box = new THREE.Box3().setFromObject(mesh), top = box.max.y - mesh.position.y, L = Math.min(1.2, spec.wid * 0.75);
    const bar = new THREE.Group(), base = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, L), new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.6, roughness: 0.4 }));
    base.position.y = 0.03; bar.add(base);
    const cols = t.siren === 1 ? [0xff1a2a, 0x1f5bff] : [0xff9a00, 0xff9a00], lamps = [];
    cols.forEach((c, i) => { const m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.2, transparent: true, opacity: 0.9, roughness: 0.2 });
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.11, L * 0.46), m); lamp.position.set(0, 0.115, (i ? 1 : -1) * L * 0.25); bar.add(lamp); lamps.push(m); });
    const light = new THREE.PointLight(cols[0], 0, 14, 2); light.position.y = 0.5; bar.add(light);
    bar.position.set(-spec.len * 0.04, top, 0); bar.userData = { lamps, cols, light };
    mesh.add(bar); mesh.userData.lightbar = bar;
  }
}
