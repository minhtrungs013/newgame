// JSON API: /api/register, /api/login, /api/logout, /api/me and /api/clan/<action>.
const { getDb } = require('./db');
const { USER_RE } = require('./config');
const { readBody, sendJson } = require('./http-util');
const { idOf, freshProgress, isAdmin, hashPassword, checkPassword, newSession, userFromToken, publicProfile } = require('./accounts');
const { handleAdmin } = require('./admin');
const eco = require('./economy');

// brute-force protection for login/register: 20 attempts / 10 min / IP
const authHits = new Map();
function rateLimited(ip) {
  const now = Date.now(), e = authHits.get(ip) || { n: 0, t: now };
  if (now - e.t > 600000) { e.n = 0; e.t = now; }
  e.n++; authHits.set(ip, e);
  return e.n > 20;
}

// game = the running game (clan manager, online players)
async function handleApi(req, res, url, game) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (url.startsWith('/api/clan/')) {
    const auth = await userFromToken((req.headers.authorization || '').replace(/^Bearer /, ''));
    if (!auth) return sendJson(res, 401, { error: 'Cần đăng nhập để dùng clan.' });
    const body = req.method === 'POST' ? await readBody(req) : {};
    if (!body) return sendJson(res, 400, { error: 'Dữ liệu không hợp lệ.' });
    const r = await game.clans.handle(url.slice('/api/clan/'.length), auth, body);
    return sendJson(res, r.code, r.json);
  }
  if (url.startsWith('/api/admin/')) {
    const auth = await userFromToken((req.headers.authorization || '').replace(/^Bearer /, ''));
    if (!auth || !isAdmin(auth.user)) return sendJson(res, 403, { error: 'Chỉ admin mới dùng được.' });
    const body = req.method === 'POST' ? await readBody(req, 8192) : {};
    if (!body) return sendJson(res, 400, { error: 'Dữ liệu không hợp lệ.' });
    const r = await handleAdmin(url.slice('/api/admin/'.length), auth, body, game);
    return sendJson(res, r.code, r.json);
  }
  // shop window: anyone may look (buying happens in the game, at the counter)
  if (url === '/api/shop' && req.method === 'GET') return sendJson(res, 200, { items: await eco.shopItems(), milkPrice: await eco.getMilkPrice() });
  if (url === '/api/me' && req.method === 'GET') {
    const auth = await userFromToken((req.headers.authorization || '').replace(/^Bearer /, ''));
    return auth ? sendJson(res, 200, { ...publicProfile(auth.player), admin: isAdmin(auth.user) }) : sendJson(res, 401, { error: 'Phiên đăng nhập đã hết hạn.' });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
  const body = await readBody(req);
  if (!body) return sendJson(res, 400, { error: 'Dữ liệu không hợp lệ.' });
  if (url === '/api/logout') {
    if (typeof body.token === 'string' && /^[a-f0-9]{48}$/.test(body.token)) await (await getDb()).sessions.del(body.token);
    return sendJson(res, 200, { ok: true });
  }
  if (rateLimited(ip)) return sendJson(res, 429, { error: 'Thử quá nhiều lần, đợi vài phút nhé.' });
  const username = String(body.username || '').trim(), password = String(body.password || '');
  if (!USER_RE.test(username)) return sendJson(res, 400, { error: 'Tên đăng nhập 3–16 ký tự: chữ không dấu, số, dấu _' });
  if (password.length < 6 || password.length > 100) return sendJson(res, 400, { error: 'Mật khẩu cần ít nhất 6 ký tự.' });
  const db = await getDb();
  const id = idOf(username);
  if (url === '/api/register') {
    if (await db.users.get(id)) return sendJson(res, 409, { error: 'Tên đăng nhập đã có người dùng.' });
    const now = new Date();
    await db.users.put({ _id: id, username, password: await hashPassword(password), clanId: null, createdAt: now, lastLoginAt: null });
    const player = { _id: id, username, name: username, look: null, ...freshProgress(), updatedAt: now };
    await db.players.put(player);
    console.log(`* new account: ${username}`);
    return sendJson(res, 200, { token: await newSession(username), ...publicProfile(player) });
  }
  if (url === '/api/login') {
    const user = await db.users.get(id);
    if (!user || !(await checkPassword(password, user.password))) return sendJson(res, 401, { error: 'Sai tên đăng nhập hoặc mật khẩu.' });
    let player = await db.players.get(id);
    if (!player) { player = { _id: id, username: user.username, name: user.username, look: null, ...freshProgress(), updatedAt: new Date() }; await db.players.put(player); }
    return sendJson(res, 200, { token: await newSession(user.username), ...publicProfile(player) });
  }
  return sendJson(res, 404, { error: 'Not found' });
}

module.exports = { handleApi };
