import * as THREE from 'three';
import { Terrain, heightAt } from './terrain.js';
import { Grass } from './grass.js';
import { Cow, BUTT_HIT_AT } from './cow.js';
import { Sky } from './sky.js';
import { Environment } from './environment.js';
import { World } from './world.js';
import { AudioSys } from './audio.js';
import { Net, NameTag } from './net.js';
import { Customizer } from './customize.js';
import { MAX_COWS } from './grass.js';
import { WEATHERS } from './environment.js';

const $ = (id) => document.getElementById(id);
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
let cow = new Cow(scene);
const audio = new AudioSys();
const onStep = (sp) => audio.step(sp, env.weather.rain > 0.5);
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

// ---------- drifting leaves / petals ----------
const LEAVES = 90;
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
  if (e.target.tagName === 'INPUT') return;
  if (e.target.tagName === 'SELECT') e.target.blur();
  const k = e.code;
  if ((k === 'Enter' || k === 'NumpadEnter') && state.started) { e.preventDefault(); openChat(); return; }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3'].includes(k)) e.preventDefault();
  if (e.repeat) { state.keys.add(k); return; }
  state.keys.add(k);
  if (k === 'Space' && state.started && cow.stun <= 0 && cow.jump()) {
    audio.jump();
    net.send({ t: 'act', a: 'jump' });
  }
  if (k === 'KeyF' && state.started) tryButt();
  if (k === 'KeyE' && state.started) {
    audio.moo();
    selfTag.say('Mooo~', 2);
    net.send({ t: 'moo' });
    if (cow.speed < 0.6) cow.startGraze(4 + Math.random() * 2);
    state.happy = Math.min(1, state.happy + 0.03);
  }
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

let dragging = false, lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  state.yaw -= dx * 0.005;
  state.pitch = THREE.MathUtils.clamp(state.pitch + dy * 0.004, -0.05, 1.35);
  state.lastDrag = state.time;
});
const endDrag = () => { dragging = false; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  state.dist = THREE.MathUtils.clamp(state.dist * (1 + Math.sign(e.deltaY) * 0.1), 3, 28);
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- UI ----------
$('sel-quality').addEventListener('change', (e) => { applyQuality(e.target.value); e.target.blur(); });
// weather/time are shared: when online the server decides and tells everyone
$('sel-weather').addEventListener('change', (e) => {
  if (net.connected) net.send({ t: 'env', weather: e.target.value });
  else env.setWeather(e.target.value);
  e.target.blur();
});
$('sel-time').addEventListener('change', (e) => {
  if (net.connected) net.send({ t: 'env', time: e.target.value });
  else env.setTime(e.target.value);
  e.target.blur();
});
$('btn-sound').addEventListener('click', (e) => {
  audio.setEnabled(!audio.enabled);
  e.target.textContent = audio.enabled ? 'On' : 'Off';
  e.target.classList.toggle('off', !audio.enabled);
  e.target.blur();
});
// ---------- start screen ----------
const customizer = new Customizer($('customizer'));
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
  cow = new Cow(scene, { look, seed });
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
  net.connect(name, look);
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
    else { addChat($('txt-name').textContent, text); selfTag.say(text); }
  }
  closeChat();
});
chatInput.addEventListener('blur', () => $('chat').classList.remove('open'));
function addChat(name, text, system = false) {
  const log = $('chat-log');
  const row = document.createElement('div');
  if (system) { row.className = 'sys'; row.textContent = text; }
  else {
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
  env.setWeather(m.weather);
  if (m.time === 'cycle') {
    env.setTime('cycle');
    if (Math.abs(env.hour - m.hour) > 0.5) env.hour = m.hour;
  } else env.setTime(m.time);
  if (instant) {
    env.weather = { ...WEATHERS[m.weather] };
    env.hour = m.hour;
  }
  $('sel-weather').value = m.weather;
  $('sel-time').value = m.time;
}
const net = new Net(scene, $('tags'), {
  onStatus(s) {
    $('net-dot').className = 'dot ' + s;
    $('net-text').textContent = s === 'online' ? 'Online' : s === 'connecting' ? 'Đang kết nối…' : 'Offline';
  },
  onWelcome(m) {
    cow.pos.set(m.x, heightAt(m.x, m.z), m.z);
    cow.heading = m.h;
    state.yaw = state.camYaw = m.h + Math.PI;
    applyEnv(m.env, true);
    addChat('', m.players.length
      ? `Đã vào đồng cỏ cùng ${m.players.length} người khác. Nhấn Enter để chat!`
      : 'Đã vào đồng cỏ. Gửi địa chỉ server cho bạn bè để chơi chung!', true);
  },
  onSystem(text) { addChat('', text, true); },
  onChat(name, text, remote, isSelf) {
    addChat(name, text);
    if (isSelf) selfTag.say(text);
    else if (remote) remote.tag.say(text);
  },
  onRemoteMoo(r) {
    r.tag.say('Mooo~', 2);
    const { vol, pan } = spatial(r.cow.pos);
    audio.moo(vol, pan, 0.9 + (r.id % 5) * 0.06);
  },
  onRemoteAct(r, a) {
    const { vol } = spatial(r.cow.pos, 50);
    if (a === 'jump') {
      r.cow.onLand ??= (v) => audio.land(v, spatial(r.cow.pos, 50).vol);
      if (r.cow.jump()) audio.jump(vol);
    } else if (a === 'butt') {
      if (r.cow.startButt()) audio.whoosh(vol);
    }
  },
  onHit(r, dx, dz) {
    // we got headbutted: fly back, hop, get dizzy for a moment
    cow.knockback(dx, dz);
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
    if (m.by) toast(`${m.by}: ${$('sel-weather').selectedOptions[0].text} · ${$('sel-time').selectedOptions[0].text}`);
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
    if (d > 2.8 || d < 0.01) continue;
    if ((dx * fx + dz * fz) / d < 0.45) continue; // must be in front of us
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

function updateCow(dt) {
  const k = state.keys;
  const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
  const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  const running = k.has('ShiftLeft') || k.has('ShiftRight');
  let targetSpeed = 0;
  const canControl = state.started && cow.stun <= 0;
  if (canControl && (f || r)) {
    // camera-relative movement
    const fx = -Math.sin(state.camYaw), fz = -Math.cos(state.camYaw);
    const rx = Math.cos(state.camYaw), rz = -Math.sin(state.camYaw);
    const dx = fx * f + rx * r, dz = fz * f + rz * r;
    const want = Math.atan2(dx, dz);
    const diff = angleDiff(cow.heading, want);
    const turnRate = running ? 2.6 : 2.0;
    cow.heading += THREE.MathUtils.clamp(diff, -turnRate * dt, turnRate * dt);
    targetSpeed = (running ? 5.2 : 1.9) * Math.max(0.25, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)));
    if (cow.isGrazing) cow.grazeTimer = 0;
  }
  // fatigue: a hungry cow runs slower
  targetSpeed *= 0.75 + 0.25 * Math.min(1, state.food * 2);
  // keep momentum in the air, react faster on the ground
  const accel = cow.grounded ? (targetSpeed > cow.speed ? 2.5 : 4) : 0.6;
  cow.speed += (targetSpeed - cow.speed) * Math.min(1, dt * accel);

  const vx = Math.sin(cow.heading) * cow.speed, vz = Math.cos(cow.heading) * cow.speed;
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
  state.distance += cow.speed * dt;

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

  // needs
  if (cow.graze > 0.8) {
    state.food = Math.min(1, state.food + dt * 0.06);
    state.chewTimer -= dt;
    if (state.chewTimer < 0) { state.chewTimer = 0.32 + Math.random() * 0.1; audio.chew(); }
  }
  state.food = Math.max(0, state.food - dt * (0.004 + cow.speed * 0.0015));
  const targetHappy = 0.3 + state.food * 0.5 + (cow.speed > 0.5 ? 0.2 : 0.05) - env.weather.rain * 0.05;
  state.happy += (targetHappy - state.happy) * dt * 0.05;
}

function updateCamera(dt) {
  if (state.cinematic) {
    state.yaw += dt * 0.12;
    state.pitch += (0.18 - state.pitch) * dt * 0.5;
  } else if (cow.speed > 0.4 && state.time - state.lastDrag > 1.8) {
    // drift behind the cow while walking
    const behind = cow.heading + Math.PI;
    state.yaw += angleDiff(state.yaw, behind) * Math.min(1, dt * 0.6);
  }
  const s = Math.min(1, dt * 8);
  state.camYaw += angleDiff(state.camYaw, state.yaw) * s;
  state.camPitch += (state.pitch - state.camPitch) * s;
  const targetDist = state.cinematic ? 10 : state.dist;
  state.camDist += (targetDist - state.camDist) * Math.min(1, dt * 5);

  const target = tmpV.set(cow.pos.x, cow.pos.y + 1.2 * cow.size + cow.air * 0.6, cow.pos.z);
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
  // lightning in heavy rain
  if (w.rain > 0.8) {
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
  for (let i = 0; i < MAX_COWS; i++) {
    const c = nearCows[i];
    if (c) g.uCows.value[i].set(c.pos.x, c.pos.z, c.pos.x + sox, c.pos.z + soz);
    else g.uCows.value[i].set(1e5, 1e5, 1e5, 1e5);
  }
  g.uShadowStr.value = 0.55 * Math.min(1, env.sunI / 1.2);
  g.uSunDir.value.copy(ld);
  g.uSunColor.value.copy(env.sunColor).multiplyScalar(env.sunI * 0.55);
  g.uAmbient.value.copy(env.ambient).multiplyScalar(env.ambI * 0.75);
  g.uWet.value = w.rain;

  state.obstacleTimer -= dt;
  if (state.obstacleTimer < 0) {
    state.obstacleTimer = 0.3;
    world.nearest(cow.pos.x, cow.pos.z, g.uObstacles.value);
  }

  rain.update(dt, w.rain, w.wind, windDir);

  // leaves
  for (let i = 0; i < LEAVES; i++) {
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
  leafMat.color.setHex(0xe0c050).multiplyScalar(0.6 + 0.4 * env.dayness);

  world.animateTrees(state.time, w.wind);
}

// ---------- HUD ----------
let hudTimer = 0, fpsFrames = 0, fpsTime = 0, fps = 0;
function updateHud(dt) {
  fpsFrames++; fpsTime += dt;
  if (fpsTime > 0.5) { fps = Math.round(fpsFrames / fpsTime); fpsFrames = 0; fpsTime = 0; }
  hudTimer -= dt;
  if (hudTimer > 0) return;
  hudTimer = 0.2;
  $('bar-happy').style.width = `${Math.round(state.happy * 100)}%`;
  $('bar-food').style.width = `${Math.round(state.food * 100)}%`;
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
    mctx.fillStyle = far ? 'rgba(255,196,90,0.7)' : '#ffc45a';
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
applyQuality('medium');
env.setWeather($('sel-weather').value);
env.setTime($('sel-time').value);
env.weather = { ...env.targetWeather };

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  state.time += dt;
  updateCow(dt);
  terrain.update(cow.pos.x, cow.pos.z);
  world.update(cow.pos.x, cow.pos.z);
  updateCamera(dt);
  updateEnvironment(dt);
  audio.update(dt, env, state.time);
  net.update(dt, cow, camera);
  selfTagPos.set(cow.pos.x, cow.pos.y + cow.air + 2.0 * cow.size, cow.pos.z);
  selfTag.update(dt, selfTagPos, camera);
  renderer.render(scene, camera);
  drawMinimap();
  updateHud(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__game = { state, cow, env, world, grass, net };
