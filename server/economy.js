// Milk & coins: the udder fills while an adult cow is fed and watered, milking in the barn
// moves it into bottles, the market buys it, and the shop sells items for coins.
// Everything that touches coins is decided here on the server (clients only show it).
const crypto = require('crypto');
const { getDb } = require('./db');
const {
  levelOf, MILK_MIN_LEVEL, UDDER_MAX, BOTTLE_L, BOTTLES_MAX, milkRate, MILK_NEED, MILK_TIME,
  DEFAULT_MILK_PRICE, DEATH_COIN_LOSS, inBarn, nearCounter,
} = require('./config');

const CAPACITY = BOTTLE_L * BOTTLES_MAX;
const r2 = (v) => Math.round(v * 100) / 100;

// one money operation at a time (single server process) so balances / stock stay consistent
let chain = Promise.resolve();
const locked = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

// ---------- settings (milk price) ----------
let milkPrice = null;
async function getMilkPrice() {
  if (milkPrice === null) {
    const s = await (await getDb()).settings.get('economy');
    milkPrice = s && typeof s.milkPrice === 'number' ? s.milkPrice : DEFAULT_MILK_PRICE;
  }
  return milkPrice;
}
async function setMilkPrice(price, by) {
  milkPrice = price;
  await (await getDb()).settings.put({ _id: 'economy', milkPrice: price, updatedBy: by, updatedAt: new Date() });
  return price;
}

async function logTx(p, type, fields) {
  try {
    await (await getDb()).transactions.put({
      _id: crypto.randomBytes(8).toString('hex'), username: p.user, type, balanceAfter: p.coins, at: new Date(), ...fields,
    });
  } catch (e) { console.error('transaction log failed', e.message); }
}

// player fields from the saved profile (or a fresh guest)
function loadInto(p, saved) {
  p.coins = Math.max(0, Math.floor(saved?.coins || 0));
  p.udder = Math.min(UDDER_MAX, Math.max(0, saved?.udder || 0));
  p.bottles = Math.min(CAPACITY, Math.max(0, saved?.bottles || 0));
  p.inventory = Array.isArray(saved?.inventory) ? saved.inventory : [];
}
const wallet = (p) => ({ udder: r2(p.udder), bottles: r2(p.bottles), coins: p.coins });
const ecoMsg = (p) => ({ t: 'eco', ...wallet(p) });

// called every second for each player
function produce(p, dt) {
  if (p.dead || p.udder >= UDDER_MAX) return;
  if (p.food <= MILK_NEED || p.water <= MILK_NEED) return;
  p.udder = Math.min(UDDER_MAX, p.udder + dt * milkRate(levelOf(p.xp)));
}

// ---------- barn: milking ----------
// the client plays a 3 s milking animation ('milk-start'), then asks for the milk
function milkStart(p) {
  p.milkT = Date.now();
}
function milk(p) {
  const fail = (text) => ({ ok: false, text });
  if (!p.user) return fail('Đăng nhập để vắt và bán sữa.');
  if (levelOf(p.xp) < MILK_MIN_LEVEL) return fail(`Bò cần đạt Lv ${MILK_MIN_LEVEL} mới có sữa.`);
  if (!inBarn(p.x, p.z, 1)) return fail('Vào trong khu vắt sữa (rào gỗ) mới vắt được.');
  if (!p.milkT || Date.now() - p.milkT < (MILK_TIME - 0.6) * 1000) return fail('Vắt từ từ thôi…');
  p.milkT = 0;
  const room = CAPACITY - p.bottles;
  if (room < 0.05) return fail('Các bình đã đầy, mang ra chợ bán nhé!');
  if (p.udder < 1) return fail('Chưa có đủ sữa (cần ít nhất 1 lít).');
  const amount = r2(Math.min(p.udder, room));
  p.udder = r2(p.udder - amount);
  p.bottles = r2(p.bottles + amount);
  p.saveDirty = true;
  return { ok: true, amount };
}

// ---------- market: selling milk ----------
function sell(p) {
  return locked(async () => {
    if (!p.user) return { ok: false, text: 'Đăng nhập để bán sữa.' };
    if (!nearCounter('milk', p.x, p.z, 4.5)) return { ok: false, text: 'Tới quầy thu mua sữa ở chợ để bán.' };
    if (p.bottles <= 0) return { ok: false, text: 'Bạn chưa có bình sữa nào.' };
    const price = await getMilkPrice();
    const liters = p.bottles;
    const earned = Math.round(liters * price);
    p.coins += earned;
    p.bottles = 0;
    await logTx(p, 'sell_milk', { coins: earned, liters, price });
    return { ok: true, liters, earned };
  });
}

// ---------- death: lose the milk and half the coins ----------
function deathLoss(p) {
  if (p.lossApplied) return null;
  p.lossApplied = true;
  const milkLost = r2(p.udder + p.bottles);
  const coinsLost = p.user ? Math.floor(p.coins * DEATH_COIN_LOSS) : 0;
  p.udder = 0; p.bottles = 0;
  p.coins -= coinsLost;
  if (p.user && (coinsLost || milkLost)) logTx(p, 'death_loss', { coins: -coinsLost, liters: milkLost });
  return { lostMilk: milkLost, lostCoins: coinsLost };
}

// ---------- shop ----------
const isOnSale = (it, now = new Date()) => it.active && (!it.startAt || it.startAt <= now) && (!it.endAt || it.endAt > now);
const pubItem = (it) => ({
  id: it._id, icon: it.icon, name: it.name, desc: it.desc, price: it.price,
  left: it.stock === null || it.stock === undefined ? null : Math.max(0, it.stock - (it.sold || 0)), endAt: it.endAt || null,
});
async function shopItems() {
  const all = await (await getDb()).shop_items.find({ active: true }, { sort: { createdAt: -1 } });
  return all.filter((it) => isOnSale(it)).map(pubItem);
}

function buy(p, itemId) {
  return locked(async () => {
    const fail = (text) => ({ ok: false, text });
    if (!p.user) return fail('Đăng nhập để mua đồ.');
    if (!nearCounter('shop', p.x, p.z, 4.5)) return fail('Tới quầy cửa hàng ở chợ để mua.');
    const db = await getDb();
    const it = typeof itemId === 'string' ? await db.shop_items.get(itemId) : null;
    if (!it || !isOnSale(it)) return fail('Vật phẩm này không còn bán.');
    const left = it.stock === null || it.stock === undefined ? Infinity : it.stock - (it.sold || 0);
    if (left <= 0) return fail('Vật phẩm đã hết hàng.');
    if (p.coins < it.price) return fail(`Còn thiếu ${it.price - p.coins} 🪙.`);
    p.coins -= it.price;
    await db.shop_items.update(it._id, { sold: (it.sold || 0) + 1 });
    const have = p.inventory.find((x) => x.itemId === it._id);
    if (have) have.qty += 1;
    // name / icon are copied so the bag still shows the item if the admin removes it later
    else p.inventory.push({ itemId: it._id, icon: it.icon, name: it.name, qty: 1, boughtAt: new Date() });
    await logTx(p, 'buy', { coins: -it.price, itemId: it._id, itemName: it.name });
    return { ok: true, item: pubItem({ ...it, sold: (it.sold || 0) + 1 }) };
  });
}

module.exports = {
  CAPACITY, getMilkPrice, setMilkPrice, loadInto, wallet, ecoMsg, produce, milkStart, milk, sell, deathLoss,
  shopItems, buy, isOnSale, locked,
};
