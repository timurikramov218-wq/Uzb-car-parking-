import * as THREE from 'three';
import { CARS, COLORS, CREDITS, carById, buildCarMesh, randomPlate, loadCarModels } from './cars.js';
import { Vehicle } from './physics.js';
import { World, STRUCTS, S_FLAT, S_RAMP, S_BAND, structProfile, structUV, HALF, VLINES, HLINES, W, SW, RING_IN, RING_OUT, CANAL_X, CANAL_W, SPAWN, LEVEL_CENTER } from './world.js';
import { LEVELS, LevelRunner } from './levels.js';
import { Terrain } from './terrain.js';
import { Hangar, HANGAR } from './garage.js';

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('ru-RU');
const WHITE = COLORS[0].hex;

// ---------- Сохранение ----------
const SAVE_KEY = 'uzbcarparking-save-v2';
const save = Object.assign({ money: 1500, owned: ['matiz'], car: 'matiz', colors: {}, stars: {}, plate: randomPlate() },
  (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } })());
if (!CARS.some(c => c.id === save.car)) save.car = 'matiz';
save.owned = CARS.map(c => c.id);          // все машины бесплатные и сразу в гараже
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
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 12000);
scene.fog = new THREE.Fog(0xdfe6ea, 400, 7600);
{
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x6aa7d8) }, bottom: { value: new THREE.Color(0xe4ebef) } },
    vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 p; void main(){ float t = clamp(p.y*1.8,0.,1.); gl_FragColor = vec4(mix(bottom, top, pow(t,0.6)),1.); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(11000, 32, 16), m); sky.renderOrder = -1; scene.add(sky); scene.userData.sky = sky;
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

let world, levels, player, playerMesh, terrain, hangar;
let inHangar = false;
// ангар (меню и гараж) или город (езда): показываем только одно, второе не рисуем
function setScene(h) {
  inHangar = h;
  hangar.show(h); world.root.visible = !h; terrain.root.visible = !h; if (levels.group) levels.group.visible = !h; if (playerMesh) playerMesh.visible = !h;
  if (h) hangar.setCar(buildCarMesh(carById(garageSel || save.car), garageColor || colorOf(garageSel || save.car), save.plate));
}
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
      // шум шин: фильтрованный белый шум, громкость от проскальзывания
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 3;
      this.skidGain = ctx.createGain(); this.skidGain.gain.value = 0;
      noise.connect(bp); bp.connect(this.skidGain); this.skidGain.connect(this.master); noise.start();
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
    this.skidGain.gain.setTargetAtTime(active && player ? Math.min(0.12, Math.max(0, (player.skid || 0) - 1.05) * 0.25) : 0, t, 0.05);
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
  mesh.position.set(v.x, v.y || 0, v.z); mesh.rotation.order = 'YZX'; mesh.rotation.set(v.tRoll || 0, v.h, v.tPitch || 0);
  for (const w of mesh.userData.wheels) {
    if (w.single) w.pivot.rotation.set(0, w.front ? v.steer : 0, v.wheelRot);
    else { w.spin.rotation.z = v.wheelRot; if (w.front) w.pivot.rotation.y = v.steer; }
  }
  for (const m of mesh.userData.lights.brake) m.emissiveIntensity = v.braking ? 2.5 : 0.35;
  const b = mesh.userData.body;
  if (b) { b.rotation.x = v.roll || 0; b.rotation.z = v.pitch || 0; }
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
  const py = player.y || 0;
  const want = new THREE.Vector3(), look = new THREE.Vector3(player.x, 1 + py, player.z);
  if (c.inside) {
    const s = player.spec, hx = Math.cos(player.h), hz = -Math.sin(player.h);
    camPos.set(player.x - hx * s.len * 0.08 + hz * 0.32, s.hgt * 0.78 + py, player.z - hz * s.len * 0.08 - hx * 0.32);
    camLook.set(player.x + hx * 20, s.hgt * 0.7 + py + Math.tan(player.tPitch || 0) * 20, player.z + hz * 20);
  } else {
    if (c.top) want.set(player.x - fx * 0.01, 34 + py, player.z - fz * 0.01);
    else { const gy = terrain ? Math.max(hAt(player.x - fx * c.dist, player.z - fz * c.dist, player.layer || 0) + 1.5, py + c.h) : c.h; want.set(player.x - fx * c.dist, gy, player.z - fz * c.dist); look.y = 1 + py; }
    const k = snap ? 1 : 1 - Math.exp(-dt * 5);
    camPos.lerp(want, k); camLook.lerp(look, k);
  }
  camera.up.set(c.top ? fx : 0, c.top ? 0 : 1, c.top ? fz : 0);
  camera.position.copy(camPos); camera.lookAt(camLook);
  playerMesh.visible = !c.inside;
}

// ---------- Мини-карта ----------
const mm = $('minimap'), mctx = mm.getContext('2d');
const MX0 = -720, MZ0 = -4400, MAP_SIZE = 5120, MAP_PX = 2048, MS = MAP_PX / MAP_SIZE;   // город + горы на северо-востоке
const mapCanvas = document.createElement('canvas'); mapCanvas.width = mapCanvas.height = MAP_PX;
function drawMapBase() {
  const g = mapCanvas.getContext('2d'), PX = v => (v - MX0) * MS, PZ = v => (v - MZ0) * MS;
  g.fillStyle = '#1c1d20'; g.fillRect(0, 0, MAP_PX, MAP_PX);
  g.fillStyle = '#23261f'; g.fillRect(PX(450), PZ(-4350), 3900 * MS, 3900 * MS);
  g.fillStyle = '#26362a'; g.beginPath(); g.arc(PX(0), PZ(0), RING_IN * MS, 0, 7); g.fill();
  g.fillStyle = '#244b57'; g.fillRect(PX(CANAL_X - CANAL_W / 2), PZ(-640), CANAL_W * MS, 1280 * MS);
  g.fillStyle = '#4a4c52';
  for (const v of VLINES) g.fillRect(PX(v.x - W[v.t] / 2), PZ(-600), W[v.t] * MS, 1200 * MS);
  for (const h of HLINES) g.fillRect(PX(-600), PZ(h.z - W[h.t] / 2), 1200 * MS, W[h.t] * MS);
  g.strokeStyle = '#4a4c52'; g.lineWidth = (RING_OUT - RING_IN) * MS; g.beginPath(); g.arc(PX(0), PZ(0), ((RING_IN + RING_OUT) / 2) * MS, 0, 7); g.stroke();
  if (terrain) {
    const L = terrain.mapData();
    g.save(); g.translate(PX(L.lake.x), PZ(L.lake.z)); g.rotate(-L.lake.rot); g.fillStyle = '#1f6672'; g.beginPath(); g.ellipse(0, 0, L.lake.rx * MS, L.lake.rz * MS, 0, 0, 7); g.fill(); g.restore();
    g.strokeStyle = '#5a5c62'; g.lineWidth = 18 * MS + 1; g.lineCap = 'round'; g.beginPath();
    L.path.forEach((p, i) => (i ? g.lineTo(PX(p.x), PZ(p.z)) : g.moveTo(PX(p.x), PZ(p.z)))); g.stroke();
    g.fillStyle = '#f2f0ea'; for (const q of [L.amir, L.end]) { g.beginPath(); g.arc(PX(q.x), PZ(q.z), 6, 0, 7); g.fill(); }
  }
  g.fillStyle = '#6f6a5c';
  for (const l of world.labels) { g.beginPath(); g.arc(PX(l.x), PZ(l.z), 3, 0, 7); g.fill(); }
}
function drawMinimap() {
  const Wd = mm.width, s = 1.6;
  mctx.save();
  mctx.fillStyle = '#1c1d20'; mctx.fillRect(0, 0, Wd, Wd);
  mctx.translate(Wd / 2, Wd / 2); mctx.rotate(camHeading - Math.PI / 2); mctx.scale(s / MS, s / MS);
  mctx.drawImage(mapCanvas, -(player.x - MX0) * MS, -(player.z - MZ0) * MS);
  mctx.restore();
  const a = camHeading - Math.PI / 2;
  const dot = (x, z, col, r) => {
    const dx = (x - player.x) * s, dz = (z - player.z) * s;
    let px = Wd / 2 + dx * Math.cos(a) - dz * Math.sin(a), py = Wd / 2 + dx * Math.sin(a) + dz * Math.cos(a);
    const d = Math.hypot(px - Wd / 2, py - Wd / 2), max = Wd / 2 - 12;
    if (d > max) { px = Wd / 2 + (px - Wd / 2) * max / d; py = Wd / 2 + (py - Wd / 2) * max / d; }
    mctx.fillStyle = col; mctx.beginPath(); mctx.arc(px, py, r, 0, 7); mctx.fill();
    mctx.strokeStyle = '#111'; mctx.lineWidth = 3; mctx.stroke();
  };
  if (mode === 'level' && levels.spot) dot(levels.spot.x, levels.spot.z, '#3ad07a', 9);
  else dot(LEVEL_CENTER.x, LEVEL_CENTER.z, '#ff4a3d', 7);
  mctx.fillStyle = '#f2c230'; mctx.strokeStyle = '#111'; mctx.lineWidth = 3;
  mctx.beginPath(); mctx.moveTo(Wd / 2, Wd / 2 - 14); mctx.lineTo(Wd / 2 + 10, Wd / 2 + 10); mctx.lineTo(Wd / 2, Wd / 2 + 5); mctx.lineTo(Wd / 2 - 10, Wd / 2 + 10); mctx.closePath(); mctx.stroke(); mctx.fill();
}

// ---------- Режимы и экраны ----------
let mode = 'menu';              // menu | free | level | garage
let paused = true, inRun = false;
const playing = () => (mode === 'free' || mode === 'level') && !paused;
const SCREENS = ['menu', 'levels', 'garage', 'result', 'loading'];
function show(id) { for (const s of SCREENS) $(s).hidden = s !== id; $('vignette').classList.toggle('off', id !== 'menu' && id !== 'levels'); }
let toastT;
function toast(text, ms = 2200, bad = false) { const t = $('toast'); t.textContent = text; t.classList.toggle('bad', bad); t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
function updateMoney() {
  $('money').textContent = fmt(save.money);
  $('menu-money').textContent = `${fmt(save.money)} сум · ${carById(save.car).name}`;
  $('garage-money').textContent = `${fmt(save.money)} сум на счету`;
}

function enterPlay(m) {
  mode = m; paused = false; inRun = true;
  setScene(false);
  show(null); $('hud').hidden = false; $('touch').hidden = !isTouch;
  $('level-panel').hidden = m !== 'level';
  $('btn-play').querySelector('span').textContent = 'Дальше';
  updateMoney();
}
function openMenu() {
  paused = true; garageSel = null; garageColor = null;
  setScene(true);
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
$('res-menu').onclick = () => { levels.clear(); inRun = false; mode = 'menu'; $('btn-play').querySelector('span').textContent = 'Ехать'; show('menu'); };

// гараж
let garageSel, garageColor, garageMesh, prevMode;
function openGarage() {
  prevMode = mode; mode = 'garage'; paused = true;
  garageSel = save.car; garageColor = null;
  show('garage'); previewGarage(); renderGarage();
}
function leaveGarage() {
  mode = prevMode === 'garage' ? 'menu' : prevMode;
  garageSel = null; garageColor = null;
  hangar.setCar(buildCarMesh(carById(save.car), colorOf(save.car), save.plate));
}
function previewGarage() {        // машина на поворотном подиуме в ангаре
  if (!inHangar) setScene(true);
  hangar.setCar(buildCarMesh(carById(garageSel), garageColor || colorOf(garageSel), save.plate));
}
function renderGarage() {
  const tabs = $('car-tabs'); tabs.innerHTML = '';
  for (const c of CARS) {
    const b = document.createElement('button'); b.className = c.id === garageSel ? 'on' : '';
    const own = save.owned.includes(c.id);
    b.innerHTML = `<span>${c.name}</span><small>${c.id === save.car ? 'за рулём' : 'бесплатно'}</small>`;
    b.onclick = () => { garageSel = c.id; garageColor = null; previewGarage(); renderGarage(); };
    tabs.append(b);
  }
  const c = carById(garageSel), owned = save.owned.includes(c.id);
  $('car-desc').textContent = c.desc;
  $('car-specs').innerHTML = `<div><b>${Math.round(c.maxSpeed * 3.6)}</b><span>км/ч</span></div><div><b>${c.len.toFixed(1)}</b><span>длина, м</span></div><div><b>${Math.round(c.accel * 10) / 10}</b><span>разгон, м/с²</span></div>`;
  const cl = $('color-list'); cl.innerHTML = '';
  const cur = garageColor || colorOf(garageSel);
  for (const col of COLORS) {
    const b = document.createElement('button'); b.style.background = col.hex; b.title = col.name; b.setAttribute('aria-label', col.name);
    if (col.hex === cur) b.className = 'on';
    b.onclick = () => { save.colors[garageSel] = col.hex; persist(); garageColor = null; if (garageSel === save.car) rebuildPlayer(); previewGarage(); renderGarage(); };
    cl.append(b);
  }
  const btn = $('btn-buy');
  btn.textContent = c.id === save.car ? 'Поехали' : 'Выбрать'; btn.disabled = false;
  updateMoney();
}
$('btn-buy').onclick = () => {
  const c = carById(garageSel);
  if (c.id !== save.car) { save.car = c.id; persist(); rebuildPlayer(); previewGarage(); renderGarage(); toast(`${c.name} — за рулём`); return; }
  leaveGarage();
  if (inRun) enterPlay(mode === 'level' ? 'level' : 'free'); else startFree();
};

// ---------- Светофоры: подсказка и штраф за красный ----------
let lastCell = null, fineCooldown = 0;
function nearestLine(arr, v) { let best = arr[0]; for (const a of arr) if (Math.abs(a - v) < Math.abs(best - v)) best = a; return best; }
function trafficCheck(dt) {
  fineCooldown -= dt;
  const fx = Math.cos(player.h), fz = -Math.sin(player.h);
  const ns = Math.abs(fz) > Math.abs(fx);
  const grp = ns ? 'NS' : 'EW';
  const st = world.signalState?.[grp];
  // ближайший перекрёсток впереди по ходу движения
  const X = nearestLine(VLINES.map(v => v.x), player.x + fx * 40), Z = nearestLine(HLINES.map(h => h.z), player.z + fz * 40);
  const ahead = (X - player.x) * fx + (Z - player.z) * fz;
  const onLine = ns ? Math.abs(player.x - X) < 16 : Math.abs(player.z - Z) < 16;
  const centre = Math.hypot(X, Z) < 1;
  const show = mode === 'free' && st && onLine && !centre && ahead > 0 && ahead < 90;
  $('signal').hidden = !show;
  if (show) {
    for (const c of ['r', 'y', 'g']) $('signal').querySelector('.' + c).classList.toggle('on', c === st);
    $('signal-t').textContent = world.signalLeft?.[grp] || '';
  }
  // въезд на перекрёсток на красный
  const V = VLINES.find(v => Math.abs(v.x - player.x) < W[v.t] / 2), H = HLINES.find(h => Math.abs(h.z - player.z) < W[h.t] / 2);
  const cell = V && H && !(V.x === 0 && H.z === 0) ? `${V.x},${H.z}` : null;
  if (cell && cell !== lastCell && mode === 'free' && Math.abs(player.speed) > 3 && st === 'r' && fineCooldown <= 0) {
    save.money = Math.max(0, save.money - 50); persist(); updateMoney(); fineCooldown = 4;
    toast('Проезд на красный: штраф 50 сум', 2600, true);
  }
  lastCell = cell;
}

// ---------- Два уровня: тоннель и эстакада ----------
const S_REACH = S_FLAT + S_RAMP;
function structAt(x, z) {
  for (let i = 0; i < STRUCTS.length; i++) { const S = STRUCTS[i], q = structUV(S, x, z); if (Math.abs(q.u) < 13.6 && Math.abs(q.v - S.node) < S_REACH) return { S, i, q }; }
  return null;
}
function updateLayer(v) {
  const a = structAt(v.x, v.z);
  if (!a) { v.layer = 0; return; }
  if (v.layer === undefined || v.layer === null) v.layer = 0;
  if (!v._inStruct) v.layer = Math.abs(a.q.v - a.S.node) > S_REACH - 8 ? 10 + a.i : 0;   // въезд с торца — на полотно
  v._inStruct = true;
}
function hAt(x, z, layer) {
  if (layer >= 10) { const S = STRUCTS[layer - 10], q = structUV(S, x, z); if (Math.abs(q.v - S.node) < S_REACH) return structProfile(S, q.v); }
  return terrain.heightAt(x, z);
}

// ---------- Цикл ----------
const clock = new THREE.Clock();
let t = 0, orbit = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05); t += dt;
  if (window.__freeCam) {
    window.__freeCam(camera);
  } else if (playing()) {
    // уклон дороги: разница высот под передом и задом машины
    const hx = Math.cos(player.h), hz = -Math.sin(player.h), hl = player.spec.len / 2, hw = player.spec.wid / 2;
    const L = player.layer || 0;
    const yF = hAt(player.x + hx * hl, player.z + hz * hl, L), yB = hAt(player.x - hx * hl, player.z - hz * hl, L);
    player.grade = (yF - yB) / player.spec.len;
    const hit = player.update(dt, input, world.obstacles, 3600);
    { const was = !!structAt(player.x, player.z); if (!was) player._inStruct = false; updateLayer(player); }
    player.y = hAt(player.x, player.z, player.layer);
    const yL = hAt(player.x + hz * hw, player.z - hx * hw, player.layer), yR = hAt(player.x - hz * hw, player.z + hx * hw, player.layer);
    const k = 1 - Math.exp(-dt * 10);
    player.tPitch = (player.tPitch || 0) + (Math.atan2(yF - yB, player.spec.len) - (player.tPitch || 0)) * k;
    player.tRoll = (player.tRoll || 0) + (Math.atan2(yL - yR, player.spec.wid) - (player.tRoll || 0)) * k;
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
    $('speed-bar').style.width = Math.min(100, Math.abs(player.speed) / player.spec.maxSpeed * 100) + '%';
    $('gear').textContent = player.speed < -0.2 ? 'R' : Math.abs(player.speed) < 0.2 ? 'N' : 'D';
    drawMinimap();
    trafficCheck(dt);
  } else if (hangar && inHangar) {
    orbit += dt;
    hangar.update(dt);
    hangar.camera(camera, mode === 'garage' ? 'garage' : 'menu', orbit, innerWidth > 720);
  }
  if (world) world.updateSignals(t);
  audio.update(player ? player.speed : 0, input.up || input.down, input.horn, playing());
  if (inHangar) { sun.position.set(HANGAR.x + SUN_OFF.x, SUN_OFF.y, HANGAR.z + SUN_OFF.z); sun.target.position.set(HANGAR.x, 0, HANGAR.z); }
  else if (player) { const py = player.y || 0; sun.position.set(player.x + SUN_OFF.x, SUN_OFF.y + py, player.z + SUN_OFF.z); sun.target.position.set(player.x, py, player.z); }
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
  $('load-bar').style.width = '75%'; $('load-text').textContent = 'Дорога в горы…';
  await nextFrame();
  terrain = new Terrain(scene, world.obstacles);
  levels = new LevelRunner(scene, world.obstacles);
  $('load-bar').style.width = '90%'; $('load-text').textContent = 'Открываем ангар…';
  await nextFrame();
  hangar = new Hangar(scene);
  player = new Vehicle(carById(save.car));
  player.reset(SPAWN.x, SPAWN.z, SPAWN.h); camHeading = player.h;
  rebuildPlayer();
  drawMapBase();
  $('credits').textContent = CREDITS.join(' · ');
  $('load-bar').style.width = '100%';
  await nextFrame();
  updateMoney();
  $('btn-play').classList.add('first');
  document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('mouseenter', () => $('btn-play').classList.toggle('first', b.id === 'btn-play')));
  show('menu');
  setScene(true);
  requestAnimationFrame(frame);
  window.__game = { player, world, levels, save, startLevel, startFree, input, camera, terrain, hangar };
})();
