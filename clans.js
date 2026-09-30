// Clans: create / join / manage. Members are teammates (headbutts between them do nothing).
// Everything is stored through the same key-value store as accounts:
//   clan:<id>            -> clan record
//   clanname:<lower>     -> id   (unique names)
//   clantag:<lower>      -> id   (unique tags)
//   clans:index          -> [id, ...]
//   user:<name>.clanId   -> id   (the account's clan)
const crypto = require('crypto');

const MAX_MEMBERS = 20;
const NAME_RE = /^[\p{L}\p{N} ]{3,20}$/u;
const TAG_RE = /^[A-Z0-9]{2,4}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const ROLE_RANK = { leader: 3, officer: 2, member: 1 };

function createClans({ store, userKey, levelOf, onlineUsers, notify }) {
  // one mutation at a time (single server process) so read-modify-write stays consistent
  let chain = Promise.resolve();
  const locked = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

  const getClan = (id) => (id ? store.get(`clan:${id}`) : null);
  const saveClan = (c) => store.set(`clan:${c.id}`, c);
  const index = async () => (await store.get('clans:index')) || [];
  const pub = (c) => (c ? { id: c.id, tag: c.tag, color: c.color, name: c.name } : null);
  const memberOf = (c, u) => c.members.find((m) => m.u.toLowerCase() === u.toLowerCase());

  async function setUserClan(username, clanId) {
    const u = await store.get(userKey(username));
    if (!u) return;
    u.clanId = clanId || null;
    await store.set(userKey(username), u);
  }

  // detailed view for the manager tab
  async function detail(c, viewer) {
    const online = onlineUsers();
    const members = [];
    for (const m of c.members) {
      const u = await store.get(userKey(m.u));
      members.push({ u: m.u, name: u ? u.profile.name : m.u, role: m.role, level: u ? levelOf(u.profile.xp || 0) : 0, online: online.has(m.u.toLowerCase()), joined: m.joined });
    }
    members.sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || b.level - a.level);
    const me = memberOf(c, viewer);
    return {
      id: c.id, name: c.name, tag: c.tag, color: c.color, desc: c.desc, open: c.open, created: c.created,
      members, myRole: me ? me.role : null, max: MAX_MEMBERS,
      requests: me && ROLE_RANK[me.role] >= 2 ? c.requests.map((r) => ({ u: r.u, at: r.at })) : [],
    };
  }

  async function disband(c) {
    for (const m of c.members) await setUserClan(m.u, null);
    await store.del(`clan:${c.id}`);
    await store.del(`clanname:${c.name.toLowerCase()}`);
    await store.del(`clantag:${c.tag.toLowerCase()}`);
    await store.set('clans:index', (await index()).filter((id) => id !== c.id));
    notify(c.members.map((m) => m.u), null, c.id);
  }

  const err = (code, error) => ({ code, json: { error } });
  const ok = (json) => ({ code: 200, json });

  // route: '/api/clan/<action>'; auth = { username, user } (logged-in players only)
  async function handle(action, auth, body) {
    const me = auth.username;
    if (action === 'list') {
      const ids = await index();
      const out = [];
      for (const id of ids) {
        const c = await getClan(id);
        if (!c) continue;
        out.push({ id: c.id, name: c.name, tag: c.tag, color: c.color, desc: c.desc, open: c.open, count: c.members.length, max: MAX_MEMBERS,
          leader: (c.members.find((m) => m.role === 'leader') || {}).u, requested: c.requests.some((r) => r.u.toLowerCase() === me.toLowerCase()) });
      }
      out.sort((a, b) => b.count - a.count);
      return ok({ clans: out, myClan: auth.user.clanId || null });
    }
    if (action === 'mine') {
      const c = await getClan(auth.user.clanId);
      return ok({ clan: c ? await detail(c, me) : null });
    }

    return locked(async () => {
      const user = await store.get(userKey(me)); // fresh copy inside the lock
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
          if (await store.get(`clanname:${name.toLowerCase()}`)) return err(409, 'Tên clan đã có người dùng.');
          if (await store.get(`clantag:${tag.toLowerCase()}`)) return err(409, 'Tag đã có clan khác dùng.');
          const c = {
            id: crypto.randomBytes(6).toString('hex'), name, tag,
            color: HEX.test(body.color) ? body.color.toLowerCase() : '#e8b83a',
            desc: String(body.desc || '').replace(/[<>]/g, '').trim().slice(0, 120), open: body.open !== false,
            created: Date.now(), members: [{ u: user.username, role: 'leader', joined: Date.now() }], requests: [],
          };
          await saveClan(c);
          await store.set(`clanname:${name.toLowerCase()}`, c.id);
          await store.set(`clantag:${tag.toLowerCase()}`, c.id);
          await store.set('clans:index', [...(await index()), c.id]);
          await setUserClan(user.username, c.id);
          notify([user.username], pub(c), c.id);
          return ok({ clan: await detail(c, me) });
        }
        case 'join': {
          if (my) return err(400, 'Bạn đang ở trong một clan rồi.');
          const c = await getClan(String(body.id || ''));
          if (!c) return err(404, 'Clan không tồn tại.');
          if (c.members.length >= MAX_MEMBERS) return err(400, 'Clan đã đủ người.');
          if (c.open) {
            c.members.push({ u: user.username, role: 'member', joined: Date.now() });
            c.requests = c.requests.filter((r) => r.u.toLowerCase() !== me.toLowerCase());
            await saveClan(c);
            await setUserClan(user.username, c.id);
            notify(c.members.map((m) => m.u), pub(c), c.id);
            return ok({ clan: await detail(c, me), joined: true });
          }
          if (!c.requests.some((r) => r.u.toLowerCase() === me.toLowerCase())) {
            c.requests.push({ u: user.username, at: Date.now() });
            c.requests = c.requests.slice(-30);
            await saveClan(c);
            notify(c.members.filter((m) => m.role !== 'member').map((m) => m.u), undefined, c.id);
          }
          return ok({ requested: true });
        }
        case 'cancel': {
          const c = await getClan(String(body.id || ''));
          if (c) { c.requests = c.requests.filter((r) => r.u.toLowerCase() !== me.toLowerCase()); await saveClan(c); }
          return ok({ requested: false });
        }
        case 'leave': {
          if (!my) return err(400, 'Bạn chưa có clan.');
          const others = my.members.filter((m) => m.u.toLowerCase() !== me.toLowerCase());
          if (!others.length) { await disband(my); return ok({ clan: null, disbanded: true }); }
          if (myRole === 'leader') {
            // hand the clan to the most senior officer, else the oldest member
            const heir = others.find((m) => m.role === 'officer') || others.slice().sort((a, b) => a.joined - b.joined)[0];
            heir.role = 'leader';
          }
          my.members = others;
          await saveClan(my);
          await setUserClan(user.username, null);
          notify([user.username], null, my.id);
          notify(my.members.map((m) => m.u), pub(my), my.id);
          return ok({ clan: null });
        }
        case 'disband': {
          if (myRole !== 'leader') return err(403, 'Chỉ trưởng clan mới giải tán được.');
          await disband(my);
          return ok({ clan: null, disbanded: true });
        }
        case 'approve': case 'reject': {
          if (!my || ROLE_RANK[myRole] < 2) return err(403, 'Bạn không có quyền duyệt.');
          const req = my.requests.find((r) => r.u.toLowerCase() === target.toLowerCase());
          if (!req) return err(404, 'Không tìm thấy đơn xin vào.');
          my.requests = my.requests.filter((r) => r !== req);
          if (action === 'approve') {
            const cand = await store.get(userKey(req.u));
            if (!cand) { await saveClan(my); return err(404, 'Tài khoản không còn tồn tại.'); }
            if (cand.clanId) { await saveClan(my); return err(400, 'Người này đã vào clan khác.'); }
            if (my.members.length >= MAX_MEMBERS) { await saveClan(my); return err(400, 'Clan đã đủ người.'); }
            my.members.push({ u: cand.username, role: 'member', joined: Date.now() });
            await saveClan(my);
            await setUserClan(cand.username, my.id);
            notify(my.members.map((m) => m.u), pub(my), my.id);
          } else await saveClan(my);
          return ok({ clan: await detail(my, me) });
        }
        case 'kick': case 'promote': case 'demote': case 'transfer': {
          if (!my) return err(400, 'Bạn chưa có clan.');
          const m = memberOf(my, target);
          if (!m) return err(404, 'Không phải thành viên của clan.');
          if (m.u.toLowerCase() === me.toLowerCase()) return err(400, 'Không thể tự làm việc này với chính mình.');
          if (action === 'kick') {
            if (ROLE_RANK[myRole] < 2 || ROLE_RANK[m.role] >= ROLE_RANK[myRole]) return err(403, 'Bạn không có quyền kick người này.');
            my.members = my.members.filter((x) => x !== m);
            await saveClan(my);
            await setUserClan(m.u, null);
            notify([m.u], null, my.id);
            notify(my.members.map((x) => x.u), pub(my), my.id);
          } else {
            if (myRole !== 'leader') return err(403, 'Chỉ trưởng clan mới làm được.');
            if (action === 'promote') m.role = 'officer';
            if (action === 'demote') m.role = 'member';
            if (action === 'transfer') { m.role = 'leader'; memberOf(my, me).role = 'officer'; }
            await saveClan(my);
            notify(my.members.map((x) => x.u), pub(my), my.id);
          }
          return ok({ clan: await detail(my, me) });
        }
        case 'update': {
          if (myRole !== 'leader') return err(403, 'Chỉ trưởng clan mới sửa được.');
          if (typeof body.desc === 'string') my.desc = body.desc.replace(/[<>]/g, '').trim().slice(0, 120);
          if (typeof body.open === 'boolean') my.open = body.open;
          if (HEX.test(body.color || '')) my.color = body.color.toLowerCase();
          await saveClan(my);
          notify(my.members.map((x) => x.u), pub(my), my.id);
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
      const user = await store.get(userKey(username));
      if (!user) return { error: 'Tài khoản không tồn tại.' };
      if (user.clanId) return { error: 'Bạn đang ở trong một clan rồi.' };
      const c = await getClan(clanId);
      if (!c) return { error: 'Clan không còn tồn tại.' };
      if (c.members.length >= MAX_MEMBERS) return { error: 'Clan đã đủ người.' };
      c.members.push({ u: user.username, role: 'member', joined: Date.now() });
      c.requests = c.requests.filter((r) => r.u.toLowerCase() !== username.toLowerCase());
      await saveClan(c);
      await setUserClan(user.username, c.id);
      notify(c.members.map((m) => m.u), pub(c), c.id);
      return { clan: pub(c) };
    });
  }

  return { handle, getClan, pub, roleOf, acceptInvite, MAX_MEMBERS };
}

module.exports = { createClans };
