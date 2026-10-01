import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { BARN, MARKET, COUNTERS, toWorld } from '../game/config.js';

// The farm near the spawn meadow: a fenced milking pen (walk in and press M to milk) and a small market
// with a milk-buying stall and a shop stall, each with a shopkeeper.

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

// sign / board texture with text
function textTexture(lines, { w = 512, h = 160, bg = '#5a3a22', fg = '#fff4d8', border = '#e8d8a8' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = border; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  const lh = h / (lines.length + 0.4);
  lines.forEach((t, i) => { g.font = `bold ${i === 0 ? Math.round(lh * 0.62) : Math.round(lh * 0.5)}px "Segoe UI", "Segoe UI Emoji", sans-serif`; g.fillText(t, w / 2, lh * (i + 0.7)); });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, canvas: c };
}

// a simple shopkeeper (origin at the feet, facing +z)
function makeNPC({ shirt, apron, hat }) {
  const g = new THREE.Group();
  const skin = mat(0xe0b08a), pants = mat(0x3a3a48), dark = mat(0x222018);
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  for (const s of [1, -1]) add(new THREE.CylinderGeometry(0.09, 0.08, 0.8, 8), pants, s * 0.11, 0.4, 0);
  const body = new THREE.Group(); body.position.y = 0.8; g.add(body);
  const addB = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; body.add(o); return o; };
  addB(new THREE.CylinderGeometry(0.2, 0.24, 0.62, 12), mat(shirt), 0, 0.31, 0);
  addB(new THREE.BoxGeometry(0.36, 0.5, 0.02), mat(apron), 0, 0.2, 0.235);
  const arms = [];
  for (const s of [1, -1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.27, 0.56, 0); body.add(arm);
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.55, 8), mat(shirt)); a.position.y = -0.26; arm.add(a);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), skin); hand.position.y = -0.56; arm.add(hand);
    arms.push(arm);
  }
  const head = new THREE.Group(); head.position.y = 0.82; body.add(head);
  const hm = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), skin); hm.castShadow = true; head.add(hm);
  for (const s of [1, -1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), dark); e.position.set(s * 0.06, 0.02, 0.15); head.add(e); }
  if (hat === 'conical') { // nón lá
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.22, 20, 1, true), mat(0xd9c28a, { side: THREE.DoubleSide }));
    h.position.y = 0.2; h.castShadow = true; head.add(h);
  } else { // headscarf
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(hat));
    h.position.y = 0.02; head.add(h);
  }
  return { group: g, body, head, arms };
}

export class Farm {
  constructor(scene, world) {
    this.scene = scene;
    this.colliders = [];
    this.npcs = [];
    this.places = [
      { x: BARN.x, z: BARN.z, icon: '🐄', name: 'Khu vắt sữa' },
      { x: MARKET.x, z: MARKET.z, icon: '🏪', name: 'Chợ' },
    ];
    this._buildBarn();
    this._buildMarket();
    // keep trees / rocks off the farm, stop grass growing through the straw in the pen
    world.reserve(BARN.x, BARN.z, Math.hypot(BARN.w, BARN.d) / 2 + 3);
    world.reserve(MARKET.x, MARKET.z, 9);
    world.addStatic(this.colliders, [{ x: BARN.x, z: BARN.z, r: BARN.d / 2 }]);
  }

  // wall of small circles from (ax,az) to (bx,bz) in barn space, skipping [gapA, gapB] along x
  _wallColliders(base, ax, az, bx, bz, r = 0.25) {
    const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / 0.45);
    for (let i = 0; i <= n; i++) {
      const t = i / n, p = toWorld(base, ax + (bx - ax) * t, az + (bz - az) * t);
      this.colliders.push({ x: p.x, z: p.z, r });
    }
  }

  // Milking pen: an open-air wooden fence (gap at the front), straw on the ground, a few props,
  // and a sign planted by the entrance. Fence posts stand on the ground wherever they are.
  _buildBarn() {
    const { w, d } = BARN, GATE = 4;
    const root = new THREE.Group();
    this.scene.add(root);
    this.barn = root;
    const wood = mat(0x8a6038), dark = mat(0x5e4128), hay = mat(0xd8b860);
    const ground = (lx, lz) => { const p = toWorld(BARN, lx, lz); return { x: p.x, y: heightAt(p.x, p.z), z: p.z }; };
    // mesh at a pen-space spot, standing on the ground (y = height above it), turned with the pen
    const place = (geo, m, lx, lz, y = 0, ry = 0) => {
      const g = ground(lx, lz), o = new THREE.Mesh(geo, m);
      o.position.set(g.x, g.y + y, g.z); o.rotation.y = BARN.yaw + ry;
      o.castShadow = true; o.receiveShadow = true; root.add(o); return o;
    };

    // straw on the dirt inside the fence, following the ground
    const floor = new THREE.PlaneGeometry(w - 0.3, d - 0.3, 18, 22);
    floor.rotateX(-Math.PI / 2);
    const fp = floor.attributes.position, col = [], straw = new THREE.Color(0xc8a85a), dirt = new THREE.Color(0x7a6038), c = new THREE.Color();
    for (let i = 0; i < fp.count; i++) {
      const lx = fp.getX(i), lz = fp.getZ(i), g = ground(lx, lz);
      fp.setXYZ(i, g.x, g.y + 0.04, g.z);
      c.copy(dirt).lerp(straw, 0.45 + 0.55 * Math.abs(Math.sin(lx * 3.1 + lz * 1.7)));
      col.push(c.r, c.g, c.b);
    }
    floor.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    floor.computeVertexNormals();
    const fm = new THREE.Mesh(floor, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    fm.receiveShadow = true; root.add(fm);

    // fence: posts every ~1.6 m with two rails between them
    const postGeo = new THREE.BoxGeometry(0.16, 1.35, 0.16); postGeo.translate(0, 0.675, 0);
    const railGeo = new THREE.BoxGeometry(0.08, 0.11, 1);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    const fence = (ax, az, bx, bz) => {
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 1.6));
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const t = i / n, lx = ax + (bx - ax) * t, lz = az + (bz - az) * t;
        const g = ground(lx, lz);
        const post = new THREE.Mesh(postGeo, wood);
        post.position.set(g.x, g.y - 0.15, g.z); post.rotation.set((Math.random() - 0.5) * 0.06, BARN.yaw, (Math.random() - 0.5) * 0.06);
        post.castShadow = true; root.add(post);
        if (prev) {
          for (const hh of [0.45, 0.95]) {
            a.set(prev.x, prev.y + hh, prev.z); b.set(g.x, g.y + hh, g.z);
            const rail = new THREE.Mesh(railGeo, wood);
            rail.position.copy(a).lerp(b, 0.5); rail.lookAt(b); rail.scale.z = a.distanceTo(b);
            rail.castShadow = true; root.add(rail);
          }
        }
        prev = g;
      }
      this._wallColliders(BARN, ax, az, bx, bz, 0.22);
    };
    fence(-w / 2, -d / 2, w / 2, -d / 2);
    fence(-w / 2, -d / 2, -w / 2, d / 2);
    fence(w / 2, -d / 2, w / 2, d / 2);
    fence(-w / 2, d / 2, -GATE / 2, d / 2);
    fence(GATE / 2, d / 2, w / 2, d / 2);
    // taller gate posts at the entrance
    const gatePost = new THREE.BoxGeometry(0.22, 1.8, 0.22); gatePost.translate(0, 0.9, 0);
    for (const s of [-1, 1]) place(gatePost, dark, s * GATE / 2, d / 2, -0.15);

    // inside: hay bales, bucket & milking stool, a water trough
    for (const [x, z, y] of [[-3.2, -4.2, 0], [-2.0, -4.2, 0], [-2.6, -4.2, 0.55]]) {
      place(new THREE.BoxGeometry(1.1, 0.55, 0.75), hay, x, z, 0.28 + y);
      if (!y) { const p = toWorld(BARN, x, z); this.colliders.push({ x: p.x, z: p.z, r: 0.55 }); }
    }
    place(new THREE.CylinderGeometry(0.2, 0.16, 0.34, 14, 1, true), mat(0xb8bcc0, { metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }), -2.6, 0.5, 0.17);
    place(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 14), mat(0xf6f4ee), -2.6, 0.5, 0.28); // milk in the bucket
    place(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12), wood, -3.2, 0.9, 0.42); // stool
    for (let i = 0; i < 3; i++) place(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 5), wood, -3.2 + Math.cos(i * 2.1) * 0.15, 0.9 + Math.sin(i * 2.1) * 0.15, 0.21);
    place(new THREE.BoxGeometry(0.7, 0.5, 3), wood, 3.4, -0.5, 0.25);
    place(new THREE.BoxGeometry(0.55, 0.05, 2.8), mat(0x3a6a8a, { roughness: 0.2 }), 3.4, -0.5, 0.48);
    for (const z of [-1.5, 0, 0.5]) { const p = toWorld(BARN, 3.4, z); this.colliders.push({ x: p.x, z: p.z, r: 0.45 }); }

    // sign planted in front of the entrance
    const { tex } = textTexture(['🥛 KHU VẮT SỮA', 'Vào trong · nhấn M để vắt'], { bg: '#f2ead8', fg: '#7a2a1c', border: '#7a4a22' });
    const sx = GATE / 2 + 1.5, sz = d / 2 + 1.3;
    for (const o of [-0.9, 0.9]) place(new THREE.BoxGeometry(0.1, 1.6, 0.1), dark, sx + o, sz, 0.8 - 0.15, -0.35);
    const board = place(new THREE.BoxGeometry(2.2, 0.75, 0.06), wood, sx, sz, 1.35, -0.35);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.68), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    face.position.z = 0.032; board.add(face);
    { const p = toWorld(BARN, sx, sz); this.colliders.push({ x: p.x, z: p.z, r: 0.45 }); }
  }

  _stall(lx, title, sub, awningA, awningB, npc) {
    const p = toWorld(MARKET, lx, 0), base = heightAt(p.x, p.z);
    const g = new THREE.Group();
    g.position.set(p.x, base, p.z);
    g.rotation.y = MARKET.yaw;
    this.scene.add(g);
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
    const wood = mat(0x8a6038), dark = mat(0x5a3a22);
    add(new THREE.BoxGeometry(2.8, 0.95, 0.8), wood, 0, 0.47, 0);   // counter
    add(new THREE.BoxGeometry(3.0, 0.08, 0.95), dark, 0, 0.97, 0);  // counter top
    for (const sx of [-1.4, 1.4]) for (const sz of [-1.3, 0.35]) add(new THREE.CylinderGeometry(0.07, 0.07, 2.8, 8), dark, sx, 1.4, sz);
    // striped awning
    const stripes = 8;
    for (let i = 0; i < stripes; i++) {
      const s = add(new THREE.BoxGeometry(3.4 / stripes, 0.06, 2.1), mat(i % 2 ? awningA : awningB), -1.7 + (i + 0.5) * 3.4 / stripes, 2.85, -0.45);
      s.rotation.x = -0.18;
    }
    const { tex, canvas } = textTexture([title, sub], { w: 512, h: 150 });
    const sign = add(new THREE.PlaneGeometry(2.6, 0.76), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), 0, 2.45, 0.42);
    sign.castShadow = false;
    // shopkeeper behind the counter
    const n = makeNPC(npc);
    n.group.position.set(0, 0, -0.75);
    g.add(n.group);
    this.npcs.push({ ...n, phase: Math.random() * 6, world: toWorld(MARKET, lx, -0.75) });
    // can't walk through the counter
    for (const k of [-1.1, 0, 1.1]) { const c = toWorld(MARKET, lx + k, 0); this.colliders.push({ x: c.x, z: c.z, r: 0.5 }); }
    return { g, add, sign, tex, canvas };
  }

  _buildMarket() {
    const milk = this._stall(COUNTERS.milk.lx, '🥛 THU MUA SỮA', 'Đứng trước quầy · nhấn E', 0x3a7ad8, 0xf2f2ee, { shirt: 0x5a7a3a, apron: 0x8a6a4a, hat: 'conical' });
    const shop = this._stall(COUNTERS.shop.lx, '🎁 CỬA HÀNG', 'Đứng trước quầy · nhấn E', 0xd83a5a, 0xf2f2ee, { shirt: 0xc85a8a, apron: 0xf2e8d8, hat: 0xe85a5a });
    // milk cans on the milk counter, gift boxes on the shop counter
    const can = mat(0xc8ccd0, { metalness: 0.6, roughness: 0.35 });
    for (const x of [-0.9, -0.45]) milk.add(new THREE.CylinderGeometry(0.16, 0.18, 0.5, 14), can, x, 1.26, 0.05);
    const gifts = [0xe84a4a, 0x4a8ae8, 0xf2c83a, 0x6ac85a];
    gifts.forEach((c, i) => shop.add(new THREE.BoxGeometry(0.3, 0.26, 0.3), mat(c), -1 + i * 0.42, 1.14, 0.1));
    // price board next to the milk stall (updated when the admin changes the price)
    this.priceBoard = textTexture(['GIÁ SỮA HÔM NAY', '… 🪙 / lít'], { w: 384, h: 220, bg: '#24301e', fg: '#f2f2d8', border: '#8a6a3a' });
    const pb = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.75), new THREE.MeshStandardMaterial({ map: this.priceBoard.tex, roughness: 0.9 }));
    pb.position.set(-2.1, 1.7, 0.5); pb.rotation.y = 0.35; milk.g.add(pb);
    milk.add(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6), mat(0x5a3a22), -2.1, 0.7, 0.45);
  }

  // milk price shown on the board at the market
  setPrice(price) {
    const { canvas, tex } = this.priceBoard, g = canvas.getContext('2d');
    g.fillStyle = '#24301e'; g.fillRect(10, 90, canvas.width - 20, canvas.height - 100);
    g.fillStyle = '#f2d86a'; g.font = 'bold 64px "Segoe UI", "Segoe UI Emoji", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`${price} 🪙 / lít`, canvas.width / 2, 150);
    tex.needsUpdate = true;
  }

  // NPCs idle, look at / wave to a cow standing at their counter
  update(dt, time, cowPos) {
    for (const n of this.npcs) {
      const near = Math.hypot(cowPos.x - n.world.x, cowPos.z - n.world.z) < 4.5;
      n.body.position.y = 0.8 + Math.sin(time * 1.6 + n.phase) * 0.012;
      n.head.rotation.y = Math.sin(time * 0.5 + n.phase) * 0.35 * (near ? 0.3 : 1);
      const wave = near ? Math.sin(time * 7) * 0.35 + 2.5 : 0.1 + Math.sin(time + n.phase) * 0.05;
      n.arms[0].rotation.z += (wave - n.arms[0].rotation.z) * Math.min(1, dt * 6);
    }
  }
}
