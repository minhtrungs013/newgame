// Admin API (/api/admin/<action>): milk price, shop items, transactions, players.
// Only accounts that isAdmin() accepts get here - checked on every request.
const crypto = require('crypto');
const { getDb } = require('./db');
const { levelOf } = require('./config');
const eco = require('./economy');

const err = (code, error) => ({ code, json: { error } });
const ok = (json) => ({ code: 200, json });
const text = (v, max) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const intOr = (v, def, lo, hi) => (v === '' || v === null || v === undefined ? def : Number.isInteger(+v) && +v >= lo && +v <= hi ? +v : NaN);
const dateOr = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? undefined : d; };

// full item view for the admin table
const adminItem = (it) => ({
  id: it._id, icon: it.icon, name: it.name, desc: it.desc, price: it.price, stock: it.stock ?? null, sold: it.sold || 0,
  startAt: it.startAt || null, endAt: it.endAt || null, active: !!it.active, onSale: eco.isOnSale(it),
  createdBy: it.createdBy, createdAt: it.createdAt, updatedAt: it.updatedAt || null,
});

// game: { broadcastPrice, liveStats } from game.js
async function handleAdmin(action, auth, body, game) {
  const db = await getDb();
  switch (action) {
    case 'overview':
      return ok({ milkPrice: await eco.getMilkPrice() });

    case 'price': {
      const price = Number(body.milkPrice);
      if (!Number.isFinite(price) || price < 0 || price > 100000) return err(400, 'Giá sữa phải là số từ 0 đến 100000.');
      const p = await eco.setMilkPrice(Math.round(price * 100) / 100, auth.username);
      game.broadcastPrice(p);
      console.log(`$ milk price set to ${p} by ${auth.username}`);
      return ok({ milkPrice: p });
    }

    case 'items': {
      const all = await db.shop_items.find({}, { sort: { createdAt: -1 } });
      return ok({ items: all.map(adminItem) });
    }
    case 'item-save': {
      const name = text(body.name, 40), icon = text(body.icon, 8) || '🎁', desc = text(body.desc, 200);
      const price = intOr(body.price, NaN, 1, 10000000);
      const stock = intOr(body.stock, null, 0, 1000000);
      const startAt = dateOr(body.startAt), endAt = dateOr(body.endAt);
      if (!name) return err(400, 'Cần nhập tên vật phẩm.');
      if (Number.isNaN(price)) return err(400, 'Giá phải là số nguyên từ 1 đến 10.000.000.');
      if (Number.isNaN(stock)) return err(400, 'Số lượng phải là số nguyên ≥ 0 (để trống = không giới hạn).');
      if (startAt === undefined || endAt === undefined) return err(400, 'Ngày không hợp lệ.');
      if (startAt && endAt && endAt <= startAt) return err(400, 'Ngày kết thúc phải sau ngày bắt đầu.');
      const now = new Date();
      const fields = { icon, name, desc, price, stock, startAt, endAt, active: body.active !== false, updatedAt: now };
      if (body.id) {
        const it = await db.shop_items.get(String(body.id));
        if (!it) return err(404, 'Không tìm thấy vật phẩm.');
        await db.shop_items.update(it._id, fields);
        return ok({ item: adminItem({ ...it, ...fields }) });
      }
      const it = { _id: crypto.randomBytes(6).toString('hex'), ...fields, sold: 0, createdBy: auth.username, createdAt: now };
      await db.shop_items.put(it);
      console.log(`$ shop item "${name}" added by ${auth.username}`);
      return ok({ item: adminItem(it) });
    }
    case 'item-delete': {
      const it = await db.shop_items.get(String(body.id || ''));
      if (!it) return err(404, 'Không tìm thấy vật phẩm.');
      await db.shop_items.del(it._id); // bought copies stay in players' bags (name / icon are copied)
      return ok({ deleted: true });
    }

    case 'transactions': {
      const q = {};
      if (body.user) q.username = text(body.user, 16);
      if (body.type) q.type = text(body.type, 20);
      const list = await db.transactions.find(q, { sort: { at: -1 }, limit: 200 });
      return ok({ transactions: list.map((t) => ({ ...t, id: t._id, _id: undefined })) });
    }

    case 'players': {
      const live = game.liveStats();
      const list = await db.players.find({}, { sort: { updatedAt: -1 }, limit: 500 });
      return ok({
        players: list.map((pl) => {
          const l = live.get(pl._id);
          const xp = l ? l.xp : pl.xp || 0;
          return {
            username: pl.username, name: pl.name, level: levelOf(xp), online: !!l,
            coins: l ? l.coins : pl.coins || 0, udder: l ? l.udder : pl.udder || 0, bottles: l ? l.bottles : pl.bottles || 0,
            items: (l ? l.inventory : pl.inventory || []).reduce((n, x) => n + (x.qty || 0), 0), updatedAt: pl.updatedAt,
            flags: l ? l.flags : 0, // suspicious actions this session
          };
        }),
      });
    }
  }
  return err(404, 'Unknown action');
}

module.exports = { handleAdmin };
