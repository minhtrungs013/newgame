// Database: one collection per kind of record, so each can be browsed / monitored on its own.
//
//   users     { _id: 'name' (lower case), username, password: { salt, hash }, clanId, createdAt, lastLoginAt }
//   players   { _id: 'name', username, name, look, level, xp, food, water, health, x, z, h, updatedAt }
//   sessions  { _id: token, username, createdAt, expiresAt }      <- expired ones are deleted automatically
//   clans     { _id: id, name, nameLower, tag, color, desc, open, createdAt,
//               members: [{ username, role, joinedAt }], requests: [{ username, requestedAt }] }
//   shop_items   { _id, icon, name, desc, price, stock (null = unlimited), sold, startAt, endAt, active, createdBy, createdAt, updatedAt }
//   transactions { _id, username, type: sell_milk | buy | death_loss, coins (+/-), balanceAfter, liters, itemId, itemName, at }
//   settings     { _id: 'economy', milkPrice }
//   meta      { _id: 'schema', version, migratedAt }
//
// MONGODB_URI set (MongoDB Atlas, used on Render) -> those collections in <MONGODB_DB>.
// Otherwise -> one JSON file per collection in data/ (local play).
// Data from the old single key-value collection ("kv" / data/store.json) is migrated once
// on start-up; the old data is left untouched as a backup.
const fs = require('fs');
const path = require('path');

const COLLECTIONS = ['users', 'players', 'sessions', 'clans', 'shop_items', 'transactions', 'settings', 'meta'];
const SCHEMA_VERSION = 2;
const matches = (doc, q) => Object.entries(q).every(([k, v]) => doc[k] === v);

// ---------- file backend ----------
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const reviveDates = (k, v) => (typeof v === 'string' && /At$/.test(k) && ISO.test(v) ? new Date(v) : v);

class FileCollection {
  constructor(file) {
    this.file = file;
    this.docs = new Map();
    try { for (const d of JSON.parse(fs.readFileSync(file, 'utf8'), reviveDates)) this.docs.set(d._id, d); } catch {}
  }
  async get(id) { const d = this.docs.get(id); return d ? structuredClone(d) : null; }
  async put(doc) { this.docs.set(doc._id, structuredClone(doc)); this._flush(); }
  async update(id, fields) {
    const d = this.docs.get(id);
    if (!d) return false;
    Object.assign(d, structuredClone(fields)); this._flush();
    return true;
  }
  async del(id) { this.docs.delete(id); this._flush(); }
  async findOne(q) { for (const d of this.docs.values()) if (matches(d, q)) return structuredClone(d); return null; }
  // opts: { sort: { field: 1 | -1 }, limit }
  async find(q = {}, opts = {}) {
    let out = [...this.docs.values()].filter((d) => matches(d, q));
    const [[key, dir] = []] = Object.entries(opts.sort || {});
    if (key) out.sort((a, b) => (a[key] > b[key] ? dir : a[key] < b[key] ? -dir : 0));
    if (opts.limit) out = out.slice(0, opts.limit);
    return out.map((d) => structuredClone(d));
  }
  async count() { return this.docs.size; }
  // write at most once a second, atomically (tmp file + rename)
  _flush() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this._write(); }, 1000);
  }
  _write() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify([...this.docs.values()], null, 1));
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('db write failed:', e.message); }
  }
  async close() { if (this._timer) { clearTimeout(this._timer); this._timer = null; this._write(); } }
}

class FileDb {
  constructor(dir) {
    this.dir = dir;
    this.kind = `files (${path.relative(process.cwd(), dir) || dir}/*.json)`;
    for (const n of COLLECTIONS) this[n] = new FileCollection(path.join(dir, `${n}.json`));
    // sessions expire by themselves in MongoDB; here we sweep them
    setInterval(() => this._sweep(), 60 * 60 * 1000).unref();
  }
  async connect() { this._sweep(); }
  _sweep() {
    const now = Date.now();
    for (const [id, s] of this.sessions.docs) if (s.expiresAt && s.expiresAt.getTime() < now) this.sessions.docs.delete(id);
    this.sessions._flush();
  }
  // old format: data/store.json = { key: { v, exp } }
  legacy() {
    const file = path.join(this.dir, 'store.json');
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Object.entries(data).map(([key, e]) => ({ key, v: e.v, exp: e.exp ? new Date(e.exp) : null }));
    } catch { return []; }
  }
  async close() { for (const n of COLLECTIONS) await this[n].close(); }
}

// ---------- MongoDB backend ----------
class MongoCollection {
  constructor(col) { this.col = col; }
  get(id) { return this.col.findOne({ _id: id }); }
  async put(doc) { await this.col.replaceOne({ _id: doc._id }, doc, { upsert: true }); }
  async update(id, fields) { return (await this.col.updateOne({ _id: id }, { $set: fields })).matchedCount > 0; }
  async del(id) { await this.col.deleteOne({ _id: id }); }
  findOne(q) { return this.col.findOne(q); }
  find(q = {}, opts = {}) {
    let c = this.col.find(q);
    if (opts.sort) c = c.sort(opts.sort);
    if (opts.limit) c = c.limit(opts.limit);
    return c.toArray();
  }
  count() { return this.col.estimatedDocumentCount(); }
}

class MongoDb {
  constructor(uri, dbName) {
    const { MongoClient } = require('mongodb');
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    this.dbName = dbName;
    this.kind = `MongoDB (${dbName})`;
  }
  async connect() {
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    for (const n of COLLECTIONS) this[n] = new MongoCollection(this.db.collection(n));
    await this.db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.db.collection('sessions').createIndex({ username: 1 });
    await this.db.collection('clans').createIndex({ nameLower: 1 }, { unique: true });
    await this.db.collection('clans').createIndex({ tag: 1 }, { unique: true });
    await this.db.collection('users').createIndex({ clanId: 1 });
    await this.db.collection('transactions').createIndex({ at: -1 });
    await this.db.collection('transactions').createIndex({ username: 1, at: -1 });
  }
  // old format: collection "kv" = { _id: key, v, exp }
  async legacy() {
    const docs = await this.db.collection('kv').find({}).toArray();
    return docs.map((d) => ({ key: d._id, v: d.v, exp: d.exp || null }));
  }
  async close() { try { await this.client.close(); } catch {} }
}

// ---------- one-time migration from the key-value layout ----------
async function migrate(db, levelOf) {
  const meta = await db.meta.get('schema');
  if (meta && meta.version >= SCHEMA_VERSION) return;
  const old = await db.legacy();
  const date = (ms) => (ms ? new Date(ms) : null);
  let users = 0, sessions = 0, clans = 0;
  for (const { key, v, exp } of old) {
    if (!v) continue;
    if (key.startsWith('user:')) {
      const id = v.username.toLowerCase(), pr = v.profile || {};
      if (await db.users.get(id)) continue;
      await db.users.put({ _id: id, username: v.username, password: v.pass, clanId: v.clanId || null, createdAt: date(v.created), lastLoginAt: null });
      await db.players.put({
        _id: id, username: v.username, name: pr.name || v.username, look: pr.look || null,
        level: levelOf(pr.xp || 0), xp: pr.xp || 0, food: pr.food ?? 0.5, water: pr.water ?? 0.7, health: pr.health ?? 1,
        x: pr.x ?? null, z: pr.z ?? null, h: pr.h || 0, updatedAt: date(pr.updated || v.created),
      });
      users++;
    } else if (key.startsWith('sess:')) {
      if (exp && exp < new Date()) continue;
      await db.sessions.put({ _id: key.slice(5), username: v, createdAt: null, expiresAt: exp });
      sessions++;
    } else if (key.startsWith('clan:')) {
      await db.clans.put({
        _id: v.id, name: v.name, nameLower: v.name.toLowerCase(), tag: v.tag, color: v.color, desc: v.desc || '', open: v.open !== false,
        createdAt: date(v.created),
        members: (v.members || []).map((m) => ({ username: m.u, role: m.role, joinedAt: date(m.joined) })),
        requests: (v.requests || []).map((r) => ({ username: r.u, requestedAt: date(r.at) })),
      });
      clans++;
    }
  }
  await db.meta.put({ _id: 'schema', version: SCHEMA_VERSION, migratedAt: new Date() });
  if (old.length) console.log(`Migrated old data: ${users} accounts, ${clans} clans, ${sessions} sessions (old data kept as backup)`);
}

async function openDb({ levelOf }) {
  const db = process.env.MONGODB_URI
    ? new MongoDb(process.env.MONGODB_URI, process.env.MONGODB_DB || 'newgame')
    : new FileDb(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  await db.connect();
  await migrate(db, levelOf);
  return db;
}

// one shared connection; connects on first use and retries on the next call if it failed
let dbPromise = null;
function getDb() {
  if (!dbPromise) {
    const { levelOf } = require('./config');
    dbPromise = openDb({ levelOf });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

module.exports = { getDb };
