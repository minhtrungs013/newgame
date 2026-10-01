import * as THREE from 'three';
import { heightAt, noise2, pondsNear, waterAt, POND_CELL } from './terrain.js';

function cellRandom(cx, cz) {
  let s = (cx * 73856093) ^ (cz * 19349663) ^ 0x5bd1e995;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------- prop templates (built once, shared by every chunk) ----------
function makeRockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const colors = [];
  const base = new THREE.Color(0x7c7f78), moss = new THREE.Color(0x5c6b40), dark = new THREE.Color(0x5a5c57);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = noise2(v.x * 1.7 + seed * 13.1, v.z * 1.7 + v.y * 2.3 + seed * 7.7);
    v.multiplyScalar(0.75 + n * 0.45);
    v.y *= 0.62;
    if (v.y < 0) v.y *= 0.5;
    p.setXYZ(i, v.x, v.y, v.z);
    const c = base.clone().lerp(dark, noise2(v.x * 4 + seed, v.z * 4)).lerp(moss, THREE.MathUtils.smoothstep(v.y, 0.15, 0.55) * 0.55);
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

function makeBlob(radius, detail, jitter, seed) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(1 + (noise2(v.x * 3 + seed, v.y * 3 + v.z * 2) - 0.5) * jitter);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// birch bark: white with dark horizontal marks, baked into vertex colours
function makeBirchTrunk() {
  const g = new THREE.CylinderGeometry(0.1, 0.15, 1, 8, 12);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position, col = [];
  const white = new THREE.Color(0xe8e4da), dark = new THREE.Color(0x2a2622), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), a = Math.atan2(p.getZ(i), p.getX(i));
    const mark = noise2(y * 9, a * 1.3) > 0.72 ? 0.85 : 0;
    c.copy(white).lerp(dark, mark);
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function mtx(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)).clone();
}

// Collects transformed template pieces per material category and merges them into
// one mesh per category -> a whole chunk costs only a few draw calls.
class ChunkBuilder {
  constructor() { this.parts = { solid: [], rock: [], foliage: [] }; }
  add(cat, geo, matrix, tint = null, sway = 0) { this.parts[cat].push({ geo, matrix, tint, sway }); }
  build(materials, group) {
    const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3(), white = new THREE.Color(1, 1, 1);
    for (const [cat, parts] of Object.entries(this.parts)) {
      if (!parts.length) continue;
      let count = 0;
      for (const { geo } of parts) count += geo.index ? geo.index.count : geo.attributes.position.count;
      const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3), sw = new Float32Array(count);
      let o = 0;
      for (const { geo, matrix, tint, sway } of parts) {
        nm.getNormalMatrix(matrix);
        const P = geo.attributes.position, N = geo.attributes.normal, C = geo.attributes.color;
        const idx = geo.index ? geo.index.array : null;
        const len = idx ? idx.length : P.count;
        const t = tint || white;
        for (let k = 0; k < len; k++, o++) {
          const i = idx ? idx[k] : k;
          v.fromBufferAttribute(P, i).applyMatrix4(matrix);
          n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
          pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
          nor[o * 3] = n.x; nor[o * 3 + 1] = n.y; nor[o * 3 + 2] = n.z;
          const r = C ? C.getX(i) : 1, g = C ? C.getY(i) : 1, b = C ? C.getZ(i) : 1;
          col[o * 3] = r * t.r; col[o * 3 + 1] = g * t.g; col[o * 3 + 2] = b * t.b;
          sw[o] = sway;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, materials[cat]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

const FLOWER_COLORS = [0xf06ab0, 0xf2d23a, 0xf4f0ea, 0xa070e0, 0xe84a4a, 0xf09a40].map((c) => new THREE.Color(c));

// Streams trees, bushes, flowers, rocks, reeds... in chunks around the player (endless map).
export class World {
  constructor(scene) {
    this.scene = scene;
    this.cell = 32;
    this.radius = 5;
    this.chunks = new Map();
    this.colliders = [];
    this.statics = [];   // colliders of fixed buildings (the farm), kept whatever chunks load
    this.masks = [];     // circles where grass must not grow (barn floor)
    this.reserved = [];  // circles kept free of trees, rocks, fences

    // foliage sways in the wind (per-vertex "sway" weight, world-space phase)
    this.swayUniforms = { uTime: { value: 0 }, uWind: { value: 0.5 } };
    this.materials = {
      solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
      rock: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }),
      foliage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true }),
    };
    this.materials.foliage.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.swayUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uTime, uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  float swayK = sway * (0.35 + uWind);
  transformed.x += sin(uTime * 1.6 + position.x * 0.45 + position.z * 0.3) * 0.06 * swayK;
  transformed.z += cos(uTime * 1.25 + position.z * 0.5 + position.x * 0.2) * 0.05 * swayK;`);
    };

    this.rockGeos = Array.from({ length: 6 }, (_, i) => makeRockGeometry(i + 1));
    this.trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 1, 7);
    this.trunkGeo.translate(0, 0.5, 0);
    this.birchGeo = makeBirchTrunk();
    this.blobGeos = Array.from({ length: 4 }, (_, i) => makeBlob(1, 1, 0.5, i * 5.3));
    this.coneGeo = new THREE.ConeGeometry(1, 1, 9, 1);
    this.coneGeo.translate(0, 0.5, 0);
    this.flowerGeo = new THREE.OctahedronGeometry(1, 0); // tiny, so 8 faces are plenty
    this.stemGeo = new THREE.CylinderGeometry(0.012, 0.02, 1, 4);
    this.stemGeo.translate(0, 0.5, 0);
    this.cattailGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 6);
    this.padGeo = new THREE.CylinderGeometry(1, 1, 0.02, 10);
    this.logGeo = new THREE.CylinderGeometry(1, 1, 1, 9);
    this.postGeo = new THREE.BoxGeometry(0.14, 1.2, 0.14);
    this.postGeo.translate(0, 0.6, 0);
    this.railGeo = new THREE.BoxGeometry(0.08, 0.1, 1);

    this.col = {
      trunk: new THREE.Color(0x4a3a2a), wood: new THREE.Color(0x6b5842), log: new THREE.Color(0x5a4630),
      leaf: [0x2f4a22, 0x3a5526, 0x2a4020, 0x46602a].map((c) => new THREE.Color(c)),
      pine: [0x1f3a24, 0x24422a, 0x1a3320].map((c) => new THREE.Color(c)),
      birchLeaf: new THREE.Color(0x6a8a34), bush: new THREE.Color(0x2b3f1e), bush2: new THREE.Color(0x3a5028),
      reed: new THREE.Color(0x6a7a3a), cattail: new THREE.Color(0x5a3a22), pad: new THREE.Color(0x3a6a2a),
    };
  }

  // fixed buildings: keep props away and add their colliders / grass masks
  reserve(x, z, r) { this.reserved.push({ x, z, r }); }
  addStatic(colliders, masks = []) {
    this.statics.push(...colliders);
    this.colliders.push(...colliders);
    this.masks.push(...masks);
  }
  _free(x, z) { return !this.reserved.some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r); }

  // is this spot usable for a land prop? (not in or right next to water)
  _dry(x, z) {
    for (const p of pondsNear(x, z)) if (Math.hypot(x - p.x, z - p.z) < p.R * 1.3) return false;
    return true;
  }

  _tree(B, colliders, rnd, x, y, z) {
    const kind = noise2(x * 0.004 + 9, z * 0.004) > 0.62 ? 'pine' : rnd() < 0.2 ? 'birch' : 'round';
    const ry = rnd() * Math.PI * 2;
    if (kind === 'pine') {
      const h = 4 + rnd() * 4;
      B.add('solid', this.trunkGeo, mtx(x, y - 0.1, z, 0, ry, 0, 0.8, h * 0.45, 0.8), this.col.trunk);
      const tint = this.col.pine[Math.floor(rnd() * 3)];
      const tiers = 3 + Math.floor(rnd() * 2);
      for (let i = 0; i < tiers; i++) {
        const k = i / tiers;
        const r = (1.9 - k * 1.2) * (0.8 + h * 0.05);
        B.add('foliage', this.coneGeo, mtx(x, y + h * (0.25 + k * 0.55), z, 0, ry + i, 0, r, h * 0.38, r), tint, 0.5 + k * 0.5);
      }
      colliders.push({ x, z, r: 0.5 });
    } else if (kind === 'birch') {
      const h = 4 + rnd() * 3;
      B.add('solid', this.birchGeo, mtx(x, y - 0.1, z, (rnd() - 0.5) * 0.08, ry, (rnd() - 0.5) * 0.08, 1, h, 1));
      for (let b = 0; b < 4; b++) {
        const r = 0.8 + rnd() * 0.7;
        B.add('foliage', this.blobGeos[b % 4], mtx(x + (rnd() - 0.5) * 1.4, y + h * (0.75 + rnd() * 0.3), z + (rnd() - 0.5) * 1.4, 0, rnd() * 6, 0, r, r * 1.3, r),
          this.col.birchLeaf.clone().offsetHSL((rnd() - 0.5) * 0.04, 0, (rnd() - 0.5) * 0.06), 1);
      }
      colliders.push({ x, z, r: 0.4 });
    } else {
      const h = 3 + rnd() * 3;
      B.add('solid', this.trunkGeo, mtx(x, y - 0.1, z, 0, ry, 0, 1, h, 1), this.col.trunk);
      const base = this.col.leaf[Math.floor(rnd() * 4)];
      const blobs = 4 + Math.floor(rnd() * 3);
      for (let b = 0; b < blobs; b++) {
        const r = 1.2 + rnd() * 1.1;
        B.add('foliage', this.blobGeos[Math.floor(rnd() * 4)],
          mtx(x + (rnd() - 0.5) * 2.4, y + h + (rnd() - 0.3) * 1.6, z + (rnd() - 0.5) * 2.4, 0, rnd() * 6, 0, r),
          base.clone().offsetHSL((rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.05), 1);
      }
      colliders.push({ x, z, r: 0.6 });
    }
  }

  _bush(B, colliders, rnd, x, y, z, flowering) {
    const s = 0.5 + rnd() * 0.7;
    const n = 2 + Math.floor(rnd() * 3);
    const tint = rnd() < 0.5 ? this.col.bush : this.col.bush2;
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28, d = rnd() * s * 0.6;
      B.add('foliage', this.blobGeos[Math.floor(rnd() * 4)],
        mtx(x + Math.cos(a) * d, y + s * 0.3, z + Math.sin(a) * d, 0, rnd() * 6, 0, s * (0.8 + rnd() * 0.5), s * 0.75, s * (0.8 + rnd() * 0.5)),
        tint.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.05), 0.35);
    }
    if (flowering) {
      // flower heads scattered over the upper half of the bush
      const fc = FLOWER_COLORS[Math.floor(rnd() * FLOWER_COLORS.length)];
      const count = 14 + Math.floor(rnd() * 14);
      for (let i = 0; i < count; i++) {
        const a = rnd() * Math.PI * 2, up = 0.25 + rnd() * 0.75;
        const rr = s * 1.05, fs = 0.05 + rnd() * 0.035;
        B.add('foliage', this.flowerGeo,
          mtx(x + Math.cos(a) * rr * Math.sqrt(1 - up * up), y + s * 0.3 + up * s * 0.75, z + Math.sin(a) * rr * Math.sqrt(1 - up * up), 0, 0, 0, fs),
          fc.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.1), 0.45);
      }
    }
    colliders.push({ x, z, r: s * 1.05 });
  }

  _pondDecor(B, rnd, p) {
    // reeds & cattails along the shore
    const clumps = Math.floor(p.R * 1.1);
    for (let c = 0; c < clumps; c++) {
      const a = rnd() * Math.PI * 2;
      const rr = p.R * (0.9 + rnd() * 0.45);
      const cx = p.x + Math.cos(a) * rr, cz = p.z + Math.sin(a) * rr;
      const w = waterAt(cx, cz);
      if (w && w.depth > 0.45) continue;
      const n = 4 + Math.floor(rnd() * 6);
      for (let i = 0; i < n; i++) {
        const x = cx + (rnd() - 0.5) * 1.2, z = cz + (rnd() - 0.5) * 1.2;
        const y = heightAt(x, z) - 0.05, h = 0.9 + rnd() * 0.9;
        const lean = (rnd() - 0.5) * 0.25;
        B.add('foliage', this.stemGeo, mtx(x, y, z, lean, 0, (rnd() - 0.5) * 0.25, 1, h, 1), this.col.reed.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.08), 0.8);
        if (rnd() < 0.4) B.add('foliage', this.cattailGeo, mtx(x + lean * h * 0.5, y + h * 0.9, z, lean, 0, 0, 1, 0.2, 1), this.col.cattail, 0.8);
      }
    }
    // lily pads (some with a flower) floating on open water
    const pads = Math.floor(p.R * 0.9);
    for (let i = 0; i < pads; i++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * p.R * 0.95;
      const x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr;
      const w = waterAt(x, z);
      if (!w || w.depth < 0.3) continue;
      const s = 0.3 + rnd() * 0.35;
      B.add('foliage', this.padGeo, mtx(x, p.level + 0.02, z, 0, rnd() * 6, 0, s, 1, s), this.col.pad.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.08), 0.15);
      if (rnd() < 0.25) B.add('foliage', this.flowerGeo, mtx(x, p.level + 0.08, z, 0, 0, 0, 0.08, 0.05, 0.08), FLOWER_COLORS[rnd() < 0.5 ? 0 : 2], 0.1);
    }
  }

  _spawnChunk(cx, cz) {
    const rnd = cellRandom(cx, cz);
    const group = new THREE.Group();
    const colliders = [];
    const B = new ChunkBuilder();
    const x0 = cx * this.cell, z0 = cz * this.cell;
    const nearSpawn = (x, z) => x * x + z * z < 12 * 12;
    const place = (fn) => {
      const x = x0 + rnd() * this.cell, z = z0 + rnd() * this.cell;
      if (nearSpawn(x, z) || !this._dry(x, z) || !this._free(x, z)) return;
      fn(x, z, heightAt(x, z));
    };

    // biome: forests, groves and open meadow
    const forest = noise2(cx * 0.15 + 3, cz * 0.15 - 2);
    const nTrees = forest > 0.62 ? 3 + Math.floor(rnd() * 5) : forest > 0.45 ? Math.floor(rnd() * 3) : (rnd() < 0.18 ? 1 : 0);
    for (let i = 0; i < nTrees; i++) place((x, z, y) => this._tree(B, colliders, rnd, x, y, z));

    const nBush = Math.floor(rnd() * 2.5 + forest * 2.5);
    for (let i = 0; i < nBush; i++) place((x, z, y) => this._bush(B, colliders, rnd, x, y, z, rnd() < 0.3));
    const nFlowerBush = rnd() < 0.55 ? 1 + Math.floor(rnd() * 3) : 0;
    for (let i = 0; i < nFlowerBush; i++) place((x, z, y) => this._bush(B, colliders, rnd, x, y, z, true));

    // rocks: a few small scattered + occasional big boulder
    const nRocks = Math.floor(rnd() * 3.2);
    for (let i = 0; i < nRocks; i++) place((x, z, y) => {
      const s = 0.25 + rnd() * rnd() * 1.3;
      B.add('rock', this.rockGeos[Math.floor(rnd() * 6)],
        mtx(x, y - s * 0.12, z, 0, rnd() * Math.PI * 2, 0, s * (0.8 + rnd() * 0.5), s * (0.7 + rnd() * 0.5), s * (0.8 + rnd() * 0.5)));
      colliders.push({ x, z, r: s * 1.0 });
    });
    if (rnd() < 0.18) place((x, z, y) => {
      const s = 1.6 + rnd() * 1.8;
      B.add('rock', this.rockGeos[Math.floor(rnd() * 6)], mtx(x, y - s * 0.15, z, 0, rnd() * Math.PI * 2, 0, s * 1.3, s * (0.8 + rnd() * 0.4), s));
      colliders.push({ x, z, r: s * 1.15 });
    });

    // fallen logs in the woods
    if (forest > 0.5 && rnd() < 0.35) place((x, z, y) => {
      const len = 2.5 + rnd() * 2.5, r = 0.22 + rnd() * 0.12, a = rnd() * Math.PI;
      B.add('solid', this.logGeo, mtx(x, y + r * 0.6, z, 0, a, Math.PI / 2, r, len, r), this.col.log);
      const dx = Math.cos(a), dz = -Math.sin(a);
      for (const k of [-0.33, 0, 0.33]) colliders.push({ x: x + dx * len * k, z: z + dz * len * k, r: r + 0.35 });
    });

    // occasional old fence line
    if (rnd() < 0.06) {
      const ang = rnd() * Math.PI;
      const dx = Math.cos(ang), dz = Math.sin(ang);
      const sx = x0 + this.cell * 0.5, sz = z0 + this.cell * 0.5;
      if (!nearSpawn(sx, sz) && this._dry(sx, sz)) {
        const n = 5 + Math.floor(rnd() * 5);
        let prev = null;
        for (let k = 0; k < n; k++) {
          const px = sx + dx * (k - n / 2) * 2.4, pz = sz + dz * (k - n / 2) * 2.4;
          if (!this._dry(px, pz) || !this._free(px, pz)) { prev = null; continue; }
          const py = heightAt(px, pz);
          B.add('solid', this.postGeo, mtx(px, py - 0.1, pz, (rnd() - 0.5) * 0.12, rnd(), (rnd() - 0.5) * 0.12), this.col.wood);
          colliders.push({ x: px, z: pz, r: 0.35 });
          if (prev) {
            for (const hh of [0.45, 0.9]) {
              const a = new THREE.Vector3(prev.x, prev.y + hh, prev.z), b = new THREE.Vector3(px, py + hh, pz);
              const mid = a.clone().lerp(b, 0.5);
              const rail = new THREE.Object3D();
              rail.position.copy(mid);
              rail.lookAt(b);
              rail.scale.set(1, 1, a.distanceTo(b));
              rail.updateMatrix();
              B.add('solid', this.railGeo, rail.matrix.clone(), this.col.wood);
            }
            colliders.push({ x: (prev.x + px) / 2, z: (prev.z + pz) / 2, r: 0.5 });
          }
          prev = { x: px, y: py, z: pz };
        }
      }
    }

    // pond decorations belong to the chunk that holds the pond's centre
    for (const p of pondsNear(x0 + this.cell / 2, z0 + this.cell / 2)) {
      if (Math.floor(p.x / this.cell) === cx && Math.floor(p.z / this.cell) === cz) this._pondDecor(B, cellRandom(cx + 991, cz - 773), p);
    }

    B.build(this.materials, group);
    this.scene.add(group);
    return { group, colliders };
  }

  update(px, pz) {
    const ccx = Math.floor(px / this.cell), ccz = Math.floor(pz / this.cell);
    if (ccx === this._lx && ccz === this._lz) return false;
    this._lx = ccx; this._lz = ccz;
    const R = this.radius;
    const keep = new Set();
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz > (R + 0.5) * (R + 0.5)) continue;
      const key = `${ccx + dx},${ccz + dz}`;
      keep.add(key);
      if (!this.chunks.has(key)) this.chunks.set(key, this._spawnChunk(ccx + dx, ccz + dz));
    }
    for (const [key, ch] of this.chunks) {
      if (!keep.has(key)) {
        this.scene.remove(ch.group);
        for (const m of ch.group.children) m.geometry.dispose();
        this.chunks.delete(key);
      }
    }
    this.colliders = [...this.statics];
    for (const ch of this.chunks.values()) this.colliders.push(...ch.colliders);
    return true;
  }

  // nearest obstacles (within the grass patch) -> grass shader, so blades don't poke
  // through rocks & trunks. Returns how many slots were filled.
  nearest(px, pz, out, range = 60) {
    const list = [...this.colliders.filter((c) => c.r > 0.45), ...this.masks]
      .map(c => ({ c, d: (c.x - px) ** 2 + (c.z - pz) ** 2 - c.r * c.r }))
      .filter(o => o.d < range * range)
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < out.length; i++) {
      const o = list[i];
      if (o) out[i].set(o.c.x, o.c.z, o.c.r, 0); else out[i].set(0, 0, 0, 0);
    }
    return Math.min(list.length, out.length);
  }

  setFrame(time, wind) {
    this.swayUniforms.uTime.value = time;
    this.swayUniforms.uWind.value = wind;
  }
}

export { POND_CELL };
