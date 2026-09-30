import * as THREE from 'three';
import { heightAt, noise2 } from './terrain.js';

function cellRandom(cx, cz) {
  let s = (cx * 73856093) ^ (cz * 19349663) ^ 0x5bd1e995;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

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

// Streams rocks, trees and bushes in chunks around the player (endless map).
export class World {
  constructor(scene) {
    this.scene = scene;
    this.cell = 32;
    this.radius = 5;
    this.chunks = new Map();
    this.colliders = [];

    this.rockGeos = Array.from({ length: 6 }, (_, i) => makeRockGeometry(i + 1));
    this.rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    this.trunkGeo = new THREE.CylinderGeometry(0.18, 0.32, 1, 7);
    this.trunkGeo.translate(0, 0.5, 0);
    this.trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 });
    this.leafGeos = Array.from({ length: 4 }, (_, i) => makeBlob(1, 1, 0.5, i * 5.3));
    this.leafMats = [0x2f4a22, 0x3a5526, 0x2a4020].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }));
    this.bushMat = new THREE.MeshStandardMaterial({ color: 0x2b3f1e, roughness: 0.95, flatShading: true });
    this.postGeo = new THREE.BoxGeometry(0.14, 1.2, 0.14);
    this.postGeo.translate(0, 0.6, 0);
    this.railGeo = new THREE.BoxGeometry(0.08, 0.1, 1);
    this.woodMat = new THREE.MeshStandardMaterial({ color: 0x6b5842, roughness: 1 });
  }

  _spawnChunk(cx, cz) {
    const rnd = cellRandom(cx, cz);
    const group = new THREE.Group();
    const colliders = [];
    const x0 = cx * this.cell, z0 = cz * this.cell;
    const nearSpawn = (x, z) => x * x + z * z < 12 * 12;
    const place = (fn) => {
      const x = x0 + rnd() * this.cell, z = z0 + rnd() * this.cell;
      if (nearSpawn(x, z)) return;
      fn(x, z, heightAt(x, z));
    };

    // rocks: a few small scattered + occasional big boulder
    const nRocks = Math.floor(rnd() * 3.2);
    for (let i = 0; i < nRocks; i++) place((x, z, y) => {
      const s = 0.25 + rnd() * rnd() * 1.3;
      const m = new THREE.Mesh(this.rockGeos[Math.floor(rnd() * 6)], this.rockMat);
      m.position.set(x, y - s * 0.12, z);
      m.scale.set(s * (0.8 + rnd() * 0.5), s * (0.7 + rnd() * 0.5), s * (0.8 + rnd() * 0.5));
      m.rotation.y = rnd() * Math.PI * 2;
      m.castShadow = s > 0.5; m.receiveShadow = true;
      group.add(m);
      colliders.push({ x, z, r: s * 1.0 });
    });
    if (rnd() < 0.18) place((x, z, y) => {
      const s = 1.6 + rnd() * 1.8;
      const m = new THREE.Mesh(this.rockGeos[Math.floor(rnd() * 6)], this.rockMat);
      m.position.set(x, y - s * 0.15, z);
      m.scale.set(s * 1.3, s * (0.8 + rnd() * 0.4), s);
      m.rotation.y = rnd() * Math.PI * 2;
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
      colliders.push({ x, z, r: s * 1.15 });
    });

    // trees: sparse, sometimes in small groves
    const treeChance = noise2(cx * 0.35, cz * 0.35);
    const nTrees = rnd() < treeChance * 0.55 ? 1 + Math.floor(rnd() * 3 * treeChance) : 0;
    for (let i = 0; i < nTrees; i++) place((x, z, y) => {
      const tree = new THREE.Group();
      const hgt = 3 + rnd() * 3;
      const trunk = new THREE.Mesh(this.trunkGeo, this.trunkMat);
      trunk.scale.set(1, hgt, 1);
      trunk.castShadow = true;
      tree.add(trunk);
      const leafMat = this.leafMats[Math.floor(rnd() * 3)];
      const blobs = 3 + Math.floor(rnd() * 3);
      for (let b = 0; b < blobs; b++) {
        const leaf = new THREE.Mesh(this.leafGeos[Math.floor(rnd() * 4)], leafMat);
        const r = 1.2 + rnd() * 1.1;
        leaf.scale.setScalar(r);
        leaf.position.set((rnd() - 0.5) * 2.2, hgt + (rnd() - 0.3) * 1.6, (rnd() - 0.5) * 2.2);
        leaf.castShadow = true;
        tree.add(leaf);
      }
      tree.position.set(x, y - 0.1, z);
      tree.rotation.y = rnd() * 6.28;
      tree.userData.sway = rnd() * 10;
      group.add(tree);
      colliders.push({ x, z, r: 0.6 });
    });

    // bushes
    const nBush = Math.floor(rnd() * 2.2);
    for (let i = 0; i < nBush; i++) place((x, z, y) => {
      const s = 0.5 + rnd() * 0.7;
      const m = new THREE.Mesh(this.leafGeos[Math.floor(rnd() * 4)], this.bushMat);
      m.position.set(x, y + s * 0.25, z);
      m.scale.set(s * 1.3, s * 0.8, s * 1.2);
      m.castShadow = true;
      group.add(m);
      colliders.push({ x, z, r: s * 1.1 });
    });

    // occasional old fence line
    if (rnd() < 0.07) {
      const ang = rnd() * Math.PI;
      const dx = Math.cos(ang), dz = Math.sin(ang);
      const sx = x0 + this.cell * 0.5, sz = z0 + this.cell * 0.5;
      if (!nearSpawn(sx, sz)) {
        const n = 5 + Math.floor(rnd() * 5);
        let prev = null;
        for (let k = 0; k < n; k++) {
          const px = sx + dx * (k - n / 2) * 2.4, pz = sz + dz * (k - n / 2) * 2.4;
          const py = heightAt(px, pz);
          const post = new THREE.Mesh(this.postGeo, this.woodMat);
          post.position.set(px, py - 0.1, pz);
          post.rotation.set((rnd() - 0.5) * 0.12, rnd(), (rnd() - 0.5) * 0.12);
          post.castShadow = true;
          group.add(post);
          colliders.push({ x: px, z: pz, r: 0.35 });
          if (prev) {
            for (const hh of [0.45, 0.9]) {
              const rail = new THREE.Mesh(this.railGeo, this.woodMat);
              const a = new THREE.Vector3(prev.x, prev.y + hh, prev.z), b = new THREE.Vector3(px, py + hh, pz);
              rail.position.copy(a).lerp(b, 0.5);
              rail.scale.z = a.distanceTo(b);
              rail.lookAt(b);
              rail.castShadow = true;
              group.add(rail);
            }
            colliders.push({ x: (prev.x + px) / 2, z: (prev.z + pz) / 2, r: 0.5 });
          }
          prev = { x: px, y: py, z: pz };
        }
      }
    }

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
      if (!keep.has(key)) { this.scene.remove(ch.group); this.chunks.delete(key); }
    }
    this.colliders = [];
    for (const ch of this.chunks.values()) this.colliders.push(...ch.colliders);
    return true;
  }

  // nearest obstacles -> grass shader, so blades don't poke through rocks
  nearest(px, pz, out) {
    const list = this.colliders
      .map(c => ({ c, d: (c.x - px) ** 2 + (c.z - pz) ** 2 - c.r * c.r }))
      .filter(o => o.c.r > 0.45)
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < out.length; i++) {
      const o = list[i];
      if (o) out[i].set(o.c.x, o.c.z, o.c.r, 0); else out[i].set(0, 0, 0, 0);
    }
  }

  animateTrees(time, wind) {
    for (const ch of this.chunks.values()) {
      for (const obj of ch.group.children) {
        if (obj.userData.sway !== undefined) {
          const s = obj.userData.sway;
          obj.rotation.z = Math.sin(time * 0.9 + s) * 0.012 * (0.5 + wind);
          obj.rotation.x = Math.cos(time * 0.7 + s) * 0.01 * (0.5 + wind);
        }
      }
    }
  }
}
