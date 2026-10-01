// Accounts: password hashing, login sessions and saved progress (collections users / players / sessions).
const crypto = require('crypto');
const { getDb } = require('./db');
const { SESSION_TTL, levelOf, ADMIN_USERS } = require('./config');

const idOf = (username) => username.toLowerCase();
const freshProgress = () => ({ xp: 0, level: 0, food: 0.5, water: 0.7, health: 1, x: null, z: null, h: 0, coins: 0, udder: 0, bottles: 0, inventory: [] });
// admins: users.role = 'admin' in the database, or listed in the ADMIN_USERS environment variable
const isAdmin = (user) => !!user && (user.role === 'admin' || ADMIN_USERS.includes(user._id));
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((res, rej) => crypto.scrypt(pw, salt, 32, (e, k) => (e ? rej(e) : res({ salt, hash: k.toString('hex') }))));
}
async function checkPassword(pw, stored) {
  const { hash } = await hashPassword(pw, stored.salt);
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(stored.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function newSession(username) {
  const db = await getDb();
  const token = crypto.randomBytes(24).toString('hex');
  const now = new Date();
  await db.sessions.put({ _id: token, username, createdAt: now, expiresAt: new Date(now.getTime() + SESSION_TTL * 1000) });
  await db.users.update(idOf(username), { lastLoginAt: now });
  return token;
}
// -> { username, user, player } for a valid login token
async function userFromToken(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) return null;
  const db = await getDb();
  const sess = await db.sessions.get(token);
  if (!sess || (sess.expiresAt && sess.expiresAt < new Date())) return null; // MongoDB's TTL sweep runs once a minute
  const [user, player] = await Promise.all([db.users.get(idOf(sess.username)), db.players.get(idOf(sess.username))]);
  return user && player ? { username: user.username, user, player } : null;
}
const publicProfile = (pl) => ({ username: pl.username, name: pl.name, look: pl.look, xp: pl.xp, level: levelOf(pl.xp || 0) });

// write a logged-in player's current progress into their account
async function saveProfile(p) {
  if (!p.user) return;
  try {
    const db = await getDb();
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const xp = Math.round(p.xp * 10) / 10;
    await db.players.update(idOf(p.user), {
      name: p.name, look: p.look, level: levelOf(xp), xp,
      coins: p.coins, udder: Math.round(p.udder * 100) / 100, bottles: Math.round(p.bottles * 100) / 100, inventory: p.inventory,
      food: r3(p.food), water: r3(p.water), health: r3(p.health),
      // after dying the next session starts at the spawn meadow again
      x: p.posReset ? null : r3(p.x), z: p.posReset ? null : r3(p.z), h: r3(p.h),
      updatedAt: new Date(),
    });
    p.saveDirty = false;
  } catch (e) { console.error('save failed for', p.user, e.message); }
}

module.exports = { idOf, freshProgress, isAdmin, hashPassword, checkPassword, newSession, userFromToken, publicProfile, saveProfile };
