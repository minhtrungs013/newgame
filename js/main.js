import * as THREE from 'three';
import { Terrain, heightAt, waterAt, pondsNear, fillPondUniforms } from './terrain.js';
import { Water } from './water.js';
import { Crocs } from './crocs.js';
import { LEVEL_MAX, XP_MAX, levelInfo, stageName } from './levels.js';

const CARD_RANGE = 10;   // metres: how close you must be to inspect another cow
import { Grass } from './grass.js';
import { Cow, BUTT_HIT_AT } from './cow.js';
import { Sky } from './sky.js';
import { Environment } from './environment.js';
import { World } from './world.js';
import { AudioSys } from './audio.js';
import { Net, NameTag } from './net.js';
import { Customizer } from './customize.js';
import { ClanPanel } from './clan-ui.js';
import { GamepadInput } from './gamepad.js';
import { MAX_COWS } from './grass.js';
import { WEATHERS, SEASON_ORDER, SEASON_INFO, WEATHER_NAMES } from './environment.js';

const $ = (id) => document.getElementById(id);

// Levels 0..30: grazing (and a little drinking) earns XP; each level makes the cow bigger.
// Hunger and thirst cost XP (you can drop levels). server.js caps how fast XP can grow.
const XP_GRAZE = 1;      // per second of eating grass (Lv 30 takes ~78 min of grazing)
const XP_DRINK = 0.25;   // per second of drinking
const XP_HUNGER = 0.75;  // lost per second for each unmet need
const dpr = window.devicePixelRatio || 1;
const QUALITY = {
  low:    { blades: 45000,  patch: 64,  segs: 3, pr: Math.min(dpr, 1) * 0.75, shadows: false, shadowMap: 1024, flowers: 700,  rain: 1500 },
  medium: { blades: 160000, patch: 84,  segs: 4, pr: Math.min(dpr, 1),        shadows: true,  shadowMap: 1024, flowers: 1800, rain: 3000 },
  high:   { blades: 300000, patch: 104, segs: 5, pr: Math.min(dpr, 1.5),      shadows: true,  shadowMap: 2048, flowers: 3000, rain: 4500 },
  ultra:  { blades: 500000, patch: 128, segs: 5, pr: Math.min(dpr, 2),        shadows: true,  shadowMap: 4096, flowers: 4500, rain: 6000 },
};

// ---------- renderer / scene ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x999999, 0.01);
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2200);

const hemi = new THREE.HemisphereLight(0xffffff, 0x334422, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.castShadow = true;
sun.shadow.camera.left = -22; sun.shadow.camera.right = 22;
sun.shadow.camera.top = 22; sun.shadow.camera.bottom = -22;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 160;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);

const env = new Environment();
const sky = new Sky(scene);
const terrain = new Terrain(scene);
const grass = new Grass(scene);
const world = new World(scene);
const water = new Water(scene);
const crocs = new Crocs(scene);

// health: drains while starving or parched; at 0 the cow dies
const HEALTH_DRAIN = 1 / 90;  // per second for each unmet need (hunger / thirst)
const HEALTH_REGEN = 1 / 60;  // per second when fed and watered
let cow = new Cow(scene);
const audio = new AudioSys();
const onStep = (sp) => {
  const w = waterAt(cow.pos.x, cow.pos.z);
  if (w && w.depth > 0.05) audio.splash(Math.min(1, 0.5 + sp * 0.15));
  else audio.step(sp, env.weather.rain > 0.5);
};
const onLand = (v) => { audio.land(v); state.shake = Math.max(state.shake, Math.min(0.2, v * 0.02)); };
cow.onStep = onStep;
cow.onLand = onLand;
const selfTag = new NameTag($('tags'), '', true);
const selfTagPos = new THREE.Vector3();

// ---------- rain ----------
class Rain {
  constructor() {
    this.mat = new THREE.LineBasicMaterial({ color: 0xc8d0d8, transparent: true, opacity: 0.35, depthWrite: false });
    this.lines = null;
  }
  build(count) {
    if (this.lines) { scene.remove(this.lines); this.lines.geometry.dispose(); }
    this.count = count;
    this.drops = new Float32Array(count * 4); // x,y,z,speed
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    for (let i = 0; i < count; i++) this._reset(i, camera.position, true);
  }
  _reset(i, c, randomY) {
    const d = this.drops;
    d[i * 4] = c.x + (Math.random() - 0.5) * 60;
    d[i * 4 + 2] = c.z + (Math.random() - 0.5) * 60;
    d[i * 4 + 1] = c.y + (randomY ? (Math.random() - 0.3) * 40 : 20 + Math.random() * 10);
    d[i * 4 + 3] = 18 + Math.random() * 8;
  }
  update(dt, amount, wind, windDir) {
    this.lines.visible = amount > 0.02;
    this.mat.opacity = 0.32 * amount;
    if (!this.lines.visible) return;
    const d = this.drops, p = this.lines.geometry.attributes.position.array, c = camera.position;
    const wx = windDir.x * wind * 3.5, wz = windDir.y * wind * 3.5;
    const active = Math.floor(this.count * amount);
    for (let i = 0; i < this.count; i++) {
      const o = i * 4;
      const s = d[o + 3];
      d[o] += wx * dt; d[o + 1] -= s * dt; d[o + 2] += wz * dt;
      if (d[o + 1] < c.y - 15 || Math.abs(d[o] - c.x) > 32 || Math.abs(d[o + 2] - c.z) > 32 ||
          d[o + 1] < heightAt(d[o], d[o + 2])) this._reset(i, c, false);
      const k = i < active ? 0.045 : 0;
      p[i * 6] = d[o]; p[i * 6 + 1] = d[o + 1]; p[i * 6 + 2] = d[o + 2];
      p[i * 6 + 3] = d[o] - wx * k; p[i * 6 + 4] = d[o + 1] + s * k; p[i * 6 + 5] = d[o + 2] - wz * k;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
const rain = new Rain();

// ---------- snowfall (winter "rain") ----------
class Snow {
  constructor(count = 2500) {
    this.count = count;
    this.flakes = new Float32Array(count * 4); // x, y, z, phase
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    // soft round flake sprite
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'), rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.5, 'rgba(255,255,255,.6)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 32, 32);
    this.mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthWrite: false });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < count; i++) this._reset(i, camera.position, true);
  }
  _reset(i, c, anyY) {
    const d = this.flakes;
    d[i * 4] = c.x + (Math.random() - 0.5) * 50;
    d[i * 4 + 2] = c.z + (Math.random() - 0.5) * 50;
    d[i * 4 + 1] = c.y + (anyY ? (Math.random() - 0.4) * 30 : 12 + Math.random() * 8);
    d[i * 4 + 3] = Math.random() * 10;
  }
  update(dt, amount, wind, windDir) {
    this.points.visible = amount > 0.02;
    this.mat.opacity = 0.85 * amount;
    if (!this.points.visible) return;
    const d = this.flakes, p = this.points.geometry.attributes.position.array, c = camera.position;
    const active = Math.floor(this.count * amount);
    for (let i = 0; i < this.count; i++) {
      const o = i * 4;
      d[o + 3] += dt;
      d[o] += (windDir.x * wind * 1.2 + Math.sin(d[o + 3] * 1.3) * 0.4) * dt;
      d[o + 2] += (windDir.y * wind * 1.2 + Math.cos(d[o + 3] * 1.1) * 0.4) * dt;
      d[o + 1] -= (1.2 + (i % 7) * 0.12) * dt;
      if (d[o + 1] < c.y - 12 || Math.abs(d[o] - c.x) > 26 || Math.abs(d[o + 2] - c.z) > 26 || d[o + 1] < heightAt(d[o], d[o + 2])) this._reset(i, c, false);
      const hide = i >= active ? -1000 : 0;
      p[i * 3] = d[o]; p[i * 3 + 1] = d[o + 1] + hide; p[i * 3 + 2] = d[o + 2];
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
const snow = new Snow();

// ---------- drifting leaves / petals (colour & amount follow the season) ----------
const LEAVES = 220;
const leafGeo = new THREE.PlaneGeometry(0.1, 0.06);
const leafMat = new THREE.MeshStandardMaterial({ color: 0xe0c050, side: THREE.DoubleSide, roughness: 0.8 });
const leaves = new THREE.InstancedMesh(leafGeo, leafMat, LEAVES);
leaves.frustumCulled = false;
scene.add(leaves);
const leafData = Array.from({ length: LEAVES }, () => ({ p: new THREE.Vector3(), r: new THREE.Euler(), s: Math.random() * 10, v: 0.3 + Math.random() * 0.5 }));
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1);
function resetLeaf(l, around, anywhere) {
  const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 26;
  l.p.set(around.x + Math.cos(a) * r, 0, around.z + Math.sin(a) * r);
  l.p.y = heightAt(l.p.x, l.p.z) + (anywhere ? 0.2 + Math.random() * 4 : 3 + Math.random() * 3);
}

// ---------- state ----------
const state = {
  started: false,
  quality: 'medium',
  cinematic: false,
  debug: false,
  yaw: Math.PI, pitch: 0.45, dist: 8,
  camYaw: Math.PI, camPitch: 0.45, camDist: 8,
  lastDrag: -10,
  keys: new Set(),
  time: 0,
  happy: 0.6, food: 0.5, distance: 0,
  xp: 0,
  level: 0,
  age: 0,              // displayed body age (eases towards level / 30)
  starvingWarned: false,
  water: 0.7,          // 1 = not thirsty
  thirstWarned: false,
  canDrink: false,
  drinking: false,
  slurpTimer: 0,
  clan: null,          // { id, tag, color, name } of my clan
  lastHitBy: '',
  health: 1,
  dead: false,
  deathShown: false,
  nearShore: false,
  shoreTimer: 0,
  crocStalking: false,
  lightningTimer: 12,
  chewTimer: 0,
  shake: 0,            // camera shake amount
  buttCooldown: 0,
  buttChecked: true,   // hit test already done for the current headbutt
  obstacleTimer: 0,
};

function applyQuality(name) {
  const q = QUALITY[name];
  state.quality = name;
  renderer.setPixelRatio(q.pr);
  const had = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = q.shadows;
  sun.castShadow = q.shadows;
  if (sun.shadow.map && sun.shadow.mapSize.x !== q.shadowMap) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
  if (had !== q.shadows) scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  grass.build(q);
  rain.build(q.rain);
  world.radius = name === 'low' ? 4 : name === 'ultra' ? 6 : 5;
  world._lx = undefined;
}

// ---------- input ----------
addEventListener('keydown', (e) => {
  // Ctrl+K: show/hide the hidden weather & time controls
  if (e.ctrlKey && e.code === 'KeyK') {
    e.preventDefault();
    const on = document.body.classList.toggle('show-env');
    toast(on ? 'Đã mở chỉnh thời tiết & thời gian (Ctrl+K để ẩn)' : 'Đã ẩn chỉnh thời tiết & thời gian');
    return;
  }
  if (e.code === 'Escape' && state.started) {
    e.preventDefault();
    if (!$('invite').classList.contains('hidden')) $('invite').classList.add('hidden');
    else toggleMenu();
    return;
  }
  if (menuOpen) return;
  if (state.dead) {
    if ((e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') && state.deathShown) { e.preventDefault(); respawn(); }
    return;
  }
  if (e.target.tagName === 'INPUT') return;
  if (e.target.tagName === 'SELECT') e.target.blur();
  const k = e.code;
  if ((k === 'Enter' || k === 'NumpadEnter') && state.started) { e.preventDefault(); openChat(); return; }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3'].includes(k)) e.preventDefault();
  if (e.repeat) { state.keys.add(k); return; }
  state.keys.add(k);
  if (k === 'KeyZ' && state.started) toggleLie();
  if (k === 'Space' && state.started && cow.stun <= 0 && cow.isUp && !cow.lying && cow.jump()) {
    audio.jump();
    net.send({ t: 'act', a: 'jump' });
  }
  if (k === 'KeyF' && state.started && cow.isUp && !cow.lying) tryButt();
  if (k === 'KeyQ' && state.started) {
    audio.moo();
    selfTag.say('Mooo~', 2);
    net.send({ t: 'moo' });
    state.happy = Math.min(1, state.happy + 0.03);
  }
  if (k === 'KeyE' && state.started && Math.abs(cow.speed) < 0.6 && !cow.lying) cow.startGraze(1.5);
  if (k === 'KeyG' && state.started) { toggleMenu(true, 'clan'); return; }
  if (k === 'KeyC') {
    state.cinematic = !state.cinematic;
    document.body.classList.toggle('cinematic', state.cinematic);
  }
  if (k === 'F3') {
    state.debug = !state.debug;
    $('debug').classList.toggle('hidden', !state.debug);
  }
});
addEventListener('keyup', (e) => state.keys.delete(e.code));
addEventListener('blur', () => state.keys.clear());

// ---------- gamepad: buttons become the same key codes as the keyboard ----------
const pad = new GamepadInput({
  onKey: (code, down) => {
    if (down && code === 'Space' && !state.started && !$('start').classList.contains('gone')) { $('btn-start').click(); return; }
    if (down && code === 'KeyZ' && (menuOpen || !$('invite').classList.contains('hidden'))) code = 'Escape'; // B = back
    if (down && code === 'KeyZ' && !$('pcard').classList.contains('hidden')) { $('pcard-close').click(); return; }
    dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  },
  onConnect: (name, on) => toast(on ? `🎮 Đã kết nối tay cầm${name ? ': ' + name.replace(/\s*\(.*\)$/, '') : ''}` : '🎮 Tay cầm đã ngắt kết nối'),
});
let prevShake = 0;

let dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0, downT = 0;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  downX = e.clientX; downY = e.clientY; downT = performance.now();
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  state.yaw -= dx * 0.005 * settings.sens;
  state.pitch = THREE.MathUtils.clamp(state.pitch + dy * 0.004 * settings.sens * (settings.invert ? -1 : 1), -0.05, 1.35);
  state.lastDrag = state.time;
});
const endDrag = () => { dragging = false; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', (e) => {
  endDrag();
  const click = Math.hypot(e.clientX - downX, e.clientY - downY) < 6 && performance.now() - downT < 400;
  if (click && state.started && e.button === 0) pickCow(e.clientX, e.clientY);
});
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  state.dist = THREE.MathUtils.clamp(state.dist * (1 + Math.sign(e.deltaY) * 0.1), 3, 28);
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- UI ----------
$('sel-quality').addEventListener('change', (e) => { setSetting('quality', e.target.value); e.target.blur(); });
// weather/time are shared: when online the server decides and tells everyone
$('sel-weather').addEventListener('change', (e) => {
  if (net.connected) net.send({ t: 'env', weather: e.target.value });
  else env.setWeather(e.target.value);
  e.target.blur();
});
$('sel-time').addEventListener('change', (e) => {
  if (net.connected) net.send({ t: 'env', time: e.target.value });
  else env.hour = { morning: 7.9, noon: 12.5, sunset: 18.35, night: 23 }[e.target.value] ?? env.hour;
  e.target.blur();
});
$('sel-season').addEventListener('change', (e) => {
  if (net.connected) net.send({ t: 'env', season: e.target.value });
  else { env.season = e.target.value; env.seasonT = 0.05; }
  e.target.blur();
});
$('btn-sound').addEventListener('click', (e) => { setSetting('sound', !settings.sound); e.target.blur(); });

// ---------- settings (Esc menu), saved per browser ----------
const settings = {
  quality: 'medium', fov: 55, sound: true, volume: 0.8, sens: 1, invert: false, rumble: true,
  minimap: true, status: true, tags: true,
};
try { Object.assign(settings, JSON.parse(localStorage.getItem('cow.settings') || '{}')); } catch {}
if (!QUALITY[settings.quality]) settings.quality = 'medium';

// apply one setting (or all of them with key = null) to the game and the menu controls
function applySettings(key = null) {
  const all = key === null;
  if (all || key === 'quality') {
    if (state.quality !== settings.quality || all) applyQuality(settings.quality);
    $('sel-quality').value = settings.quality;
    $('m-quality').value = settings.quality;
  }
  if (all || key === 'fov') {
    camera.fov = settings.fov; camera.updateProjectionMatrix();
    $('m-fov').value = settings.fov; $('m-fov-v').textContent = `${settings.fov}°`;
  }
  if (all || key === 'sound') {
    audio.setEnabled(settings.sound);
    $('btn-sound').textContent = settings.sound ? 'On' : 'Off';
    $('btn-sound').classList.toggle('off', !settings.sound);
    $('m-sound').checked = settings.sound;
  }
  if (all || key === 'volume') {
    audio.setVolume(settings.volume);
    $('m-volume').value = settings.volume; $('m-volume-v').textContent = `${Math.round(settings.volume * 100)}%`;
  }
  if (all || key === 'sens') { $('m-sens').value = settings.sens; $('m-sens-v').textContent = `${settings.sens.toFixed(1)}×`; }
  if (all || key === 'invert') $('m-invert').checked = settings.invert;
  if (all || key === 'rumble') $('m-rumble').checked = settings.rumble;
  for (const k of ['minimap', 'status', 'tags']) {
    if (all || key === k) { document.body.classList.toggle(`hide-${k}`, !settings[k]); $(`m-${k}`).checked = settings[k]; }
  }
}
function setSetting(key, value) {
  settings[key] = value;
  try { localStorage.setItem('cow.settings', JSON.stringify(settings)); } catch {}
  applySettings(key);
}
$('m-quality').addEventListener('change', (e) => setSetting('quality', e.target.value));
$('m-fov').addEventListener('input', (e) => setSetting('fov', Number(e.target.value)));
$('m-sound').addEventListener('change', (e) => setSetting('sound', e.target.checked));
$('m-volume').addEventListener('input', (e) => setSetting('volume', Number(e.target.value)));
$('m-sens').addEventListener('input', (e) => setSetting('sens', Number(e.target.value)));
$('m-invert').addEventListener('change', (e) => setSetting('invert', e.target.checked));
$('m-rumble').addEventListener('change', (e) => setSetting('rumble', e.target.checked));
for (const k of ['minimap', 'status', 'tags']) $(`m-${k}`).addEventListener('change', (e) => setSetting(k, e.target.checked));

let menuOpen = false;
let menuPane = 'settings';
function showPane(pane) {
  menuPane = pane;
  for (const b of document.querySelectorAll('.menu-tabs button')) b.classList.toggle('sel', b.dataset.pane === pane);
  $('pane-settings').classList.toggle('hidden', pane !== 'settings');
  $('pane-clan').classList.toggle('hidden', pane !== 'clan');
  $('pane-controls').classList.toggle('hidden', pane !== 'controls');
  if (pane === 'clan') clanPanel.refresh();
}
for (const b of document.querySelectorAll('.menu-tabs button')) b.addEventListener('click', () => showPane(b.dataset.pane));
function toggleMenu(open = !menuOpen, pane = null) {
  if (open && pane) showPane(pane);
  else if (open && !menuOpen && menuPane === 'clan') clanPanel.refresh();
  menuOpen = open;
  $('menu').classList.toggle('hidden', !open);
  state.keys.clear(); // don't keep walking with a key that was held when the menu opened
  if (open) {
    // logged in: log out; guest: just go back to the start screen
    $('m-logout').textContent = account.username ? `Đăng xuất (${account.username})` : 'Về màn hình chính';
    $('m-resume').focus();
  }
}
$('m-resume').addEventListener('click', () => toggleMenu(false));
$('m-logout').addEventListener('click', async () => {
  $('m-logout').disabled = true;
  // send the latest state, then disconnect: the server saves the account when the socket closes
  net.update(1, cow, camera, { xp: state.xp, food: state.food, water: state.water, health: state.health });
  await new Promise((r) => setTimeout(r, 150));
  const token = account.token;
  if (token) {
    try { localStorage.removeItem('cow.token'); } catch {}
    await api('/api/logout', { token }).catch(() => {});
  }
  location.reload();
});
$('m-invite').addEventListener('click', () => { toggleMenu(false); openInvite(); });
// clicking the dark backdrop also closes the menu
$('menu').addEventListener('pointerdown', (e) => { if (e.target === $('menu')) toggleMenu(false); });
// ---------- account (log in to keep your cow) ----------
const account = { token: null, username: null };
try { account.token = localStorage.getItem('cow.token'); } catch {}
let accTab = 'login';
let nameTyped = false;
$('inp-name').addEventListener('input', () => { nameTyped = true; });
function accMsg(text, ok = false) { $('acc-msg').textContent = text; $('acc-msg').classList.toggle('ok', ok); }
function showAccount(profile) {
  const logged = !!profile;
  $('acc-form').classList.toggle('hidden', logged);
  $('acc-box').classList.toggle('hidden', !logged);
  if (logged) {
    account.username = profile.username;
    $('acc-name').textContent = profile.username;
    $('acc-level').textContent = `Lv ${profile.level ?? 0}`;
    if (profile.look) customizer.set(profile.look);
    // fill in the saved cow name - unless the player already typed one (slow server replies)
    if (profile.name && !nameTyped) $('inp-name').value = profile.name;
    $('btn-start').textContent = `Tiếp tục chơi (Lv ${profile.level ?? 0})`;
  } else {
    account.username = null;
    $('btn-start').textContent = 'Vào đồng cỏ (khách)';
  }
}
async function api(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Lỗi ${res.status}`);
  return j;
}
for (const b of document.querySelectorAll('.acc-tabs button')) {
  b.addEventListener('click', () => {
    accTab = b.dataset.tab;
    for (const o of document.querySelectorAll('.acc-tabs button')) o.classList.toggle('sel', o === b);
    $('acc-submit').textContent = accTab === 'login' ? 'Đăng nhập' : 'Tạo tài khoản';
    $('acc-pass').autocomplete = accTab === 'login' ? 'current-password' : 'new-password';
    accMsg('');
  });
}
async function submitAccount() {
  const username = $('acc-user').value.trim(), password = $('acc-pass').value;
  if (!username || !password) return accMsg('Nhập tên đăng nhập và mật khẩu.');
  $('acc-submit').disabled = true;
  try {
    const r = await api(accTab === 'login' ? '/api/login' : '/api/register', { username, password });
    account.token = r.token;
    try { localStorage.setItem('cow.token', r.token); } catch {}
    $('acc-pass').value = '';
    showAccount(r);
    accMsg(accTab === 'login' ? 'Đăng nhập thành công!' : 'Tạo tài khoản thành công!', true);
  } catch (e) { accMsg(e.message); }
  $('acc-submit').disabled = false;
}
$('acc-submit').addEventListener('click', submitAccount);
$('acc-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAccount(); });
$('acc-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('acc-pass').focus(); });
$('acc-logout').addEventListener('click', async () => {
  const token = account.token;
  account.token = null;
  try { localStorage.removeItem('cow.token'); } catch {}
  showAccount(null);
  if (token) api('/api/logout', { token }).catch(() => {});
});

// ---------- player card (click a nearby cow) & clan invites ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let cardRemote = null;
function pickCow(x, y) {
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const roots = [...net.remotes.values()].map((r) => r.cow.root);
  const hit = raycaster.intersectObjects(roots, true)[0];
  if (!hit) { closeCard(); return; }
  let o = hit.object;
  while (o && o.userData.remoteId === undefined) o = o.parent;
  const r = o && net.remotes.get(o.userData.remoteId);
  if (!r) return;
  if (r.cow.pos.distanceTo(cow.pos) > CARD_RANGE) { toast(`Lại gần ${r.name} hơn (dưới ${CARD_RANGE} m) để xem thông tin`); return; }
  cardRemote = r;
  $('pc-note').textContent = '';
  $('pcard').classList.remove('hidden');
  updateCard();
}
function closeCard() { cardRemote = null; $('pcard').classList.add('hidden'); }
function updateCard() {
  const r = cardRemote;
  if (!r) return;
  if (!net.remotes.has(r.id)) { closeCard(); return; }
  const d = r.cow.pos.distanceTo(cow.pos);
  if (d > CARD_RANGE * 2) { closeCard(); return; }
  const mate = !!(state.clan && r.clan && r.clan.id === state.clan.id);
  const lv = Math.round(r.target.a * LEVEL_MAX);
  const name = $('pc-name');
  name.replaceChildren();
  if (r.clan) { const t = document.createElement('span'); t.className = 'clan-tag'; t.textContent = `[${r.clan.tag}] `; t.style.color = r.clan.color; name.append(t); }
  name.append(r.name);
  name.style.color = mate ? '' : '#ff8a7a';
  $('pc-rel').textContent = mate ? 'ĐỒNG ĐỘI' : 'ĐỐI THỦ';
  $('pc-rel').className = `pc-rel ${mate ? 'mate' : 'enemy'}`;
  $('pc-level').textContent = `Lv ${lv} · ${stageName(lv)}`;
  $('pc-clan').textContent = r.clan ? `[${r.clan.tag}] ${r.clan.name}` : 'Chưa có';
  $('pc-acct').textContent = r.acct ? 'Có' : 'Khách';
  $('pc-dist').textContent = `${d.toFixed(1)} m`;
  $('pc-hp').style.width = `${Math.round((r.target.hp ?? 1) * 100)}%`;
  // invite button: only makes sense from a clan member, to a logged-in player without a clan
  const btnI = $('pc-invite');
  let why = '';
  if (!account.token) why = 'Đăng nhập để dùng clan.';
  else if (!state.clan) why = 'Bạn chưa có clan (nhấn G để tạo).';
  else if (!r.acct) why = 'Người này chơi khách, không vào clan được.';
  else if (r.clan) why = mate ? 'Đã là đồng đội.' : 'Người này đã có clan khác.';
  btnI.disabled = !!why;
  if (why && !$('pc-note').dataset.sent) $('pc-note').textContent = why;
}
$('pcard-close').addEventListener('click', closeCard);
$('pc-invite').addEventListener('click', () => {
  if (!cardRemote) return;
  net.send({ t: 'clan-invite', to: cardRemote.id });
  $('pc-note').textContent = 'Đã gửi lời mời…';
});

let pendingInvite = null, inviteTimer = 0;
function answerInvite(accept) {
  if (!pendingInvite) return;
  net.send({ t: 'clan-reply', clanId: pendingInvite.clan.id, accept });
  pendingInvite = null;
  clearTimeout(inviteTimer);
  $('cinvite').classList.add('hidden');
}
$('ci-yes').addEventListener('click', () => answerInvite(true));
$('ci-no').addEventListener('click', () => answerInvite(false));

// ---------- clan manager ----------
const clanPanel = new ClanPanel({
  root: $('pane-clan'),
  getToken: () => account.token,
  getUsername: () => account.username,
  toast: (t) => toast(t),
});
function showMyName() {
  const name = net.name || $('inp-name').value || 'Bò Mimi';
  $('txt-name').replaceChildren();
  if (state.clan) {
    const t = document.createElement('span');
    t.className = 'clan-tag';
    t.textContent = `[${state.clan.tag}] `;
    t.style.color = state.clan.color;
    $('txt-name').append(t);
  }
  $('txt-name').append(name);
}

// ---------- start screen ----------
const customizer = new Customizer($('customizer'));
showAccount(null);
if (account.token) {
  fetch('/api/me', { headers: { Authorization: `Bearer ${account.token}` } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r)))
    .then((p) => showAccount(p))
    .catch(() => { account.token = null; try { localStorage.removeItem('cow.token'); } catch {} showAccount(null); });
}
try { if (sessionStorage.getItem('cow.recreate')) { sessionStorage.removeItem('cow.recreate'); accMsg('Bò cũ đã chết - hãy tạo con mới!', true); } } catch {}
try { $('inp-name').value = localStorage.getItem('cow.name') || ''; } catch {}
$('inp-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-start').click(); });
$('btn-start').addEventListener('click', () => {
  if (state.started) return;
  const name = $('inp-name').value.replace(/[<>]/g, '').trim().slice(0, 16) || 'Bò Mimi';
  try { localStorage.setItem('cow.name', name); } catch {}
  customizer.save();
  const look = customizer.look, seed = customizer.seed;
  customizer.dispose();
  // rebuild the local cow with the chosen look
  const old = cow;
  cow = new Cow(scene, { look, seed, age: 0 });
  state.age = 0; state.level = 0; state.xp = 0;
  cow.onStep = onStep;
  cow.onLand = onLand;
  cow.pos.copy(old.pos); cow.heading = old.heading;
  old.dispose();
  window.__game.cow = cow;
  $('txt-name').textContent = name;
  $('inp-name').blur();
  audio.init();
  audio.setEnabled(audio.enabled);
  state.started = true;
  $('start').classList.add('gone');
  net.connect(name, look, account.token);
  if (!account.token) addChat('', 'Bạn đang chơi khách - tiến trình sẽ không được lưu. Đăng nhập ở màn hình đầu để lưu lại.', true);
  setTimeout(() => audio.moo(), 600);
});

// ---------- invite friends (ngrok / LAN links) ----------
function inviteRow(label, url) {
  const row = document.createElement('div');
  row.className = 'invite-row';
  const l = document.createElement('label');
  l.textContent = label;
  const box = document.createElement('div');
  box.className = 'invite-link';
  const input = document.createElement('input');
  input.readOnly = true;
  input.value = url;
  input.addEventListener('focus', () => input.select());
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Copy';
  btn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); }
    catch { input.select(); document.execCommand('copy'); }
    btn.textContent = 'Đã copy!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
  box.append(input, btn);
  row.append(l, box);
  return row;
}
function inviteNote(html) {
  const n = document.createElement('div');
  n.className = 'invite-note';
  n.innerHTML = html; // static strings only
  return n;
}
async function openInvite() {
  const body = $('invite-body');
  body.replaceChildren(inviteNote('Đang lấy link…'));
  $('invite').classList.remove('hidden');
  const isLocal = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
  let info = null;
  try { info = await (await fetch('/api/info', { cache: 'no-store' })).json(); } catch {}
  body.replaceChildren();
  const publicUrl = !isLocal && location.protocol === 'https:' ? location.origin : info?.publicUrl;
  if (publicUrl) {
    body.append(inviteRow('Qua Internet (ngrok)', publicUrl));
    body.append(inviteNote('Bạn bè mở link, nếu thấy trang cảnh báo của ngrok thì bấm <b>Visit Site</b>.'));
  } else {
    body.append(inviteNote('Chưa có link Internet. Chạy <code>start.bat</code> (đã cài ngrok) hoặc <code>ngrok http 5173</code> — link sẽ tự hiện ở đây.'));
  }
  for (const u of info?.lan || []) body.append(inviteRow('Cùng mạng WiFi / LAN', u));
  if (!info) body.append(inviteNote('Không kết nối được server — hãy chạy <code>node server.js</code>.'));
}
$('btn-invite').addEventListener('click', (e) => { e.target.blur(); openInvite(); });
$('invite-close').addEventListener('click', () => $('invite').classList.add('hidden'));

// ---------- chat ----------
const chatInput = $('chat-input');
function openChat() {
  state.keys.clear();
  $('chat').classList.add('open');
  chatInput.focus();
}
function closeChat() {
  $('chat').classList.remove('open');
  chatInput.value = '';
  chatInput.blur();
}
chatInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') return closeChat();
  if (e.key !== 'Enter') return;
  const text = chatInput.value.trim();
  if (text) {
    if (net.connected) net.send({ t: 'chat', text });
    else if (/^\/(ONADMIN|OFFADMIN|ADMIN)\b/i.test(text)) addChat('', 'Lệnh admin cần kết nối tới server.', true);
    else { addChat($('txt-name').textContent, text); selfTag.say(text); }
  }
  closeChat();
});
chatInput.addEventListener('blur', () => $('chat').classList.remove('open'));
function addChat(name, text, system = false, clan = null) {
  const log = $('chat-log');
  const row = document.createElement('div');
  if (system) { row.className = 'sys'; row.textContent = text; }
  else {
    if (clan) {
      // clan-only message
      row.className = 'clan-msg';
      const c = document.createElement('b');
      c.className = 'clan-label';
      c.textContent = `[${clan.tag}]`;
      c.style.color = clan.color;
      row.append(c);
    }
    const b = document.createElement('b');
    b.textContent = name;
    row.append(b, document.createTextNode(text));
  }
  log.appendChild(row);
  while (log.children.length > 30) log.firstChild.remove();
  setTimeout(() => row.classList.add('faded'), 12000);
}

// ---------- networking ----------
function applyEnv(m, instant) {
  const prevSeason = env.season, prevWeather = env.weatherName;
  env.applyServer(m, instant);
  $('sel-weather').value = m.weather;
  if (m.season) $('sel-season').value = m.season;
  if (!instant && m.season && m.season !== prevSeason) {
    const si = SEASON_INFO[m.season];
    toast(`${si.icon} Mùa ${si.name.toLowerCase()} đã đến!`);
  } else if (!instant && m.weather !== prevWeather) {
    toast(`${weatherIcon(m.weather)} Thời tiết: ${weatherLabel(m.weather)}`);
  }
}
const isWinter = () => env.s.snow > 0.5;
const weatherLabel = (w) => (w === 'rain' && isWinter() ? 'Tuyết rơi' : WEATHER_NAMES[w]);
const weatherIcon = (w) => (w === 'rain' ? (isWinter() ? '🌨️' : '🌧️') : w === 'cloudy' ? '☁️' : w === 'fog' ? '🌫️' : env.dayness > 0.5 ? '☀️' : '🌙');
const net = new Net(scene, $('tags'), {
  onStatus(s) {
    $('net-dot').className = 'dot ' + s;
    $('net-text').textContent = s === 'online' ? 'Online' : s === 'connecting' ? 'Đang kết nối…' : 'Offline';
  },
  onWelcome(m) {
    state.clan = m.clan || null;
    net.myClanId = state.clan ? state.clan.id : null;
    showMyName();
    if (m.profile) {
      setXp(m.profile.xp, true);
      state.food = m.profile.food; state.water = m.profile.water; state.health = m.profile.health;
      addChat('', `Chào mừng trở lại, ${m.profile.username}! Đã tải bò của bạn (Lv ${state.level}).`, true);
    }
    cow.pos.set(m.x, heightAt(m.x, m.z), m.z);
    cow.heading = m.h;
    state.yaw = state.camYaw = m.h + Math.PI;
    applyEnv(m.env, true);
    addChat('', m.players.length
      ? `Đã vào đồng cỏ cùng ${m.players.length} người khác. Nhấn Enter để chat!`
      : 'Đã vào đồng cỏ. Gửi địa chỉ server cho bạn bè để chơi chung!', true);
  },
  onSystem(text) { addChat('', text, true); },
  onClanInvite(m) {
    if (state.clan) return; // already in a clan
    pendingInvite = m;
    $('ci-text').replaceChildren();
    const t = document.createElement('b'); t.textContent = `[${m.clan.tag}] ${m.clan.name}`; t.style.color = m.clan.color;
    $('ci-text').append(`🛡️ ${m.from} mời bạn vào clan `, t);
    $('cinvite').classList.remove('hidden');
    audio.chime();
    clearTimeout(inviteTimer);
    inviteTimer = setTimeout(() => answerInvite(false), 60000); // ignored invites expire after a minute
  },
  onMyClan(clan) {
    net.myClanId = clan ? clan.id : null;
    const before = state.clan;
    state.clan = clan;
    showMyName();
    if (clan && (!before || before.id !== clan.id)) { addChat('', `🛡️ Bạn đã vào clan [${clan.tag}] ${clan.name}. Chat riêng clan: /c <tin nhắn>`, true); toast(`🛡️ Đã vào clan [${clan.tag}]`); }
    if (!clan && before) addChat('', `Bạn đã rời clan [${before.tag}].`, true);
  },
  onClanUpdate() { if (menuOpen && menuPane === 'clan') clanPanel.refresh(); },
  onKicked(text) { addChat('', text || 'Bạn đã bị ngắt kết nối.', true); toast(text || 'Bạn đã bị ngắt kết nối.'); },
  // admin banner: a = { text, by } to show, null to hide; initial = state sent on join
  onAnnounce(a, initial) {
    const box = $('announce');
    const wasShown = !box.classList.contains('hidden');
    if (!a) {
      box.classList.add('hidden');
      if (wasShown && !initial) addChat('', 'Thông báo đã được tắt.', true);
      return;
    }
    $('announce-text').textContent = a.text;
    $('announce-by').textContent = a.by ? `— ${a.by}` : '';
    // restart the pop-in animation for a new message
    box.classList.add('hidden'); void box.offsetWidth; box.classList.remove('hidden');
    audio.chime();
    if (!initial) addChat('', `📢 Thông báo: ${a.text}`, true);
  },
  onChat(name, text, remote, isSelf, m = {}) {
    if (m.sys) { addChat('', text, true); return; }
    addChat(name, text, false, m.clan ? { tag: m.clan, color: m.color } : null);
    if (isSelf) selfTag.say(text);
    else if (remote) remote.tag.say(text);
  },
  onRemoteMoo(r) {
    r.tag.say('Mooo~', 2);
    const { vol, pan } = spatial(r.cow.pos);
    audio.moo(vol, pan, 0.9 + (r.id % 5) * 0.06);
  },
  onRemoteAct(r, a) {
    if (a === 'croc') { crocs.attackAt(r.cow.pos); const sp = spatial(r.cow.pos, 60); if (sp.vol > 0) audio.snap(); return; }
    if (a === 'die') { r.cow.dead = true; r.cow.lying = false; r.tag.say('💀', 3); return; }
    if (a === 'respawn') { r.cow.dead = false; r.cow.setAge(0); r.target.a = 0; return; }
    const { vol } = spatial(r.cow.pos, 50);
    if (a === 'jump') {
      r.cow.onLand ??= (v) => audio.land(v, spatial(r.cow.pos, 50).vol);
      if (r.cow.jump()) audio.jump(vol);
    } else if (a === 'butt') {
      if (r.cow.startButt()) audio.whoosh(vol);
    }
  },
  onHit(r, dx, dz, power, dmg = 0, hp) {
    if (state.dead) return;
    // we got headbutted: fly back, hop, get dizzy for a moment - and lose health
    cow.knockback(dx, dz, power);
    if (dmg > 0) {
      state.health = Math.max(0, Math.min(state.health - dmg, typeof hp === 'number' ? hp : 1));
      if (state.health <= 0) { state.lastHitBy = r ? r.name : 'ai đó'; killCow('butt'); return; }
    }
    audio.bonk(1);
    selfTag.say('Úi! 💥', 1.5);
    state.shake = 0.45;
    state.happy = Math.max(0, state.happy - 0.02);
    toast(`${r ? r.name : 'Ai đó'} húc bạn! 💥`);
  },
  onRemoteHit(attacker, target) {
    target.cow.vy = Math.max(target.cow.vy, 4.2);
    target.cow._hurt = 0.5;
    target.tag.say('Úi! 💥', 1.5);
    const { vol, pan } = spatial(target.cow.pos, 50);
    audio.bonk(vol, pan);
  },
  onEnv(m) {
    applyEnv(m, false);
    if (m.by) toast(`${m.by} đã chỉnh thời tiết / thời gian`);
  },
});
let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- simulation ----------
const tmpV = new THREE.Vector3();
const windDir = new THREE.Vector2(0.85, 0.52).normalize();

function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// volume + stereo pan for a sound coming from a world position
function spatial(pos, range = 80) {
  const d = pos.distanceTo(camera.position);
  const right = tmpV2.setFromMatrixColumn(camera.matrixWorld, 0);
  const dir = tmpV3.subVectors(pos, camera.position).normalize();
  return { vol: Math.max(0, 1 - d / range), pan: right.dot(dir) };
}
const tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3();

function toggleLie() {
  if (!cow.lying) {
    if (!cow.grounded || cow.stun > 0 || cow.butting) return;
    cow.lying = true;
    cow.grazeTimer = 0;
    audio.land(2.5, 0.6);
    selfTag.say('💤', 2);
  } else {
    cow.lying = false;
    audio.jump(0.5);
  }
}

function tryButt() {
  if (state.buttCooldown > 0 || cow.stun > 0 || !cow.startButt()) return;
  state.buttCooldown = 0.9;
  state.buttChecked = false;
  audio.whoosh();
  net.send({ t: 'act', a: 'butt' });
}

// at the moment the head connects: did we hit another cow (or a rock)?
function checkButtHit() {
  state.buttChecked = true;
  const fx = Math.sin(cow.heading), fz = Math.cos(cow.heading);
  let best = null, bestD = Infinity;
  for (const r of net.remotes.values()) {
    const dx = r.cow.pos.x - cow.pos.x, dz = r.cow.pos.z - cow.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 1.4 * (cow.size + r.cow.size) || d < 0.01) continue;
    if ((dx * fx + dz * fz) / d < 0.45) continue; // must be in front of us
    if (state.clan && r.clan && r.clan.id === state.clan.id) continue; // teammate
    if (Math.abs(r.cow.air - cow.air) > 1.2) continue;
    if (d < bestD) { best = r; bestD = d; }
  }
  if (best) {
    net.send({ t: 'hit', to: best.id });
    // instant feedback; the real knockback arrives with the target's next position updates
    best.cow.vy = Math.max(best.cow.vy, 4.2);
    best.cow._hurt = 0.5;
    best.tag.say('Úi! 💥', 1.5);
    audio.bonk(1);
    state.shake = 0.3;
    cow.speed *= 0.3;
    state.happy = Math.min(1, state.happy + 0.02);
    return;
  }
  // headbutting a rock or tree just bounces us back
  for (const c of world.colliders) {
    const dx = c.x - cow.pos.x, dz = c.z - cow.pos.z;
    const d = Math.hypot(dx, dz);
    if (d - c.r > 1.9 || d < 0.01 || (dx * fx + dz * fz) / d < 0.5) continue;
    audio.bonk(0.8);
    state.shake = 0.35;
    cow.knockback(-fx, -fz, 0.45);
    selfTag.say('Ui da…', 1.2);
    return;
  }
}

function setXp(xp, quiet = false) {
  state.xp = Math.min(XP_MAX, Math.max(0, xp));
  const { level } = levelInfo(state.xp);
  if (level === state.level) return;
  const up = level > state.level;
  state.level = level;
  if (quiet) { state.age = level / LEVEL_MAX; cow.setAge(state.age); return; }
  if (up) { toast(`⬆️ Lên cấp ${level}! ${level === 10 || level === 20 ? `Giờ đã là ${stageName(level)} 🎉` : ''}`); audio.chime(); }
  else toast(`⬇️ Tụt xuống cấp ${level}… Hãy ăn uống đầy đủ!`);
}

const DEATH_TEXT = {
  croc: ['🐊', 'Bị cá sấu đớp khi đang ở mép hồ. Đừng uống nước hay đứng sát bờ quá lâu!'],
  starve: ['🌾', 'Chết đói. Nhớ giữ E để gặm cỏ thường xuyên.'],
  thirst: ['💧', 'Chết khát. Tìm hồ nước và giữ E ở mép nước để uống.'],
  both: ['💀', 'Vừa đói vừa khát. Hãy ăn cỏ và uống nước đều đặn.'],
};
function killCow(reason) {
  if (state.dead) return;
  state.dead = true;
  cow.dead = true; cow.lying = false; cow.speed = 0; cow.grazeTimer = 0;
  state.keys.clear();
  net.send({ t: 'act', a: 'die' });
  selfTag.say('💀', 3);
  audio.death();
  const [icon, text] = reason === 'butt'
    ? ['💥', state.clan ? `Bị ${state.lastHitBy} húc gục! Người khác clan húc sẽ mất máu - hãy đi cùng đồng đội.` : `Bị ${state.lastHitBy} húc gục! Vào clan (phím G) để có đồng đội - người cùng clan không húc mất máu nhau.`]
    : DEATH_TEXT[reason] || DEATH_TEXT.both;
  const m = state.distance;
  $('death-icon').textContent = icon;
  $('death-reason').textContent = text;
  $('death-stats').textContent = `Đạt tới: Lv ${state.level} · ${stageName(state.level)} · Quãng đường: ${m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(2) + ' km'}`;
  setTimeout(() => { $('death').classList.remove('hidden'); state.deathShown = true; $('btn-respawn').focus(); }, 1800);
}
function respawn() {
  if (!state.dead) return;
  $('death').classList.add('hidden');
  state.dead = false; state.deathShown = false;
  cow.dead = false; cow.deadK = 0; cow.lie = 0; cow.knock.set(0, 0); cow.vy = 0; cow.air = 0;
  // brand new calf at the spawn meadow
  state.level = -1; setXp(0, true);
  state.food = 0.5; state.water = 0.7; state.health = 1; state.happy = 0.6; state.distance = 0;
  state.starvingWarned = false; state.thirstWarned = false;
  const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 6;
  cow.pos.set(Math.cos(a) * r, 0, Math.sin(a) * r);
  cow.heading = Math.random() * Math.PI * 2;
  state.yaw = state.camYaw = cow.heading + Math.PI;
  net.send({ t: 'act', a: 'respawn' });
  toast('Một chú bê con mới chào đời 🐮');
}
$('btn-respawn').addEventListener('click', () => respawn());
// back to the character creator (the dead cow's account was already reset by the server)
$('btn-recreate').addEventListener('click', () => { try { sessionStorage.setItem('cow.recreate', '1'); } catch {} location.reload(); });

function updateCow(dt) {
  const k = state.keys;
  const ageTarget = state.level / LEVEL_MAX;
  if (Math.abs(ageTarget - state.age) > 1e-4) { state.age += (ageTarget - state.age) * Math.min(1, dt * 2.5); cow.setAge(state.age); }
  let f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  let r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  // left stick: analog walking (a light push walks slowly)
  let stickScale = 1;
  if (pad.move.m > 0 && !menuOpen) { f = -pad.move.y; r = pad.move.x; stickScale = 0.35 + 0.65 * pad.move.m; }
  const running = k.has('ShiftLeft') || k.has('ShiftRight');
  let targetSpeed = 0;
  if (state.started && cow.lying && (f || r)) toggleLie();
  const canControl = state.started && !state.dead && cow.stun <= 0 && cow.lie < 0.25 && !cow.lying;
  if (canControl && (f || r)) {
    // camera-relative movement. S = walk backwards: keep facing away from the camera
    // and step back (instead of turning round); S+A/D backs away diagonally.
    const back = f < 0;
    const ff = back ? 1 : f, rr = back ? -r : r;
    const fx = -Math.sin(state.camYaw), fz = -Math.cos(state.camYaw);
    const rx = Math.cos(state.camYaw), rz = -Math.sin(state.camYaw);
    const dx = fx * ff + rx * rr, dz = fz * ff + rz * rr;
    const want = Math.atan2(dx, dz);
    const diff = angleDiff(cow.heading, want);
    const turnRate = running ? 2.6 : 2.0;
    cow.heading += THREE.MathUtils.clamp(diff, -turnRate * dt, turnRate * dt);
    const pace = back ? (running ? 2.2 : 1.1) : (running ? 5.2 : 1.9);
    targetSpeed = (back ? -1 : 1) * pace * Math.max(0.25, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)));
    if (cow.isGrazing) cow.grazeTimer = 0;
  }
  targetSpeed *= stickScale;
  // fatigue: a hungry cow runs slower
  targetSpeed *= 0.75 + 0.25 * Math.min(1, state.food * 2);
  // keep momentum in the air, react faster on the ground
  const accel = cow.grounded ? (targetSpeed > cow.speed ? 2.5 : 4) : 0.6;
  cow.speed += (targetSpeed - cow.speed) * Math.min(1, dt * accel);

  const vx = Math.sin(cow.heading) * cow.speed, vz = Math.cos(cow.heading) * cow.speed;
  const prevX = cow.pos.x, prevZ = cow.pos.z;
  cow.pos.x += vx * dt; cow.pos.z += vz * dt;

  // jump arc + knockback slide
  cow.updatePhysics(dt);
  // headbutt: short lunge forward, then the hit test when the head connects
  state.buttCooldown = Math.max(0, state.buttCooldown - dt);
  const bp = cow.buttProgress;
  if (bp > 0.3 && bp < 0.55) {
    cow.pos.x += Math.sin(cow.heading) * 5 * dt;
    cow.pos.z += Math.cos(cow.heading) * 5 * dt;
  }
  if (!state.buttChecked && bp >= BUTT_HIT_AT) checkButtHit();
  // collisions
  for (const c of world.colliders) {
    const dx = cow.pos.x - c.x, dz = cow.pos.z - c.z;
    const rr = c.r + 0.75;
    const d2 = dx * dx + dz * dz;
    if (d2 < rr * rr && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      cow.pos.x = c.x + dx / d * rr;
      cow.pos.z = c.z + dz / d * rr;
    }
  }
  // don't walk through other players' cows
  for (const r of net.remotes.values()) {
    const dx = cow.pos.x - r.cow.pos.x, dz = cow.pos.z - r.cow.pos.z;
    const d2 = dx * dx + dz * dz, rr = 0.75 * (cow.size + r.cow.size);
    if (d2 < rr * rr && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      cow.pos.x = r.cow.pos.x + dx / d * rr;
      cow.pos.z = r.cow.pos.z + dz / d * rr;
    }
  }
  // cows can wade in the shallows but not walk into deep water
  const wet = waterAt(cow.pos.x, cow.pos.z);
  if (wet && wet.depth > 0.65 * cow.size) {
    const before = waterAt(prevX, prevZ);
    // only block steps that go deeper, so a cow knocked in can still walk back out
    if (!before || wet.depth > before.depth) { cow.pos.x = prevX; cow.pos.z = prevZ; cow.speed *= 0.5; cow.knock.set(0, 0); }
  }
  state.distance += Math.abs(cow.speed) * dt;

  // align to ground
  const hx = Math.sin(cow.heading), hz = Math.cos(cow.heading);
  const hF = heightAt(cow.pos.x + hx * 0.9, cow.pos.z + hz * 0.9);
  const hB = heightAt(cow.pos.x - hx * 0.9, cow.pos.z - hz * 0.9);
  cow.pos.y = (hF + hB) * 0.5;
  const pitch = Math.atan2(hF - hB, 1.8);
  cow.root.position.copy(cow.pos);
  cow.root.position.y += cow.air;
  cow.root.rotation.y = cow.heading;
  cow.root.rotation.x += (-pitch - cow.root.rotation.x) * Math.min(1, dt * 6);
  cow.animate(dt, running);

  // needs: hold E to eat grass - or to drink when the muzzle is over water
  const reach = 1.5 * cow.size;
  const wHead = waterAt(cow.pos.x + hx * reach, cow.pos.z + hz * reach);
  const wHere = waterAt(cow.pos.x, cow.pos.z);
  state.canDrink = !!((wHead && wHead.depth > 0.03) || (wHere && wHere.depth > 0.05));
  if (canControl && k.has('KeyE') && Math.abs(cow.speed) < 0.6) cow.grazeTimer = Math.max(cow.grazeTimer, 0.3);
  state.drinking = state.canDrink && cow.graze > 0.8;
  if (state.drinking) {
    state.water = Math.min(1, state.water + dt * 0.15);
    setXp(state.xp + XP_DRINK * dt);
    state.slurpTimer -= dt;
    if (state.slurpTimer < 0) { state.slurpTimer = 0.38 + Math.random() * 0.12; audio.slurp(); }
  } else if (cow.graze > 0.8 && !wHere) {
    state.food = Math.min(1, state.food + dt * 0.06);
    // eating grass earns XP - but only if the cow isn't parched
    if (state.food > 0.25 && state.water > 0.15) setXp(state.xp + XP_GRAZE * dt);
    state.chewTimer -= dt;
    if (state.chewTimer < 0) { state.chewTimer = 0.32 + Math.random() * 0.1; audio.chew(); }
  }
  if (state.dead) { state.drinking = false; return; }
  // on the shore? (any water within a couple of metres) - crocodiles notice loiterers
  state.shoreTimer -= dt;
  if (state.shoreTimer < 0) {
    state.shoreTimer = 0.2;
    let near = !!wHere;
    for (let i = 0; i < 8 && !near; i++) {
      const a = (i / 8) * Math.PI * 2, r = 2.5 * Math.max(0.7, cow.size);
      if (waterAt(cow.pos.x + Math.cos(a) * r, cow.pos.z + Math.sin(a) * r)) near = true;
    }
    state.nearShore = near;
  }
  const rest = cow.isDown ? 0.4 : 1; // resting cows get hungry / thirsty more slowly
  // full -> empty: food ~13 min standing (~5 min running), water ~10 min (~4 min running)
  const effort = Math.abs(cow.speed);
  state.food = Math.max(0, state.food - dt * (0.0013 + effort * 0.0005) * rest * env.s.hunger);
  state.water = Math.max(0, state.water - dt * (0.0016 + effort * 0.0006) * rest);
  // thirsty: shrink too
  if (state.started && state.water <= 0.02) {
    setXp(state.xp - XP_HUNGER * dt);
    if (!state.thirstWarned) { state.thirstWarned = true; toast('Bò khát quá! Tìm hồ nước rồi giữ E để uống 💧'); }
  } else if (state.water > 0.2) state.thirstWarned = false;
  // starving: the cow slowly gets thinner / smaller
  if (state.started && state.food <= 0.02) {
    setXp(state.xp - XP_HUNGER * dt);
    if (!state.starvingWarned) { state.starvingWarned = true; toast('Bò đói quá, đang gầy đi… Giữ E để gặm cỏ!'); }
  } else if (state.food > 0.2) state.starvingWarned = false;
  // health: hunger and thirst each drain it; well fed & watered it recovers
  if (state.started) {
    const starving = state.food <= 0.02, parched = state.water <= 0.02;
    if (starving || parched) state.health -= HEALTH_DRAIN * ((starving ? 1 : 0) + (parched ? 1 : 0)) * dt;
    else if (state.food > 0.3 && state.water > 0.3) state.health = Math.min(1, state.health + HEALTH_REGEN * dt);
    if (state.health <= 0) { state.health = 0; killCow(starving && parched ? 'both' : starving ? 'starve' : 'thirst'); }
  }
  const targetHappy = 0.2 + state.food * 0.35 + state.water * 0.3 + (Math.abs(cow.speed) > 0.5 ? 0.15 : cow.isDown ? 0.18 : 0.05) - env.weather.rain * 0.05;
  state.happy += (targetHappy - state.happy) * dt * 0.05;
}

function updateCamera(dt) {
  // right stick: orbit the camera; D-pad up/down: zoom; R3: snap behind the cow
  if (!menuOpen && (pad.look.x || pad.look.y)) {
    state.yaw -= pad.look.x * dt * 2.6 * settings.sens;
    state.pitch = THREE.MathUtils.clamp(state.pitch + pad.look.y * dt * 1.6 * settings.sens * (settings.invert ? -1 : 1), -0.05, 1.35);
    state.lastDrag = state.time;
  }
  if (pad.zoom && !menuOpen) state.dist = THREE.MathUtils.clamp(state.dist * (1 + pad.zoom * dt * 1.5), 3, 28);
  if (pad.recenter) state.yaw = cow.heading + Math.PI;
  if (state.cinematic) {
    state.yaw += dt * 0.12;
    state.pitch += (0.18 - state.pitch) * dt * 0.5;
  } else if (cow.speed > 0.4 && state.time - state.lastDrag > 1.8) { // not while backing up (keeps S+A/D steady)
    // drift behind the cow while walking
    const behind = cow.heading + Math.PI;
    state.yaw += angleDiff(state.yaw, behind) * Math.min(1, dt * 0.6);
  }
  const s = Math.min(1, dt * 8);
  state.camYaw += angleDiff(state.camYaw, state.yaw) * s;
  state.camPitch += (state.pitch - state.camPitch) * s;
  const targetDist = state.cinematic ? 10 : state.dist;
  state.camDist += (targetDist - state.camDist) * Math.min(1, dt * 5);

  const target = tmpV.set(cow.pos.x, cow.pos.y + (1.2 - 0.45 * cow.lie) * cow.size + cow.air * 0.6, cow.pos.z);
  // camera shake after bumps and landings
  state.shake = Math.max(0, state.shake - dt * 1.5);
  const sh = state.shake * state.shake;
  target.x += (Math.random() - 0.5) * sh;
  target.y += (Math.random() - 0.5) * sh;
  const cp = Math.cos(state.camPitch), d = state.camDist;
  camera.position.set(
    target.x + Math.sin(state.camYaw) * cp * d,
    target.y + Math.sin(state.camPitch) * d,
    target.z + Math.cos(state.camYaw) * cp * d,
  );
  const ground = heightAt(camera.position.x, camera.position.z) + 0.9;
  if (camera.position.y < ground) camera.position.y = ground;
  camera.lookAt(target);
}

function updateEnvironment(dt) {
  env.update(dt);
  const w = env.weather;
  const S = env.s;
  const snowK = S.snowing;              // rain that falls as snow
  const rainK = Math.max(0, w.rain - snowK);
  env.rainSound = rainK;                 // snow is silent
  // lightning in heavy rain (never during snowfall)
  if (rainK > 0.8) {
    state.lightningTimer -= dt;
    if (state.lightningTimer < 0) {
      state.lightningTimer = 12 + Math.random() * 25;
      env.flash = 1;
      audio.thunder(0.6 + Math.random() * 2);
    }
  }
  scene.fog.color.copy(env.fogColor);
  scene.fog.density = w.fog;
  renderer.setClearColor(env.fogColor);

  sun.color.copy(env.sunColor);
  sun.intensity = env.sunI;
  hemi.color.copy(env.ambient);
  hemi.groundColor.copy(env.ground);
  hemi.intensity = env.ambI;
  sun.position.copy(cow.pos).addScaledVector(env.lightDir, 80);
  sun.target.position.copy(cow.pos);

  const u = sky.uniforms;
  u.uTop.value.copy(env.top);
  u.uHorizon.value.copy(env.horizon);
  u.uSunColor.value.copy(env.sunColor).multiplyScalar(Math.max(0.3, env.sunI / 2));
  u.uCloudColor.value.copy(env.cloudColor);
  u.uSunDir.value.copy(env.sunDir);
  u.uMoonDir.value.copy(env.moonDir);
  u.uCloud.value = w.cloud;
  u.uStars.value = env.stars;
  u.uSunVis.value = env.sunVis;
  u.uTime.value = state.time;
  u.uFlash.value = env.flash * 0.6;
  sky.mesh.position.copy(camera.position);

  const g = grass.uniforms;
  g.uTime.value = state.time;
  g.uCenter.value.set(cow.pos.x, cow.pos.z);
  g.uWind.value = w.wind;
  g.uWindDir.value.copy(windDir);
  // every nearby cow pushes grass aside and casts a blob shadow (offset along the light)
  const ld = env.lightDir;
  const sox = -ld.x / Math.max(ld.y, 0.35) * 0.9, soz = -ld.z / Math.max(ld.y, 0.35) * 0.9;
  const nearCows = [cow];
  for (const r of net.remotes.values()) nearCows.push(r.cow);
  if (nearCows.length > MAX_COWS) {
    nearCows.sort((a, b) => a.pos.distanceToSquared(cow.pos) - b.pos.distanceToSquared(cow.pos));
  }
  g.uCowCount.value = Math.min(nearCows.length, MAX_COWS);
  for (let i = 0; i < MAX_COWS; i++) {
    const c = nearCows[i];
    if (c) g.uCows.value[i].set(c.pos.x, c.pos.z, c.pos.x + sox, c.pos.z + soz);
    else g.uCows.value[i].set(1e5, 1e5, 1e5, 1e5);
  }
  g.uShadowStr.value = 0.55 * Math.min(1, env.sunI / 1.2);
  g.uSunDir.value.copy(ld);
  g.uSunColor.value.copy(env.sunColor).multiplyScalar(env.sunI * 0.55);
  g.uAmbient.value.copy(env.ambient).multiplyScalar(env.ambI * 0.75);
  g.uWet.value = rainK;
  g.uSeasonTint.value.set(...S.grass);
  g.uSnow.value = S.snow;
  g.uFlowerAmt.value = S.flowers;
  terrain.seasonUniforms.uSnow.value = S.snow;
  terrain.seasonUniforms.uTint.value.set(...S.grass).lerp(new THREE.Vector3(1, 1, 1), 0.5);
  world.materials.foliage.color.setRGB(...S.foliage);

  state.obstacleTimer -= dt;
  if (state.obstacleTimer < 0) {
    state.obstacleTimer = 0.3;
    const patchR = grass.uniforms.uPatch.value * 0.5;
    g.uObstacleCount.value = world.nearest(cow.pos.x, cow.pos.z, g.uObstacles.value, patchR + 4);
    g.uPondCount.value = fillPondUniforms(cow.pos.x, cow.pos.z, g.uPonds.value, g.uPondLevel.value, patchR + 4);
  }

  rain.update(dt, rainK, w.wind, windDir);
  snow.update(dt, snowK, w.wind, windDir);

  // leaves / petals: how many depends on the season
  leaves.count = Math.min(LEAVES, Math.round(90 * S.leaves));
  for (let i = 0; i < leaves.count; i++) {
    const l = leafData[i];
    if (!l.init) { resetLeaf(l, cow.pos, true); l.init = true; }
    l.s += dt;
    l.p.x += (windDir.x * w.wind * 1.4 + Math.sin(l.s * 1.3) * 0.3) * dt;
    l.p.z += (windDir.y * w.wind * 1.4 + Math.cos(l.s * 1.1) * 0.3) * dt;
    l.p.y -= l.v * dt * (0.5 + 0.5 * Math.sin(l.s * 2.0) ** 2);
    const gh = heightAt(l.p.x, l.p.z);
    if (l.p.y < gh + 0.05) l.p.y = gh + 0.05, l.rest = (l.rest || 0) + dt;
    const dx = l.p.x - cow.pos.x, dz = l.p.z - cow.pos.z;
    if ((l.rest || 0) > 6 || dx * dx + dz * dz > 34 * 34) { resetLeaf(l, cow.pos, false); l.rest = 0; }
    l.r.set(l.s * 2.1, l.s * 1.3, l.s * 1.7);
    _q.setFromEuler(l.r);
    _m.compose(l.p, _q, _one);
    leaves.setMatrixAt(i, _m);
  }
  leaves.instanceMatrix.needsUpdate = true;
  leafMat.color.copy(S.leafColor).multiplyScalar(0.6 + 0.4 * env.dayness);

  world.setFrame(state.time, w.wind);
  water.setFrame(state.time, env, rainK, S.ice);
}

// ---------- season wheel (top right) ----------
const wheel = $('season-wheel'), wctx = wheel.getContext('2d');
function drawSeasonWheel() {
  const W = 110, R = W / 2, ring = R - 6; // drawn in CSS pixels, canvas is 2x for sharpness
  const idx = SEASON_ORDER.indexOf(env.season);
  const year = (idx + env.seasonT) / 4; // 0..1 position in the year
  wctx.setTransform(wheel.width / W, 0, 0, wheel.width / W, 0, 0);
  wctx.clearRect(0, 0, W, W);
  // four season arcs (spring starts at the top, clockwise)
  for (let i = 0; i < 4; i++) {
    const a0 = -Math.PI / 2 + (i / 4) * Math.PI * 2, a1 = a0 + Math.PI / 2;
    wctx.beginPath();
    wctx.arc(R, R, ring, a0 + 0.04, a1 - 0.04);
    wctx.strokeStyle = SEASON_INFO[SEASON_ORDER[i]].color;
    wctx.globalAlpha = i === idx ? 1 : 0.38;
    wctx.lineWidth = i === idx ? 9 : 7;
    wctx.lineCap = 'round';
    wctx.stroke();
    // icon in the middle of each arc
    const am = (a0 + a1) / 2;
    wctx.globalAlpha = i === idx ? 1 : 0.55;
    wctx.font = `${i === idx ? 15 : 12}px "Segoe UI Emoji", sans-serif`;
    wctx.textAlign = 'center'; wctx.textBaseline = 'middle';
    wctx.fillText(SEASON_INFO[SEASON_ORDER[i]].icon, R + Math.cos(am) * (ring - 17), R + Math.sin(am) * (ring - 17));
  }
  wctx.globalAlpha = 1;
  // marker: where we are in the year
  const am = -Math.PI / 2 + year * Math.PI * 2;
  wctx.beginPath();
  wctx.arc(R + Math.cos(am) * ring, R + Math.sin(am) * ring, 6, 0, Math.PI * 2);
  wctx.fillStyle = '#fff'; wctx.fill();
  wctx.lineWidth = 2; wctx.strokeStyle = 'rgba(0,0,0,.5)'; wctx.stroke();
  // centre: day / night dial (sun or moon moving round with the hour)
  const inner = ring - 30;
  const g2 = wctx.createRadialGradient(R, R, 2, R, R, inner);
  const day = env.dayness;
  g2.addColorStop(0, day > 0.5 ? 'rgba(120,170,230,.55)' : 'rgba(30,40,80,.65)');
  g2.addColorStop(1, 'rgba(0,0,0,.25)');
  wctx.beginPath(); wctx.arc(R, R, inner, 0, Math.PI * 2); wctx.fillStyle = g2; wctx.fill();
  const ha = (env.hour / 24) * Math.PI * 2 + Math.PI / 2; // midnight at the bottom, noon at the top
  wctx.font = '13px "Segoe UI Emoji", sans-serif';
  wctx.fillText(day > 0.5 ? '☀️' : '🌙', R + Math.cos(ha) * (inner - 9), R + Math.sin(ha) * (inner - 9));
  wctx.fillStyle = '#fff';
  wctx.font = '600 11px "Segoe UI", sans-serif';
  const hh = Math.floor(env.hour), mm = Math.floor((env.hour % 1) * 60);
  wctx.fillText(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, R, R + 1);
  $('season-text').textContent = `${SEASON_INFO[env.season].icon} ${SEASON_INFO[env.season].name} · Ngày ${env.day}/2 · ${weatherIcon(env.weatherName)} ${weatherLabel(env.weatherName)}`;
}

// ---------- HUD ----------
let hudTimer = 0, fpsFrames = 0, fpsTime = 0, fps = 0;
function updateHud(dt) {
  if (hudTimer <= dt) drawSeasonWheel();
  if (cardRemote && hudTimer <= dt) updateCard();
  fpsFrames++; fpsTime += dt;
  if (fpsTime > 0.5) { fps = Math.round(fpsFrames / fpsTime); fpsFrames = 0; fpsTime = 0; }
  hudTimer -= dt;
  if (hudTimer > 0) return;
  hudTimer = 0.2;
  $('bar-happy').style.width = `${Math.round(state.happy * 100)}%`;
  $('bar-food').style.width = `${Math.round(state.food * 100)}%`;
  const li = levelInfo(state.xp);
  $('bar-grow').style.width = `${Math.round(li.frac * 100)}%`;
  $('bar-grow').parentElement.title = state.level >= LEVEL_MAX ? 'Cấp tối đa' : `${Math.floor(li.into)} / ${li.need} XP`;
  $('bar-water').style.width = `${Math.round(state.water * 100)}%`;
  $('bar-health').style.width = `${Math.round(state.health * 100)}%`;
  const low = state.started && !state.dead && state.health < 0.35;
  $('hurt').style.opacity = low ? String(0.35 + (0.35 - state.health) * 1.8) : '0';
  $('hurt').classList.toggle('pulse', low);
  const danger = state.crocStalking && !state.dead;
  $('prompt').classList.toggle('danger', danger);
  const prompt = state.dead ? '' : danger ? '⚠️ Coi chừng cá sấu! Tránh xa bờ hồ ngay!'
    : cow.lying ? 'Đang nằm nghỉ… 💤  (Z để đứng dậy)'
    : state.drinking ? 'Đang uống nước… 💧' : state.canDrink && state.water < 0.97 ? 'Giữ E để uống nước 💧' : '';
  $('prompt').textContent = prompt;
  $('prompt').classList.toggle('show', !!prompt && state.started);
  $('txt-stage').textContent = `Lv ${state.level} · ${stageName(state.level)}`;
  const m = state.distance;
  $('txt-online').textContent = `${net.online} người`;
  $('txt-dist').textContent = m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
  if (state.debug) {
    const info = renderer.info;
    const hh = Math.floor(env.hour), mm = Math.floor((env.hour % 1) * 60);
    $('debug').textContent =
      `FPS        ${fps}\n` +
      `Draw calls ${info.render.calls}\n` +
      `Triangles  ${(info.render.triangles / 1e6).toFixed(2)} M\n` +
      `Blades     ${grass.bladeCount.toLocaleString()}\n` +
      `Position   ${cow.pos.x.toFixed(1)}, ${cow.pos.y.toFixed(1)}, ${cow.pos.z.toFixed(1)}\n` +
      `Speed      ${cow.speed.toFixed(2)} m/s\n` +
      `Clock      ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}\n` +
      `Chunks     ${world.chunks.size}  colliders ${world.colliders.length}\n` +
      `Net        ${net.connected ? 'id ' + net.id : 'offline'}  players ${net.online}`;
  }
}

// ---------- minimap ----------
const mm = $('minimap'), mctx = mm.getContext('2d');
const MM_RANGE = 120; // metres from centre to edge
function drawMinimap() {
  if (state.cinematic) return;
  const W = mm.width, R = W / 2, sc = (R - 8) / MM_RANGE;
  const sy = Math.sin(state.camYaw), cy = Math.cos(state.camYaw);
  // world offset -> minimap pixels, rotated so the camera's forward points up
  const toScreen = (dx, dz) => [R + (dx * cy - dz * sy) * sc, R + (dx * sy + dz * cy) * sc];
  mctx.clearRect(0, 0, W, W);
  mctx.save();
  mctx.beginPath(); mctx.arc(R, R, R - 1, 0, Math.PI * 2); mctx.clip();
  mctx.fillStyle = 'rgba(90,150,210,0.55)';
  for (const p of pondsNear(cow.pos.x, cow.pos.z, 1)) {
    const [x, y] = toScreen(p.x - cow.pos.x, p.z - cow.pos.z);
    mctx.beginPath(); mctx.arc(x, y, Math.max(3, p.R * 1.15 * sc), 0, Math.PI * 2); mctx.fill();
  }
  mctx.fillStyle = 'rgba(160,170,150,0.45)';
  for (const c of world.colliders) {
    if (c.r < 0.5) continue;
    const [x, y] = toScreen(c.x - cow.pos.x, c.z - cow.pos.z);
    mctx.beginPath(); mctx.arc(x, y, Math.max(1.2, c.r * sc), 0, Math.PI * 2); mctx.fill();
  }
  mctx.strokeStyle = 'rgba(255,255,255,0.08)';
  mctx.beginPath(); mctx.arc(R, R, (R - 8) / 2, 0, Math.PI * 2); mctx.stroke();
  mctx.font = '600 10px Segoe UI, sans-serif';
  mctx.textAlign = 'center';
  for (const r of net.remotes.values()) {
    let dx = r.cow.pos.x - cow.pos.x, dz = r.cow.pos.z - cow.pos.z;
    const d = Math.hypot(dx, dz);
    const far = d > MM_RANGE;
    if (far) { dx *= MM_RANGE / d; dz *= MM_RANGE / d; }
    const [x, y] = toScreen(dx, dz);
    const mate = state.clan && r.clan && r.clan.id === state.clan.id;
    mctx.fillStyle = mate ? state.clan.color : far ? 'rgba(255,196,90,0.7)' : '#ffc45a';
    mctx.beginPath(); mctx.arc(x, y, far ? 3 : 4, 0, Math.PI * 2); mctx.fill();
    if (!far) { mctx.fillStyle = 'rgba(255,255,255,0.85)'; mctx.fillText(r.name, x, y - 7); }
  }
  mctx.restore();
  // local cow arrow
  mctx.save();
  mctx.translate(R, R);
  mctx.rotate(state.camYaw + Math.PI - cow.heading);
  mctx.fillStyle = '#d8e8a8';
  mctx.beginPath(); mctx.moveTo(0, -7); mctx.lineTo(5, 5); mctx.lineTo(0, 2); mctx.lineTo(-5, 5); mctx.closePath(); mctx.fill();
  mctx.restore();
}

// ---------- loop ----------
applySettings();
env.setWeather('clear');
env.weather = { ...env.targetWeather };

const clock = new THREE.Clock();
function frame() {
  tick(Math.min(clock.getDelta(), 0.05));
  requestAnimationFrame(frame);
}
// one simulation + render step (also callable from the console for debugging)
function tick(dt) {
  state.time += dt;
  pad.poll();
  updateCow(dt);
  terrain.update(cow.pos.x, cow.pos.z);
  world.update(cow.pos.x, cow.pos.z);
  water.update(cow.pos.x, cow.pos.z);
  const cr = crocs.update(dt, state.time, {
    cow, alive: state.started && !state.dead, drinking: state.drinking, nearShore: state.nearShore, frozen: env.s.ice > 0.5,
    onStalk: () => { audio.growl(); toast('⚠️ Có gì đó đang bơi về phía bạn…'); },
    onBite: () => { audio.snap(); net.send({ t: 'act', a: 'croc' }); state.shake = 0.8; killCow('croc'); },
  });
  state.crocStalking = cr.stalking;
  updateCamera(dt);
  updateEnvironment(dt);
  audio.update(dt, env, state.time);
  net.update(dt, cow, camera, { xp: state.xp, food: state.food, water: state.water, health: state.health });
  selfTagPos.set(cow.pos.x, cow.pos.y + cow.air + (2.0 - 0.5 * cow.lie) * cow.size, cow.pos.z);
  selfTag.update(dt, selfTagPos, camera);
  renderer.render(scene, camera);
  drawMinimap();
  updateHud(dt);
  // rumble the controller on bumps, hits and bites
  if (settings.rumble && state.shake > prevShake + 0.05) pad.rumble(state.shake, 120 + state.shake * 300);
  prevShake = state.shake;
}
requestAnimationFrame(frame);
window.__game = { pad, state, cow, env, world, grass, water, crocs, net, customizer, tick, killCow, respawn, camera, pickCow };
