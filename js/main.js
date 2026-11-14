import * as THREE from 'three';
import { CARS, COLORS, CREDITS, carById, buildCarMesh, randomPlate, loadCarModels } from './cars.js';
import { Vehicle } from './physics.js';
import { LEVEL_CENTER } from './world.js';
import { City, CITY_HALF } from './city.js';
import { LEVELS, LevelRunner } from './levels.js';
import { Hangar, HANGAR } from './garage.js';
import { TUNE, RIMS, tuneOf, tunedSpec, applyTune } from './tuning.js';

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString('ru-RU');
const WHITE = COLORS[0].hex;

// ---------- Сохранение ----------
const SAVE_KEY = 'uzbcarparking-save-v2';
const save = Object.assign({ money: 1500, owned: ['matiz'], car: 'matiz', colors: {}, stars: {}, plate: randomPlate(), tune: {}, bought: [], fuel: 1, damage: 0 },
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
const hemiMain = new THREE.HemisphereLight(0xdfeeff, 0x9a8a6a, 1.0); scene.add(hemiMain);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.5);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 500 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const SUN_OFF = new THREE.Vector3(90, 160, 60);

function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

let world, levels, player, playerMesh, hangar;
let inHangar = false;
// ангар (меню и гараж) или город (езда): показываем только одно, второе не рисуем
function setScene(h) {
  inHangar = h;
  hangar.show(h); world.root.visible = !h; if (levels.group) levels.group.visible = !h; if (playerMesh) playerMesh.visible = !h;
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
  const t = tuneOf(save, save.car);
  player.setSpec(tunedSpec(carById(save.car), t, save.damage));
  playerMesh = buildCarMesh(carById(save.car), colorOf(save.car), save.plate);
  applyTune(playerMesh, player.spec, t);
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
    else { const gy = Math.max(world.surfaceAt(player.x - fx * c.dist, player.z - fz * c.dist, py) + 1.5, py + c.h); want.set(player.x - fx * c.dist, gy, player.z - fz * c.dist); look.y = 1 + py; }
    const k = snap ? 1 : 1 - Math.exp(-dt * 5);
    camPos.lerp(want, k); camLook.lerp(look, k);
  }
  camera.up.set(c.top ? fx : 0, c.top ? 0 : 1, c.top ? fz : 0);
  camera.position.copy(camPos); camera.lookAt(camLook);
  playerMesh.visible = !c.inside;
}

// ---------- Мини-карта ----------
const mm = $('minimap'), mctx = mm.getContext('2d');
const MX0 = -1840, MZ0 = -1840, MAP_SIZE = 3680, MAP_PX = 2048, MS = MAP_PX / MAP_SIZE;   // весь город
const mapCanvas = document.createElement('canvas'); mapCanvas.width = mapCanvas.height = MAP_PX;
function drawMapBase() {
  const g = mapCanvas.getContext('2d');
  g.fillStyle = '#1c1d20'; g.fillRect(0, 0, MAP_PX, MAP_PX);
  world.drawMap(g, v => (v - MX0) * MS, v => (v - MZ0) * MS, MS);
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
const SCREENS = ['menu', 'levels', 'garage', 'result'];
function show(id) { for (const s of SCREENS) $(s).hidden = s !== id; $('vignette').classList.toggle('off', !id); }
let toastT;
function toast(text, ms = 2200, bad = false) { const t = $('toast'); t.textContent = text; t.classList.toggle('bad', bad); t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
function updateMoney() {
  $('money').textContent = fmt(save.money);
  $('garage-money').textContent = fmt(save.money);
  $('menu-car-name').textContent = carById(save.car).name;
}

function enterPlay(m) {
  mode = m; paused = false; inRun = true;
  setScene(false);
  show(null); $('hud').hidden = false; $('touch').hidden = !isTouch;
  $('level-panel').hidden = m !== 'level';
  $('btn-play').querySelector('span').textContent = 'Дальше';
  updateMoney();
}
function openMenu() {                 // пауза — сразу в гараж
  $('hud').hidden = true; $('touch').hidden = true;
  openGarage();
}
function closeSheets() { show('garage'); }

function resetCar() {
  if (mode === 'free') { save.fuel = Math.max(save.fuel, 0.25); player._dry = false; }
  if (mode === 'level') { startLevel(levels.idx); return; }
  player.reset(world.spawn.x, world.spawn.z, world.spawn.h); camHeading = player.h; updateCamera(0, true);
}

function startFree() {
  levels.clear();
  player.reset(world.spawn.x, world.spawn.z, world.spawn.h); camHeading = player.h; updateCamera(0, true);
  enterPlay('free');
  toast(isTouch ? 'Красная точка на карте — автодром' : 'WASD — ехать · Пробел — ручник · C — камера • M — карта', 4000);
}

function startLevel(i) {
  levels.clear();
  const st = levels.start(i, player.spec);
  player.reset(st.x, st.z, st.h); camHeading = player.h; updateCamera(0, true);
  $('lvl-name').textContent = `${i + 1} / ${LEVELS.length}`;
  $('lvl-hint').textContent = LEVELS[i].desc;
  enterPlay('level');
}

// город строится в фоне; если игрок уже жмёт «Ехать» — ждём его с полоской
let cityReady = false, afterCity = null;
const whenCity = fn => { if (cityReady) fn(); else { afterCity = fn; $('city-wait').hidden = false; } };
$('btn-play').onclick = () => whenCity(() => { const m = prevMode; if (inRun) enterPlay(m === 'level' ? 'level' : 'free'); else startFree(); });
$('btn-levels').onclick = () => whenCity(() => { renderLevels(); show('levels'); });
$('btn-start').onclick = () => { if (hangar) openGarage(); };
$('btn-home').onclick = () => { mode = 'menu'; show('menu'); };
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
$('res-menu').onclick = () => { levels.clear(); inRun = false; $('btn-play').querySelector('span').textContent = 'Ехать'; openGarage(); };

// гараж: машины, покраска и тюнинг; выбранная машина сразу становится твоей
let garageSel, garageColor, garageMesh, prevMode = 'free', gTab = 'cars';
function openGarage(tab) {
  if (mode !== 'garage' && mode !== 'menu') prevMode = mode;
  mode = 'garage'; paused = true; if (tab) gTab = tab;
  garageSel = save.car; garageColor = null;
  $('hud').hidden = true; $('touch').hidden = true;
  show('garage'); previewGarage(); renderGarage();
}
function leaveGarage() { garageSel = null; garageColor = null; }
function previewGarage() {        // машина на поворотном подиуме в студии
  if (!inHangar) setScene(true);
  const m = buildCarMesh(carById(save.car), colorOf(save.car), save.plate);
  applyTune(m, carById(save.car), tuneOf(save, save.car));
  hangar.setCar(m);
}
const priceTag = n => (n ? `${fmt(n)} сум` : 'бесплатно');
function renderGarage() {
  document.querySelectorAll('.gtabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === gTab));
  for (const k of ['cars', 'paint', 'tune']) $('tab-' + k).hidden = k !== gTab;
  const tabs = $('car-tabs'); tabs.innerHTML = '';
  for (const c of CARS) {
    const b = document.createElement('button'); b.className = c.id === save.car ? 'on' : '';
    b.innerHTML = `<span>${c.name}</span><small>${c.id === save.car ? 'за рулём' : 'бесплатно'}</small>`;
    b.onclick = () => { if (c.id === save.car) return; save.car = c.id; persist(); rebuildPlayer(); previewGarage(); renderGarage(); };
    tabs.append(b);
  }
  const c = carById(save.car), t = tuneOf(save, c.id), sp = tunedSpec(c, t);
  $('car-desc').textContent = c.desc;
  $('car-specs').innerHTML = `<div><b>${Math.round(sp.maxSpeed * 3.6)}</b><span>км/ч</span></div><div><b>${c.len.toFixed(1)}</b><span>длина, м</span></div><div><b>${Math.round(sp.accel * 10) / 10}</b><span>разгон, м/с²</span></div>`;
  const sw = (el, list, cur, set, title) => {
    el.innerHTML = '';
    for (const hex of list) {
      const b = document.createElement('button'); b.style.background = hex || 'conic-gradient(#888 0 25%, #ddd 0 50%, #888 0 75%, #ddd 0)'; b.title = title(hex);
      b.setAttribute('aria-label', title(hex)); if (hex === cur) b.className = 'on';
      b.onclick = () => { set(hex); persist(); rebuildPlayer(); previewGarage(); renderGarage(); };
      el.append(b);
    }
  };
  sw($('color-list'), COLORS.map(x => x.hex), colorOf(c.id), hex => (save.colors[c.id] = hex), hex => COLORS.find(x => x.hex === hex).name);
  sw($('rim-list'), RIMS, t.rims, hex => { (save.tune[c.id] ||= {}).rims = hex; }, hex => (hex ? 'Диски ' + hex : 'Заводские'));
  const tl = $('tune-list'); tl.innerHTML = '';
  for (const g of TUNE) {
    const row = document.createElement('div'); row.className = 'tune-row';
    row.innerHTML = `<div class="label">${g.name}</div>`;
    const opts = document.createElement('div'); opts.className = 'tune-opts';
    for (const [v, name, price] of g.opts) {
      const id = `${c.id}:${g.key}:${v}`, have = !price || save.bought.includes(id);
      const b = document.createElement('button'); b.className = (t[g.key] === v ? 'on' : '') + (g.key === 'glow' && v ? ' glow' : '');
      if (g.key === 'glow' && v) b.style.setProperty('--glow', v);
      b.innerHTML = `<span>${name}</span><small>${have ? (t[g.key] === v ? 'стоит' : 'есть') : priceTag(price)}</small>`;
      b.onclick = () => {
        if (!have) { if (save.money < price) { toast('Не хватает денег — пройди уровни парковки', 2400, true); return; } save.money -= price; save.bought.push(id); }
        (save.tune[c.id] ||= {})[g.key] = v; persist(); rebuildPlayer(); previewGarage(); renderGarage();
      };
      opts.append(b);
    }
    row.append(opts); tl.append(row);
  }
  $('play-sub').textContent = inRun ? 'Продолжить' : cityReady ? 'Открытый город' : 'Город строится…';
  updateMoney();
}
document.querySelectorAll('.gtabs button').forEach(b => (b.onclick = () => { gTab = b.dataset.tab; renderGarage(); }));

// ---------- Бензин, износ и сервисы в городе ----------
let svc = null;
function serviceCheck(dt) {
  const dist = Math.abs(player.speed) * dt;
  save.fuel = Math.max(0, save.fuel - dist / 14000);
  $('fuel-bar').style.width = save.fuel * 100 + '%'; $('fuel-bar').classList.toggle('low', save.fuel < 0.15);
  $('hp-bar').style.width = (1 - save.damage) * 100 + '%'; $('hp-bar').classList.toggle('low', save.damage > 0.6);
  svc = null;
  if (mode === 'free' && Math.abs(player.speed) < 1.5) for (const z of world.services || []) if (Math.hypot(player.x - z.x, player.z - z.z) < z.r) { svc = z; break; }
  const b = $('svc-btn');
  if (svc) {
    const cost = svc.type === 'gas' ? Math.ceil((1 - save.fuel) * 300) : svc.type === 'repair' ? Math.ceil(save.damage * 800) : 0;
    b.dataset.cost = cost;
    b.textContent = svc.type === 'gas' ? (save.fuel > 0.98 ? 'Бак полный' : `Заправить · ${fmt(cost)} сум`) : svc.type === 'repair' ? (save.damage < 0.02 ? 'Машина целая' : `Починить · ${fmt(cost)} сум`) : 'Тюнинг-ателье';
  }
  b.hidden = !svc;
}
$('svc-btn').onclick = () => {
  if (!svc) return;
  const cost = +$('svc-btn').dataset.cost || 0;
  if (svc.type === 'tune') { openGarage('tune'); return; }
  if (cost <= 0) return;
  if (save.money < cost) { toast('Не хватает денег', 2000, true); return; }
  save.money -= cost;
  if (svc.type === 'gas') { save.fuel = 1; toast('Полный бак'); audio.ding(); }
  else { save.damage = 0; rebuildPlayer(); toast('Машина как новая'); audio.ding(); }
  persist(); updateMoney();
};
setInterval(persist, 5000);

// ---------- Светофоры: подсказка и штраф за красный ----------
let lastSig = null, fineCooldown = 0;
function trafficCheck(dt) {
  fineCooldown -= dt;
  const fx = Math.cos(player.h), fz = -Math.sin(player.h);
  const a = mode === 'free' && (player.y || 0) < 1 ? world.signalAhead(player.x, player.z, fx, fz) : null;
  const st = a && world.signalState?.[a.grp];
  $('signal').hidden = !(a && st && !a.inside);
  if (a && st) {
    for (const c of ['r', 'y', 'g']) $('signal').querySelector('.' + c).classList.toggle('on', c === st);
    $('signal-t').textContent = world.signalLeft?.[a.grp] || '';
  }
  const inside = a && a.inside ? a.n : null;          // въезд на перекрёсток на красный
  if (inside && inside !== lastSig && Math.abs(player.speed) > 3 && st === 'r' && fineCooldown <= 0) {
    save.money = Math.max(0, save.money - 50); persist(); updateMoney(); fineCooldown = 4;
    toast('Проезд на красный: штраф 50 сум', 2600, true);
  }
  lastSig = inside;
}

// ---------- Большая карта с названиями мест ----------
const bm = $('bigmap'), bmc = $('bigmap-c'), bctx = bmc.getContext('2d');
const PARK_RE = /парк/i, CITY_RE = /Стадион|Арена|Вокзал|Автодром|Торговый|Тоннель|Эстакада|Порт|АЗС/;
let bmView = { x: 0, z: 0, k: 0.6 }, bmOpen = false, places = null;
function mapPlaces() {
  const out = world.labels.map(l => ({ x: l.x, z: l.z, text: l.text, big: l.district, cat: l.district ? 'mount' : PARK_RE.test(l.text) ? 'park' : CITY_RE.test(l.text) ? 'city' : 'sight' }));
  const pri = { mount: 0, sight: 1, city: 2, park: 3 };
  return out.sort((a, b) => pri[a.cat] - pri[b.cat]);
}
const CAT_COL = { sight: '#f0b03c', park: '#5cc27a', city: '#e8e4dc', mount: '#6cc4e0' };
function drawBigMap() {
  const dpr = Math.min(devicePixelRatio || 1, 2), Wd = bmc.clientWidth, H = bmc.clientHeight;
  if (bmc.width !== Math.round(Wd * dpr)) { bmc.width = Math.round(Wd * dpr); bmc.height = Math.round(H * dpr); }
  const g = bctx, k = bmView.k;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#141316'; g.fillRect(0, 0, Wd, H);
  const SX = x => Wd / 2 + (x - bmView.x) * k, SZ = z => H / 2 + (z - bmView.z) * k;
  g.imageSmoothingEnabled = true;
  g.drawImage(mapCanvas, SX(MX0), SZ(MZ0), MAP_SIZE * k, MAP_SIZE * k);
  if (k > 0.45) world.drawMap(g, SX, SZ, k);
  // места: сначала все точки, потом подписи поверх (подписи не налезают друг на друга)
  const vis = places.filter(p => (k < 0.3 ? p.big || p.cat === 'sight' : !p.far)).map(p => ({ p, px: SX(p.x), py: SZ(p.z) })).filter(q => q.px > -100 && q.py > -40 && q.px < Wd + 100 && q.py < H + 40);
  for (const { p, px, py } of vis) { g.fillStyle = CAT_COL[p.cat]; g.strokeStyle = '#141316'; g.lineWidth = 2.5; g.beginPath(); g.arc(px, py, p.big ? 7 : 5, 0, 7); g.fill(); g.stroke(); }
  const boxes = [];
  for (const { p, px, py } of vis) {
    const fs = p.big ? 15 : 13; g.font = `${p.big ? 700 : 600} ${fs}px Rubik, Arial, sans-serif`;
    const tw = g.measureText(p.text).width, by = py - fs / 2 - 3, bw = tw + 10, bh = fs + 7;
    const hit = bx => bx < 4 || bx + bw > Wd - 4 || boxes.some(b => bx < b[0] + b[2] + 4 && bx + bw + 4 > b[0] && by < b[1] + b[3] + 2 && by + bh + 2 > b[1]);
    let bx = px + 9; if (hit(bx)) { bx = px - 9 - bw; if (hit(bx)) continue; }
    boxes.push([bx, by, bw, bh]);
    g.fillStyle = 'rgba(20,19,22,0.85)'; g.fillRect(bx, by, bw, bh);
    g.fillStyle = CAT_COL[p.cat]; g.fillRect(bx, by, 3, bh);
    g.fillStyle = '#f4efe6'; g.textBaseline = 'middle'; g.fillText(p.text, bx + 7, py + 0.5);
  }
  // машина игрока
  if (player) {
    const px = SX(player.x), py = SZ(player.z);
    g.save(); g.translate(px, py); g.rotate(-player.h + Math.PI / 2);
    g.fillStyle = '#d8343f'; g.strokeStyle = '#fff'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(0, -13); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fill(); g.stroke(); g.restore();
  }
  // масштабная линейка
  const m = [50, 100, 200, 500, 1000, 2000].find(v => v * k > 70) || 2000;
  g.fillStyle = '#f4efe6'; g.fillRect(16, 84, m * k, 3); g.font = '500 12px Rubik, Arial';
  g.fillText(m >= 1000 ? `${m / 1000} км` : `${m} м`, 16, 74);
}
function bmGo(where) {
  const Wd = bmc.clientWidth || innerWidth, H = bmc.clientHeight || innerHeight, fit = Math.min(Wd, H);
  if (where === 'city') bmView = { x: 0, z: 0, k: fit / 3000 };
  else bmView = { x: player.x, z: player.z, k: Math.max(bmView.k, fit / 700) };
  bm.querySelectorAll('[data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === where));
  drawBigMap();
}
function openBigMap() {
  if (!playing() && !bmOpen) return;
  places = places || mapPlaces();
  bmOpen = true; paused = true; bm.hidden = false;
  Object.keys(input).forEach(k => (input[k] = false));
  bmGo('city');
}
function closeBigMap() { if (!bmOpen) return; bmOpen = false; bm.hidden = true; paused = false; clock.getDelta(); }
const bmZoom = (f, cx, cy) => {
  const Wd = bmc.clientWidth, H = bmc.clientHeight, k0 = bmView.k, k1 = Math.min(6, Math.max(0.08, k0 * f));
  if (cx !== undefined) { bmView.x += (cx - Wd / 2) * (1 / k0 - 1 / k1); bmView.z += (cy - H / 2) * (1 / k0 - 1 / k1); }
  bmView.k = k1; drawBigMap();
};
$('btn-map').onclick = openBigMap; mm.onclick = openBigMap;
$('bm-close').onclick = closeBigMap;
$('bm-in').onclick = () => bmZoom(1.5); $('bm-out').onclick = () => bmZoom(1 / 1.5);
bm.querySelectorAll('[data-go]').forEach(b => (b.onclick = () => bmGo(b.dataset.go)));
bmc.addEventListener('wheel', e => { e.preventDefault(); bmZoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.offsetX, e.offsetY); }, { passive: false });
{ const pts = new Map(); let pinch = 0;
  bmc.addEventListener('pointerdown', e => { bmc.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); });
  bmc.addEventListener('pointermove', e => {
    const p = pts.get(e.pointerId); if (!p) return;
    if (pts.size === 1) { bmView.x -= (e.offsetX - p.x) / bmView.k; bmView.z -= (e.offsetY - p.y) / bmView.k; p.x = e.offsetX; p.y = e.offsetY; drawBigMap(); return; }
    p.x = e.offsetX; p.y = e.offsetY;
    const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) bmZoom(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2); pinch = d;
  });
  const up = e => { pts.delete(e.pointerId); pinch = 0; };
  bmc.addEventListener('pointerup', up); bmc.addEventListener('pointercancel', up);
}
addEventListener('resize', () => bmOpen && drawBigMap());
addEventListener('keydown', e => {
  if (e.code === 'KeyM') { bmOpen ? closeBigMap() : openBigMap(); }
  else if (e.code === 'Escape' && bmOpen) { e.stopImmediatePropagation(); closeBigMap(); }
}, true);

// ---------- Гараж: крутим машину мышкой или пальцем ----------
let dragA = 0, dragT = -10, dragX = null;
$('game').addEventListener('pointerdown', e => { if (mode === 'garage') { dragX = e.clientX; $('game').setPointerCapture(e.pointerId); } });
$('game').addEventListener('pointermove', e => { if (dragX === null) return; dragA -= (e.clientX - dragX) * 0.006; dragX = e.clientX; dragT = t; });
const dragEnd = () => { dragX = null; };
$('game').addEventListener('pointerup', dragEnd); $('game').addEventListener('pointercancel', dragEnd);

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
    const Y = player.y || 0, hAt = (x, z) => world.surfaceAt(x, z, Y);
    const yF = hAt(player.x + hx * hl, player.z + hz * hl), yB = hAt(player.x - hx * hl, player.z - hz * hl);
    player.grade = (yF - yB) / player.spec.len;
    const noFuel = mode === 'free' && save.fuel <= 0;
    const hit = player.update(dt, noFuel ? { ...input, up: false } : input, world.obstacles, CITY_HALF);
    if (mode === 'free' && hit > 3) { save.damage = Math.min(1, save.damage + (hit - 3) * 0.012); if (save.damage > 0.6 && !player._slowed) { player._slowed = true; player.setSpec(tunedSpec(carById(save.car), tuneOf(save, save.car), save.damage)); toast('Машина повреждена — заедь в автосервис', 3000, true); } }
    if (noFuel && !player._dry) { player._dry = true; toast('Бензин кончился — R вернёт на старт с запасом', 3500, true); }
    const yN = world.surfaceAt(player.x, player.z, Y);
    player.vy = yN < Y - 0.4 ? (player.vy || 0) - 9.81 * dt : 0;          // падение с края — с ускорением
    player.y = player.vy ? Math.max(yN, Y + player.vy * dt) : yN;
    const yL = hAt(player.x + hz * hw, player.z - hx * hw), yR = hAt(player.x - hz * hw, player.z + hx * hw);
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
    if (mode === 'free') serviceCheck(dt); else $('svc-btn').hidden = true;
  } else if (hangar && inHangar) {
    if (t - dragT > 2.5) orbit += dt;           // сам крутится, пока не трогают
    hangar.update(dt);
    hangar.camera(camera, mode === 'garage' ? 'garage' : 'menu', orbit + dragA / 0.16, innerWidth > 720);
  }
  if (world) world.updateSignals(t);
  audio.update(player ? player.speed : 0, input.up || input.down, input.horn, playing());
  sun.intensity = inHangar ? 0.35 : 2.5; hemiMain.intensity = inHangar ? 0.2 : 1.0;
  if (inHangar) { sun.position.set(HANGAR.x + SUN_OFF.x, SUN_OFF.y, HANGAR.z + SUN_OFF.z); sun.target.position.set(HANGAR.x, 0, HANGAR.z); }
  else if (player) { const py = player.y || 0; sun.position.set(player.x + SUN_OFF.x, SUN_OFF.y + py, player.z + SUN_OFF.z); sun.target.position.set(player.x, py, player.z); }
  scene.userData.sky.position.copy(camera.position);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- Запуск: заставка сразу, гараж после загрузки машин, город строится в фоне ----------
(async function boot() {
  show('menu'); $('btn-start').classList.add('wait');
  $('credits').textContent = CREDITS.join(' · ');
  requestAnimationFrame(frame);
  await loadCarModels();
  hangar = new Hangar(scene);
  world = new City(scene);
  levels = new LevelRunner(scene, world.obstacles);
  player = new Vehicle(carById(save.car));
  rebuildPlayer();
  setScene(true);
  updateMoney();
  $('btn-start').classList.remove('wait');
  window.__game = { player, world, levels, save, startLevel, startFree, input, camera, hangar };
  await world.buildAsync(p => { $('title-bar').style.width = $('load-bar').style.width = Math.round(p * 100) + '%'; });
  player.reset(world.spawn.x, world.spawn.z, world.spawn.h); camHeading = player.h;
  drawMapBase();
  cityReady = true; $('title-progress').classList.add('done');
  if (mode === 'garage') renderGarage();
  $('city-wait').hidden = true;
  if (afterCity) { const f = afterCity; afterCity = null; f(); }
})();
