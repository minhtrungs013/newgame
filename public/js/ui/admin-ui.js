// Admin tab (Esc menu, admins only): milk price, shop items, transactions, players.
// Every action is checked again on the server (/api/admin/*).

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const btn = (text, cls, fn) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; };
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString('vi-VN');
const when = (d) => (d ? new Date(d).toLocaleString('vi-VN') : '');
const dateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const TX_LABEL = { sell_milk: '🥛 Bán sữa', buy: '🛒 Mua đồ', death_loss: '💀 Chết rớt xu' };

export class AdminPanel {
  // getToken(): login token, toast(text)
  constructor(root, { getToken, toast }) {
    this.root = root;
    this.getToken = getToken;
    this.toast = toast;
    this.tab = 'price';
    this.editing = null; // item being edited (or {} for a new one)
  }

  async api(action, body = {}) {
    const r = await fetch(`/api/admin/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.getToken() || ''}` }, body: JSON.stringify(body),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error || 'Lỗi server');
    return json;
  }

  refresh() { this.render(); }

  async render() {
    const tabs = el('div', 'ad-tabs');
    for (const [k, label] of [['price', '💲 Giá sữa'], ['items', '📦 Vật phẩm'], ['tx', '📋 Giao dịch'], ['players', '👥 Người chơi']]) {
      tabs.append(btn(label, `ad-tab${this.tab === k ? ' sel' : ''}`, () => { this.tab = k; this.editing = null; this.render(); }));
    }
    const body = el('div', 'ad-body');
    body.append(el('p', 'mk-note', 'Đang tải…'));
    this.root.replaceChildren(tabs, body);
    try {
      if (this.tab === 'price') await this._price(body);
      else if (this.tab === 'items') await this._items(body);
      else if (this.tab === 'tx') await this._tx(body);
      else await this._players(body);
    } catch (e) { body.replaceChildren(el('p', 'c-error', e.message)); }
  }

  async _price(body) {
    const { milkPrice } = await this.api('overview');
    const input = el('input'); input.type = 'number'; input.min = '0'; input.step = '0.5'; input.value = milkPrice;
    const row = el('div', 'ad-row');
    row.append(el('label', '', 'Giá thu mua sữa (🪙 / lít)'), input, btn('Lưu', 'c-btn c-primary', async () => {
      try { const r = await this.api('price', { milkPrice: Number(input.value) }); this.toast(`Đã đặt giá sữa: ${r.milkPrice} 🪙/lít`); } catch (e) { this.toast(e.message); }
    }));
    body.replaceChildren(row, el('p', 'mk-note', 'Giá mới áp dụng ngay cho mọi người chơi và hiện trên bảng giá ở chợ.'));
  }

  async _items(body) {
    if (this.editing) return this._itemForm(body, this.editing);
    const { items } = await this.api('items');
    const top = el('div', 'ad-row');
    top.append(btn('+ Thêm vật phẩm', 'c-btn c-primary', () => { this.editing = { active: true }; this.render(); }));
    const table = el('table', 'ad-table');
    const hr = el('tr');
    for (const h of ['', 'Tên', 'Giá', 'Đã bán / Kho', 'Thời gian', 'Trạng thái', '']) hr.append(el('th', '', h));
    table.append(hr);
    for (const it of items) {
      const tr = el('tr');
      const state = !it.active ? 'Ẩn' : it.onSale ? 'Đang bán' : 'Ngoài thời gian bán';
      tr.append(el('td', 'ad-icon', it.icon), el('td', '', it.name), el('td', '', `${fmt(it.price)} 🪙`),
        el('td', '', `${it.sold} / ${it.stock === null ? '∞' : it.stock}`),
        el('td', '', [it.startAt && `từ ${dateInput(it.startAt)}`, it.endAt && `đến ${dateInput(it.endAt)}`].filter(Boolean).join(' ') || '—'),
        el('td', '', state));
      const act = el('td', 'ad-actions');
      act.append(btn('Sửa', 'c-btn c-small', () => { this.editing = it; this.render(); }),
        btn(it.active ? 'Ẩn' : 'Hiện', 'c-btn c-small', async () => {
          try { await this.api('item-save', { ...it, active: !it.active }); this.render(); } catch (e) { this.toast(e.message); }
        }),
        btn('Xoá', 'c-btn c-small c-danger', async () => {
          if (!confirm(`Xoá "${it.name}"? Đồ người chơi đã mua vẫn còn trong túi.`)) return;
          try { await this.api('item-delete', { id: it.id }); this.render(); } catch (e) { this.toast(e.message); }
        }));
      tr.append(act);
      table.append(tr);
    }
    body.replaceChildren(top, items.length ? table : el('p', 'mk-note', 'Chưa có vật phẩm nào.'));
  }

  _itemForm(body, it) {
    const form = el('div', 'ad-form');
    const field = (label, input) => { const r = el('label', 'ad-field'); r.append(el('span', '', label), input); form.append(r); return input; };
    const inp = (type, value, attrs = {}) => { const i = el('input'); i.type = type; i.value = value ?? ''; Object.assign(i, attrs); return i; };
    const icon = field('Icon (emoji)', inp('text', it.icon || '🎁', { maxLength: 8 }));
    const name = field('Tên', inp('text', it.name, { maxLength: 40 }));
    const price = field('Giá (🪙)', inp('number', it.price, { min: 1, step: 1 }));
    const stock = field('Số lượng (trống = không giới hạn)', inp('number', it.stock ?? '', { min: 0, step: 1 }));
    const start = field('Bán từ ngày', inp('date', dateInput(it.startAt)));
    const end = field('Bán đến ngày', inp('date', dateInput(it.endAt)));
    const desc = field('Mô tả', el('textarea')); desc.maxLength = 200; desc.value = it.desc || '';
    const active = inp('checkbox', ''); active.checked = it.active !== false;
    field('Hiện trong cửa hàng', active);
    const row = el('div', 'ad-row');
    row.append(btn('Lưu', 'c-btn c-primary', async () => {
      try {
        await this.api('item-save', {
          id: it.id, icon: icon.value, name: name.value, price: price.value, stock: stock.value, desc: desc.value,
          startAt: start.value || null, endAt: end.value ? `${end.value}T23:59:59` : null, active: active.checked,
        });
        this.toast(it.id ? 'Đã lưu vật phẩm' : 'Đã thêm vật phẩm');
        this.editing = null; this.render();
      } catch (e) { this.toast(e.message); }
    }), btn('Huỷ', 'c-btn', () => { this.editing = null; this.render(); }));
    body.replaceChildren(el('h4', '', it.id ? `Sửa: ${it.name}` : 'Thêm vật phẩm'), form, row);
  }

  async _tx(body) {
    const user = el('input'); user.placeholder = 'Lọc theo tên đăng nhập'; user.value = this.txUser || '';
    const type = el('select');
    for (const [v, l] of [['', 'Tất cả'], ...Object.entries(TX_LABEL)]) { const o = el('option', '', l); o.value = v; type.append(o); }
    type.value = this.txType || '';
    const row = el('div', 'ad-row');
    row.append(user, type, btn('Lọc', 'c-btn', () => { this.txUser = user.value.trim(); this.txType = type.value; this.render(); }));
    const { transactions } = await this.api('transactions', { user: this.txUser || '', type: this.txType || '' });
    const table = el('table', 'ad-table');
    const hr = el('tr');
    for (const h of ['Thời gian', 'Người chơi', 'Loại', 'Xu', 'Số dư', 'Chi tiết']) hr.append(el('th', '', h));
    table.append(hr);
    for (const t of transactions) {
      const tr = el('tr');
      const detail = t.type === 'sell_milk' ? `${fmt(t.liters)} L × ${t.price}` : t.type === 'buy' ? t.itemName : t.type === 'death_loss' ? `mất ${fmt(t.liters || 0)} L sữa` : '';
      tr.append(el('td', '', when(t.at)), el('td', '', t.username), el('td', '', TX_LABEL[t.type] || t.type),
        el('td', t.coins >= 0 ? 'ad-plus' : 'ad-minus', `${t.coins >= 0 ? '+' : ''}${fmt(t.coins)}`), el('td', '', fmt(t.balanceAfter)), el('td', '', detail));
      table.append(tr);
    }
    body.replaceChildren(row, transactions.length ? table : el('p', 'mk-note', 'Chưa có giao dịch.'), el('p', 'mk-note', 'Hiện 200 giao dịch gần nhất.'));
  }

  async _players(body) {
    const { players } = await this.api('players');
    const table = el('table', 'ad-table');
    const hr = el('tr');
    for (const h of ['Người chơi', 'Lv', '🪙 Xu', '🥛 Bầu vú', '🍼 Bình', '🎒 Đồ', 'Online']) hr.append(el('th', '', h));
    table.append(hr);
    for (const p of players) {
      const tr = el('tr');
      tr.append(el('td', '', p.name === p.username ? p.username : `${p.name} (${p.username})`), el('td', '', p.level), el('td', '', fmt(p.coins)),
        el('td', '', `${fmt(p.udder)} L`), el('td', '', `${fmt(p.bottles)} L`), el('td', '', p.items), el('td', '', p.online ? '🟢' : ''));
      table.append(tr);
    }
    body.replaceChildren(table);
  }
}
