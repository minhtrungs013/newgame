// Cheating: clear violations get a warning; enough of them in a short time bans the account,
// for longer each time (10 min, 1 h, 6 h, 1 day, 7 days, 30 days). Bans live on the users doc:
//   users.ban = { until, reason, at, minutes } | null, users.banCount, users.banHistory[]
const { getDb } = require('./db');
const { BAN_STEPS_MIN } = require('./config');

const REASONS = {
  speed: 'Di chuyển quá nhanh / dịch chuyển tức thời',
  xp: 'Khai báo XP / level không hợp lệ',
  stats: 'Tự chỉnh thanh no / nước',
};

const activeBan = (user) => (user && user.ban && new Date(user.ban.until) > new Date() ? user.ban : null);
const when = (d) => new Date(d).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
const banText = (ban) => `Tài khoản bị khóa đến ${when(ban.until)} vì: ${ban.reason}.`;

async function ban(username, reason) {
  const db = await getDb();
  const id = username.toLowerCase();
  const u = await db.users.get(id);
  if (!u) return null;
  const count = (u.banCount || 0) + 1;
  const minutes = BAN_STEPS_MIN[Math.min(count, BAN_STEPS_MIN.length) - 1];
  const at = new Date(), until = new Date(at.getTime() + minutes * 60000);
  const entry = { at, until, minutes, reason };
  await db.users.update(id, { ban: entry, banCount: count, banHistory: [...(u.banHistory || []), entry].slice(-20) });
  console.log(`## banned ${username} for ${minutes} min (#${count}): ${reason}`);
  return { ...entry, count };
}

async function unban(username, by) {
  const db = await getDb();
  const ok = await db.users.update(username.toLowerCase(), { ban: null });
  if (ok) console.log(`## ${username} unbanned by ${by}`);
  return ok;
}

module.exports = { REASONS, activeBan, banText, ban, unban };
