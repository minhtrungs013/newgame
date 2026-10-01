// Market UI: the milk stall (sell bottles), the shop (buy items with coins) and the bag.
import { UDDER_MAX, BOTTLE_L, BOTTLES_MAX } from '../game/config.js';

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const btn = (text, cls, fn) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };
const fmt = (n) => Math.floor(n).toLocaleString('vi-VN');
const liters = (l) => `${(Math.round(l * 10) / 10).toLocaleString('vi-VN')} L`;
const day = (d) => (d ? new Date(d).toLocaleDateString('vi-VN') : '');

// Modal window for the two counters at the market.
export class MarketDialog {
  // root: the modal element; hooks: { onSell(), onBuy(id), onClose() }
  constructor(root, hooks) {
    this.root = root;
    this.h = hooks;
    this.mode = null; // 'milk' | 'shop'
    this.items = [];
    this.pendingBuy = null;
    root.addEventListener('pointerdown', (e) => { if (e.target === root) this.close(); });
  }
  get open() { return this.mode !== null; }

  show(mode, eco) {
    this.mode = mode;
    this.eco = eco;
    this.root.classList.remove('hidden');
    this.render();
    if (mode === 'shop') this.loadItems();
  }
  close() {
    if (!this.open) return;
    this.mode = null;
    this.pendingBuy = null;
    this.root.classList.add('hidden');
    this.h.onClose?.();
  }
  // wallet changed: redraw only if something shown here changed (the udder ticks every second,
  // and redrawing under the mouse would swallow clicks)
  update(eco) {
    this.eco = eco;
    const key = `${eco.coins}|${eco.bottles}|${eco.milkPrice}|${eco.loggedIn}`;
    if (key === this.shownKey) return;
    if (this.open && !this.pendingBuy) this.render();
  }

  async loadItems() {
    try {
      const r = await (await fetch('/api/shop', { cache: 'no-store' })).json();
      this.items = r.items || [];
    } catch { this.items = []; this.error = 'Không tải được cửa hàng.'; }
    if (this.mode === 'shop') this.render();
  }

  render() {
    const e = this.eco;
    this.shownKey = `${e.coins}|${e.bottles}|${e.milkPrice}|${e.loggedIn}`;
    const card = el('div', 'mk-card');
    const head = el('div', 'mk-head');
    head.append(el('h3', '', this.mode === 'milk' ? '🥛 Quầy thu mua sữa' : '🎁 Cửa hàng'), el('span', 'mk-coins', `🪙 ${fmt(this.eco.coins)}`));
    card.append(head);
    if (this.mode === 'milk') this._milk(card); else this._shop(card);
    const foot = el('div', 'mk-foot');
    foot.append(btn('Đóng (Esc)', 'c-btn', () => this.close()));
    card.append(foot);
    this.root.replaceChildren(card);
  }

  _milk(card) {
    const e = this.eco, price = e.milkPrice ?? 0, earn = Math.round(e.bottles * price);
    const box = el('div', 'mk-milk');
    box.append(
      el('div', 'mk-price', `Giá hiện tại: ${price} 🪙 / lít`),
      el('div', '', `Bạn đang có: ${liters(e.bottles)} (${Math.ceil(e.bottles / 5 - 1e-6)} bình)`),
      el('div', 'mk-earn', `→ Nhận: ${fmt(earn)} 🪙`),
    );
    if (!e.loggedIn) box.append(el('p', 'mk-note', 'Đăng nhập để bán sữa lấy xu.'));
    else if (e.bottles <= 0) box.append(el('p', 'mk-note', 'Chưa có bình sữa nào. Vào chuồng nhấn M để vắt sữa (bò Lv 20+).'));
    card.append(box);
    const sell = btn(`Bán hết · +${fmt(earn)} 🪙`, 'c-btn c-primary mk-sell', () => this.h.onSell());
    sell.disabled = !e.loggedIn || e.bottles <= 0;
    card.append(sell);
  }

  _shop(card) {
    if (this.pendingBuy) {
      const it = this.pendingBuy;
      const box = el('div', 'mk-confirm');
      box.append(el('div', 'mk-big', it.icon), el('p', '', `Mua ${it.name} với ${fmt(it.price)} 🪙?`));
      const row = el('div', 'mk-row');
      row.append(btn('Mua', 'c-btn c-primary', () => { this.h.onBuy(it.id); this.pendingBuy = null; this.render(); }),
        btn('Huỷ', 'c-btn', () => { this.pendingBuy = null; this.render(); }));
      box.append(row);
      card.append(box);
      return;
    }
    card.append(shopGrid(this.items, this.eco, (it) => { this.pendingBuy = it; this.render(); }, true));
    if (!this.eco.loggedIn) card.append(el('p', 'mk-note', 'Đăng nhập để mua đồ.'));
  }

  // after a purchase: refresh stock numbers
  bought() { if (this.mode === 'shop') this.loadItems(); }
}

// item cards; canBuy = standing at the shop counter
export function shopGrid(items, eco, onPick, canBuy) {
  const grid = el('div', 'mk-grid');
  if (!items.length) grid.append(el('p', 'mk-note', 'Cửa hàng chưa có vật phẩm nào.'));
  for (const it of items) {
    const card = el('div', 'mk-item');
    card.append(el('div', 'mk-icon', it.icon), el('div', 'mk-name', it.name));
    if (it.desc) card.append(el('div', 'mk-desc', it.desc));
    const meta = el('div', 'mk-meta');
    if (it.left !== null) meta.append(el('span', '', `Còn ${it.left}`));
    if (it.endAt) meta.append(el('span', '', `đến ${day(it.endAt)}`));
    if (meta.childNodes.length) card.append(meta);
    card.append(el('div', 'mk-cost', `${fmt(it.price)} 🪙`));
    const lack = it.price - eco.coins;
    const b = btn(it.left === 0 ? 'Hết hàng' : lack > 0 ? `Thiếu ${fmt(lack)} 🪙` : 'Mua', 'c-btn c-primary c-small', () => onPick(it));
    b.disabled = !canBuy || !eco.loggedIn || it.left === 0 || lack > 0;
    card.append(b);
    grid.append(card);
  }
  return grid;
}

// Esc menu tab "Cửa hàng": look only (buying happens at the shop counter)
export async function renderShopTab(root, eco) {
  root.replaceChildren(el('p', 'mk-note', 'Đang tải…'));
  let items = [];
  try { items = (await (await fetch('/api/shop', { cache: 'no-store' })).json()).items || []; } catch {}
  const head = el('div', 'mk-head');
  head.append(el('span', 'mk-note', '🏪 Tới quầy cửa hàng ở chợ (nhấn E) để mua.'), el('span', 'mk-coins', `🪙 ${fmt(eco.coins)}`));
  root.replaceChildren(head, shopGrid(items, eco, () => {}, false));
}

// Bag (Tab): milk on hand + what you've bought (keep only, for now)
export function renderBag(root, eco) {
  if (!eco.loggedIn) { root.replaceChildren(el('p', 'mk-note', 'Đăng nhập để có túi đồ, vắt và bán sữa.')); return; }
  const head = el('div', 'mk-head');
  head.append(el('span', 'mk-note', 'Đồ đã mua không mất khi chết · sữa thì có.'), el('span', 'mk-coins', `🪙 ${fmt(eco.coins)}`));

  // milk
  const milk = el('div', 'bag-sec');
  milk.append(el('h3', '', '🥛 Sữa đang có'));
  const cards = el('div', 'bag-milk');
  const card = (label, value, note, frac) => {
    const c = el('div');
    c.append(el('small', '', label), el('b', '', value), el('small', '', note));
    if (frac !== undefined) { const bar = el('div', 'bar'); const i = el('i'); i.style.width = `${Math.round(frac * 100)}%`; bar.append(i); c.append(bar); }
    return c;
  };
  const nb = Math.ceil(eco.bottles / BOTTLE_L - 1e-6);
  cards.append(
    card('Trong bầu vú', `${liters(eco.udder)} / ${UDDER_MAX} L`, 'Vào chuồng 🏠 nhấn M để vắt', eco.udder / UDDER_MAX),
    card('Trong bình', `🍼 ${nb} / ${BOTTLES_MAX} bình · ${liters(eco.bottles)}`, 'Mang ra chợ 🏪 bán', eco.bottles / (BOTTLE_L * BOTTLES_MAX)),
    card('Giá trị nếu bán', `≈ ${fmt(eco.bottles * (eco.milkPrice || 0))} 🪙`, `Giá hiện tại ${eco.milkPrice ?? 0} 🪙 / lít`),
  );
  milk.append(cards);

  // bought items
  const items = el('div', 'bag-sec');
  items.append(el('h3', '', `🎁 Sản phẩm đã mua${eco.inventory.length ? ` (${eco.inventory.reduce((n, x) => n + x.qty, 0)})` : ''}`));
  const list = el('div', 'mk-grid');
  if (!eco.inventory.length) list.append(el('p', 'mk-note', 'Chưa có gì. Bán sữa lấy xu rồi ghé cửa hàng ở chợ nhé!'));
  for (const it of eco.inventory) {
    const c = el('div', 'mk-item');
    c.append(el('div', 'mk-icon', it.icon), el('div', 'mk-name', it.name), el('div', 'mk-meta', `× ${it.qty}`), el('div', 'mk-desc', `Mua ngày ${day(it.boughtAt)}`));
    list.append(c);
  }
  items.append(list);
  root.replaceChildren(head, milk, items);
}
