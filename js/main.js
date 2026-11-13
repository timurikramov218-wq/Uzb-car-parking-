import * as THREE from 'three';
import { CARS, COLORS, carById, buildCarMesh, randomPlate } from './cars.js';
import { Vehicle } from './physics.js';
import { World, HALF, ROADS, SPAWN, LEVEL_CENTER } from './world.js';
import { LEVELS, LevelRunner } from './levels.js';
import { Net } from './net.js';

const $ = id => document.getElementById(id);

// ---------- Сохранение ----------
const SAVE_KEY = 'uzbcarparking-save-v1';
const save = Object.assign({ money: 1500, owned: ['matiz'], car: 'matiz', colors: {}, stars: {}, name: '', plate: randomPlate() },
  (() => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch { return {}; } })());
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} };
const colorOf = id => save.colors[id] || '#f2f2f0';

// ---------- Рендер ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2500);
scene.fog = new THREE.Fog(0xcfe3ee, 180, 1100);

// небо-градиент
{
  const g = new THREE.SphereGeometry(1800, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3d8fd6) }, bottom: { value: new THREE.Color(0xdcebf2) } },
    vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 p; void main(){ float t = clamp(p.y*1.6,0.,1.); gl_FragColor = vec4(mix(bottom, top, pow(t,0.7)),1.); }',
  });
  const sky = new THREE.Mesh(g, m); sky.renderOrder = -1; scene.add(sky);
  scene.userData.sky = sky;
}
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x8a7a5a, 0.9));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const SUN_OFF = new THREE.Vector3(80, 140, 50);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---------- Мир ----------
const world = new World(scene);
const levels = new LevelRunner(scene, world.obstacles);

// ---------- Игрок ----------
const player = new Vehicle(carById(save.car));
let playerMesh = null;
function rebuildPlayer() {
  if (playerMesh) scene.remove(playerMesh);
  player.setSpec(carById(save.car));
  playerMesh = buildCarMesh(player.spec, colorOf(save.car), save.plate);
  scene.add(playerMesh);
  syncMesh(playerMesh, player, 0);
}
function syncMesh(mesh, v, dt) {
  mesh.position.set(v.x, 0, v.z); mesh.rotation.y = v.h;
  const ud = mesh.userData;
  for (const w of ud.wheels) {
    w.spin.rotation.z = v.wheelRot;
    if (w.front) w.pivot.rotation.y = v.steer;
  }
  for (const m of ud.lights.brake) m.emissiveIntensity = v.braking ? 2.5 : 0.35;
}
player.reset(SPAWN.x, SPAWN.z, SPAWN.h);
rebuildPlayer();

// ---------- Ввод ----------
const input = { up: false, down: false, left: false, right: false, brake: false, horn: false };
const KEYS = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'brake', KeyH: 'horn' };
addEventListener('keydown', e => {
  if (document.activeElement?.tagName === 'INPUT') {
    if (e.code === 'Enter' && document.activeElement === $('chat-input')) sendChat();
    if (e.code === 'Escape') document.activeElement.blur();
    return;
  }
  if (KEYS[e.code]) { input[KEYS[e.code]] = true; e.preventDefault(); }
  if (!playing()) return;
  if (e.code === 'KeyC') cycleCam();
  if (e.code === 'KeyR') resetCar();
  if (e.code === 'Escape') openMenu();
  if (e.code === 'KeyT' && mode === 'online') { e.preventDefault(); const ci = $('chat-input'); ci.classList.remove('hidden'); ci.focus(); }
});
addEventListener('keyup', e => { if (KEYS[e.code]) input[KEYS[e.code]] = false; });
addEventListener('blur', () => Object.keys(input).forEach(k => (input[k] = false)));

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
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
      const master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
      this.eng = ctx.createOscillator(); this.eng.type = 'sawtooth';
      this.eng2 = ctx.createOscillator(); this.eng2.type = 'square';
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
      this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
      this.eng.connect(lp); this.eng2.connect(lp); lp.connect(this.engGain); this.engGain.connect(master);
      this.eng.start(); this.eng2.start();
      this.horn = [ctx.createOscillator(), ctx.createOscillator()];
      this.hornGain = ctx.createGain(); this.hornGain.gain.value = 0; this.hornGain.connect(master);
      this.horn[0].frequency.value = 415; this.horn[1].frequency.value = 520;
      for (const o of this.horn) { o.type = 'square'; o.connect(this.hornGain); o.start(); }
      this.master = master;
    } catch { this.ctx = null; }
  },
  update(speed, throttle, horn, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const rpm = 45 + (Math.abs(speed) % 14) * 7 + Math.abs(speed) * 1.2 + (throttle ? 15 : 0);
    this.eng.frequency.setTargetAtTime(rpm, t, 0.05);
    this.eng2.frequency.setTargetAtTime(rpm * 0.5, t, 0.05);
    this.engGain.gain.setTargetAtTime(active ? 0.12 + (throttle ? 0.06 : 0) : 0, t, 0.1);
    this.hornGain.gain.setTargetAtTime(horn && active ? 0.08 : 0, t, 0.02);
  },
  thump(v) {
    if (!this.ctx) return;
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(120, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.25);
    g.gain.setValueAtTime(Math.min(0.6, v / 15), ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    o.connect(g); g.connect(this.master); o.start(); o.stop(ctx.currentTime + 0.3);
  },
  ding() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    [660, 880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f;
      const t0 = ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + 0.45);
    });
  },
};
addEventListener('pointerdown', () => audio.init());
addEventListener('keydown', () => audio.init());

// ---------- Камера ----------
const CAMS = [{ dist: 7.5, h: 3.0, look: 1.0 }, { dist: 13, h: 5.5, look: 1.0 }, { top: true }, { inside: true }];
const CAM_NAMES = ['Камера: сзади', 'Камера: дальняя', 'Камера: сверху', 'Камера: из салона'];
let camIdx = 0;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let camHeading = 0;
function cycleCam() { camIdx = (camIdx + 1) % CAMS.length; toast(CAM_NAMES[camIdx]); }
function updateCamera(dt, snap = false) {
  const c = CAMS[camIdx];
  const k = snap ? 1 : 1 - Math.exp(-dt * 5);
  // камера смотрит по направлению движения (при заднем ходе не разворачивается резко)
  let dh = player.h - camHeading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  camHeading += dh * (snap ? 1 : 1 - Math.exp(-dt * 4));
  const fx = Math.cos(camHeading), fz = -Math.sin(camHeading);
  const want = new THREE.Vector3(), look = new THREE.Vector3(player.x, 1, player.z);
  if (c.top) {
    want.set(player.x - fx * 0.01, 32, player.z - fz * 0.01);
  } else if (c.inside) {
    const s = player.spec;
    // водитель слева (левый руль), чуть позади середины
    want.set(player.x - fx * s.len * 0.08 + fz * 0.35, s.hgt * 0.8, player.z - fz * s.len * 0.08 - fx * 0.35);
    look.set(player.x + fx * 20, s.hgt * 0.7, player.z + fz * 20);
    camPos.copy(want); camLook.copy(look);
  } else {
    want.set(player.x - fx * c.dist, c.h, player.z - fz * c.dist);
    look.y = c.look;
  }
  if (!c.inside) { camPos.lerp(want, k); camLook.lerp(look, k); }
  if (c.top) camera.up.set(fx, 0, fz); else camera.up.set(0, 1, 0);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  playerMesh.visible = !c.inside;
}

// ---------- Миникарта ----------
const mm = $('minimap'), mctx = mm.getContext('2d');
const mapCanvas = document.createElement('canvas'); mapCanvas.width = mapCanvas.height = 840;
{
  const g = mapCanvas.getContext('2d'), S = 840 / (HALF * 2);
  g.fillStyle = '#b8a27a'; g.fillRect(0, 0, 840, 840);
  const colors = { park: '#5d8a3a', square: '#5d8a3a', apartments: '#7f9a62', offices: '#8a8f98', mahalla: '#c9ae80', madrasa: '#1b9ec9', gas: '#1e9e4a', autodrom: '#c8202a', parking: '#6a6d75', bazaar: '#e0a040' };
  for (const b of world.blocks) { g.fillStyle = colors[b.type] || '#999'; g.fillRect((b.x - 53 + HALF) * S, (b.z - 53 + HALF) * S, 106 * S, 106 * S); }
  g.fillStyle = '#3a3c40';
  for (const r of ROADS) { g.fillRect((r - 7 + HALF) * S, 0, 14 * S, 840); g.fillRect(0, (r - 7 + HALF) * S, 840, 14 * S); }
}
function drawMinimap() {
  const W = mm.width, s = 1.4; // пикселей на метр
  mctx.save();
  mctx.fillStyle = '#223'; mctx.fillRect(0, 0, W, W);
  mctx.translate(W / 2, W / 2);
  mctx.rotate(-(Math.PI / 2 - camHeading) * (CAMS[camIdx].top ? 1 : 1));
  const S = 840 / (HALF * 2);
  mctx.scale(s / S, s / S);
  mctx.drawImage(mapCanvas, -(player.x + HALF) * S, -(player.z + HALF) * S);
  mctx.restore();
  const toMap = (x, z) => {
    const dx = (x - player.x) * s, dz = (z - player.z) * s, a = -(Math.PI / 2 - camHeading);
    return [W / 2 + dx * Math.cos(a) - dz * Math.sin(a), W / 2 + dx * Math.sin(a) + dz * Math.cos(a)];
  };
  // цель уровня / другие игроки
  const dot = (x, z, col, r = 5) => {
    let [px, py] = toMap(x, z);
    const d = Math.hypot(px - W / 2, py - W / 2), max = W / 2 - 8;
    if (d > max) { px = W / 2 + (px - W / 2) * max / d; py = W / 2 + (py - W / 2) * max / d; }
    mctx.fillStyle = col; mctx.beginPath(); mctx.arc(px, py, r, 0, 7); mctx.fill();
  };
  if (mode === 'level' && levels.spot) dot(levels.spot.x, levels.spot.z, '#3dff8c', 6);
  if (mode === 'free') dot(LEVEL_CENTER.x, LEVEL_CENTER.z, '#ff4040', 5);
  for (const r of remotes.values()) dot(r.cur.x, r.cur.z, '#ffd36b', 5);
  // игрок
  mctx.fillStyle = '#fff'; mctx.beginPath();
  mctx.moveTo(W / 2, W / 2 - 9); mctx.lineTo(W / 2 + 6, W / 2 + 6); mctx.lineTo(W / 2, W / 2 + 3); mctx.lineTo(W / 2 - 6, W / 2 + 6); mctx.fill();
}

// ---------- Онлайн ----------
const remotes = new Map();
function nameSprite(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.roundRect(8, 8, 240, 48, 20); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 30px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, 128, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  s.scale.set(3, 0.75, 1); s.renderOrder = 10; return s;
}
const net = new Net({
  onState(id, st) {
    let r = remotes.get(id);
    const car = typeof st.car === 'string' ? st.car : 'matiz';
    const col = /^#[0-9a-f]{6}$/i.test(st.col) ? st.col : '#ffffff';
    const name = String(st.name || 'Игрок').slice(0, 16);
    if (!r || r.car !== car || r.col !== col || r.name !== name) {
      if (r) scene.remove(r.mesh);
      const spec = carById(car);
      const mesh = buildCarMesh(spec, col, typeof st.plate === 'string' ? st.plate.slice(0, 12) : randomPlate());
      const label = nameSprite(name); label.position.set(0, spec.hgt + 1, 0); mesh.add(label);
      scene.add(mesh);
      const v = { x: +st.x || 0, z: +st.z || 0, h: +st.h || 0, steer: 0, wheelRot: 0, braking: false };
      r = { mesh, car, col, name, spec, cur: v, tgt: { ...v }, obb: { x: v.x, z: v.z, h: v.h, hl: spec.len / 2, hw: spec.wid / 2 } };
      if (!remotes.has(id)) toast(`${name} в игре`);
      remotes.set(id, r);
    }
    r.tgt = { x: +st.x || 0, z: +st.z || 0, h: +st.h || 0, s: +st.s || 0 };
    r.cur.steer = +st.st || 0; r.cur.braking = !!st.b; r.last = performance.now();
    updateOnlineInfo();
  },
  onLeave(id) { const r = remotes.get(id); if (r) { scene.remove(r.mesh); remotes.delete(id); toast(`${r.name} вышел`); } updateOnlineInfo(); },
  onStatus(text) { if (text) toast(text); updateOnlineInfo(); },
  onChat(name, text) { addChat(name, text); },
});
function updateRemotes(dt) {
  const k = 1 - Math.exp(-dt * 10);
  const now = performance.now();
  player.extra = [];
  for (const [id, r] of remotes) {
    if (now - r.last > 8000) { net.h.onLeave(id); continue; }
    const c = r.cur, t = r.tgt;
    c.x += (t.x - c.x) * k; c.z += (t.z - c.z) * k;
    let dh = t.h - c.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); c.h += dh * k;
    c.wheelRot -= (t.s / r.spec.len) * dt * 4.5;
    syncMesh(r.mesh, c, dt);
    Object.assign(r.obb, { x: c.x, z: c.z, h: c.h });
    player.extra.push(r.obb);
  }
}
function updateOnlineInfo() {
  const el = $('online-info');
  if (mode !== 'online') { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.textContent = `🌐 Комната ${net.code} · игроков: ${remotes.size + 1}`;
}
let netTimer = 0;
function sendNet(dt) {
  netTimer += dt;
  if (netTimer < 1 / 15 || mode !== 'online') return;
  netTimer = 0;
  net.sendState({ x: +player.x.toFixed(2), z: +player.z.toFixed(2), h: +player.h.toFixed(3), s: +player.speed.toFixed(2), st: +player.steer.toFixed(2), b: player.braking ? 1 : 0,
    car: save.car, col: colorOf(save.car), name: save.name || 'Игрок', plate: save.plate });
}
function addChat(name, text) {
  const log = $('chat-log'); log.classList.remove('hidden');
  const d = document.createElement('div');
  const b = document.createElement('b'); b.textContent = name + ': ';
  d.append(b, document.createTextNode(text));
  log.append(d);
  while (log.children.length > 6) log.firstChild.remove();
  setTimeout(() => d.remove(), 15000);
}
function sendChat() {
  const ci = $('chat-input'), text = ci.value.trim();
  if (text) { net.sendChat(save.name || 'Игрок', text); addChat(save.name || 'Я', text); }
  ci.value = ''; ci.blur(); ci.classList.add('hidden');
}

// ---------- UI ----------
let mode = 'menu'; // menu | free | level | online | garage
let prevPlayMode = null, paused = true;
const playing = () => ['free', 'level', 'online'].includes(mode) && !paused;
const screens = ['menu', 'levels', 'garage', 'online', 'result', 'loading'];
function show(id) { for (const s of screens) $(s).classList.toggle('hidden', s !== id); }
let toastT;
function toast(text) { const t = $('toast'); t.textContent = text; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }
function updateMoney() { for (const id of ['money', 'menu-money', 'garage-money']) $(id).textContent = save.money.toLocaleString('ru-RU'); $('menu-car').textContent = carById(save.car).name; }

function enterPlay(m) {
  mode = m; paused = false; prevPlayMode = m;
  show(null); $('hud').classList.remove('hidden');
  $('touch').classList.toggle('hidden', !isTouch);
  $('level-panel').classList.toggle('hidden', m !== 'level');
  updateOnlineInfo(); updateMoney();
  $('btn-resume').classList.remove('hidden');
}
function openMenu() {
  paused = true; mode = 'menu';
  if (prevPlayMode === 'online') mode = 'online';
  if (prevPlayMode === 'level') mode = 'level';
  $('hud').classList.add('hidden'); $('touch').classList.add('hidden');
  show('menu'); updateMoney();
}
function resetCar() {
  if (mode === 'level') { startLevel(levels.idx); return; }
  // ставим на ближайшую дорогу
  const near = a => ROADS.reduce((b, r) => (Math.abs(r - a) < Math.abs(b - a) ? r : b), ROADS[0]);
  const rx = near(player.x), rz = near(player.z);
  if (Math.abs(rx - player.x) < Math.abs(rz - player.z)) player.reset(rx + 3.5, player.z, Math.PI / 2);
  else player.reset(player.x, rz + 3.5, 0);
  camHeading = player.h; updateCamera(0, true);
}

function closeOnline() {
  net.close();
  for (const id of [...remotes.keys()]) net.h.onLeave(id);
  $('chat-log').classList.add('hidden');
}

function startFree() {
  levels.clear();
  if (prevPlayMode === 'online') closeOnline();
  player.reset(SPAWN.x, SPAWN.z, SPAWN.h); camHeading = player.h; updateCamera(0, true);
  enterPlay('free'); toast('Свободная езда — красная точка на карте: Автодром');
}

function startLevel(i) {
  if (prevPlayMode === 'online') closeOnline();
  levels.clear();
  const st = levels.start(i, player.spec);
  player.reset(st.x, st.z, st.h); camHeading = player.h; updateCamera(0, true);
  $('lvl-name').textContent = `${i + 1}. ${LEVELS[i].name}`;
  $('lvl-hint').textContent = LEVELS[i].desc;
  enterPlay('level');
}

function levelUnlocked(i) { return i === 0 || (save.stars[i - 1] || 0) > 0; }
function renderLevels() {
  const g = $('level-grid'); g.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const b = document.createElement('button'); b.className = 'level-card'; b.disabled = !levelUnlocked(i);
    const st = save.stars[i] || 0;
    b.innerHTML = `<span class="num">${i + 1}</span><span class="t"></span><span class="d"></span><span class="s">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</span><span class="d">💰 ${L.reward}</span>`;
    b.querySelector('.t').textContent = b.disabled ? '🔒 ' + L.name : L.name;
    b.querySelectorAll('.d')[0].textContent = L.desc;
    b.onclick = () => startLevel(i);
    g.append(b);
  });
}

function finishLevel(res) {
  paused = true;
  const i = levels.idx, L = LEVELS[i];
  $('hud').classList.add('hidden'); $('touch').classList.add('hidden');
  show('result');
  if (res === 'win') {
    audio.ding();
    const stars = levels.stars();
    const first = !(save.stars[i] > 0);
    const reward = Math.round(L.reward * (first ? 1 : 0.3) * (0.6 + stars * 0.15));
    save.stars[i] = Math.max(save.stars[i] || 0, stars);
    save.money += reward; persist(); updateMoney();
    $('res-title').textContent = 'Отлично припарковался!';
    $('res-stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    $('res-text').textContent = `Касаний: ${levels.hits} · Осталось ${Math.ceil(levels.timeLeft)} с · +${reward.toLocaleString('ru-RU')} сум`;
    $('res-next').classList.toggle('hidden', i >= LEVELS.length - 1);
  } else {
    $('res-title').textContent = 'Время вышло';
    $('res-stars').textContent = '☆☆☆';
    $('res-text').textContent = 'Попробуй ещё раз — не спеши и используй камеру сверху (C).';
    $('res-next').classList.add('hidden');
  }
}
$('res-menu').onclick = () => { levels.clear(); prevPlayMode = null; $('btn-resume').classList.add('hidden'); mode = 'menu'; show('menu'); };
$('res-retry').onclick = () => startLevel(levels.idx);
$('res-next').onclick = () => startLevel(levels.idx + 1);

// гараж
let garageSel = save.car, garageColor = null;
function renderGarage() {
  const list = $('car-list'); list.innerHTML = '';
  const maxS = Math.max(...CARS.map(c => c.maxSpeed)), maxA = Math.max(...CARS.map(c => c.accel));
  for (const c of CARS) {
    const b = document.createElement('button'); b.className = 'car-item' + (c.id === garageSel ? ' sel' : '');
    const owned = save.owned.includes(c.id);
    b.innerHTML = `<b></b>${owned ? `<span class="owned">${c.id === save.car ? '✔ Выбрана' : 'Куплена'}</span>` : `<span class="price">${c.price.toLocaleString('ru-RU')} сум</span>`}<small></small>
      <div class="bars"><span>Скорость<i style="width:${(c.maxSpeed / maxS) * 100}%"></i></span><span>Разгон<i style="width:${(c.accel / maxA) * 100}%"></i></span><span>Размер<i style="width:${(c.len / 5) * 100}%"></i></span></div>`;
    b.querySelector('b').textContent = 'Chevrolet ' + c.name;
    b.querySelector('small').textContent = c.desc;
    b.onclick = () => { garageSel = c.id; garageColor = null; previewGarage(); renderGarage(); };
    list.append(b);
  }
  const cl = $('color-list'); cl.innerHTML = '';
  const cur = garageColor || colorOf(garageSel);
  for (const col of COLORS) {
    const b = document.createElement('button'); b.style.background = col.hex; b.title = col.name;
    if (col.hex === cur) b.className = 'sel';
    b.onclick = () => { garageColor = col.hex; previewGarage(); renderGarage(); };
    cl.append(b);
  }
  const btn = $('btn-buy'), c = carById(garageSel), owned = save.owned.includes(c.id);
  if (!owned) { btn.textContent = `Купить за ${c.price.toLocaleString('ru-RU')} сум`; btn.disabled = save.money < c.price; }
  else if (garageColor && garageColor !== colorOf(c.id)) { btn.textContent = 'Покрасить за 200 сум'; btn.disabled = save.money < 200; }
  else { btn.textContent = c.id === save.car ? 'Поехали!' : 'Выбрать'; btn.disabled = false; }
  updateMoney();
}
let garageMesh = null;
function previewGarage() {
  if (garageMesh) scene.remove(garageMesh);
  garageMesh = buildCarMesh(carById(garageSel), garageColor || colorOf(garageSel), save.plate);
  garageMesh.position.set(player.x, 0, player.z); garageMesh.rotation.y = player.h;
  scene.add(garageMesh); playerMesh.visible = false;
}
$('btn-buy').onclick = () => {
  const c = carById(garageSel), owned = save.owned.includes(c.id);
  if (!owned) {
    if (save.money < c.price) return;
    save.money -= c.price; save.owned.push(c.id); if (garageColor) save.colors[c.id] = garageColor;
    save.car = c.id; toast(`Поздравляем с покупкой ${c.name}!`); audio.ding();
  } else if (garageColor && garageColor !== colorOf(c.id)) {
    if (save.money < 200) return;
    save.money -= 200; save.colors[c.id] = garageColor; save.car = c.id; garageColor = null; toast('Покрашено!');
  } else {
    save.car = c.id; persist(); closeGarage(); return;
  }
  persist(); rebuildPlayer(); previewGarage(); renderGarage();
};
function openGarage() {
  if (prevPlayMode === 'level') { levels.clear(); prevPlayMode = null; $('btn-resume').classList.add('hidden'); }
  mode = 'garage'; paused = true; garageSel = save.car; garageColor = null;
  show('garage'); previewGarage(); renderGarage();
}
function closeGarage() {
  if (garageMesh) { scene.remove(garageMesh); garageMesh = null; }
  rebuildPlayer(); playerMesh.visible = true;
  if (prevPlayMode) enterPlay(prevPlayMode); else startFree();
}

document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
  const g = b.dataset.go;
  if (g === 'free') startFree();
  else if (g === 'levels') { renderLevels(); show('levels'); }
  else if (g === 'online') { $('player-name').value = save.name; $('online-status').textContent = ''; show('online'); }
  else if (g === 'garage') openGarage();
  else if (g === 'resume') { if (prevPlayMode) enterPlay(prevPlayMode); }
  else if (g === 'menu') {
    if (mode === 'garage') { if (garageMesh) { scene.remove(garageMesh); garageMesh = null; } playerMesh.visible = true; mode = 'menu'; }
    show('menu'); updateMoney();
  }
}));
$('btn-pause').onclick = openMenu;

async function goOnline(host) {
  const name = $('player-name').value.trim().slice(0, 16);
  if (!name) { $('online-status').textContent = 'Введи имя'; return; }
  save.name = name; persist();
  const code = host ? Net.randomCode() : $('room-code').value.trim().toUpperCase();
  if (!host && code.length !== 4) { $('online-status').textContent = 'Код из 4 символов'; return; }
  if (!window.Peer) { $('online-status').textContent = 'Онлайн-модуль не загрузился'; return; }
  $('online-status').textContent = host ? 'Создаём комнату…' : 'Подключаемся…';
  if (levels.active) levels.clear();
  net.close();
  try {
    await (host ? net.host(code) : net.join(code));
    player.reset(SPAWN.x + (Math.random() - 0.5) * 6, SPAWN.z + Math.random() * 30, SPAWN.h); camHeading = player.h; updateCamera(0, true);
    enterPlay('online');
    toast(host ? `Комната ${code} — отправь код друзьям` : `Ты в комнате ${code}`);
  } catch (e) {
    net.close();
    $('online-status').textContent = 'Ошибка: ' + (e.message || e.type || e);
  }
}
$('btn-host').onclick = () => goOnline(true);
$('btn-join').onclick = () => goOnline(false);

// ---------- Цикл ----------
const clock = new THREE.Clock();
let t = 0, menuAngle = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05); t += dt;
  if (playing()) {
    const hit = player.update(dt, input, world.obstacles, HALF + 30);
    if (hit > 1.2) audio.thump(hit);
    if (mode === 'level') {
      const r = levels.update(dt, player, hit, t);
      $('lvl-time').textContent = Math.max(0, Math.ceil(levels.timeLeft));
      $('lvl-hits').textContent = levels.hits;
      const h = $('lvl-hint');
      h.classList.toggle('ok', !!levels.inside);
      h.textContent = levels.inside ? (Math.abs(player.speed) < 0.4 ? 'Держи… ✓' : 'Остановись!') : LEVELS[levels.idx].desc;
      if (r) finishLevel(r);
    }
    syncMesh(playerMesh, player, dt);
    updateCamera(dt);
    $('speed').textContent = Math.round(Math.abs(player.speed) * 3.6);
    $('gear').textContent = player.speed < -0.2 ? 'R' : Math.abs(player.speed) < 0.2 ? 'N' : 'D';
    drawMinimap();
  } else if (mode === 'garage') {
    menuAngle += dt * 0.35;
    const r = 7;
    camera.up.set(0, 1, 0);
    camera.position.set(player.x + Math.cos(menuAngle) * r, 2.2, player.z + Math.sin(menuAngle) * r);
    camera.lookAt(player.x - (innerWidth > 700 ? 0 : 0), 0.7, player.z);
  } else {
    menuAngle += dt * 0.08;
    camera.up.set(0, 1, 0);
    camera.position.set(player.x + Math.cos(menuAngle) * 14, 4.5, player.z + Math.sin(menuAngle) * 14);
    camera.lookAt(player.x, 1.2, player.z);
  }
  if (mode === 'online' || remotes.size) updateRemotes(dt);
  sendNet(dt);
  audio.update(player.speed, input.up || input.down, input.horn, playing());
  sun.position.set(player.x + SUN_OFF.x, SUN_OFF.y, player.z + SUN_OFF.z);
  sun.target.position.set(player.x, 0, player.z);
  scene.userData.sky.position.copy(camera.position);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

updateMoney();
show('menu');
requestAnimationFrame(frame);
window.__game = { player, world, levels, save, startLevel, startFree, input };
