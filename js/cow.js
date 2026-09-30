import * as THREE from 'three';

function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Procedural Holstein pattern: white hide with irregular black patches.
export const COATS = {
  holstein: { base: '#f2efe8', spot: '#121212', white: 0xf0ede6, blotch: 0x151515 },
  brown:    { base: '#f0e8dc', spot: '#6b3a1e', white: 0xefe6da, blotch: 0x6b3a1e },
  jersey:   { base: '#b9804a', spot: '#8a5a30', white: 0xc89868, blotch: 0x7a4a26 },
  black:    { base: '#1c1b1a', spot: '#f0ede6', white: 0x2a2826, blotch: 0x121212 },
};

function makeSpotTexture(seed = 11, coat = COATS.holstein) {
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = coat.base;
  g.fillRect(0, 0, W, H);
  const rnd = mulberry32(seed);
  g.fillStyle = coat.spot;
  const blob = (cx, cy, r) => {
    for (let k = 0; k < 26; k++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r * 0.75;
      const rr = r * (0.18 + rnd() * 0.4);
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.8;
      for (const ox of [-W, 0, W]) {
        g.beginPath(); g.arc(x + ox, y, rr, 0, Math.PI * 2); g.fill();
      }
    }
  };
  const nBlobs = coat === COATS.black ? 6 : coat === COATS.jersey ? 8 : 16;
  for (let i = 0; i < nBlobs; i++) blob(rnd() * W, 40 + rnd() * (H - 80), 45 + rnd() * 75);
  // fur grain
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 18;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export const JUMP_SPEED = 6.2;
export const GRAVITY = 19;
export const BUTT_TIME = 0.6;   // seconds for the whole headbutt move
export const BUTT_HIT_AT = 0.45; // fraction of BUTT_TIME when the head connects

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Cow {
  constructor(scene, { coat = 'holstein', seed = 11 } = {}) {
    const C = COATS[coat] || COATS.holstein;
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    scene.add(this.root);

    const spotTex = this.spotTex = makeSpotTexture(seed, C);
    const spot = new THREE.MeshStandardMaterial({ map: spotTex, roughness: 0.85 });
    const white = new THREE.MeshStandardMaterial({ color: C.white, roughness: 0.85 });
    const black = new THREE.MeshStandardMaterial({ color: C.blotch, roughness: 0.7 });
    const pink = new THREE.MeshStandardMaterial({ color: 0xdca59a, roughness: 0.6 });
    const horn = new THREE.MeshStandardMaterial({ color: 0xe6dcc4, roughness: 0.5 });
    const hoof = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.6 });
    const eye = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.15 });
    this.materials = [spot, white, black, pink, horn, hoof, eye];

    const M = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // body group (bobbing while walking)
    const body = this.body = new THREE.Group();
    this.root.add(body);

    const torso = M(new THREE.CapsuleGeometry(0.46, 1.15, 10, 24), spot, body, 0, 1.08, -0.02);
    torso.rotation.x = Math.PI / 2;
    torso.scale.set(0.95, 1, 1.12);
    // shoulders & haunches for a less tube-like silhouette
    const shoulder = M(new THREE.SphereGeometry(0.47, 20, 14), spot, body, 0, 1.15, 0.55);
    shoulder.scale.set(0.95, 1.05, 1);
    const hip = M(new THREE.SphereGeometry(0.47, 20, 14), spot, body, 0, 1.12, -0.62);
    hip.scale.set(1.0, 1.02, 0.95);
    hip.material = spot;

    // udder
    const udder = M(new THREE.SphereGeometry(0.17, 16, 12), pink, body, 0, 0.62, -0.45);
    udder.scale.set(1.1, 0.8, 1.2);
    for (const [x, z] of [[0.07, 0.07], [-0.07, 0.07], [0.07, -0.07], [-0.07, -0.07]]) {
      M(new THREE.CylinderGeometry(0.02, 0.025, 0.09, 6), pink, body, x, 0.5, -0.45 + z);
    }

    // legs: hip pivot -> upper -> knee pivot -> lower + hoof
    this.legs = [];
    const legDefs = [
      { x: 0.25, z: 0.62, front: true, phase: Math.PI * 0.5 },   // front left
      { x: -0.25, z: 0.62, front: true, phase: Math.PI * 1.5 },  // front right
      { x: 0.25, z: -0.66, front: false, phase: 0 },             // back left
      { x: -0.25, z: -0.66, front: false, phase: Math.PI },      // back right
    ];
    for (const d of legDefs) {
      const hipP = new THREE.Group();
      hipP.position.set(d.x, 0.95, d.z);
      body.add(hipP);
      const thigh = M(new THREE.SphereGeometry(0.16, 12, 10), spot, hipP, 0, 0, 0);
      thigh.scale.set(0.9, 1.6, 1.2);
      M(new THREE.CylinderGeometry(0.1, 0.075, 0.5, 10), d.front ? white : spot, hipP, 0, -0.27, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.5;
      hipP.add(knee);
      M(new THREE.SphereGeometry(0.075, 10, 8), white, knee);
      M(new THREE.CylinderGeometry(0.065, 0.06, 0.34, 10), white, knee, 0, -0.18, 0);
      M(new THREE.CylinderGeometry(0.075, 0.085, 0.09, 10), hoof, knee, 0, -0.38, 0.01);
      this.legs.push({ hip: hipP, knee, ...d, lastS: 0 });
    }

    // neck + head
    const neck = this.neck = new THREE.Group();
    neck.position.set(0, 1.32, 0.9);
    body.add(neck);
    const neckMesh = M(new THREE.CapsuleGeometry(0.27, 0.35, 8, 16), spot, neck, 0, 0.02, 0.2);
    neckMesh.rotation.x = Math.PI / 2 - 0.55;
    // dewlap
    const dew = M(new THREE.SphereGeometry(0.2, 12, 10), white, neck, 0, -0.2, 0.25);
    dew.scale.set(0.7, 1.1, 1.3);

    const head = this.head = new THREE.Group();
    head.position.set(0, 0.2, 0.55);
    neck.add(head);
    const skull = M(new THREE.SphereGeometry(0.25, 20, 16), white, head, 0, 0, 0.12);
    skull.scale.set(1, 1.05, 1.5);
    skull.rotation.x = 0.45;
    // black patch over one eye
    const patch = M(new THREE.SphereGeometry(0.2, 14, 10), black, head, 0.11, 0.05, 0.08);
    patch.scale.set(0.8, 0.9, 1.1);
    const snout = M(new THREE.SphereGeometry(0.19, 18, 12), pink, head, 0, -0.16, 0.43);
    snout.scale.set(1.15, 0.85, 0.9);
    M(new THREE.SphereGeometry(0.035, 8, 6), black, head, 0.08, -0.12, 0.6);
    M(new THREE.SphereGeometry(0.035, 8, 6), black, head, -0.08, -0.12, 0.6);
    for (const s of [1, -1]) {
      M(new THREE.SphereGeometry(0.045, 10, 8), eye, head, s * 0.2, 0.07, 0.2);
      const ear = new THREE.Group();
      ear.position.set(s * 0.26, 0.12, 0.0);
      ear.rotation.z = -s * 0.35;
      head.add(ear);
      const earM = M(new THREE.SphereGeometry(0.12, 12, 8), s > 0 ? black : white, ear, s * 0.1, 0, 0);
      earM.scale.set(1.5, 0.35, 0.8);
      const inner = M(new THREE.SphereGeometry(0.09, 10, 6), pink, ear, s * 0.11, -0.03, 0.01);
      inner.scale.set(1.4, 0.2, 0.65);
      if (s > 0) this.earL = ear; else this.earR = ear;
      // horns: two segments curving up & out
      const h1 = new THREE.Group();
      h1.position.set(s * 0.14, 0.22, 0.02);
      h1.rotation.z = -s * 1.1;
      head.add(h1);
      M(new THREE.CylinderGeometry(0.028, 0.045, 0.16, 8), horn, h1, 0, 0.08, 0);
      const h2 = new THREE.Group();
      h2.position.y = 0.16;
      h2.rotation.z = s * 0.9;
      h1.add(h2);
      M(new THREE.ConeGeometry(0.028, 0.14, 8), horn, h2, 0, 0.07, 0);
    }
    // forelock tuft
    M(new THREE.SphereGeometry(0.1, 10, 8), white, head, 0, 0.24, 0.05).scale.set(1.3, 0.6, 1);

    // tail: chain of segments hanging from the rump
    this.tail = [];
    let parent = new THREE.Group();
    parent.position.set(0, 1.45, -1.12);
    parent.rotation.x = 0.05;
    body.add(parent);
    this.tailRoot = parent;
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Group();
      seg.position.y = i === 0 ? 0 : -0.14;
      parent.add(seg);
      M(new THREE.CylinderGeometry(0.03, 0.035, 0.15, 6), i < 2 ? spot : white, seg, 0, -0.07, 0);
      this.tail.push(seg);
      parent = seg;
    }
    const tuft = M(new THREE.SphereGeometry(0.07, 10, 8), white, parent, 0, -0.2, 0);
    tuft.scale.set(0.9, 1.8, 0.9);

    // state
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.speed = 0;
    this.phase = 0;
    this.graze = 0;       // 0..1 head down amount
    this.grazeTimer = 0;
    this.time = 0;
    this.earTimer = 2;
    this.tailSwish = 0;
    this.onStep = null;
    // jump / headbutt / knockback
    this.air = 0;        // height above the ground
    this.vy = 0;
    this.buttT = 0;      // time left in the headbutt move
    this.knock = new THREE.Vector2(); // knockback velocity (xz)
    this.stun = 0;
    this.onLand = null;
  }

  get grounded() { return this.air <= 0 && this.vy <= 0; }
  get butting() { return this.buttT > 0; }
  // 0..1 progress through the headbutt
  get buttProgress() { return this.buttT > 0 ? 1 - this.buttT / BUTT_TIME : 0; }

  jump(speed = JUMP_SPEED) {
    if (!this.grounded) return false;
    this.vy = speed;
    this.grazeTimer = 0;
    return true;
  }

  startButt() {
    if (this.buttT > 0 || this.stun > 0) return false;
    this.buttT = BUTT_TIME;
    this.grazeTimer = 0;
    return true;
  }

  // push this cow away (dx,dz normalised) with a little hop
  knockback(dx, dz, power = 1) {
    this.knock.set(dx * 9 * power, dz * 9 * power);
    if (this.air < 0.3) this.vy = Math.max(this.vy, 4.2 * power);
    this.stun = 0.6;
    this.buttT = 0;
    this._hurt = 0.5;
  }

  // integrate jump arc + knockback slide; returns true on the frame it lands
  updatePhysics(dt) {
    let landed = false;
    if (this.air > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.air += this.vy * dt;
      if (this.air <= 0) {
        landed = this.vy < -2;
        if (landed && this.onLand) this.onLand(-this.vy);
        this.air = 0;
        this.vy = 0;
      }
    }
    if (this.knock.lengthSq() > 1e-4) {
      this.pos.x += this.knock.x * dt;
      this.pos.z += this.knock.y * dt;
      this.knock.multiplyScalar(Math.exp(-dt * 5));
    }
    if (this.buttT > 0) this.buttT = Math.max(0, this.buttT - dt);
    if (this.stun > 0) this.stun = Math.max(0, this.stun - dt);
    return landed;
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.materials) m.dispose();
    this.spotTex.dispose();
  }

  startGraze(seconds = 4) { this.grazeTimer = seconds; }
  get isGrazing() { return this.grazeTimer > 0; }

  animate(dt, running) {
    this.time += dt;
    const sp = this.speed;
    const moving = sp > 0.05;
    const freq = 1.35 + sp * 0.32;
    this.phase += dt * freq * (moving ? 1 : 0) * Math.PI * 2 * Math.min(1, sp / 1.2 + 0.25);
    const amp = Math.min(0.62, sp * 0.2) * (running ? 1.15 : 1);

    const airK = smooth(0.02, 0.25, this.air);
    for (const L of this.legs) {
      const s = Math.sin(this.phase + L.phase);
      const c = Math.cos(this.phase + L.phase);
      // lift the lower leg during the forward swing
      const lift = Math.max(0, c) * amp * 1.3;
      // in the air: front legs reach forward, hind legs kick back, knees fold
      const tuckHip = L.front ? -0.55 : 0.5;
      const tuckKnee = L.front ? 1.1 : 0.7;
      L.hip.rotation.x = s * amp * (1 - airK) + tuckHip * airK;
      L.knee.rotation.x = (L.front ? lift : lift * 0.7) * (1 - airK) + tuckKnee * airK;
      // foot plant event (when leg passes back through the stance start)
      if (moving && airK < 0.1 && L.lastS > 0 && s <= 0 && this.onStep) this.onStep(sp);
      L.lastS = s;
    }

    // body motion
    const bob = moving ? Math.abs(Math.sin(this.phase)) * 0.035 * Math.min(1, sp / 2) : 0;
    const breathe = Math.sin(this.time * 1.7) * 0.008;
    this.body.position.y = bob + breathe;
    this.body.rotation.z = moving ? Math.sin(this.phase) * 0.025 : 0;
    // nose up while rising, nose down while falling
    this.body.rotation.x = airK * THREE.MathUtils.clamp(-this.vy * 0.035, -0.2, 0.25);

    // headbutt: wind up (lean back), thrust (lunge forward), recover
    const p = this.buttProgress;
    const windup = p > 0 ? smooth(0, 0.3, p) * (1 - smooth(0.3, 0.45, p)) : 0;
    const thrust = p > 0 ? smooth(0.3, 0.45, p) * (1 - smooth(0.6, 1, p)) : 0;
    this.body.position.z = -windup * 0.18 + thrust * 0.35;
    this.body.rotation.x += windup * -0.06 + thrust * 0.1;

    // hurt wobble after being knocked
    if (this._hurt > 0) {
      this._hurt = Math.max(0, this._hurt - dt);
      this.body.rotation.z += Math.sin(this._hurt * 40) * this._hurt * 0.25;
    }

    // grazing / head
    if (this.grazeTimer > 0) this.grazeTimer -= dt;
    const grazeTarget = this.grazeTimer > 0 && !moving ? 1 : 0;
    this.graze += (grazeTarget - this.graze) * Math.min(1, dt * 2.5);
    const chew = this.graze > 0.8 ? Math.sin(this.time * 9) * 0.04 : 0;
    const headBob = moving ? Math.sin(this.phase * 2) * 0.04 : Math.sin(this.time * 0.6) * 0.03;
    this.neck.rotation.x = 0.1 + this.graze * 1.05 + headBob + windup * 0.55 + thrust * 0.75 - airK * 0.15;
    this.head.rotation.x = -0.05 + this.graze * 0.35 + chew + thrust * 0.35;
    this.head.rotation.y = moving ? 0 : Math.sin(this.time * 0.35) * 0.25 * (1 - this.graze);

    // ears twitch
    this.earTimer -= dt;
    if (this.earTimer < 0) { this.earTimer = 1.5 + Math.random() * 4; this._twitch = 0.25; }
    this._twitch = Math.max(0, (this._twitch || 0) - dt);
    const tw = Math.sin(this._twitch * 40) * this._twitch * 1.5;
    this.earL.rotation.z = -0.35 + tw;
    this.earR.rotation.z = 0.35 + Math.sin(this.time * 1.3) * 0.05;

    // tail: gentle sway + occasional swish
    if (Math.random() < dt * 0.25) this.tailSwish = 1;
    this.tailSwish = Math.max(0, this.tailSwish - dt * 0.8);
    for (let i = 0; i < this.tail.length; i++) {
      const k = i / this.tail.length;
      this.tail[i].rotation.z = Math.sin(this.time * 2.2 - i * 0.5) * (0.05 + this.tailSwish * 0.35) * (0.5 + k);
      this.tail[i].rotation.x = (i === 0 ? 0.12 : 0.015) + (moving ? Math.sin(this.phase - i * 0.4) * 0.05 : 0);
    }
  }
}
