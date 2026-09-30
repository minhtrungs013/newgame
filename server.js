// Cow Meadow server: static files + multiplayer over WebSocket (no dependencies).
//   node server.js           -> http://localhost:5173
// Friends on the same network join via http://<your-LAN-IP>:5173
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = process.env.PORT || 5173;
const ROOT = __dirname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
const MAX_PLAYERS = 32;
// Admin announcements (/ONADMIN <text>, /OFFADMIN). If ADMIN_KEY is set, a player must
// first unlock admin commands with /ADMIN <key>; otherwise anyone may use them.
const ADMIN_KEY = process.env.ADMIN_KEY || '';
let announcement = null; // { text, by }
const COATS = ['holstein', 'brown', 'jersey', 'black'];
// cow appearance options (must match js/cow.js)
const PATTERNS = ['none', 'few', 'many', 'patches'];
const HORNS = ['none', 'short', 'long'];
const ACCESSORIES = ['none', 'bell', 'hat', 'flowers', 'scarf'];
const HEX = /^#[0-9a-f]{6}$/i;
const WEATHERS = ['clear', 'cloudy', 'rain', 'fog'];
// levels 0..30 from XP (must match js/levels.js); XP comes from grazing (1/s) / drinking
const LEVEL_MAX = 30;
const xpForLevel = (l) => 40 * l + 4 * l * (l - 1);
const XP_MAX = xpForLevel(LEVEL_MAX);
const levelOf = (xp) => { let l = 0; while (l < LEVEL_MAX && xp >= xpForLevel(l + 1)) l++; return l; };
const MAX_XP_PER_SEC = 1.4; // a little above the client's best rate (1/s), to absorb lag
const CALF_SIZE = 0.5;

// ---------- accounts & saved progress ----------
const { createStore } = require('./store');
const store = createStore();
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const USER_RE = /^[a-zA-Z0-9_]{3,16}$/;
const userKey = (u) => `user:${u.toLowerCase()}`;
const freshProgress = () => ({ xp: 0, food: 0.5, water: 0.7, health: 1, x: null, z: null, h: 0 });
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((res, rej) => crypto.scrypt(pw, salt, 32, (e, k) => (e ? rej(e) : res({ salt, hash: k.toString('hex') }))));
}
async function checkPassword(pw, stored) {
  const { hash } = await hashPassword(pw, stored.salt);
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(stored.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function newSession(username) {
  const token = crypto.randomBytes(24).toString('hex');
  await store.set(`sess:${token}`, username, SESSION_TTL);
  return token;
}
async function userFromToken(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) return null;
  const username = await store.get(`sess:${token}`);
  if (!username) return null;
  const u = await store.get(userKey(username));
  return u ? { username: u.username, user: u } : null;
}
const publicProfile = (u) => ({ username: u.username, name: u.profile.name, look: u.profile.look, xp: u.profile.xp, level: levelOf(u.profile.xp || 0) });

// brute-force protection for login/register: 20 attempts / 10 min / IP
const authHits = new Map();
function rateLimited(ip) {
  const now = Date.now(), e = authHits.get(ip) || { n: 0, t: now };
  if (now - e.t > 600000) { e.n = 0; e.t = now; }
  e.n++; authHits.set(ip, e);
  return e.n > 20;
}
function readBody(req, limit = 4096) {
  return new Promise((res) => {
    let body = '', over = false;
    req.on('data', (d) => { body += d; if (body.length > limit) { over = true; req.destroy(); } });
    req.on('end', () => { if (over) return res(null); try { res(JSON.parse(body || '{}')); } catch { res(null); } });
    req.on('error', () => res(null));
  });
}
function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
async function handleApi(req, res, url) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (url === '/api/me' && req.method === 'GET') {
    const auth = await userFromToken((req.headers.authorization || '').replace(/^Bearer /, ''));
    return auth ? sendJson(res, 200, publicProfile(auth.user)) : sendJson(res, 401, { error: 'Phiên đăng nhập đã hết hạn.' });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  const body = await readBody(req);
  if (!body) return sendJson(res, 400, { error: 'Dữ liệu không hợp lệ.' });
  if (url === '/api/logout') {
    if (typeof body.token === 'string' && /^[a-f0-9]{48}$/.test(body.token)) await store.del(`sess:${body.token}`);
    return sendJson(res, 200, { ok: true });
  }
  if (rateLimited(ip)) return sendJson(res, 429, { error: 'Thử quá nhiều lần, đợi vài phút nhé.' });
  const username = String(body.username || '').trim(), password = String(body.password || '');
  if (!USER_RE.test(username)) return sendJson(res, 400, { error: 'Tên đăng nhập 3–16 ký tự: chữ không dấu, số, dấu _' });
  if (password.length < 6 || password.length > 100) return sendJson(res, 400, { error: 'Mật khẩu cần ít nhất 6 ký tự.' });
  const key = userKey(username);
  if (url === '/api/register') {
    if (await store.get(key)) return sendJson(res, 409, { error: 'Tên đăng nhập đã có người dùng.' });
    const user = { username, pass: await hashPassword(password), created: Date.now(), profile: { name: username, look: null, ...freshProgress() } };
    await store.set(key, user);
    console.log(`* new account: ${username}`);
    return sendJson(res, 200, { token: await newSession(username), ...publicProfile(user) });
  }
  if (url === '/api/login') {
    const user = await store.get(key);
    if (!user || !(await checkPassword(password, user.pass))) return sendJson(res, 401, { error: 'Sai tên đăng nhập hoặc mật khẩu.' });
    return sendJson(res, 200, { token: await newSession(user.username), ...publicProfile(user) });
  }
  return sendJson(res, 404, { error: 'Not found' });
}

// write a logged-in player's current progress into their account
async function saveProfile(p) {
  if (!p.user) return;
  try {
    const u = await store.get(userKey(p.user));
    if (!u) return;
    u.profile = {
      ...u.profile, name: p.name, look: p.look, xp: Math.round(p.xp * 10) / 10,
      food: p.food, water: p.water, health: p.health, updated: Date.now(),
      // after dying the next session starts at the spawn meadow again
      x: p.posReset ? null : p.x, z: p.posReset ? null : p.z, h: p.h,
    };
    await store.set(userKey(p.user), u);
    p.saveDirty = false;
  } catch (e) { console.error('save failed for', p.user, e.message); }
}
const TIMES = { morning: 7.9, noon: 12.5, sunset: 18.35, night: 23.0 };

// ---------- public URL (ngrok) ----------
// When ngrok runs on this machine it exposes a local API listing its tunnels.
// On Render the public address is provided automatically.
const FIXED_URL = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || null;
let publicUrl = FIXED_URL;
function setPublicUrl(url) {
  if (url === publicUrl) return;
  publicUrl = url;
  if (url) console.log(`\n  INTERNET (ngrok):  ${url}\n  -> Gui link nay cho ban be de choi chung!\n`);
  else console.log('  ngrok da tat - chi con choi duoc trong LAN.');
}
function pollNgrok() {
  if (FIXED_URL) return;
  const req = http.get('http://127.0.0.1:4040/api/tunnels', { timeout: 1500 }, (res) => {
    let body = '';
    res.on('data', (d) => { body += d; });
    res.on('end', () => {
      try {
        const t = JSON.parse(body).tunnels.find((x) => x.public_url?.startsWith('https://'));
        setPublicUrl(t ? t.public_url : null);
      } catch {}
    });
  });
  req.on('error', () => setPublicUrl(null));
  req.on('timeout', () => req.destroy());
}
setInterval(pollNgrok, 3000);
pollNgrok();

function lanUrls() {
  const out = [];
  if (process.env.RENDER) return out; // cloud host: internal IPs are useless to players
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`);
  }
  return out;
}

// ---------- static files ----------
// Only the game's own files are served (never server.js, .bat, config...), since
// the server may be reachable from the Internet through ngrok.
const PUBLIC_FILE = /^\/(index\.html|style\.css|js\/[\w-]+\.js)$/;
const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (url.startsWith('/api/') && url !== '/api/info') { handleApi(req, res, url).catch((e) => { console.error(e); sendJson(res, 500, { error: 'Lỗi server.' }); }); return; }
  if (url === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ publicUrl, lan: lanUrls(), players: [...players.values()].filter((p) => p.ready).length }));
  }
  if (url === '/') url = '/index.html';
  if (req.method !== 'GET' || !PUBLIC_FILE.test(url)) { res.writeHead(404); return res.end('Not found'); }
  const file = path.join(ROOT, url);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------- minimal WebSocket (RFC 6455) ----------
function encodeFrame(str, opcode = 0x1) {
  const payload = Buffer.from(str);
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

class Conn {
  constructor(socket, onMessage, onClose) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = [];
    this.open = true;
    this.onMessage = onMessage;
    this.onClose = onClose;
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }
  send(obj) {
    if (!this.open) return;
    try { this.socket.write(encodeFrame(typeof obj === 'string' ? obj : JSON.stringify(obj))); } catch { this._closed(); }
  }
  close() {
    if (!this.open) return;
    try { this.socket.end(encodeFrame('', 0x8)); } catch {}
    this._closed();
  }
  _closed() {
    if (!this.open) return;
    this.open = false;
    this.socket.destroy();
    this.onClose();
  }
  _data(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    if (this.buf.length > 1 << 20) return this.close();
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 65536 || !masked) return this.close();
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const data = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);

      if (opcode === 0x8) return this.close();
      if (opcode === 0x9) { try { this.socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data])); } catch {} continue; }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x0) {
        this.frag.push(data);
        if (fin) {
          const text = Buffer.concat(this.frag).toString('utf8');
          this.frag = [];
          this.onMessage(text);
        }
      }
    }
  }
}

// ---------- game state ----------
const players = new Map(); // id -> player
let nextId = 1;
const envState = { weather: 'rain', time: 'morning', cycleBase: TIMES.morning, cycleStart: Date.now() };

function envMsg() {
  const hour = envState.time === 'cycle'
    ? (envState.cycleBase + (Date.now() - envState.cycleStart) / 25000) % 24
    : TIMES[envState.time];
  return { t: 'env', weather: envState.weather, time: envState.time, hour };
}
const num = (v, lo, hi, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
function cleanLook(l) {
  if (!l || typeof l !== 'object') return null;
  const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  return {
    base: hex(l.base, '#f2efe8'), spot: hex(l.spot, '#121212'), pattern: pick(l.pattern, PATTERNS, 'many'),
    snout: hex(l.snout, '#dca59a'), horns: pick(l.horns, HORNS, 'short'), size: Math.round(num(l.size, 0.85, 1.2, 1) * 100) / 100,
    acc: pick(l.acc, ACCESSORIES, 'none'), accColor: hex(l.accColor, '#d83a3a'),
  };
}
const publicInfo = (p) => ({ id: p.id, name: p.name, coat: p.coat, look: p.look, x: p.x, z: p.z, h: p.h, sp: p.sp, g: p.g, a: p.age, l: p.l });
const bodySize = (p) => CALF_SIZE + ((p.look ? p.look.size : 1) - CALF_SIZE) * p.age;

function broadcast(obj, except) {
  const s = JSON.stringify(obj);
  for (const p of players.values()) if (p !== except && p.ready) p.conn.send(s);
}

server.on('upgrade', (req, socket) => {
  if (req.url !== '/ws' || req.headers.upgrade?.toLowerCase() !== 'websocket') return socket.destroy();
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
               `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);

  const p = {
    id: nextId++, name: 'Bò', coat: 'holstein', x: 0, z: 0, h: 0, sp: 0, g: 0, l: 0,
    ready: false, dirty: false, lastChat: 0, chatBudget: 5,
    lastJump: 0, lastButt: 0, lastHit: 0,
    age: 0, xp: 0, xpT: Date.now(), food: 0.5, water: 0.7, health: 1,
    user: null, saveDirty: false,
  };
  p.conn = new Conn(socket, (text) => handle(p, text), () => {
    if (!players.has(p.id)) return;
    players.delete(p.id);
    if (p.user && !p.kicked) saveProfile(p); // quitting saves progress - nothing drains while you're away
    if (p.ready) {
      broadcast({ t: 'leave', id: p.id });
      console.log(`- ${p.name} left (${players.size} online)`);
    }
  });
  if (players.size >= MAX_PLAYERS) { p.conn.send({ t: 'full' }); return p.conn.close(); }
  players.set(p.id, p);
});

async function hello(p, m) {
  p.name = clean(m.name, 16) || `Bò ${p.id}`;
  p.coat = COATS.includes(m.coat) ? m.coat : 'holstein';
  p.look = cleanLook(m.look); // null for old clients -> they fall back to 'coat'
  const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 6;
  p.x = Math.cos(a) * r; p.z = Math.sin(a) * r; p.h = Math.random() * Math.PI * 2;
  let profile = null;
  const auth = m.token ? await userFromToken(m.token) : null;
  if (!p.conn.open) return;
  if (auth) {
    // the same account playing in another tab/device: save that one and kick it
    for (const o of players.values()) {
      if (o !== p && o.user && o.user.toLowerCase() === auth.username.toLowerCase()) {
        await saveProfile(o);
        o.kicked = true;
        o.conn.send({ t: 'kicked', text: 'Tài khoản này vừa đăng nhập ở nơi khác.' });
        o.conn.close();
      }
    }
    const fresh = await store.get(userKey(auth.username)); // re-read after the kick-save
    const pr = fresh.profile;
    p.user = fresh.username;
    p.xp = num(pr.xp, 0, XP_MAX, 0); p.food = num(pr.food, 0, 1, 0.5); p.water = num(pr.water, 0, 1, 0.7); p.health = num(pr.health, 0.05, 1, 1);
    if (typeof pr.x === 'number' && typeof pr.z === 'number') { p.x = pr.x; p.z = pr.z; p.h = num(pr.h, -1e4, 1e4, 0); }
    profile = { username: p.user, xp: p.xp, food: p.food, water: p.water, health: p.health, x: p.x, z: p.z, h: p.h };
    p.saveDirty = true;
  }
  p.age = levelOf(p.xp) / LEVEL_MAX;
  p.xpT = Date.now();
  p.ready = true;
  p.conn.send({
    t: 'welcome', id: p.id, x: p.x, z: p.z, h: p.h, env: envMsg(), announce: announcement, profile,
    players: [...players.values()].filter(o => o.ready && o !== p).map(publicInfo),
  });
  broadcast({ t: 'join', p: publicInfo(p) }, p);
  console.log(`+ ${p.name}${p.user ? ` [${p.user}]` : ''} joined (${players.size} online)`);
}

function handle(p, text) {
  let m;
  try { m = JSON.parse(text); } catch { return; }
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'hello': {
      if (p.ready || p.helloing) return;
      p.helloing = true;
      hello(p, m).catch((e) => { console.error('hello failed', e); p.conn.close(); });
      break;
    }
    case 's': {
      if (!p.ready) return;
      p.x = num(m.x, -1e6, 1e6, p.x); p.z = num(m.z, -1e6, 1e6, p.z);
      p.h = num(m.h, -1e4, 1e4, p.h); p.sp = num(m.sp, 0, 10); p.g = num(m.g, 0, 1); p.l = m.l ? 1 : 0;
      // XP is reported by the client but can't grow faster than grazing allows
      const now = Date.now();
      if (!p.dead) { // while dead the progress stays reset (fresh calf) whatever the client says
        const maxXp = p.xp + ((now - p.xpT) / 1000) * MAX_XP_PER_SEC;
        p.xp = Math.min(num(m.xp, 0, XP_MAX, p.xp), maxXp);
        p.age = levelOf(p.xp) / LEVEL_MAX;
        p.food = num(m.f, 0, 1, p.food); p.water = num(m.w, 0, 1, p.water); p.health = num(m.hp, 0, 1, p.health);
      }
      p.xpT = now;
      p.saveDirty = true;
      p.dirty = true;
      break;
    }
    case 'moo':
      if (p.ready) broadcast({ t: 'moo', id: p.id }, p);
      break;
    case 'act': {
      // visual actions other players should see: jump / headbutt
      if (!p.ready) return;
      const now = Date.now();
      if (m.a === 'jump' && now - p.lastJump > 450) { p.lastJump = now; broadcast({ t: 'act', id: p.id, a: 'jump' }, p); }
      if (m.a === 'butt' && now - p.lastButt > 700) { p.lastButt = now; broadcast({ t: 'act', id: p.id, a: 'butt' }, p); }
      // life events: eaten by a croc, died, respawned (others only see the animation)
      if (['croc', 'die', 'respawn'].includes(m.a) && now - (p.lastLife || 0) > 300) {
        p.lastLife = now;
        if (m.a === 'die' || m.a === 'respawn') {
          // dying starts the account over: new calf at the spawn meadow
          Object.assign(p, { xp: 0, age: 0, xpT: now, food: 0.5, water: 0.7, health: 1 });
          p.dead = m.a === 'die';
          p.posReset = p.dead;
          if (p.dead && p.user) saveProfile(p);
        }
        broadcast({ t: 'act', id: p.id, a: m.a }, p);
        if (m.a === 'die') console.log(`x ${p.name} died`);
      }
      break;
    }
    case 'hit': {
      // attacker reports a headbutt hit; the server checks it before knocking the target back
      if (!p.ready) return;
      const target = players.get(m.to);
      const now = Date.now();
      if (!target || target === p || !target.ready) return;
      if (now - p.lastButt > 1200 || now - p.lastHit < 600) return; // must follow a real butt, no spamming
      const dx = target.x - p.x, dz = target.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 4.5) return; // too far apart (allows for some network lag)
      p.lastHit = now;
      const nx = d > 0.01 ? dx / d : Math.sin(p.h), nz = d > 0.01 ? dz / d : Math.cos(p.h);
      // bigger cows hit harder (knockback only - being butted doesn't shrink you)
      const power = Math.min(1.8, Math.max(0.6, bodySize(p) / bodySize(target)));
      target.conn.send({ t: 'hit', from: p.id, dx: +nx.toFixed(3), dz: +nz.toFixed(3), p: +power.toFixed(2) });
      const fx = JSON.stringify({ t: 'hitfx', from: p.id, to: target.id });
      for (const o of players.values()) if (o.ready && o !== p && o !== target) o.conn.send(fx);
      break;
    }
    case 'chat': {
      if (!p.ready) return;
      const now = Date.now();
      p.chatBudget = Math.min(5, p.chatBudget + (now - p.lastChat) / 2000);
      p.lastChat = now;
      if (p.chatBudget < 1) return;
      p.chatBudget -= 1;
      // admin commands are handled here and never shown as chat
      const cmd = String(m.text ?? '').trim().match(/^\/(ONADMIN|OFFADMIN|ADMIN)(?:\s+([\s\S]*))?$/i);
      if (cmd) { adminCommand(p, cmd[1].toUpperCase(), cmd[2] || ''); break; }
      const txt = clean(m.text, 120);
      if (txt) broadcast({ t: 'chat', id: p.id, name: p.name, text: txt });
      break;
    }
    case 'env': {
      if (!p.ready) return;
      if (WEATHERS.includes(m.weather)) envState.weather = m.weather;
      if (m.time === 'cycle' && envState.time !== 'cycle') {
        envState.cycleBase = TIMES[envState.time];
        envState.cycleStart = Date.now();
        envState.time = 'cycle';
      } else if (TIMES[m.time] !== undefined) envState.time = m.time;
      broadcast({ ...envMsg(), by: p.name });
      break;
    }
  }
}

function sameKey(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function adminCommand(p, cmd, arg) {
  const reply = (text) => p.conn.send({ t: 'sys', text });
  if (cmd === 'ADMIN') {
    if (!ADMIN_KEY) return reply('Server chưa đặt ADMIN_KEY nên không cần đăng nhập admin.');
    if (p.adminFails >= 5) return reply('Sai mã quá nhiều lần.');
    if (sameKey(arg.trim(), ADMIN_KEY)) { p.admin = true; return reply('Đã đăng nhập admin ✔'); }
    p.adminFails = (p.adminFails || 0) + 1;
    return reply('Sai mã admin.');
  }
  if (ADMIN_KEY && !p.admin) return reply('Bạn cần đăng nhập trước: /ADMIN <mã>');
  if (cmd === 'ONADMIN') {
    const text = clean(arg, 200);
    if (!text) return reply('Cú pháp: /ONADMIN <nội dung thông báo>');
    announcement = { text, by: p.name };
    broadcast({ t: 'announce', ...announcement });
    console.log(`! announcement by ${p.name}: ${text}`);
  } else if (cmd === 'OFFADMIN') {
    if (!announcement) return reply('Hiện không có thông báo nào.');
    announcement = null;
    broadcast({ t: 'announce', text: null, by: p.name });
    console.log(`! announcement cleared by ${p.name}`);
  }
}

// position snapshots at 15 Hz, env heartbeat every 10 s
setInterval(() => {
  const ps = [];
  for (const p of players.values()) {
    if (!p.ready || !p.dirty) continue;
    p.dirty = false;
    ps.push([p.id, +p.x.toFixed(2), +p.z.toFixed(2), +p.h.toFixed(3), +p.sp.toFixed(2), +p.g.toFixed(2), +p.age.toFixed(3), p.l]);
  }
  if (ps.length) broadcast({ t: 'snap', ps });
}, 1000 / 15);
setInterval(() => broadcast(envMsg()), 10000);
setInterval(() => { for (const p of players.values()) if (p.ready && p.user && p.saveDirty) saveProfile(p); }, 20000);
// hosts (Render, Docker...) send SIGTERM before stopping: save everyone first
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all([...players.values()].filter((p) => p.user).map(saveProfile));
  await store.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Cow Meadow running at http://localhost:${PORT}`);
  console.log(`  Saves: ${store.kind}`);
  store.ready().then(() => console.log(`  Storage ready: ${store.kind}`))
    .catch((e) => console.error(`  !! Cannot reach storage (${store.kind}): ${e.message}`));
  for (const u of lanUrls()) console.log(`  LAN:  ${u}`);
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} dang duoc dung - co the server da chay roi.`);
  else console.error(e);
  process.exit(1);
});
