import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { BARN, MARKET, COUNTERS, toWorld } from '../game/config.js';

// The farm near the spawn meadow: a barn (walk in and press M to milk) and a small market
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
      { x: BARN.x, z: BARN.z, icon: '🏠', name: 'Chuồng bò' },
      { x: MARKET.x, z: MARKET.z, icon: '🏪', name: 'Chợ' },
    ];
    this._buildBarn();
    this._buildMarket();
    // keep trees / rocks off the farm, stop grass growing through the barn floor
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

  _buildBarn() {
    const { w, d } = BARN, H = 3.4, RIDGE = 5.3, DOOR = 4.2, T = 0.22;
    // ground under the barn is never perfectly flat: the floor follows it, walls reach below it
    let lo = Infinity, hi = -Infinity;
    for (let lx = -w / 2; lx <= w / 2; lx += 1) for (let lz = -d / 2; lz <= d / 2; lz += 1) {
      const p = toWorld(BARN, lx, lz), h = heightAt(p.x, p.z);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    const base = hi;
    const g = new THREE.Group();
    g.position.set(BARN.x, base, BARN.z);
    g.rotation.y = BARN.yaw;
    this.scene.add(g);
    this.barn = g;
    const add = (geo, m, x, y, z, ry = 0) => {
      const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry;
      o.castShadow = true; o.receiveShadow = true; g.add(o); return o;
    };
    const red = mat(0x9b3324), white = mat(0xece4d4), roof = mat(0x4b4d50, { roughness: 0.7 }), wood = mat(0x7a5634);
    const foot = lo - base - 0.4; // walls start below the lowest ground
    const wallH = H - foot;

    // floor: straw on dirt, following the ground
    const floor = new THREE.PlaneGeometry(w - 0.1, d - 0.1, 18, 22);
    floor.rotateX(-Math.PI / 2);
    const fp = floor.attributes.position, col = [], straw = new THREE.Color(0xc8a85a), dirt = new THREE.Color(0x7a6038), c = new THREE.Color();
    for (let i = 0; i < fp.count; i++) {
      const p = toWorld(BARN, fp.getX(i), fp.getZ(i));
      fp.setY(i, heightAt(p.x, p.z) - base + 0.04);
      c.copy(dirt).lerp(straw, 0.45 + 0.55 * Math.abs(Math.sin(fp.getX(i) * 3.1 + fp.getZ(i) * 1.7)));
      col.push(c.r, c.g, c.b);
    }
    floor.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    floor.computeVertexNormals();
    const fm = new THREE.Mesh(floor, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    fm.receiveShadow = true; g.add(fm);

    // walls (back, sides, front with a wide door)
    add(new THREE.BoxGeometry(w, wallH, T), red, 0, foot + wallH / 2, -d / 2);
    for (const s of [1, -1]) add(new THREE.BoxGeometry(T, wallH, d), red, s * w / 2, foot + wallH / 2, 0);
    const side = (w - DOOR) / 2;
    for (const s of [1, -1]) add(new THREE.BoxGeometry(side, wallH, T), red, s * (DOOR / 2 + side / 2), foot + wallH / 2, d / 2);
    add(new THREE.BoxGeometry(DOOR, 0.7, T), red, 0, H - 0.35, d / 2);
    // white trim: corners, door frame, eaves
    for (const sx of [1, -1]) for (const sz of [1, -1]) add(new THREE.BoxGeometry(0.3, wallH, 0.3), white, sx * w / 2, foot + wallH / 2, sz * d / 2);
    for (const s of [1, -1]) add(new THREE.BoxGeometry(0.22, H - 0.7 - foot, 0.32), white, s * DOOR / 2, (H - 0.7 + foot) / 2, d / 2);
    add(new THREE.BoxGeometry(DOOR + 0.22, 0.22, 0.32), white, 0, H - 0.7, d / 2);
    // open barn doors with the white X brace
    for (const s of [1, -1]) {
      const door = new THREE.Group();
      door.position.set(s * DOOR / 2, 0, d / 2 + 0.1);
      door.rotation.y = s * 1.9; // swung open outwards
      g.add(door);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(DOOR / 2, H - 0.75, 0.1), red);
      leaf.position.set(-s * DOOR / 4, (H - 0.75) / 2, 0); leaf.castShadow = true; door.add(leaf);
      for (const a of [0.9, -0.9]) {
        const br = new THREE.Mesh(new THREE.BoxGeometry(0.14, (H - 0.75) * 1.15, 0.12), white);
        br.position.set(-s * DOOR / 4, (H - 0.75) / 2, 0.02); br.rotation.z = a * 0.62; door.add(br);
      }
    }
    // gables + roof
    const gable = new THREE.Shape();
    gable.moveTo(-w / 2, 0); gable.lineTo(w / 2, 0); gable.lineTo(0, RIDGE - H); gable.closePath();
    const gGeo = new THREE.ExtrudeGeometry(gable, { depth: T, bevelEnabled: false });
    for (const sz of [1, -1]) add(gGeo, red, 0, H, sz * d / 2 - T / 2); // extruded along +z by T
    const run = w / 2 + 0.45, rise = RIDGE - H + 0.25, len = Math.hypot(run, rise), ang = Math.atan2(rise, run);
    for (const s of [1, -1]) {
      const panel = add(new THREE.BoxGeometry(len, 0.16, d + 0.9), roof, s * run / 2, H - 0.2 + rise / 2, 0);
      panel.rotation.z = -s * ang;
    }
    add(new THREE.BoxGeometry(0.3, 0.3, d + 0.9), white, 0, RIDGE + 0.05, 0);

    // inside: hay bales, bucket & stool, a trough
    const hay = mat(0xd8b860);
    for (const [x, z, y] of [[-3.3, -4.3, 0], [-2.1, -4.3, 0], [-2.7, -4.3, 0.55], [3.3, -4.3, 0]]) {
      const p = toWorld(BARN, x, z);
      add(new THREE.BoxGeometry(1.1, 0.55, 0.75), hay, x, heightAt(p.x, p.z) - base + 0.28 + y, z);
      if (!y) this.colliders.push({ x: p.x, z: p.z, r: 0.55 });
    }
    const bp = toWorld(BARN, -2.6, 0.5), by = heightAt(bp.x, bp.z) - base;
    add(new THREE.CylinderGeometry(0.2, 0.16, 0.34, 14, 1, true), mat(0xb8bcc0, { metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }), -2.6, by + 0.17, 0.5);
    add(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 14), mat(0xf6f4ee), -2.6, by + 0.28, 0.5); // milk in the bucket
    add(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12), wood, -3.2, by + 0.42, 0.9); // milking stool
    for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 5), wood, -3.2 + Math.cos(i * 2.1) * 0.15, by + 0.21, 0.9 + Math.sin(i * 2.1) * 0.15);
    const tp = toWorld(BARN, 3.6, -0.5);
    add(new THREE.BoxGeometry(0.7, 0.5, 3), wood, 3.6, heightAt(tp.x, tp.z) - base + 0.25, -0.5);
    add(new THREE.BoxGeometry(0.55, 0.05, 2.8), mat(0x3a6a8a, { roughness: 0.2 }), 3.6, heightAt(tp.x, tp.z) - base + 0.48, -0.5);
    for (const z of [-1.5, 0, 0.5]) { const p = toWorld(BARN, 3.6, z); this.colliders.push({ x: p.x, z: p.z, r: 0.45 }); }

    // sign over the door + a lantern that glows at night
    const { tex } = textTexture(['🥛 CHUỒNG VẮT SỮA', 'Vào trong · nhấn M để vắt'], { bg: '#f2ead8', fg: '#7a2a1c', border: '#7a2a1c' });
    const sign = add(new THREE.PlaneGeometry(3.2, 1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), 0, H + 0.6, d / 2 + 0.14);
    sign.castShadow = false;
    this.lanternMat = new THREE.MeshStandardMaterial({ color: 0xffd890, emissive: 0xffb050, emissiveIntensity: 0 });
    add(new THREE.BoxGeometry(0.22, 0.3, 0.22), this.lanternMat, 0, H - 0.25, 1);
    this.lamp = new THREE.PointLight(0xffc070, 0, 12, 1.6);
    this.lamp.position.set(0, H - 0.5, 1);
    g.add(this.lamp);

    // colliders along the walls, leaving the door open
    this._wallColliders(BARN, -w / 2, -d / 2, w / 2, -d / 2);
    this._wallColliders(BARN, -w / 2, -d / 2, -w / 2, d / 2);
    this._wallColliders(BARN, w / 2, -d / 2, w / 2, d / 2);
    this._wallColliders(BARN, -w / 2, d / 2, -DOOR / 2 - 0.1, d / 2);
    this._wallColliders(BARN, DOOR / 2 + 0.1, d / 2, w / 2, d / 2);
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

  // NPCs idle, look at / wave to a cow standing at their counter; lantern at night
  update(dt, time, cowPos, night) {
    for (const n of this.npcs) {
      const near = Math.hypot(cowPos.x - n.world.x, cowPos.z - n.world.z) < 4.5;
      n.body.position.y = 0.8 + Math.sin(time * 1.6 + n.phase) * 0.012;
      n.head.rotation.y = Math.sin(time * 0.5 + n.phase) * 0.35 * (near ? 0.3 : 1);
      const wave = near ? Math.sin(time * 7) * 0.35 + 2.5 : 0.1 + Math.sin(time + n.phase) * 0.05;
      n.arms[0].rotation.z += (wave - n.arms[0].rotation.z) * Math.min(1, dt * 6);
    }
    this.lanternMat.emissiveIntensity = 0.4 + night * 1.8;
    this.lamp.intensity = 1.5 + night * 4.5; // a little light inside by day too
  }
}
