import * as THREE from 'three';
import { HEIGHT_GLSL } from './terrain.js';

export const MAX_OBSTACLES = 12;
export const MAX_COWS = 8;
const FAR = 1e5;

const commonUniforms = () => ({
  uTime: { value: 0 },
  uCenter: { value: new THREE.Vector2() },
  uPatch: { value: 90 },
  uWind: { value: 0.6 },
  uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
  // xy = cow position, zw = its blob-shadow position
  uCows: { value: Array.from({ length: MAX_COWS }, () => new THREE.Vector4(FAR, FAR, FAR, FAR)) },
  uShadowStr: { value: 0.5 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uAmbient: { value: new THREE.Color(0.4, 0.4, 0.4) },
  uWet: { value: 0 },
  uObstacles: { value: Array.from({ length: MAX_OBSTACLES }, () => new THREE.Vector4(0, 0, 0, 0)) },
});

// Place a blade inside the wrapping patch so blades stay fixed in world space
// while the patch itself travels with the player.
const WRAP_GLSL = /* glsl */`
vec2 wrapPos(vec2 off) {
  vec2 origin = uCenter - uPatch * 0.5;
  return origin + mod(off - origin, uPatch);
}
float obstacleMask(vec2 wp) {
  float m = 1.0;
  for (int i = 0; i < ${MAX_OBSTACLES}; i++) {
    vec4 o = uObstacles[i];
    if (o.z > 0.0) m *= smoothstep(o.z * 0.75, o.z * 1.05, length(wp - o.xy));
  }
  return m;
}
`;

const grassVert = /* glsl */`
uniform float uTime, uPatch, uWind, uShadowStr, uWet;
uniform vec2 uCenter, uWindDir;
uniform vec3 uSunDir, uSunColor, uAmbient;
uniform vec4 uCows[${MAX_COWS}];
uniform vec4 uObstacles[${MAX_OBSTACLES}];
attribute vec2 aOffset;
attribute vec4 aParams; // angle, heightScale, widthScale, seed
varying vec3 vColor;
#include <fog_pars_vertex>
${HEIGHT_GLSL}
${WRAP_GLSL}

void main() {
  vec2 wp = wrapPos(aOffset);
  float dist = length(wp - uCenter) / (uPatch * 0.5);
  float fade = 1.0 - smoothstep(0.72, 1.0, dist);
  float patchN = vnoise(wp * 0.07);
  float patchN2 = vnoise(wp * 0.23 + 17.0);
  fade *= obstacleMask(wp);

  float t = position.y;
  float hgt = 0.62 * aParams.y * (0.55 + 0.75 * patchN) * fade;
  float wid = 0.075 * aParams.z * (1.0 - t * 0.9);

  float a = aParams.x;
  vec2 face = vec2(cos(a), sin(a));
  vec2 side = vec2(-face.y, face.x);

  // Wind: large rolling gusts + per-blade flutter.
  float gust = vnoise(wp * 0.045 - uWindDir * uTime * 0.9);
  float wave = sin(uTime * 1.6 + dot(wp, uWindDir) * 0.35 + aParams.w * 2.0) * 0.5 + 0.5;
  float windStr = uWind * (0.2 + 0.9 * gust) * (0.55 + 0.45 * wave);
  float flutter = sin(uTime * (3.5 + aParams.w * 2.5) + aParams.w * 40.0) * 0.12 * (0.3 + uWind);
  vec2 bend = uWindDir * windStr + face * (aParams.w - 0.5) * 0.7 + side * flutter;

  // Grass gets pushed aside by every cow nearby, and darkened under their shadows.
  float shadow = 1.0;
  for (int i = 0; i < ${MAX_COWS}; i++) {
    vec4 c = uCows[i];
    vec2 toB = wp - c.xy;
    float cd = length(toB);
    float push = 1.0 - smoothstep(0.35, 1.25, cd);
    bend += (toB / max(cd, 0.001)) * push * 1.6;
    shadow *= mix(1.0 - uShadowStr, 1.0, smoothstep(0.5, 1.5, length(wp - c.zw)));
  }
  float bl = length(bend);

  float curve = t * t;
  vec3 p;
  p.xz = wp + side * position.x * wid + bend * curve * hgt * 0.75;
  p.y = terrainH(wp) - 0.05 + t * hgt / (1.0 + 0.45 * bl * bl * t);

  // Lighting (cheap, vertex-based)
  vec3 n = normalize(vec3(face.x * 0.7 + bend.x * 0.4, 0.9, face.y * 0.7 + bend.y * 0.4));
  float diff = abs(dot(n, uSunDir)) * 0.6 + max(uSunDir.y, 0.0) * 0.4;
  float trans = pow(max(dot(normalize(vec3(-uWindDir.x, 0.3, -uWindDir.y)), uSunDir), 0.0), 2.0) * t * 0.25;

  vec3 cBase = vec3(0.02, 0.05, 0.01);
  vec3 cMid  = mix(vec3(0.05, 0.13, 0.02), vec3(0.09, 0.14, 0.03), patchN2);
  vec3 cTip  = mix(vec3(0.16, 0.28, 0.05), vec3(0.3, 0.32, 0.08), aParams.w * patchN);
  vec3 col = mix(cBase, cMid, smoothstep(0.0, 0.5, t));
  col = mix(col, cTip, smoothstep(0.35, 1.0, t));
  col *= 0.7 + 0.6 * patchN;
  col = mix(col, col * vec3(0.8, 0.95, 0.85), uWet * 0.6);

  float ao = mix(0.3, 1.0, smoothstep(0.0, 0.8, t));
  vec3 light = uAmbient * 0.9 + uSunColor * (diff * shadow + trans);
  vColor = col * light * ao + uWet * 0.02 * t * uSunColor;

  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const simpleFrag = /* glsl */`
varying vec3 vColor;
#include <common>
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(vColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const flowerVert = /* glsl */`
uniform float uTime, uPatch, uWind;
uniform vec2 uCenter, uWindDir;
uniform vec3 uSunColor, uAmbient;
uniform vec4 uCows[${MAX_COWS}];
uniform vec4 uObstacles[${MAX_OBSTACLES}];
attribute vec2 aOffset;
attribute vec3 aColor;
attribute float aSize;
varying vec3 vColor;
varying float vAlpha;
#include <fog_pars_vertex>
${HEIGHT_GLSL}
${WRAP_GLSL}
void main() {
  vec2 wp = wrapPos(aOffset);
  float dist = length(wp - uCenter) / (uPatch * 0.5);
  float fade = (1.0 - smoothstep(0.6, 0.95, dist)) * obstacleMask(wp);
  float gust = vnoise(wp * 0.045 - uWindDir * uTime * 0.9);
  vec2 sway = uWindDir * uWind * gust * 0.15;
  for (int i = 0; i < ${MAX_COWS}; i++) {
    vec2 toB = wp - uCows[i].xy; float cd = length(toB);
    sway += (toB / max(cd, 0.001)) * (1.0 - smoothstep(0.3, 1.2, cd)) * 0.3;
  }
  vec3 p = vec3(wp.x + sway.x, terrainH(wp) + 0.42 * aSize * fade, wp.y + sway.y);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = min(aSize * 55.0 / -mvPosition.z, 7.0) * fade;
  vColor = aColor * (uAmbient + uSunColor * 0.6);
  vAlpha = fade;
  #include <fog_vertex>
}
`;
const flowerFrag = /* glsl */`
varying vec3 vColor;
varying float vAlpha;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  if (r > 0.5 || vAlpha < 0.02) discard;
  float center = smoothstep(0.18, 0.08, r);
  gl_FragColor = vec4(mix(vColor, vColor * vec3(1.2, 0.9, 0.3), center), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export class Grass {
  constructor(scene) {
    this.scene = scene;
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, commonUniforms()]);
    // keep the obstacle vectors as live references (merge() clones them)
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: grassVert,
      fragmentShader: simpleFrag,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.flowerMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: flowerVert,
      fragmentShader: flowerFrag,
      fog: true,
    });
    this.mesh = null;
    this.flowers = null;
  }

  build({ blades, patch, segs, flowers }) {
    this.dispose();
    this.uniforms.uPatch.value = patch;
    const rnd = mulberry32(1337);

    // Blade template: `segs` quads tapering to a tip.
    const pos = [];
    const idx = [];
    for (let i = 0; i < segs; i++) {
      const y = i / segs;
      pos.push(-0.5, y, 0, 0.5, y, 0);
    }
    pos.push(0, 1, 0);
    for (let i = 0; i < segs - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const last = (segs - 1) * 2;
    idx.push(last, last + 1, last + 2);

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const offsets = new Float32Array(blades * 2);
    const params = new Float32Array(blades * 4);
    for (let i = 0; i < blades; i++) {
      offsets[i * 2] = rnd() * patch;
      offsets[i * 2 + 1] = rnd() * patch;
      params[i * 4] = rnd() * Math.PI * 2;
      params[i * 4 + 1] = 0.55 + rnd() * 0.9;
      params[i * 4 + 2] = 0.7 + rnd() * 0.6;
      params[i * 4 + 3] = rnd();
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 2));
    geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
    geo.instanceCount = blades;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);

    // Wild flowers
    const fGeo = new THREE.BufferGeometry();
    const fo = new Float32Array(flowers * 2);
    const fc = new Float32Array(flowers * 3);
    const fs = new Float32Array(flowers);
    const palette = [[1, 0.78, 0.2], [1, 1, 0.9], [0.75, 0.8, 1], [1, 0.6, 0.25], [0.95, 0.9, 0.4]];
    for (let i = 0; i < flowers; i++) {
      // clustered placement
      const cx = rnd() * patch, cz = rnd() * patch;
      fo[i * 2] = cx; fo[i * 2 + 1] = cz;
      const c = palette[Math.floor(rnd() * palette.length)];
      fc[i * 3] = c[0]; fc[i * 3 + 1] = c[1]; fc[i * 3 + 2] = c[2];
      fs[i] = 0.7 + rnd() * 0.6;
    }
    fGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flowers * 3), 3));
    fGeo.setAttribute('aOffset', new THREE.BufferAttribute(fo, 2));
    fGeo.setAttribute('aColor', new THREE.BufferAttribute(fc, 3));
    fGeo.setAttribute('aSize', new THREE.BufferAttribute(fs, 1));
    this.flowers = new THREE.Points(fGeo, this.flowerMat);
    this.flowers.frustumCulled = false;
    this.scene.add(this.flowers);
    this.bladeCount = blades;
  }

  dispose() {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    if (this.flowers) { this.scene.remove(this.flowers); this.flowers.geometry.dispose(); this.flowers = null; }
  }
}
