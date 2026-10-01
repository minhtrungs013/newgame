// Multiplayer game: connected players, the message protocol, clans in-game, admin
// announcements and the periodic snapshots / autosave.
const { getDb } = require('./db');
const {
  MAX_PLAYERS, ADMIN_KEY, COATS, LEVEL_MAX, XP_MAX, levelOf, CALF_SIZE,
  XP_GRAZE, XP_DRINK, GRAZE_RATE, DRINK_RATE, RISE_SLACK, XP_SLACK, XP_BANK_MAX, BUTT_DAMAGE, MAX_HEAL_PER_SEC,
} = require('./config');
const { num, clean, cleanLook, sameKey } = require('./util');
const { Conn } = require('./websocket');
const { worldClock, envMsg, applyOverride } = require('./world-clock');
const { idOf, freshProgress, userFromToken, saveProfile } = require('./accounts');
const { createClans } = require('./clans');

let announcement = null; // admin announcement { text, by }
const players = new Map(); // id -> player
let nextId = 1;

const publicInfo = (p) => ({ id: p.id, name: p.name, coat: p.coat, look: p.look, x: p.x, z: p.z, h: p.h, sp: p.sp, g: p.g, a: p.age, l: p.l, clan: p.clan || null, hp: +p.health.toFixed(2), acct: !!p.user });
const bodySize = (p) => CALF_SIZE + ((p.look ? p.look.size : 1) - CALF_SIZE) * p.age;

function broadcast(obj, except) {
  const s = JSON.stringify(obj);
  for (const p of players.values()) if (p !== except && p.ready) p.conn.send(s);
}

const clans = createClans({
  getDb, levelOf,
  onlineUsers: () => new Set([...players.values()].filter((p) => p.ready && p.user).map((p) => p.user.toLowerCase())),
  // roster / tag changed for these accounts: update online players and tell everyone
  notify(usernames, clanPub, clanId) {
    const names = new Set(usernames.map((u) => u.toLowerCase()));
    for (const p of players.values()) {
      if (!p.ready || !p.user) continue;
      const affected = names.has(p.user.toLowerCase());
      if (affected && clanPub !== undefined) {
        p.clan = clanPub;
        broadcast({ t: 'pclan', id: p.id, clan: clanPub });
      }
      if (affected || (p.clan && p.clan.id === clanId)) p.conn.send({ t: 'clanupd' });
    }
  },
});
const sameClan = (a, b) => !!(a.clan && b.clan && a.clan.id === b.clan.id);

// a new WebSocket connection (handshake already done)
function connect(socket) {
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
}

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
    const db = await getDb();
    const [fresh, saved] = await Promise.all([db.users.get(idOf(auth.username)), db.players.get(idOf(auth.username))]); // re-read after the kick-save
    const pr = saved || freshProgress();
    p.user = fresh.username;
    p.xp = num(pr.xp, 0, XP_MAX, 0); p.food = num(pr.food, 0, 1, 0.5); p.water = num(pr.water, 0, 1, 0.7); p.health = num(pr.health, 0.05, 1, 1);
    if (typeof pr.x === 'number' && typeof pr.z === 'number') { p.x = pr.x; p.z = pr.z; p.h = num(pr.h, -1e4, 1e4, 0); }
    profile = { username: p.user, xp: p.xp, food: p.food, water: p.water, health: p.health, x: p.x, z: p.z, h: p.h };
    p.saveDirty = true;
    const c = fresh.clanId ? await clans.getClan(fresh.clanId) : null;
    p.clan = clans.pub(c);
  }
  p.age = levelOf(p.xp) / LEVEL_MAX;
  p.xpT = Date.now();
  p.hpT = Date.now();
  p.ready = true;
  p.conn.send({
    t: 'welcome', id: p.id, x: p.x, z: p.z, h: p.h, env: envMsg(), announce: announcement, profile, clan: p.clan || null,
    players: [...players.values()].filter(o => o.ready && o !== p).map(publicInfo),
  });
  broadcast({ t: 'join', p: publicInfo(p) }, p);
  console.log(`+ ${p.name}${p.user ? ` [${p.user}]` : ''} joined (${players.size} online)`);
}

const INVITE_TTL = 3 * 60 * 1000;
async function clanInvite(p, m) {
  const sys = (text) => p.conn.send({ t: 'sys', text });
  if (!p.user || !p.clan) return sys('Bạn cần đăng nhập và ở trong một clan để mời người khác.');
  const target = players.get(m.to);
  if (!target || !target.ready || target === p) return;
  if (!target.user) return sys(`${target.name} đang chơi khách - cần đăng nhập mới vào clan được.`);
  if (target.clan) return sys(`${target.name} đã ở trong clan [${target.clan.tag}].`);
  const now = Date.now();
  if (now - (p.lastInvite || 0) < 3000) return sys('Đợi một chút rồi mời tiếp nhé.');
  const role = await clans.roleOf(p.user, p.clan.id);
  if (role !== 'leader' && role !== 'officer') return sys('Chỉ trưởng hoặc phó clan mới mời được người vào.');
  p.lastInvite = now;
  target.invites = target.invites || new Map();
  target.invites.set(p.clan.id, { from: p.name, fromId: p.id, at: now });
  target.conn.send({ t: 'clan-invite', from: p.name, clan: p.clan });
  sys(`Đã gửi lời mời vào clan tới ${target.name}.`);
}
async function clanReply(p, m) {
  const sys = (text) => p.conn.send({ t: 'sys', text });
  const inv = p.invites && p.invites.get(m.clanId);
  if (!inv) return;
  p.invites.delete(m.clanId);
  const inviter = players.get(inv.fromId);
  if (Date.now() - inv.at > INVITE_TTL) return sys('Lời mời đã hết hạn.');
  if (!m.accept) { if (inviter) inviter.conn.send({ t: 'sys', text: `${p.name} đã từ chối lời mời vào clan.` }); return; }
  if (!p.user) return sys('Cần đăng nhập để vào clan.');
  const r = await clans.acceptInvite(p.user, m.clanId);
  if (r.error) return sys(r.error);
  if (inviter) inviter.conn.send({ t: 'sys', text: `🎉 ${p.name} đã vào clan [${r.clan.tag}]!` });
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
      p.h = num(m.h, -1e4, 1e4, p.h); p.sp = num(m.sp, -3, 10); p.g = num(m.g, 0, 1); p.l = m.l ? 1 : 0;
      // XP is reported by the client but can't grow faster than grazing allows
      const now = Date.now();
      if (!p.dead) { // while dead the progress stays reset (fresh calf) whatever the client says
        const dt = Math.min(5, (now - p.xpT) / 1000);
        const food = Math.min(num(m.f, 0, 1, p.food), p.food + dt * GRAZE_RATE * RISE_SLACK);
        const water = Math.min(num(m.w, 0, 1, p.water), p.water + dt * DRINK_RATE * RISE_SLACK);
        const earned = Math.max(0, food - p.food) / GRAZE_RATE * XP_GRAZE + Math.max(0, water - p.water) / DRINK_RATE * XP_DRINK;
        p.xpBank = Math.min(XP_BANK_MAX, (p.xpBank || 0) + earned * XP_SLACK);
        const want = num(m.xp, 0, XP_MAX, p.xp);
        if (want > p.xp) { const gain = Math.min(want - p.xp, p.xpBank); p.xp += gain; p.xpBank -= gain; }
        else p.xp = want; // hunger / thirst cost XP
        p.age = levelOf(p.xp) / LEVEL_MAX;
        p.food = food; p.water = water;
        const maxHp = p.health + ((now - (p.hpT || now)) / 1000) * MAX_HEAL_PER_SEC;
        p.health = Math.min(num(m.hp, 0, 1, p.health), maxHp);
      }
      p.xpT = now;
      p.hpT = now;
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
          Object.assign(p, { xp: 0, xpBank: 0, age: 0, xpT: now, food: 0.5, water: 0.7, health: 1 });
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
      if (sameClan(p, target)) return; // clan mates are teammates: no knockback, no damage
      if (target.dead) return;
      p.lastHit = now;
      const nx = d > 0.01 ? dx / d : Math.sin(p.h), nz = d > 0.01 ? dz / d : Math.cos(p.h);
      // bigger cows hit harder: stronger knockback and more damage
      const power = Math.min(1.8, Math.max(0.6, bodySize(p) / bodySize(target)));
      const dmg = +(BUTT_DAMAGE * power).toFixed(3);
      target.health = Math.max(0, target.health - dmg);
      target.hpT = now;
      target.dirty = true;
      target.conn.send({ t: 'hit', from: p.id, dx: +nx.toFixed(3), dz: +nz.toFixed(3), p: +power.toFixed(2), dmg, hp: +target.health.toFixed(3) });
      if (target.health <= 0) {
        p.conn.send({ t: 'sys', text: `💪 Bạn đã húc gục ${target.name}!` });
        broadcast({ t: 'chat', id: 0, name: '', text: `💥 ${target.name} đã bị ${p.name} húc gục`, sys: true });
      }
      const fx = JSON.stringify({ t: 'hitfx', from: p.id, to: target.id });
      for (const o of players.values()) if (o.ready && o !== p && o !== target) o.conn.send(fx);
      break;
    }
    case 'clan-invite': {
      if (!p.ready) return;
      clanInvite(p, m).catch((e) => console.error('invite failed', e));
      break;
    }
    case 'clan-reply': {
      if (!p.ready) return;
      clanReply(p, m).catch((e) => console.error('invite reply failed', e));
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
      const cc = String(m.text ?? '').trim().match(/^\/(?:c|clan)\s+([\s\S]+)$/i);
      if (cc) {
        if (!p.clan) { p.conn.send({ t: 'sys', text: 'Bạn chưa có clan (nhấn G để mở quản lý clan).' }); break; }
        const t = clean(cc[1], 120);
        if (!t) break;
        const msg = JSON.stringify({ t: 'chat', id: p.id, name: p.name, text: t, clan: p.clan.tag, color: p.clan.color });
        for (const o of players.values()) if (o.ready && sameClan(o, p)) o.conn.send(msg);
        break;
      }
      const txt = clean(m.text, 120);
      if (txt) broadcast({ t: 'chat', id: p.id, name: p.name, text: txt });
      break;
    }
    case 'env': {
      if (!p.ready) return;
      applyOverride(m); // Ctrl+K: weather / time / season
      broadcast({ ...envMsg(), by: p.name });
      break;
    }
  }
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

// position snapshots at 15 Hz, env heartbeat every 10 s, weather / season changes, autosave
let lastWeather = null, lastSeason = null;
function startTimers() {
  setInterval(() => {
    const ps = [];
    for (const p of players.values()) {
      if (!p.ready || !p.dirty) continue;
      p.dirty = false;
      ps.push([p.id, +p.x.toFixed(2), +p.z.toFixed(2), +p.h.toFixed(3), +p.sp.toFixed(2), +p.g.toFixed(2), +p.age.toFixed(3), p.l, +p.health.toFixed(2)]);
    }
    if (ps.length) broadcast({ t: 'snap', ps });
  }, 1000 / 15);
  setInterval(() => broadcast(envMsg()), 10000);
  setInterval(() => {
    const c = worldClock();
    if (c.weather !== lastWeather || c.season !== lastSeason) {
      if (lastSeason && c.season !== lastSeason) console.log(`~ season: ${c.season}`);
      lastWeather = c.weather; lastSeason = c.season;
      broadcast(envMsg());
    }
  }, 2000);
  setInterval(() => { for (const p of players.values()) if (p.ready && p.user && p.saveDirty) saveProfile(p); }, 20000);
}

// save everyone (shutdown)
const saveAll = () => Promise.all([...players.values()].filter((p) => p.user).map(saveProfile));
const onlineCount = () => [...players.values()].filter((p) => p.ready).length;

module.exports = { connect, startTimers, saveAll, onlineCount, clans };
