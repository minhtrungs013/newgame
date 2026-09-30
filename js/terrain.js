import * as THREE from 'three';

// Height function — the JS and GLSL versions MUST stay identical, because grass
// blades compute their ground height on the GPU while the cow/rocks use the CPU.
export function heightAt(x, z) {
  return 9.0 * Math.sin(x * 0.0045 + 0.5) * Math.sin(z * 0.0038)
       + 4.0 * Math.sin(x * 0.011) * Math.cos(z * 0.013)
       + 2.0 * Math.sin(x * 0.027 + z * 0.019 + 1.3)
       + 0.9 * Math.sin(x * 0.061 - z * 0.047)
       + 0.4 * Math.cos(x * 0.13 + z * 0.11);
}

export const HEIGHT_GLSL = /* glsl */`
float terrainH(vec2 p) {
  float x = p.x, z = p.y;
  return 9.0 * sin(x * 0.0045 + 0.5) * sin(z * 0.0038)
       + 4.0 * sin(x * 0.011) * cos(z * 0.013)
       + 2.0 * sin(x * 0.027 + z * 0.019 + 1.3)
       + 0.9 * sin(x * 0.061 - z * 0.047)
       + 0.4 * cos(x * 0.13 + z * 0.11);
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
  constructor(scene, size = 800, segments = 160) {
    this.size = size;
    this.step = size / segments;
    this.geo = new THREE.PlaneGeometry(size, size, segments, segments);
    this.geo.rotateX(-Math.PI / 2);
    this.base = this.geo.attributes.position.array.slice();
    const count = this.geo.attributes.position.count;
    this.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.cx = Infinity; this.cz = Infinity;
    this._cA = new THREE.Color(0x2c3f1c);
    this._cB = new THREE.Color(0x3d4526);
    this._cC = new THREE.Color(0x223318);
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
      col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}
