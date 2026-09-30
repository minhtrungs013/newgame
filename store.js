// Key-value storage for accounts & saved progress.
//  - MONGODB_URI set (e.g. MongoDB Atlas): documents in <MONGODB_DB>.kv  <- use this on Render
//  - otherwise: a JSON file (data/store.json) - fine for local play / a VPS.
// Render's free disk is wiped on every restart, so a file store there loses all accounts.
const fs = require('fs');
const path = require('path');

class FileStore {
  constructor(file) {
    this.file = file;
    this.data = {};
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    this.kind = `file (${path.relative(process.cwd(), file) || file})`;
  }
  async ready() {}
  _live(key) {
    const e = this.data[key];
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) { delete this.data[key]; return null; }
    return e;
  }
  async get(key) { const e = this._live(key); return e ? e.v : null; }
  async set(key, value, ttlSec = 0) {
    this.data[key] = { v: value, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 };
    this._flush();
  }
  async del(key) { delete this.data[key]; this._flush(); }
  // write at most once a second, atomically (tmp file + rename)
  _flush() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this._write(); }, 1000);
  }
  _write() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('store write failed:', e.message); }
  }
  async close() { if (this._timer) { clearTimeout(this._timer); this._timer = null; this._write(); } }
}

// One collection of { _id: key, v: value, exp: Date|null }. A TTL index lets MongoDB
// delete expired login sessions by itself.
class MongoStore {
  constructor(uri, dbName) {
    const { MongoClient } = require('mongodb');
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    this.dbName = dbName;
    this.kind = `MongoDB (${dbName})`;
    this._ready = null;
  }
  ready() {
    if (!this._ready) {
      this._ready = (async () => {
        await this.client.connect();
        this.col = this.client.db(this.dbName).collection('kv');
        await this.col.createIndex({ exp: 1 }, { expireAfterSeconds: 0 });
      })();
      this._ready.catch(() => { this._ready = null; }); // retry on the next call
    }
    return this._ready;
  }
  async get(key) {
    await this.ready();
    const doc = await this.col.findOne({ _id: key });
    if (!doc) return null;
    if (doc.exp && doc.exp < new Date()) return null; // TTL cleanup runs only once a minute
    return doc.v;
  }
  async set(key, value, ttlSec = 0) {
    await this.ready();
    const exp = ttlSec ? new Date(Date.now() + ttlSec * 1000) : null;
    await this.col.updateOne({ _id: key }, { $set: { v: value, exp } }, { upsert: true });
  }
  async del(key) {
    await this.ready();
    await this.col.deleteOne({ _id: key });
  }
  async close() { try { await this.client.close(); } catch {} }
}

function createStore() {
  if (process.env.MONGODB_URI) return new MongoStore(process.env.MONGODB_URI, process.env.MONGODB_DB || 'newgame');
  return new FileStore(process.env.DATA_FILE || path.join(__dirname, 'data', 'store.json'));
}

module.exports = { createStore };
