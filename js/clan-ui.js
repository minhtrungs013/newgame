// Clan manager tab (inside the Esc menu). All data comes from /api/clan/* (logged-in only).
const COLORS = ['#e8b83a', '#e8663a', '#e84a6a', '#b85ae8', '#5a7ae8', '#3ab8e8', '#3ae8a0', '#8ae83a', '#f0f0f0'];
const ROLE_LABEL = { leader: '👑 Trưởng clan', officer: '⭐ Phó clan', member: 'Thành viên' };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const btn = (text, cls, onClick) => {
  const b = el('button', cls || 'c-btn', text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};

export class ClanPanel {
  /** opts: { root, getToken(), getUsername(), toast(text) } */
  constructor(opts) {
    this.root = opts.root;
    this.getToken = opts.getToken;
    this.getUsername = opts.getUsername;
    this.toast = opts.toast;
    this.busy = false;
  }

  async call(action, body) {
    const token = this.getToken();
    const res = await fetch(`/api/clan/${action}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Lỗi ${res.status}`);
    return j;
  }

  // run an action, show errors, then re-render
  async act(action, body, okText) {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.call(action, body);
      if (okText) this.toast(okText);
    } catch (e) { this.toast(`⚠️ ${e.message}`); }
    this.busy = false;
    await this.refresh();
  }

  async refresh() {
    const root = this.root;
    if (!this.getToken()) {
      root.replaceChildren(el('div', 'c-empty', 'Đăng nhập tài khoản (ở màn hình đầu) để tạo hoặc tham gia clan.'));
      return;
    }
    root.replaceChildren(el('div', 'c-empty', 'Đang tải…'));
    try {
      const { clan } = await this.call('mine');
      if (clan) this.renderClan(clan);
      else this.renderNoClan((await this.call('list')).clans);
    } catch (e) {
      root.replaceChildren(el('div', 'c-empty', `⚠️ ${e.message}`));
    }
  }

  // ---------- not in a clan: create one or browse ----------
  renderNoClan(list) {
    const wrap = el('div', 'c-grid');

    const create = el('section', 'c-card');
    create.append(el('h3', null, 'Tạo clan mới'));
    const name = el('input', 'c-input'); name.placeholder = 'Tên clan (3–20 ký tự)'; name.maxLength = 20;
    const tag = el('input', 'c-input c-tag-input'); tag.placeholder = 'TAG'; tag.maxLength = 4;
    tag.addEventListener('input', () => { tag.value = tag.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    const desc = el('input', 'c-input'); desc.placeholder = 'Mô tả ngắn (không bắt buộc)'; desc.maxLength = 120;
    let color = COLORS[0];
    const sw = el('div', 'c-swatches');
    for (const c of COLORS) {
      const s = btn('', 'c-swatch', () => { color = c; for (const o of sw.children) o.classList.toggle('sel', o === s); });
      s.style.background = c;
      if (c === color) s.classList.add('sel');
      sw.append(s);
    }
    const openLbl = el('label', 'c-check');
    const open = el('input'); open.type = 'checkbox'; open.checked = true;
    openLbl.append(open, ' Ai cũng vào được (bỏ chọn = phải duyệt)');
    const row = el('div', 'c-row'); row.append(name, tag);
    create.append(row, desc, el('div', 'c-label', 'Màu clan'), sw, openLbl,
      btn('Tạo clan', 'c-btn c-primary', () => this.act('create', { name: name.value, tag: tag.value, desc: desc.value, color, open: open.checked }, '🎉 Đã tạo clan!')));

    const browse = el('section', 'c-card');
    browse.append(el('h3', null, `Các clan (${list.length})`));
    if (!list.length) browse.append(el('div', 'c-empty', 'Chưa có clan nào - hãy là người đầu tiên!'));
    const ul = el('div', 'c-list');
    for (const c of list) {
      const item = el('div', 'c-item');
      const head = el('div', 'c-item-head');
      const t = el('b', 'c-tagpill', c.tag); t.style.background = c.color;
      head.append(t, el('span', 'c-item-name', c.name), el('span', 'c-muted', `${c.count}/${c.max} · ${c.open ? 'mở' : 'cần duyệt'}`));
      item.append(head);
      if (c.desc) item.append(el('div', 'c-muted', c.desc));
      const full = c.count >= c.max;
      if (c.requested) item.append(btn('Huỷ đơn xin vào', 'c-btn', () => this.act('cancel', { id: c.id }, 'Đã huỷ đơn.')));
      else item.append(btn(full ? 'Đã đủ người' : c.open ? 'Vào clan' : 'Xin vào', 'c-btn c-primary', () => {
        if (!full) this.act('join', { id: c.id }, c.open ? `Đã vào clan ${c.tag}!` : 'Đã gửi đơn, chờ trưởng/phó clan duyệt.');
      }));
      ul.append(item);
    }
    browse.append(ul);
    wrap.append(create, browse);
    this.root.replaceChildren(wrap);
  }

  // ---------- in a clan: roster & management ----------
  renderClan(c) {
    const role = c.myRole, isLeader = role === 'leader', isOfficer = role === 'officer';
    const wrap = el('div', 'c-grid');

    const info = el('section', 'c-card');
    const head = el('div', 'c-clan-head');
    const t = el('b', 'c-tagpill c-big', c.tag); t.style.background = c.color;
    const titles = el('div');
    titles.append(el('h3', null, c.name), el('div', 'c-muted', `${c.members.length}/${c.max} thành viên · ${c.open ? 'ai cũng vào được' : 'cần duyệt'} · Bạn: ${ROLE_LABEL[role]}`));
    head.append(t, titles);
    info.append(head);
    if (c.desc) info.append(el('p', 'c-desc', c.desc));
    info.append(el('div', 'c-hint', 'Đồng đội cùng clan húc nhau không mất máu. Chat riêng clan: gõ /c <tin nhắn>.'));

    if (isLeader) {
      const set = el('div', 'c-settings');
      set.append(el('div', 'c-label', 'Cài đặt clan'));
      const desc = el('input', 'c-input'); desc.value = c.desc; desc.maxLength = 120; desc.placeholder = 'Mô tả';
      const sw = el('div', 'c-swatches');
      let color = c.color;
      for (const col of COLORS) {
        const s = btn('', 'c-swatch', () => { color = col; for (const o of sw.children) o.classList.toggle('sel', o === s); });
        s.style.background = col;
        if (col === c.color) s.classList.add('sel');
        sw.append(s);
      }
      const openLbl = el('label', 'c-check');
      const open = el('input'); open.type = 'checkbox'; open.checked = c.open;
      openLbl.append(open, ' Ai cũng vào được');
      set.append(desc, sw, openLbl, btn('Lưu cài đặt', 'c-btn c-primary', () => this.act('update', { desc: desc.value, color, open: open.checked }, 'Đã lưu.')));
      info.append(set);
    }

    const actions = el('div', 'c-actions');
    actions.append(btn('Rời clan', 'c-btn c-danger', () => {
      if (confirm(isLeader && c.members.length > 1 ? 'Rời clan? Quyền trưởng clan sẽ được chuyển cho người khác.' : 'Rời clan?')) this.act('leave', {}, 'Đã rời clan.');
    }));
    if (isLeader) actions.append(btn('Giải tán clan', 'c-btn c-danger', () => {
      if (confirm(`Giải tán clan ${c.tag}? Mọi thành viên sẽ rời clan.`)) this.act('disband', {}, 'Đã giải tán clan.');
    }));
    info.append(actions);

    const roster = el('section', 'c-card');
    if (c.requests.length) {
      roster.append(el('h3', null, `Đơn xin vào (${c.requests.length})`));
      for (const r of c.requests) {
        const row = el('div', 'c-member');
        row.append(el('span', 'c-member-name', r.u),
          btn('Duyệt', 'c-btn c-primary c-small', () => this.act('approve', { username: r.u }, `Đã nhận ${r.u}.`)),
          btn('Từ chối', 'c-btn c-small', () => this.act('reject', { username: r.u })));
        roster.append(row);
      }
    }
    roster.append(el('h3', null, 'Thành viên'));
    for (const m of c.members) {
      const row = el('div', 'c-member');
      const dot = el('i', `c-dot ${m.online ? 'on' : ''}`);
      dot.title = m.online ? 'Đang online' : 'Offline';
      const nm = el('span', 'c-member-name', m.name);
      if (m.name.toLowerCase() !== m.u.toLowerCase()) nm.append(el('span', 'c-muted', ` (${m.u})`));
      row.append(dot, nm, el('span', 'c-role', ROLE_LABEL[m.role]), el('span', 'c-level', `Lv ${m.level}`));
      const others = el('span', 'c-member-actions');
      const isMe = m.u.toLowerCase() === (this.getUsername() || '').toLowerCase();
      if (isMe) nm.append(el('span', 'c-you', ' (bạn)'));
      if (!isMe && m.role !== 'leader') {
        if (isLeader) {
          if (m.role === 'member') others.append(btn('Phong phó', 'c-btn c-small', () => this.act('promote', { username: m.u })));
          else others.append(btn('Hạ chức', 'c-btn c-small', () => this.act('demote', { username: m.u })));
          others.append(btn('Chuyển trưởng', 'c-btn c-small', () => {
            if (confirm(`Chuyển quyền trưởng clan cho ${m.name}? Bạn sẽ thành phó clan.`)) this.act('transfer', { username: m.u }, 'Đã chuyển quyền.');
          }));
        }
        if (isLeader || (isOfficer && m.role === 'member')) others.append(btn('Kick', 'c-btn c-small c-danger', () => {
          if (confirm(`Kick ${m.name} khỏi clan?`)) this.act('kick', { username: m.u }, `Đã kick ${m.name}.`);
        }));
      }
      row.append(others);
      roster.append(row);
    }
    wrap.append(info, roster);
    this.root.replaceChildren(wrap);
  }
}
