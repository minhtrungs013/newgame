// Clans: create / join / manage. Members are teammates (headbutts between them do nothing).
// Stored in the "clans" collection (see db.js); each account's clan is users.clanId.
//   clans { _id, name, nameLower, tag, color, desc, open, createdAt,
//           members: [{ username, role, joinedAt }], requests: [{ username, requestedAt }] }
const crypto = require('crypto');

const MAX_MEMBERS = 20;
const NAME_RE = /^[\p{L}\p{N} ]{3,20}$/u;
const TAG_RE = /^[A-Z0-9]{2,4}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const ROLE_RANK = { leader: 3, officer: 2, member: 1 };
const ms = (d) => (d ? new Date(d).getTime() : 0);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

function createClans({ getDb, levelOf, onlineUsers, notify }) {
  // one mutation at a time (single server process) so read-modify-write stays consistent
  let chain = Promise.resolve();
  const locked = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

  const getClan = async (id) => (id ? (await getDb()).clans.get(id) : null);
  const saveClan = async (c) => (await getDb()).clans.put(c);
  const getUser = async (username) => (await getDb()).users.get(username.toLowerCase());
  const pub = (c) => (c ? { id: c._id, tag: c.tag, color: c.color, name: c.name } : null);
  const memberOf = (c, u) => c.members.find((m) => same(m.username, u));
  const usernames = (c) => c.members.map((m) => m.username);

  async function setUserClan(username, clanId) {
    await (await getDb()).users.update(username.toLowerCase(), { clanId: clanId || null });
  }

  // detailed view for the manager tab (field names kept as the client expects them)
  async function detail(c, viewer) {
    const db = await getDb();
    const online = onlineUsers();
    const members = [];
    for (const m of c.members) {
      const pl = await db.players.get(m.username.toLowerCase());
      members.push({ u: m.username, name: pl ? pl.name : m.username, role: m.role, level: pl ? levelOf(pl.xp || 0) : 0, online: online.has(m.username.toLowerCase()), joined: ms(m.joinedAt) });
    }
    members.sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || b.level - a.level);
    const me = memberOf(c, viewer);
    return {
      id: c._id, name: c.name, tag: c.tag, color: c.color, desc: c.desc, open: c.open, created: ms(c.createdAt),
      members, myRole: me ? me.role : null, max: MAX_MEMBERS,
      requests: me && ROLE_RANK[me.role] >= 2 ? c.requests.map((r) => ({ u: r.username, at: ms(r.requestedAt) })) : [],
    };
  }

  async function disband(c) {
    for (const m of c.members) await setUserClan(m.username, null);
    await (await getDb()).clans.del(c._id);
    notify(usernames(c), null, c._id);
  }

  const err = (code, error) => ({ code, json: { error } });
  const ok = (json) => ({ code: 200, json });

  // route: '/api/clan/<action>'; auth = { username, user, player } (logged-in players only)
  async function handle(action, auth, body) {
    const me = auth.username;
    if (action === 'list') {
      const all = await (await getDb()).clans.find({});
      const out = all.map((c) => ({
        id: c._id, name: c.name, tag: c.tag, color: c.color, desc: c.desc, open: c.open, count: c.members.length, max: MAX_MEMBERS,
        leader: (c.members.find((m) => m.role === 'leader') || {}).username,
        requested: c.requests.some((r) => same(r.username, me)),
      }));
      out.sort((a, b) => b.count - a.count);
      return ok({ clans: out, myClan: auth.user.clanId || null });
    }
    if (action === 'mine') {
      const c = await getClan(auth.user.clanId);
      return ok({ clan: c ? await detail(c, me) : null });
    }

    return locked(async () => {
      const db = await getDb();
      const user = await getUser(me); // fresh copy inside the lock
      const my = user && user.clanId ? await getClan(user.clanId) : null;
      const myRole = my ? (memberOf(my, me) || {}).role : null;
      const target = String(body.username || '');

      switch (action) {
        case 'create': {
          if (my) return err(400, 'Bạn đang ở trong một clan rồi.');
          const name = String(body.name || '').trim().replace(/\s+/g, ' ');
          const tag = String(body.tag || '').trim().toUpperCase();
          if (!NAME_RE.test(name)) return err(400, 'Tên clan 3–20 ký tự (chữ, số, khoảng trắng).');
          if (!TAG_RE.test(tag)) return err(400, 'Tag 2–4 ký tự: chữ in hoa không dấu hoặc số.');
          if (await db.clans.findOne({ nameLower: name.toLowerCase() })) return err(409, 'Tên clan đã có người dùng.');
          if (await db.clans.findOne({ tag })) return err(409, 'Tag đã có clan khác dùng.');
          const now = new Date();
          const c = {
            _id: crypto.randomBytes(6).toString('hex'), name, nameLower: name.toLowerCase(), tag,
            color: HEX.test(body.color) ? body.color.toLowerCase() : '#e8b83a',
            desc: String(body.desc || '').replace(/[<>]/g, '').trim().slice(0, 120), open: body.open !== false,
            createdAt: now, members: [{ username: user.username, role: 'leader', joinedAt: now }], requests: [],
          };
          await saveClan(c);
          await setUserClan(user.username, c._id);
          notify([user.username], pub(c), c._id);
          return ok({ clan: await detail(c, me) });
        }
        case 'join': {
          if (my) return err(400, 'Bạn đang ở trong một clan rồi.');
          const c = await getClan(String(body.id || ''));
          if (!c) return err(404, 'Clan không tồn tại.');
          if (c.members.length >= MAX_MEMBERS) return err(400, 'Clan đã đủ người.');
          if (c.open) {
            c.members.push({ username: user.username, role: 'member', joinedAt: new Date() });
            c.requests = c.requests.filter((r) => !same(r.username, me));
            await saveClan(c);
            await setUserClan(user.username, c._id);
            notify(usernames(c), pub(c), c._id);
            return ok({ clan: await detail(c, me), joined: true });
          }
          if (!c.requests.some((r) => same(r.username, me))) {
            c.requests.push({ username: user.username, requestedAt: new Date() });
            c.requests = c.requests.slice(-30);
            await saveClan(c);
            notify(c.members.filter((m) => m.role !== 'member').map((m) => m.username), undefined, c._id);
          }
          return ok({ requested: true });
        }
        case 'cancel': {
          const c = await getClan(String(body.id || ''));
          if (c) { c.requests = c.requests.filter((r) => !same(r.username, me)); await saveClan(c); }
          return ok({ requested: false });
        }
        case 'leave': {
          if (!my) return err(400, 'Bạn chưa có clan.');
          const others = my.members.filter((m) => !same(m.username, me));
          if (!others.length) { await disband(my); return ok({ clan: null, disbanded: true }); }
          if (myRole === 'leader') {
            // hand the clan to the most senior officer, else the oldest member
            const heir = others.find((m) => m.role === 'officer') || others.slice().sort((a, b) => ms(a.joinedAt) - ms(b.joinedAt))[0];
            heir.role = 'leader';
          }
          my.members = others;
          await saveClan(my);
          await setUserClan(user.username, null);
          notify([user.username], null, my._id);
          notify(usernames(my), pub(my), my._id);
          return ok({ clan: null });
        }
        case 'disband': {
          if (myRole !== 'leader') return err(403, 'Chỉ trưởng clan mới giải tán được.');
          await disband(my);
          return ok({ clan: null, disbanded: true });
        }
        case 'approve': case 'reject': {
          if (!my || ROLE_RANK[myRole] < 2) return err(403, 'Bạn không có quyền duyệt.');
          const req = my.requests.find((r) => same(r.username, target));
          if (!req) return err(404, 'Không tìm thấy đơn xin vào.');
          my.requests = my.requests.filter((r) => r !== req);
          if (action === 'approve') {
            const cand = await getUser(req.username);
            if (!cand) { await saveClan(my); return err(404, 'Tài khoản không còn tồn tại.'); }
            if (cand.clanId) { await saveClan(my); return err(400, 'Người này đã vào clan khác.'); }
            if (my.members.length >= MAX_MEMBERS) { await saveClan(my); return err(400, 'Clan đã đủ người.'); }
            my.members.push({ username: cand.username, role: 'member', joinedAt: new Date() });
            await saveClan(my);
            await setUserClan(cand.username, my._id);
            notify(usernames(my), pub(my), my._id);
          } else await saveClan(my);
          return ok({ clan: await detail(my, me) });
        }
        case 'kick': case 'promote': case 'demote': case 'transfer': {
          if (!my) return err(400, 'Bạn chưa có clan.');
          const m = memberOf(my, target);
          if (!m) return err(404, 'Không phải thành viên của clan.');
          if (same(m.username, me)) return err(400, 'Không thể tự làm việc này với chính mình.');
          if (action === 'kick') {
            if (ROLE_RANK[myRole] < 2 || ROLE_RANK[m.role] >= ROLE_RANK[myRole]) return err(403, 'Bạn không có quyền kick người này.');
            my.members = my.members.filter((x) => x !== m);
            await saveClan(my);
            await setUserClan(m.username, null);
            notify([m.username], null, my._id);
            notify(usernames(my), pub(my), my._id);
          } else {
            if (myRole !== 'leader') return err(403, 'Chỉ trưởng clan mới làm được.');
            if (action === 'promote') m.role = 'officer';
            if (action === 'demote') m.role = 'member';
            if (action === 'transfer') { m.role = 'leader'; memberOf(my, me).role = 'officer'; }
            await saveClan(my);
            notify(usernames(my), pub(my), my._id);
          }
          return ok({ clan: await detail(my, me) });
        }
        case 'update': {
          if (myRole !== 'leader') return err(403, 'Chỉ trưởng clan mới sửa được.');
          if (typeof body.desc === 'string') my.desc = body.desc.replace(/[<>]/g, '').trim().slice(0, 120);
          if (typeof body.open === 'boolean') my.open = body.open;
          if (HEX.test(body.color || '')) my.color = body.color.toLowerCase();
          await saveClan(my);
          notify(usernames(my), pub(my), my._id);
          return ok({ clan: await detail(my, me) });
        }
      }
      return err(404, 'Unknown action');
    });
  }

  async function roleOf(username, clanId) {
    const c = await getClan(clanId);
    const m = c && memberOf(c, username);
    return m ? m.role : null;
  }

  // an invited player accepted: join even if the clan is invite-only
  function acceptInvite(username, clanId) {
    return locked(async () => {
      const user = await getUser(username);
      if (!user) return { error: 'Tài khoản không tồn tại.' };
      if (user.clanId) return { error: 'Bạn đang ở trong một clan rồi.' };
      const c = await getClan(clanId);
      if (!c) return { error: 'Clan không còn tồn tại.' };
      if (c.members.length >= MAX_MEMBERS) return { error: 'Clan đã đủ người.' };
      c.members.push({ username: user.username, role: 'member', joinedAt: new Date() });
      c.requests = c.requests.filter((r) => !same(r.username, username));
      await saveClan(c);
      await setUserClan(user.username, c._id);
      notify(usernames(c), pub(c), c._id);
      return { clan: pub(c) };
    });
  }

  return { handle, getClan, pub, roleOf, acceptInvite, MAX_MEMBERS };
}

module.exports = { createClans };
