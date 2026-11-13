import * as THREE from 'three';
import { CARS, COLORS, CREDITS, carById, buildCarMesh, randomPlate, loadCarModels } from './cars.js';
import { Vehicle } from './physics.js';
import { World, HALF, VLINES, HLINES, W, SW, RING_IN, RING_OUT, CANAL_X, CANAL_W, SPAWN, LEVEL_CENTER } from './world.js';
import { LEVELS, LevelRunner } from './levels.js';

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('ru-RU');
const WHITE = COLORS[0].hex;

// ---------- Сохранение ----------
const SAVE_KEY = 'uzbcarparking-save-v2';
const save = Object.assign({ money: 1500, owned: ['matiz'], car: 'matiz', colors: {}, stars: {}, plate: randomPlate() },
  (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } })());
if (!CARS.some(c => c.id === save.car)) save.car = 'matiz';
save.owned = save.owned.filter(id => CARS.some(c => c.id === id)); if (!save.owned.includes('matiz')) save.owned.unshift('matiz');
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} };
const colorOf = id => save.colors[id] || WHITE;          // все машины по умолчанию белые

// ---------- Рендер ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 4000);
scene.fog = new THREE.Fog(0xdfe6ea, 250, 2200);
{
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x6aa7d8) }, bottom: { value: new THREE.Color(0xe4ebef) } },
    vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 p; void main(){ float t = clamp(p.y*1.8,0.,1.); gl_FragColor = vec4(mix(bottom, top, pow(t,0.6)),1.); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), m); sky.renderOrder = -1; scene.add(sky); scene.userData.sky = sky;
}
scene.add(new THREE.HemisphereLight(0xdfeeff, 0x9a8a6a, 1.0));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.5);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 500 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const SUN_OFF = new THREE.Vector3(90, 160, 60);

function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

let world, levels, player, playerMesh;
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

// ---------- Ввод ----------
const input = { up: false, down: false, left: false, right: false, brake: false, horn: false };
const KEYS = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'brake', KeyH: 'horn' };
addEventListener('keydown', e => {
  if (KEYS[e.code]) { input[KEYS[e.code]] = true; if (playing()) e.preventDefault(); }
  if (e.code === 'Escape') { if (playing()) openMenu(); else if (!$('levels').hidden || !$('garage').hidden) closeSheets(); }
  if (!playing()) return;
  if (e.code === 'KeyC') cycleCam();
  if (e.code === 'KeyR') resetCar();
});
addEventListener('keyup', e => { if (KEYS[e.code]) input[KEYS[e.code]] = false; });
addEventListener('blur', () => Object.keys(input).forEach(k => (input[k] = false)));

const isTouch = matchMedia('(pointer: coarse)').matches;
document.querySelectorAll('#touch button').forEach(b => {
  const k = b.dataset.k;
  const on = e => { e.preventDefault(); b.classList.add('on'); if (k === 'cam') cycleCam(); else input[k] = true; audio.init(); };
  const off = e => { e.preventDefault(); b.classList.remove('on'); if (k !== 'cam') input[k] = false; };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
});

// ---------- Звук ----------
const audio = {
  ctx: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = ctx.createGain(); this.master.gain.value = 0.45; this.master.connect(ctx.destination);
      this.eng = ctx.createOscillator(); this.eng.type = 'sawtooth';
      this.eng2 = ctx.createOscillator(); this.eng2.type = 'triangle';
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520;
      this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
      this.eng.connect(lp); this.eng2.connect(lp); lp.connect(this.engGain); this.engGain.connect(this.master);
      this.eng.start(); this.eng2.start();
      this.hornGain = ctx.createGain(); this.hornGain.gain.value = 0; this.hornGain.connect(this.master);
      for (const f of [415, 520]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(this.hornGain); o.start(); }
    } catch { this.ctx = null; }
  },
  update(speed, throttle, horn, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, v = Math.abs(speed);
    const rpm = 42 + (v % 12) * 7 + v * 1.1 + (throttle ? 14 : 0);
    this.eng.frequency.setTargetAtTime(rpm, t, 0.05); this.eng2.frequency.setTargetAtTime(rpm * 0.5, t, 0.05);
    this.engGain.gain.setTargetAtTime(active ? 0.1 + (throttle ? 0.05 : 0) : 0, t, 0.1);
    this.hornGain.gain.setTargetAtTime(horn && active ? 0.07 : 0, t, 0.02);
  },
  thump(v) {
    if (!this.ctx) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(120, c.currentTime); o.frequency.exponentialRampToValueAtTime(40, c.currentTime + 0.25);
    g.gain.setValueAtTime(Math.min(0.5, v / 15), c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);
    o.connect(g); g.connect(this.master); o.start(); o.stop(c.currentTime + 0.3);
  },
  ding() {
    if (!this.ctx) return;
    const c = this.ctx;
    [660, 880, 1320].forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; const t0 = c.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + 0.45);
    });
  },
};
addEventListener('pointerdown', () => audio.init());
addEventListener('keydown', () => audio.init());

// ---------- Машина игрока ----------
function rebuildPlayer() {
  if (playerMesh) scene.remove(playerMesh);
  player.setSpec(carById(save.car));
  playerMesh = buildCarMesh(player.spec, colorOf(save.car), save.plate);
  scene.add(playerMesh); syncMesh(playerMesh, player);
}
function syncMesh(mesh, v) {
  mesh.position.set(v.x, 0, v.z); mesh.rotation.y = v.h;
  for (const w of mesh.userData.wheels) {
    if (w.single) w.pivot.rotation.set(0, w.front ? v.steer : 0, v.wheelRot);
    else { w.spin.rotation.z = v.wheelRot; if (w.front) w.pivot.rotation.y = v.steer; }
  }
  for (const m of mesh.userData.lights.brake) m.emissiveIntensity = v.braking ? 2.5 : 0.35;
}

// ---------- Камера ----------
const CAMS = [{ dist: 7, h: 2.8 }, { dist: 12, h: 5 }, { top: true }, { inside: true }];
const CAM_NAMES = ['Камера сзади', 'Камера дальняя', 'Камера сверху', 'Вид из салона'];
let camIdx = 0, camHeading = 0;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function cycleCam() { camIdx = (camIdx + 1) % CAMS.length; toast(CAM_NAMES[camIdx]); }
function updateCamera(dt, snap = false) {
  const c = CAMS[camIdx];
  let dh = player.h - camHeading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  camHeading += dh * (snap ? 1 : 1 - Math.exp(-dt * 4));
  const fx = Math.cos(camHeading), fz = -Math.sin(camHeading);
  const want = new THREE.Vector3(), look = new THREE.Vector3(player.x, 1, player.z);
  if (c.inside) {
    const s = player.spec, hx = Math.cos(player.h), hz = -Math.sin(player.h);
    camPos.set(player.x - hx * s.len * 0.08 + hz * 0.32, s.hgt * 0.78, player.z - hz * s.len * 0.08 - hx * 0.32);
    camLook.set(player.x + hx * 20, s.hgt * 0.7, player.z + hz * 20);
  } else {
    if (c.top) want.set(player.x - fx * 0.01, 34, player.z - fz * 0.01);
    else { want.set(player.x - fx * c.dist, c.h, player.z - fz * c.dist); look.y = 1; }
    const k = snap ? 1 : 1 - Math.exp(-dt * 5);
    camPos.lerp(want, k); camLook.lerp(look, k);
  }
  camera.up.set(c.top ? fx : 0, c.top ? 0 : 1, c.top ? fz : 0);
  camera.position.copy(camPos); camera.lookAt(camLook);
  playerMesh.visible = !c.inside;
}

// ---------- Мини-карта ----------
const mm = $('minimap'), mctx = mm.getContext('2d');
const MAP_PX = 1280, MS = MAP_PX / (HALF * 2);
const mapCanvas = document.createElement('canvas'); mapCanvas.width = mapCanvas.height = MAP_PX;
function drawMapBase() {
  const g = mapCanvas.getContext('2d'), P = v => (v + HALF) * MS;
  g.fillStyle = '#e6e2d8'; g.fillRect(0, 0, MAP_PX, MAP_PX);
  g.fillStyle = '#cfdcc0'; for (const r of [[0, 0, RING_IN]]) { g.beginPath(); g.arc(P(r[0]), P(r[1]), r[2] * MS, 0, 7); g.fill(); }
  g.fillStyle = '#9cc3cf'; g.fillRect(P(CANAL_X - CANAL_W / 2), 0, CANAL_W * MS, MAP_PX);
  g.fillStyle = '#ffffff';
  for (const v of VLINES) g.fillRect(P(v.x - W[v.t] / 2), P(-580 - 20), W[v.t] * MS, 1200 * MS);
  for (const h of HLINES) g.fillRect(P(-580 - 20), P(h.z - W[h.t] / 2), 1200 * MS, W[h.t] * MS);
  g.strokeStyle = '#ffffff'; g.lineWidth = (RING_OUT - RING_IN) * MS; g.beginPath(); g.arc(P(0), P(0), ((RING_IN + RING_OUT) / 2) * MS, 0, 7); g.stroke();
  g.fillStyle = '#d4cfc3';
  for (const l of world.labels) { g.beginPath(); g.arc(P(l.x), P(l.z), 4, 0, 7); g.fill(); }
}
function drawMinimap() {
  const Wd = mm.width, s = 1.6;
  mctx.save();
  mctx.fillStyle = '#e6e2d8'; mctx.fillRect(0, 0, Wd, Wd);
  mctx.translate(Wd / 2, Wd / 2); mctx.rotate(camHeading - Math.PI / 2); mctx.scale(s / MS, s / MS);
  mctx.drawImage(mapCanvas, -(player.x + HALF) * MS, -(player.z + HALF) * MS);
  mctx.restore();
  const a = camHeading - Math.PI / 2;
  const dot = (x, z, col, r) => {
    const dx = (x - player.x) * s, dz = (z - player.z) * s;
    let px = Wd / 2 + dx * Math.cos(a) - dz * Math.sin(a), py = Wd / 2 + dx * Math.sin(a) + dz * Math.cos(a);
    const d = Math.hypot(px - Wd / 2, py - Wd / 2), max = Wd / 2 - 12;
    if (d > max) { px = Wd / 2 + (px - Wd / 2) * max / d; py = Wd / 2 + (py - Wd / 2) * max / d; }
    mctx.fillStyle = col; mctx.beginPath(); mctx.arc(px, py, r, 0, 7); mctx.fill();
    mctx.strokeStyle = '#fff'; mctx.lineWidth = 3; mctx.stroke();
  };
  if (mode === 'level' && levels.spot) dot(levels.spot.x, levels.spot.z, '#1d9a5f', 9);
  else dot(LEVEL_CENTER.x, LEVEL_CENTER.z, '#c23a2b', 7);
  mctx.fillStyle = '#2b44c0'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 3;
  mctx.beginPath(); mctx.moveTo(Wd / 2, Wd / 2 - 14); mctx.lineTo(Wd / 2 + 10, Wd / 2 + 10); mctx.lineTo(Wd / 2, Wd / 2 + 5); mctx.lineTo(Wd / 2 - 10, Wd / 2 + 10); mctx.closePath(); mctx.stroke(); mctx.fill();
}

// ---------- Режимы и экраны ----------
let mode = 'menu';              // menu | free | level | garage
let paused = true, inRun = false;
const playing = () => (mode === 'free' || mode === 'level') && !paused;
const SCREENS = ['menu', 'levels', 'garage', 'result', 'loading'];
function show(id) { for (const s of SCREENS) $(s).hidden = s !== id; }
let toastT;
function toast(text, ms = 2200) { const t = $('toast'); t.textContent = text; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
function updateMoney() {
  $('money').textContent = `${fmt(save.money)} сум`;
  $('menu-money').textContent = `${fmt(save.money)} сум · ${carById(save.car).name}`;
  $('garage-money').textContent = `На счету ${fmt(save.money)} сум`;
}

function enterPlay(m) {
  mode = m; paused = false; inRun = true;
  show(null); $('hud').hidden = false; $('touch').hidden = !isTouch;
  $('level-panel').hidden = m !== 'level';
  $('btn-play').firstChild.textContent = 'Продолжить ';
  updateMoney();
}
function openMenu() {
  paused = true;
  $('hud').hidden = true; $('touch').hidden = true;
  show('menu'); updateMoney();
}
function closeSheets() {
  if (mode === 'garage') leaveGarage();
  show('menu');
}

function resetCar() {
  if (mode === 'level') { startLevel(levels.idx); return; }
  player.reset(SPAWN.x, SPAWN.z, SPAWN.h); camHeading = player.h; updateCamera(0, true);
}

function startFree() {
  levels.clear();
  player.reset(SPAWN.x, SPAWN.z, SPAWN.h); camHeading = player.h; updateCamera(0, true);
  enterPlay('free');
  toast(isTouch ? 'Красная точка на карте — автодром' : 'WASD — ехать · Пробел — ручник · C — камера', 4000);
}

function startLevel(i) {
  levels.clear();
  const st = levels.start(i, player.spec);
  player.reset(st.x, st.z, st.h); camHeading = player.h; updateCamera(0, true);
  $('lvl-name').textContent = `${i + 1} / ${LEVELS.length}`;
  $('lvl-hint').textContent = LEVELS[i].desc;
  enterPlay('level');
}

$('btn-play').onclick = () => { if (inRun) enterPlay(mode === 'level' ? 'level' : 'free'); else startFree(); };
$('btn-levels').onclick = () => { renderLevels(); show('levels'); };
$('btn-garage').onclick = openGarage;
$('btn-pause').onclick = openMenu;
$('btn-credits').onclick = () => { const c = $('credits'); c.hidden = !c.hidden; };
document.querySelectorAll('[data-close]').forEach(b => (b.onclick = closeSheets));

// уровни
const unlocked = i => i === 0 || (save.stars[i - 1] || 0) > 0;
function renderLevels() {
  const g = $('level-grid'); g.innerHTML = '';
  const firstOpen = LEVELS.findIndex((_, i) => unlocked(i) && !save.stars[i]);
  LEVELS.forEach((L, i) => {
    const b = document.createElement('button');
    b.className = 'tile' + (i === firstOpen ? ' next' : ''); b.disabled = !unlocked(i); b.title = L.name;
    const st = save.stars[i] || 0;
    b.innerHTML = `<b>${i + 1}</b><span class="dots">${[0, 1, 2].map(k => `<i class="${k < st ? 'on' : ''}"></i>`).join('')}</span>`;
    b.onclick = () => startLevel(i);
    g.append(b);
  });
}
const starSvg = on => `<svg viewBox="0 0 24 24" class="${on ? 'on' : ''}"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>`;
function finishLevel(res) {
  paused = true;
  const i = levels.idx, L = LEVELS[i];
  $('hud').hidden = true; $('touch').hidden = true;
  show('result');
  if (res === 'win') {
    audio.ding();
    const stars = levels.stars(), first = !(save.stars[i] > 0);
    const reward = Math.round(L.reward * (first ? 1 : 0.3) * (0.6 + stars * 0.15));
    save.stars[i] = Math.max(save.stars[i] || 0, stars); save.money += reward; persist(); updateMoney();
    $('res-title').textContent = 'Припарковался';
    $('res-stars').innerHTML = [0, 1, 2].map(k => starSvg(k < stars)).join('');
    $('res-text').textContent = `+${fmt(reward)} сум · касаний ${levels.hits} · ${Math.ceil(levels.timeLeft)} с в запасе`;
    $('res-next').hidden = i >= LEVELS.length - 1;
  } else {
    $('res-title').textContent = 'Время вышло';
    $('res-stars').innerHTML = [0, 1, 2].map(() => starSvg(false)).join('');
    $('res-text').textContent = 'Не спеши и включи камеру сверху (C)';
    $('res-next').hidden = true;
  }
}
$('res-retry').onclick = () => startLevel(levels.idx);
$('res-next').onclick = () => startLevel(levels.idx + 1);
$('res-menu').onclick = () => { levels.clear(); inRun = false; mode = 'menu'; $('btn-play').firstChild.textContent = 'Поехать '; show('menu'); };

// гараж
let garageSel, garageColor, garageMesh, prevMode;
function openGarage() {
  prevMode = mode; mode = 'garage'; paused = true;
  garageSel = save.car; garageColor = null;
  show('garage'); previewGarage(); renderGarage();
}
function leaveGarage() {
  if (garageMesh) { scene.remove(garageMesh); garageMesh = null; }
  playerMesh.visible = true;
  mode = prevMode === 'garage' ? 'menu' : prevMode;
}
function previewGarage() {
  if (garageMesh) scene.remove(garageMesh);
  garageMesh = buildCarMesh(carById(garageSel), garageColor || colorOf(garageSel), save.plate);
  garageMesh.position.set(player.x, 0, player.z); garageMesh.rotation.y = player.h;
  scene.add(garageMesh); playerMesh.visible = false;
}
function renderGarage() {
  const tabs = $('car-tabs'); tabs.innerHTML = '';
  for (const c of CARS) {
    const b = document.createElement('button'); b.textContent = c.name; b.className = c.id === garageSel ? 'on' : '';
    b.onclick = () => { garageSel = c.id; garageColor = null; previewGarage(); renderGarage(); };
    tabs.append(b);
  }
  const c = carById(garageSel), owned = save.owned.includes(c.id);
  $('car-desc').textContent = c.desc;
  $('car-specs').innerHTML = `<div><b>${Math.round(c.maxSpeed * 3.6)}</b><span>км/ч</span></div><div><b>${c.len.toFixed(1)}</b><span>длина, м</span></div><div><b>${owned ? '—' : fmt(c.price)}</b><span>${owned ? 'в гараже' : 'сум'}</span></div>`;
  const cl = $('color-list'); cl.innerHTML = '';
  const cur = garageColor || colorOf(garageSel);
  for (const col of COLORS) {
    const b = document.createElement('button'); b.style.background = col.hex; b.title = col.name; b.setAttribute('aria-label', col.name);
    if (col.hex === cur) b.className = 'on';
    b.onclick = () => { garageColor = col.hex; previewGarage(); renderGarage(); };
    cl.append(b);
  }
  const btn = $('btn-buy');
  if (!owned) { btn.textContent = `Купить за ${fmt(c.price)} сум`; btn.disabled = save.money < c.price; }
  else if (garageColor && garageColor !== colorOf(c.id)) { btn.textContent = 'Покрасить за 200 сум'; btn.disabled = save.money < 200; }
  else { btn.textContent = c.id === save.car ? 'Поехали' : 'Выбрать'; btn.disabled = false; }
  updateMoney();
}
$('btn-buy').onclick = () => {
  const c = carById(garageSel), owned = save.owned.includes(c.id);
  if (!owned) {
    if (save.money < c.price) return;
    save.money -= c.price; save.owned.push(c.id); if (garageColor) save.colors[c.id] = garageColor;
    save.car = c.id; toast(`${c.name} теперь ваша`); audio.ding();
  } else if (garageColor && garageColor !== colorOf(c.id)) {
    if (save.money < 200) return;
    save.money -= 200; save.colors[c.id] = garageColor; save.car = c.id; garageColor = null; toast('Покрашено');
  } else {
    save.car = c.id; persist(); rebuildPlayer(); leaveGarage();
    if (inRun) enterPlay(mode === 'level' ? 'level' : 'free'); else startFree();
    return;
  }
  persist(); rebuildPlayer(); previewGarage(); renderGarage();
};

// ---------- Цикл ----------
const clock = new THREE.Clock();
let t = 0, orbit = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05); t += dt;
  if (window.__freeCam) {
    window.__freeCam(camera);
  } else if (playing()) {
    const hit = player.update(dt, input, world.obstacles, HALF - 10);
    if (hit > 1.2) audio.thump(hit);
    if (mode === 'level') {
      const r = levels.update(dt, player, hit, t);
      const tl = Math.max(0, Math.ceil(levels.timeLeft));
      $('lvl-time').textContent = `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`;
      $('lvl-hits').textContent = levels.hits;
      const h = $('lvl-hint'); h.classList.toggle('ok', !!levels.inside);
      h.textContent = levels.inside ? (Math.abs(player.speed) < 0.4 ? 'Стоим…' : 'Остановись') : LEVELS[levels.idx].desc;
      if (r) finishLevel(r);
    }
    syncMesh(playerMesh, player);
    updateCamera(dt);
    $('speed').textContent = Math.round(Math.abs(player.speed) * 3.6);
    $('gear').textContent = player.speed < -0.2 ? 'R' : Math.abs(player.speed) < 0.2 ? 'N' : 'D';
    drawMinimap();
  } else if (mode === 'garage') {
    orbit += dt * 0.3;
    camera.up.set(0, 1, 0);
    const wide = innerWidth > 720, R = wide ? 7.5 : 9;
    camera.position.set(player.x + Math.cos(orbit) * R, 2.4, player.z + Math.sin(orbit) * R);
    // машина левее центра на широком экране (справа панель) и выше на телефоне (снизу панель)
    const rx = -Math.sin(orbit), rz = Math.cos(orbit), side = wide ? -2.2 : 0;
    camera.lookAt(player.x + rx * side, wide ? 0.8 : -0.6, player.z + rz * side);
  } else if (world) {
    orbit += dt * 0.05;     // в меню камера медленно облетает машину на фоне сквера
    camera.up.set(0, 1, 0);
    camera.position.set(player.x + Math.cos(orbit) * 16, 5.5, player.z + Math.sin(orbit) * 16);
    camera.lookAt(player.x, 2.5, player.z);
  }
  audio.update(player ? player.speed : 0, input.up || input.down, input.horn, playing());
  if (player) { sun.position.set(player.x + SUN_OFF.x, SUN_OFF.y, player.z + SUN_OFF.z); sun.target.position.set(player.x, 0, player.z); }
  scene.userData.sky.position.copy(camera.position);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- Запуск ----------
(async function boot() {
  show('loading');
  $('load-bar').style.width = '15%';
  await loadCarModels();
  $('load-bar').style.width = '55%'; $('load-text').textContent = 'Строим Ташкент…';
  await nextFrame();
  world = new World(scene);
  levels = new LevelRunner(scene, world.obstacles);
  player = new Vehicle(carById(save.car));
  player.reset(SPAWN.x, SPAWN.z, SPAWN.h); camHeading = player.h;
  rebuildPlayer();
  drawMapBase();
  $('credits').textContent = CREDITS.join(' · ');
  $('load-bar').style.width = '100%';
  await nextFrame();
  updateMoney();
  show('menu');
  requestAnimationFrame(frame);
  window.__game = { player, world, levels, save, startLevel, startFree, input, camera };
})();
