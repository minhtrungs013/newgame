import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Height field = smooth rolling hills (baseHeight) minus pond bowls.
// The JS and GLSL versions MUST stay identical: grass blades compute their ground
// height on the GPU while the terrain mesh, cow and props use the CPU version.
// ---------------------------------------------------------------------------
export function baseHeight(x, z) {
  return 9.0 * Math.sin(x * 0.0045 + 0.5) * Math.sin(z * 0.0038)
       + 4.0 * Math.sin(x * 0.011) * Math.cos(z * 0.013)
       + 2.0 * Math.sin(x * 0.027 + z * 0.019 + 1.3)
       + 0.9 * Math.sin(x * 0.061 - z * 0.047)
       + 0.4 * Math.cos(x * 0.13 + z * 0.11);
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------- ponds ----------
// One possible pond per POND_CELL x POND_CELL area, chosen deterministically so every
// player (and every restart) gets the same map. There is always one near spawn.
export const POND_CELL = 150;
export const MAX_PONDS = 8; // how many nearby ponds the grass shader knows about
const pondCache = new Map();

function cellRng(cx, cz) {
  let s = (cx * 374761393 + cz * 668265263) ^ 0x2545f491;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function pondInCell(cx, cz) {
  const key = cx * 100003 + cz;
  if (pondCache.has(key)) return pondCache.get(key);
  const r = cellRng(cx, cz);
  let pond = null;
  const home = cx === 0 && cz === 0;
  if (home || r() < 0.55) {
    const x = home ? 34 : (cx + 0.2 + r() * 0.6) * POND_CELL;
    const z = home ? 24 : (cz + 0.2 + r() * 0.6) * POND_CELL;
    const R = home ? 13 : 9 + r() * 13;
    let D = 2.4 + r() * 1.4;
    // water level: just below the lowest point of the rim, so water never spills out
    let rim = Infinity;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      rim = Math.min(rim, baseHeight(x + Math.cos(a) * R * 1.5, z + Math.sin(a) * R * 1.5));
    }
    const level = rim - 0.35;
    const center = baseHeight(x, z);
    if (center - D > level - 1.0) D = center - level + 1.0; // make sure the middle is under water
    if (D < 7) pond = { x, z, R, D, level, id: key };
  }
  pondCache.set(key, pond);
  return pond;
}

// ponds whose bowl could touch (x, z)
export function pondsNear(x, z, ring = 1) {
  const cx = Math.floor(x / POND_CELL), cz = Math.floor(z / POND_CELL);
  const out = [];
  for (let dz = -ring; dz <= ring; dz++) {
    for (let dx = -ring; dx <= ring; dx++) {
      const p = pondInCell(cx + dx, cz + dz);
      if (p) out.push(p);
    }
  }
  return out;
}

function carve(p, x, z) {
  const d = Math.hypot(x - p.x, z - p.z) / p.R;
  return d >= 1.5 ? 0 : p.D * (1 - smoothstep(0.55, 1.5, d));
}

export function heightAt(x, z) {
  let h = baseHeight(x, z);
  for (const p of pondsNear(x, z)) h -= carve(p, x, z);
  return h;
}

// water at (x, z)? -> { pond, level, depth } or null
export function waterAt(x, z) {
  for (const p of pondsNear(x, z)) {
    if (Math.hypot(x - p.x, z - p.z) > p.R * 1.5) continue;
    const depth = p.level - heightAt(x, z);
    if (depth > 0) return { pond: p, level: p.level, depth };
  }
  return null;
}

export const HEIGHT_GLSL = /* glsl */`
uniform vec4 uPonds[${MAX_PONDS}];      // x, z, radius, depth (radius 0 = unused)
uniform float uPondLevel[${MAX_PONDS}];
uniform int uPondCount;                // only the first uPondCount entries are used
float terrainBase(vec2 p) {
  float x = p.x, z = p.y;
  return 9.0 * sin(x * 0.0045 + 0.5) * sin(z * 0.0038)
       + 4.0 * sin(x * 0.011) * cos(z * 0.013)
       + 2.0 * sin(x * 0.027 + z * 0.019 + 1.3)
       + 0.9 * sin(x * 0.061 - z * 0.047)
       + 0.4 * cos(x * 0.13 + z * 0.11);
}
float terrainH(vec2 p) {
  float h = terrainBase(p);
  for (int i = 0; i < ${MAX_PONDS}; i++) {
    if (i >= uPondCount) break;
    vec4 q = uPonds[i];
    h -= q.w * (1.0 - smoothstep(0.55, 1.5, length(p - q.xy) / q.z));
  }
  return h;
}
float waterLevel(vec2 p) {
  float l = -1e4;
  for (int i = 0; i < ${MAX_PONDS}; i++) {
    if (i >= uPondCount) break;
    vec4 q = uPonds[i];
    if (length(p - q.xy) < q.z * 1.5) l = max(l, uPondLevel[i]);
  }
  return l;
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

// Fill the shader's pond uniforms with the ponds whose bowl reaches within `range` of (x, z).
// Returns how many were written (the shader stops looping after that).
export function fillPondUniforms(x, z, pondsVec4, levels, range = 80) {
  const list = pondsNear(x, z, 1)
    .filter((p) => Math.hypot(p.x - x, p.z - z) < p.R * 1.5 + range)
    .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  for (let i = 0; i < MAX_PONDS; i++) {
    const p = list[i];
    if (p) { pondsVec4[i].set(p.x, p.z, p.R, p.D); levels[i] = p.level; }
    else { pondsVec4[i].set(0, 0, 0, 0); levels[i] = -1e4; }
  }
  return Math.min(list.length, MAX_PONDS);
}

// Cheap deterministic 2D value noise on the CPU (for terrain colouring / placement).
function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uz;
}

// A large terrain mesh that re-centres itself around the player -> endless world.
export class Terrain {
  constructor(scene, size = 800, segments = 200) {
    this.size = size;
    this.step = size / segments;
    this.geo = new THREE.PlaneGeometry(size, size, segments, segments);
    this.geo.rotateX(-Math.PI / 2);
    this.base = this.geo.attributes.position.array.slice();
    const count = this.geo.attributes.position.count;
    this.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    // seasons: tint the ground and cover it with snow in winter (patchy on slopes)
    this.seasonUniforms = { uSnow: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) } };
    this.mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.seasonUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
varying vec3 vWorldN;
varying vec3 vWorldP;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vWorldN = normal; vWorldP = position;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uSnow;
uniform vec3 uTint;
varying vec3 vWorldN;
varying vec3 vWorldP;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb *= uTint;
  float flatK = smoothstep(0.55, 0.9, vWorldN.y);
  float patchy = 0.75 + 0.25 * sin(vWorldP.x * 0.21) * sin(vWorldP.z * 0.17);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.82, 0.88), clamp(uSnow * flatK * patchy * 1.1, 0.0, 0.92));`);
    };
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.cx = Infinity; this.cz = Infinity;
    this._cA = new THREE.Color(0x2c3f1c);
    this._cB = new THREE.Color(0x3d4526);
    this._cC = new THREE.Color(0x223318);
    this._sand = new THREE.Color(0x7a6a48);
    this._mud = new THREE.Color(0x3a3222);
    this._tmp = new THREE.Color();
  }

  update(px, pz) {
    const snap = this.step * 5;
    const cx = Math.round(px / snap) * snap, cz = Math.round(pz / snap) * snap;
    if (Math.abs(cx - this.cx) < snap * 3 && Math.abs(cz - this.cz) < snap * 3) return;
    this.cx = cx; this.cz = cz;
    const pos = this.geo.attributes.position.array;
    const col = this.geo.attributes.color.array;
    const b = this.base, c = this._tmp;
    for (let i = 0; i < pos.length; i += 3) {
      const x = b[i] + cx, z = b[i + 2] + cz;
      const h = heightAt(x, z);
      pos[i] = x; pos[i + 1] = h; pos[i + 2] = z;
      const n = noise2(x * 0.03, z * 0.03);
      const n2 = noise2(x * 0.11 + 40, z * 0.11);
      c.copy(this._cA).lerp(this._cB, Math.min(1, n * 0.9 + Math.max(0, h) * 0.02)).lerp(this._cC, n2 * 0.5);
      // muddy / sandy shores around ponds
      for (const p of pondsNear(x, z)) {
        if (Math.hypot(x - p.x, z - p.z) > p.R * 1.6) continue;
        const above = h - p.level;
        c.lerp(this._sand, (1 - smoothstep(0.1, 0.9, above)) * 0.85);
        c.lerp(this._mud, smoothstep(0.0, -1.2, above));
      }
      col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}
