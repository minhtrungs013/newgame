import * as THREE from 'three';
import { pondsNear, waterAt, heightAt } from './terrain.js';

// ---------------------------------------------------------------------------
// Crocodiles lurking in the ponds. Every client simulates the crocs around it;
// a croc only ever bites the local cow (other players' deaths arrive as events).
// ---------------------------------------------------------------------------

const STALK_AT = 5;      // danger level at which a croc starts coming for you
const CALM_AT = 2;       // danger level below which it gives up
const LUNGE_RANGE = 3.0; // metres between croc snout and cow when it lunges
const BITE_RANGE = 2.6;

function seeded(seed) {
  let s = seed | 0;
  return () => {
    s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function buildCroc(materials) {
  const { skin, belly, tooth, eye, pupil } = materials;
  const root = new THREE.Group();
  const M = (geo, mat, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const body = new THREE.Group();
  root.add(body);
  // flattened torso + pale belly
  M(new THREE.SphereGeometry(1, 20, 12), skin, body).scale.set(0.42, 0.22, 1.05);
  M(new THREE.SphereGeometry(1, 16, 10), belly, body, 0, -0.07, 0).scale.set(0.38, 0.15, 0.95);
  // armoured back: rows of scutes
  const scute = new THREE.ConeGeometry(0.05, 0.1, 4);
  for (let i = 0; i < 9; i++) {
    const z = -0.8 + i * 0.2;
    for (const x of [-0.13, 0.13]) M(scute, skin, body, x, 0.2 - Math.abs(z) * 0.05, z);
  }
  // stubby splayed legs
  const leg = new THREE.CylinderGeometry(0.06, 0.07, 0.3, 6);
  const legs = [];
  for (const [x, z] of [[0.38, 0.55], [-0.38, 0.55], [0.38, -0.55], [-0.38, -0.55]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, -0.05, z);
    pivot.rotation.z = x > 0 ? -1.1 : 1.1;
    body.add(pivot);
    M(leg, skin, pivot, 0, -0.15, 0);
    legs.push(pivot);
  }
  // head: upper jaw (with eyes & nostrils) and hinged lower jaw
  const head = new THREE.Group();
  head.position.set(0, 0.02, 1.0);
  body.add(head);
  M(new THREE.SphereGeometry(1, 16, 10), skin, head, 0, 0.02, 0.05).scale.set(0.24, 0.13, 0.24);
  const upper = new THREE.Group();
  head.add(upper);
  M(new THREE.SphereGeometry(1, 16, 10), skin, upper, 0, 0.02, 0.45).scale.set(0.16, 0.075, 0.45);
  const lowerPivot = new THREE.Group();
  lowerPivot.position.set(0, -0.03, 0.05);
  head.add(lowerPivot);
  M(new THREE.SphereGeometry(1, 16, 10), belly, lowerPivot, 0, -0.03, 0.4).scale.set(0.15, 0.05, 0.43);
  const toothGeo = new THREE.ConeGeometry(0.012, 0.05, 4);
  for (let i = 0; i < 7; i++) {
    const z = 0.12 + i * 0.1, x = 0.14 - i * 0.012;
    for (const s of [1, -1]) {
      const tu = M(toothGeo, tooth, upper, s * x, -0.03, z); tu.rotation.x = Math.PI;
      M(toothGeo, tooth, lowerPivot, s * (x - 0.01), 0.02, z);
    }
  }
  for (const s of [1, -1]) {
    const bump = M(new THREE.SphereGeometry(0.06, 10, 8), skin, head, s * 0.1, 0.14, 0.05);
    bump.scale.y = 0.8;
    M(new THREE.SphereGeometry(0.035, 10, 8), eye, head, s * 0.1, 0.17, 0.08);
    M(new THREE.SphereGeometry(0.016, 8, 6), pupil, head, s * 0.1, 0.18, 0.11).scale.set(0.35, 1, 0.6);
    M(new THREE.SphereGeometry(0.02, 6, 5), skin, upper, s * 0.04, 0.09, 0.86);
  }
  // tail: tapering chain of segments
  const tail = [];
  let parent = new THREE.Group();
  parent.position.set(0, 0, -0.95);
  body.add(parent);
  for (let i = 0; i < 7; i++) {
    const seg = new THREE.Group();
    seg.position.z = i === 0 ? 0 : -0.26;
    parent.add(seg);
    const r = 0.2 * (1 - i / 8);
    M(new THREE.SphereGeometry(1, 10, 8), skin, seg, 0, 0, -0.13).scale.set(r, r * 0.6, 0.18);
    if (i < 5) M(scute, skin, seg, 0, r * 0.6, -0.13);
    tail.push(seg);
    parent = seg;
  }
  return { root, body, lowerPivot, tail, legs };
}

export class Crocs {
  constructor(scene) {
    this.scene = scene;
    this.crocs = new Map(); // key -> croc
    this.materials = {
      skin: new THREE.MeshStandardMaterial({ color: 0x3a4526, roughness: 0.75, flatShading: true }),
      belly: new THREE.MeshStandardMaterial({ color: 0x8a8660, roughness: 0.8 }),
      tooth: new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.4 }),
      eye: new THREE.MeshStandardMaterial({ color: 0xd8b830, roughness: 0.2, emissive: 0x2a2000 }),
      pupil: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.2 }),
    };
    this._cellKey = null;
    this.danger = 0;
    this.hunter = null; // croc currently stalking / attacking the local cow
  }

  _spawnFor(p) {
    const n = p.R > 16 ? 2 : 1;
    const rnd = seeded(p.id * 7919 + 13);
    for (let i = 0; i < n; i++) {
      const key = `${p.id}:${i}`;
      if (this.crocs.has(key)) continue;
      const parts = buildCroc(this.materials);
      const a = rnd() * Math.PI * 2, r = rnd() * p.R * 0.4;
      const c = {
        key, pond: p, ...parts,
        pos: new THREE.Vector3(p.x + Math.cos(a) * r, p.level, p.z + Math.sin(a) * r),
        heading: rnd() * Math.PI * 2, speed: 0, state: 'lurk', t: 0, attackT: 0, jaw: 0,
        wander: null, phase: rnd() * 10, bitten: false, target: null, remote: false,
      };
      this.scene.add(c.root);
      this.crocs.set(key, c);
    }
  }

  // keep crocs only for ponds around the player
  _stream(px, pz) {
    const key = `${Math.round(px / 50)},${Math.round(pz / 50)}`;
    if (key === this._cellKey) return;
    this._cellKey = key;
    const keep = new Set();
    for (const p of pondsNear(px, pz, 2)) {
      if (Math.hypot(p.x - px, p.z - pz) > 260) continue;
      this._spawnFor(p);
      for (const k of this.crocs.keys()) if (k.startsWith(`${p.id}:`)) keep.add(k);
    }
    for (const [k, c] of this.crocs) {
      if (keep.has(k)) continue;
      this.scene.remove(c.root);
      c.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      if (this.hunter === c) this.hunter = null;
      this.crocs.delete(k);
    }
  }

  _snout(c, out) {
    return out.set(c.pos.x + Math.sin(c.heading) * 1.7, c.pos.y, c.pos.z + Math.cos(c.heading) * 1.7);
  }

  // swim towards (tx, tz) but never leave water that is at least `minDepth` deep
  _swimTo(c, tx, tz, speed, dt, minDepth = 0.25) {
    const dx = tx - c.pos.x, dz = tz - c.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) { c.speed *= 0.9; return d; }
    const want = Math.atan2(dx, dz);
    let diff = want - c.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    c.heading += THREE.MathUtils.clamp(diff, -2.2 * dt, 2.2 * dt);
    c.speed += (speed - c.speed) * Math.min(1, dt * 2);
    const nx = c.pos.x + Math.sin(c.heading) * c.speed * dt, nz = c.pos.z + Math.cos(c.heading) * c.speed * dt;
    const w = waterAt(nx, nz);
    if (w && w.depth >= minDepth) { c.pos.x = nx; c.pos.z = nz; } else c.speed *= 0.5;
    return d;
  }

  _randomWaterPoint(c) {
    const p = c.pond;
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * p.R * 0.9;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      const w = waterAt(x, z);
      if (w && w.depth > 0.7) return new THREE.Vector2(x, z);
    }
    return new THREE.Vector2(p.x, p.z);
  }

  // a croc near `pos` lunges at a *remote* cow (visual only - that player's own client handles the death)
  attackAt(pos) {
    let best = null, bd = 30;
    for (const c of this.crocs.values()) {
      const d = c.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return;
    best.state = 'attack'; best.attackT = 0; best.remote = true; best.bitten = true;
    best.heading = Math.atan2(pos.x - best.pos.x, pos.z - best.pos.z);
  }

  /**
   * ctx: { cow, alive, drinking, nearShore, onBite(croc), onStalk(croc) }
   * returns { danger, stalking }
   */
  update(dt, time, ctx) {
    const cow = ctx.cow;
    this._stream(cow.pos.x, cow.pos.z);

    // danger builds up while drinking / loitering on the shore (not while the ponds are frozen)
    const exposed = ctx.alive && !ctx.frozen && (ctx.drinking || ctx.nearShore);
    this.danger = Math.max(0, this.danger + dt * (ctx.drinking ? 1 : ctx.nearShore ? 0.45 : -1.5));
    if (!ctx.alive) this.danger = 0;

    // pick the hunter: closest croc of the pond the cow is next to
    if (!this.hunter && exposed && this.danger > STALK_AT) {
      let best = null, bd = Infinity;
      for (const c of this.crocs.values()) {
        if (c.state === 'attack') continue;
        const d = Math.hypot(c.pos.x - cow.pos.x, c.pos.z - cow.pos.z);
        if (d < c.pond.R * 1.8 && d < bd) { bd = d; best = c; }
      }
      if (best) { this.hunter = best; best.state = 'stalk'; if (ctx.onStalk) ctx.onStalk(best); }
    }
    if (this.hunter && this.hunter.state === 'stalk' && (!exposed || this.danger < CALM_AT)) {
      this.hunter.state = 'lurk'; this.hunter = null;
    }

    const snout = new THREE.Vector3();
    for (const c of this.crocs.values()) {
      c.t += dt;
      const p = c.pond;
      let targetY = p.level - (ctx.frozen ? 0.6 : 0.09); // just the eyes and back break the surface (deep under the ice in winter)
      if (c.state === 'lurk') {
        if (!c.wander || Math.hypot(c.wander.x - c.pos.x, c.wander.y - c.pos.z) < 1 || c.t > 12) {
          c.wander = this._randomWaterPoint(c); c.t = 0;
        }
        this._swimTo(c, c.wander.x, c.wander.y, 0.45, dt, 0.5);
      } else if (c.state === 'stalk') {
        this._swimTo(c, cow.pos.x, cow.pos.z, 2.4, dt, 0.18);
        this._snout(c, snout);
        if (Math.hypot(snout.x - cow.pos.x, snout.z - cow.pos.z) < LUNGE_RANGE * Math.max(0.7, cow.size)) {
          c.state = 'attack'; c.attackT = 0; c.bitten = false; c.remote = false;
        }
      } else if (c.state === 'attack') {
        c.attackT += dt;
        const a = c.attackT;
        // lunge forward & up out of the water, jaws open... then snap shut
        if (a < 0.45) {
          const nx = c.pos.x + Math.sin(c.heading) * 4.5 * dt, nz = c.pos.z + Math.cos(c.heading) * 4.5 * dt;
          c.pos.x = nx; c.pos.z = nz;
        }
        targetY = p.level + 0.12 * Math.sin(Math.min(1, a / 0.9) * Math.PI);
        c.jaw = a < 0.28 ? a / 0.28 : a < 0.36 ? 1 - (a - 0.28) / 0.08 : 0;
        if (!c.bitten && a >= 0.34) {
          c.bitten = true;
          this._snout(c, snout);
          if (!c.remote && ctx.alive && Math.hypot(snout.x - cow.pos.x, snout.z - cow.pos.z) < BITE_RANGE * Math.max(0.7, cow.size) + 0.6) ctx.onBite(c);
        }
        if (a > 1.6) {
          c.state = 'lurk'; c.remote = false; c.wander = null;
          if (this.hunter === c) this.hunter = null;
          this.danger = 0;
        }
      }
      // stay above the pond floor
      const floor = heightAt(c.pos.x, c.pos.z) + 0.12;
      c.pos.y += (Math.max(targetY, floor) - c.pos.y) * Math.min(1, dt * 4);

      // animation
      c.phase += dt * (1 + c.speed * 2);
      c.root.position.copy(c.pos);
      c.root.rotation.set(c.state === 'attack' ? -0.18 * Math.sin(Math.min(1, c.attackT / 0.5) * Math.PI) : 0, c.heading, 0);
      c.lowerPivot.rotation.x = c.jaw * 0.75;
      const sway = 0.12 + c.speed * 0.12;
      for (let i = 0; i < c.tail.length; i++) c.tail[i].rotation.y = Math.sin(c.phase * 2.2 - i * 0.6) * sway;
      c.body.rotation.y = Math.sin(c.phase * 2.2 + 1) * sway * 0.3;
      for (let i = 0; i < c.legs.length; i++) c.legs[i].rotation.x = Math.sin(c.phase * 3 + i * 1.6) * 0.4 * Math.min(1, c.speed);
    }
    return { danger: this.danger, stalking: !!this.hunter && this.hunter.state !== 'lurk' };
  }
}
