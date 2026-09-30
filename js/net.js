import * as THREE from 'three';
import { Cow } from './cow.js';
import { heightAt } from './terrain.js';

const SEND_HZ = 12;

function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Floating HTML label (name + chat bubble) that follows a cow on screen.
export class NameTag {
  constructor(container, name, self = false) {
    this.el = document.createElement('div');
    this.el.className = 'nametag' + (self ? ' self' : '');
    this.bubble = document.createElement('div');
    this.bubble.className = 'bubble';
    this.label = document.createElement('div');
    this.label.className = 'name';
    this.label.textContent = name;
    this.el.append(this.bubble, this.label);
    container.appendChild(this.el);
    this.bubbleTimer = 0;
  }
  say(text, seconds = 5) {
    this.bubble.textContent = text;
    this.bubble.classList.add('show');
    this.bubbleTimer = seconds;
  }
  update(dt, worldPos, camera, maxDist = 70) {
    if (this.bubbleTimer > 0) {
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0) this.bubble.classList.remove('show');
    }
    const d = camera.position.distanceTo(worldPos);
    const v = worldPos.clone().project(camera);
    if (v.z > 1 || d > maxDist || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) {
      this.el.style.display = 'none';
      return;
    }
    this.el.style.display = '';
    const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
    const s = THREE.MathUtils.clamp(9 / d, 0.6, 1.1);
    this.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${s.toFixed(3)})`;
    this.el.style.opacity = String(THREE.MathUtils.clamp((maxDist - d) / 15, 0, 1));
  }
  dispose() { this.el.remove(); }
}

class Remote {
  constructor(scene, tags, p) {
    this.id = p.id;
    this.name = p.name;
    this.cow = new Cow(scene, { look: p.look, coat: p.coat, seed: p.id * 7 + 3, age: p.a ?? 1 });
    this.cow.pos.set(p.x, heightAt(p.x, p.z), p.z);
    this.cow.heading = p.h;
    this.target = { x: p.x, z: p.z, h: p.h, sp: p.sp || 0, g: p.g || 0, a: p.a ?? 1, l: p.l || 0 };
    this.cow.lying = !!p.l;
    if (p.l) this.cow.lie = 1;
    this.tag = new NameTag(tags, p.name);
    this.labelPos = new THREE.Vector3();
  }
  update(dt, camera) {
    const c = this.cow, t = this.target;
    const dx = t.x - c.pos.x, dz = t.z - c.pos.z;
    if (dx * dx + dz * dz > 400) { c.pos.x = t.x; c.pos.z = t.z; }
    else {
      // follow the latest snapshot, with a little extrapolation along the heading
      const k = Math.min(1, dt * 8);
      c.pos.x += dx * k + Math.sin(t.h) * t.sp * dt * 0.5;
      c.pos.z += dz * k + Math.cos(t.h) * t.sp * dt * 0.5;
    }
    c.heading += angleDiff(c.heading, t.h) * Math.min(1, dt * 10);
    c.speed += (t.sp - c.speed) * Math.min(1, dt * 8);
    c.grazeTimer = t.g > 0.5 ? 0.5 : 0;
    c.lying = t.l > 0.5;
    // grow / shrink smoothly towards the age the owner reports
    if (Math.abs(t.a - c.age) > 0.001) c.setAge(c.age + (t.a - c.age) * Math.min(1, dt * 3));
    c.updatePhysics(dt); // jump arcs are simulated locally from 'act' events

    const hx = Math.sin(c.heading), hz = Math.cos(c.heading);
    const hF = heightAt(c.pos.x + hx * 0.9, c.pos.z + hz * 0.9);
    const hB = heightAt(c.pos.x - hx * 0.9, c.pos.z - hz * 0.9);
    c.pos.y = (hF + hB) * 0.5;
    c.root.position.copy(c.pos);
    c.root.position.y += c.air;
    c.root.rotation.y = c.heading;
    c.root.rotation.x += (-Math.atan2(hF - hB, 1.8) - c.root.rotation.x) * Math.min(1, dt * 6);
    // skip animation work for far-away cows
    if (camera.position.distanceToSquared(c.pos) < 150 * 150) c.animate(dt, t.sp > 3);
    this.labelPos.set(c.pos.x, c.pos.y + c.air + (2.0 - 0.5 * c.lie) * c.size, c.pos.z);
    this.tag.update(dt, this.labelPos, camera);
  }
  dispose() { this.cow.dispose(); this.tag.dispose(); }
}

export class Net {
  constructor(scene, tagsContainer, handlers) {
    this.scene = scene;
    this.tags = tagsContainer;
    this.h = handlers;
    this.remotes = new Map();
    this.id = null;
    this.connected = false;
    this.ws = null;
    this.sendTimer = 0;
    this.lastSent = '';
    this.retryDelay = 1500;
  }

  get online() { return this.connected ? this.remotes.size + 1 : 1; }

  connect(name, look) {
    this.name = name;
    this.look = look;
    if (location.protocol === 'file:') { this.h.onStatus('offline'); return; }
    this._open();
  }

  _open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try { ws = new WebSocket(`${proto}://${location.host}/ws`); }
    catch { return this._retry(); }
    this.ws = ws;
    this.h.onStatus('connecting');
    ws.onopen = () => {
      this.retryDelay = 1500;
      ws.send(JSON.stringify({ t: 'hello', name: this.name, look: this.look }));
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      this._message(m);
    };
    ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      this.id = null;
      for (const r of this.remotes.values()) r.dispose();
      this.remotes.clear();
      this.h.onStatus('offline');
      if (was) this.h.onSystem('Mất kết nối server, đang thử lại…');
      this._retry();
    };
  }

  _retry() {
    setTimeout(() => this._open(), this.retryDelay);
    this.retryDelay = Math.min(15000, this.retryDelay * 1.6);
  }

  send(obj) {
    if (this.connected && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  _add(p) {
    if (p.id === this.id || this.remotes.has(p.id)) return;
    this.remotes.set(p.id, new Remote(this.scene, this.tags, p));
  }

  _message(m) {
    switch (m.t) {
      case 'welcome':
        this.id = m.id;
        this.connected = true;
        for (const p of m.players) this._add(p);
        this.h.onWelcome(m);
        this.h.onStatus('online');
        this.h.onAnnounce(m.announce || null, true);
        break;
      case 'join':
        this._add(m.p);
        this.h.onSystem(`${m.p.name} đã vào đồng cỏ 🐄`);
        break;
      case 'leave': {
        const r = this.remotes.get(m.id);
        if (r) { this.h.onSystem(`${r.name} đã rời đi`); r.dispose(); this.remotes.delete(m.id); }
        break;
      }
      case 'snap':
        for (const [id, x, z, h, sp, g, a, l] of m.ps) {
          const r = this.remotes.get(id);
          if (r) Object.assign(r.target, { x, z, h, sp, g, a: a ?? r.target.a, l: l ?? 0 });
        }
        break;
      case 'moo': {
        const r = this.remotes.get(m.id);
        if (r) this.h.onRemoteMoo(r);
        break;
      }
      case 'chat': {
        const r = this.remotes.get(m.id);
        this.h.onChat(m.name, m.text, r || null, m.id === this.id);
        break;
      }
      case 'env':
        this.h.onEnv(m);
        break;
      case 'act': {
        const r = this.remotes.get(m.id);
        if (r) this.h.onRemoteAct(r, m.a);
        break;
      }
      case 'hit': {
        // we got headbutted
        const r = this.remotes.get(m.from);
        this.h.onHit(r || null, m.dx, m.dz, m.age, m.p ?? 1);
        break;
      }
      case 'hitfx': {
        // someone else got headbutted (effects only; their position arrives via snapshots)
        const a = this.remotes.get(m.from), b = this.remotes.get(m.to);
        if (b) this.h.onRemoteHit(a || null, b);
        break;
      }
      case 'announce':
        // admin banner shown to everyone (text null = removed)
        this.h.onAnnounce(m.text ? m : null, false);
        break;
      case 'sys':
        this.h.onSystem(m.text);
        break;
      case 'full':
        this.h.onSystem('Server đã đầy người chơi.');
        break;
    }
  }

  update(dt, cow, camera) {
    for (const r of this.remotes.values()) r.update(dt, camera);
    if (!this.connected) return;
    this.sendTimer -= dt;
    if (this.sendTimer > 0) return;
    this.sendTimer = 1 / SEND_HZ;
    const msg = {
      t: 's',
      x: +cow.pos.x.toFixed(2), z: +cow.pos.z.toFixed(2),
      h: +(((cow.heading % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)).toFixed(3),
      sp: +cow.speed.toFixed(2), g: cow.graze > 0.5 ? 1 : 0, a: +cow.age.toFixed(3), l: cow.lying ? 1 : 0,
    };
    const key = `${msg.x},${msg.z},${msg.h},${msg.sp},${msg.g},${msg.a},${msg.l}`;
    if (key === this.lastSent) return;
    this.lastSent = key;
    this.send(msg);
  }
}
