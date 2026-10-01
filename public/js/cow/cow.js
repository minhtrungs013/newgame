import * as THREE from 'three';
import { COW_MODEL, makeModelHide } from './cowmodel.js';

// use the realistic 3D model (when it loaded) instead of the procedural cow
let useModel = true;
export function setCowModel(on) { useModel = on; }

// A cow's appearance ("look"). Kept small & JSON-friendly so it can be sent over the network.
export const PATTERNS = ['none', 'few', 'many', 'patches'];
export const HORNS = ['none', 'short', 'long'];
export const ACCESSORIES = ['none', 'bell', 'hat', 'flowers', 'scarf'];
export const PRESETS = {
  holstein: { base: '#f4f1ea', spot: '#141212', pattern: 'many', snout: '#d9a39a', horns: 'short', size: 1, acc: 'none', accColor: '#d83a3a' },
  brown:    { base: '#f2ebe0', spot: '#5a2e16', pattern: 'many', snout: '#d9a39a', horns: 'short', size: 1, acc: 'none', accColor: '#d83a3a' },
  jersey:   { base: '#b9804a', spot: '#7a4a26', pattern: 'few',  snout: '#3a302a', horns: 'short', size: 1, acc: 'none', accColor: '#d83a3a' },
  black:    { base: '#1f1d1c', spot: '#f0ede6', pattern: 'few',  snout: '#4a403c', horns: 'long',  size: 1, acc: 'none', accColor: '#d83a3a' },
};
export const DEFAULT_LOOK = PRESETS.holstein;
const HEX = /^#[0-9a-f]{6}$/i;

// Accept anything (localStorage, network) and return a safe, complete look.
export function normalizeLook(l) {
  if (typeof l === 'string' && PRESETS[l]) l = PRESETS[l];
  l = l && typeof l === 'object' ? l : {};
  const d = DEFAULT_LOOK;
  const hex = (v, def) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : def);
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  const size = typeof l.size === 'number' && Number.isFinite(l.size) ? Math.min(1.2, Math.max(0.85, l.size)) : 1;
  return {
    base: hex(l.base, d.base), spot: hex(l.spot, d.spot), pattern: pick(l.pattern, PATTERNS, d.pattern),
    snout: hex(l.snout, d.snout), horns: pick(l.horns, HORNS, d.horns), size: Math.round(size * 100) / 100,
    acc: pick(l.acc, ACCESSORIES, 'none'), accColor: hex(l.accColor, d.accColor),
  };
}

export function randomLook() {
  const r = (a) => a[Math.floor(Math.random() * a.length)];
  const hsl = (h, s, l) => '#' + new THREE.Color().setHSL(h, s, l).getHexString();
  const bases = [hsl(0.08, 0.1, 0.93), hsl(0.07, 0.45, 0.5), hsl(0.06, 0.5, 0.3), hsl(0, 0, 0.12), hsl(0.1, 0.35, 0.75), hsl(Math.random(), 0.5, 0.7)];
  const base = r(bases);
  const light = new THREE.Color(base).getHSL({}).l > 0.5;
  return normalizeLook({
    base,
    spot: light ? r(['#141212', '#5a2e16', '#4a2c18', hsl(Math.random(), 0.6, 0.35)]) : r(['#f0ede6', '#e8d8c0', hsl(Math.random(), 0.5, 0.75)]),
    pattern: r(PATTERNS), snout: r(['#d9a39a', '#3a302a', '#8a7a74', '#e8b8a8']),
    horns: r(HORNS), size: 0.88 + Math.random() * 0.3,
    acc: r(ACCESSORIES), accColor: hsl(Math.random(), 0.7, 0.5),
  });
}

export const JUMP_SPEED = 6.2;
export const GRAVITY = 19;
export const BUTT_TIME = 0.6;   // seconds for the whole headbutt move
export const BUTT_HIT_AT = 0.45; // fraction of BUTT_TIME when the head connects
export const CALF_SIZE = 0.5;   // body scale of a new-born calf (age 0)

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (x, mu, s) => Math.exp(-((x - mu) * (x - mu)) / (2 * s * s));

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

// Merge duplicated seam/pole vertices so smooth normals have no visible seams.
function weld(geo) {
  const pos = geo.attributes.position;
  const idx = geo.index ? geo.index.array : Array.from({ length: pos.count }, (_, i) => i);
  const map = new Map(), out = [], remap = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let j = map.get(key);
    if (j === undefined) { j = out.length / 3; map.set(key, j); out.push(x, y, z); }
    remap[i] = j;
  }
  const tri = [];
  for (let k = 0; k < idx.length; k += 3) {
    const a = remap[idx[k]], b = remap[idx[k + 1]], c = remap[idx[k + 2]];
    if (a !== b && b !== c && a !== c) tri.push(a, b, c);
  }
  geo.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  g.setIndex(tri);
  g.computeVertexNormals();
  return g;
}

// Unit sphere with its poles on the z axis, reshaped by fn(x, y, z, t) -> [X, Y, Z]
// where t runs 0 (back pole) .. 1 (front pole).
function sculpt(wSeg, hSeg, fn) {
  const g = new THREE.SphereGeometry(1, wSeg, hSeg);
  g.rotateX(Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const [X, Y, Z] = fn(x, y, z, (z + 1) / 2);
    p.setXYZ(i, X, Y, Z);
  }
  return weld(g);
}

// Tube along a curve whose cross-section radius (and ellipse) varies with t.
function taperedTube(points, tubular, radial, radiusAt, squashX = 1, squashLowY = 1) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  const p = g.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const t = Math.floor(i / (radial + 1)) / tubular;
    curve.getPointAt(t, c);
    v.fromBufferAttribute(p, i).sub(c).multiplyScalar(radiusAt(t));
    v.x *= squashX;
    if (v.y < 0) v.y *= squashLowY;
    p.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
  }
  return { geo: weld(g), curve };
}

// Surface of revolution around Y from [radius, y] pairs (top -> bottom).
function lathe(profile, seg = 18) {
  return weld(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0005), y)), seg));
}

// ---------------------------------------------------------------------------
// Hide shader: seamless 3D-noise patches with ragged edges + fur grain + fur bump.
// Pattern coordinates come from each vertex's rest position in cow space (aRest),
// so markings flow continuously across body, neck, head and legs.
// ---------------------------------------------------------------------------
const NOISE_GLSL = /* glsl */`
vec3 cw_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 cw_mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 cw_permute(vec4 x) { return cw_mod289(((x * 34.0) + 1.0) * x); }
vec4 cw_invSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float cw_snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = cw_mod289(i);
  vec4 p = cw_permute(cw_permute(cw_permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = cw_invSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float cw_fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * cw_snoise(p); p = p * 2.03 + 17.1; a *= 0.45; }
  return v;
}
vec3 cw_perturb(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = normalize(dFdx(surfPos)), sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm), r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

const PATTERN_PARAMS = { none: [1.2, 9.0], few: [1.15, 0.3], many: [1.25, 0.03], patches: [0.75, 0.0] }; // [freq, threshold]

function makeHideMaterial(look, seed) {
  const [freq, thresh] = PATTERN_PARAMS[look.pattern];
  const uniforms = {
    uBase: { value: new THREE.Color(look.base) },
    uSpot: { value: new THREE.Color(look.spot) },
    uFreq: { value: freq },
    uThresh: { value: thresh },
    uSeed: { value: new THREE.Vector3((seed * 0.37) % 53, (seed * 0.71) % 47, (seed * 1.13) % 59) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0 });
  mat.customProgramCacheKey = () => 'cow-hide-v2';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRest;\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = aRest;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uBase, uSpot, uSeed;
uniform float uFreq, uThresh;
varying vec3 vRest;
${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `
  vec3 cp = vRest;
  float f = cw_fbm(cp * uFreq + uSeed)
          + cw_snoise(cp * 6.0 + uSeed * 1.7) * 0.07
          + cw_snoise(cp * 17.0 - uSeed) * 0.03;
  float spotK = smoothstep(uThresh - 0.012, uThresh + 0.012, f);
  // classic white areas: socks, belly line, face blaze
  spotK *= smoothstep(0.30, 0.46, cp.y);
  spotK *= 1.0 - (1.0 - smoothstep(0.62, 0.72, cp.y)) * (1.0 - smoothstep(0.18, 0.3, abs(cp.x))) * step(-1.0, cp.z) * step(cp.z, 0.9);
  spotK *= 1.0 - step(1.42, cp.z) * (1.0 - smoothstep(0.03, 0.075, abs(cp.x)));
  float fur1 = cw_snoise(cp * vec3(150.0, 60.0, 150.0));
  float fur2 = cw_snoise(cp * vec3(340.0, 130.0, 340.0));
  vec3 hide = mix(uBase, uSpot, spotK);
  hide *= 0.93 + 0.05 * fur1 + 0.035 * fur2;
  diffuseColor.rgb *= hide;
`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + fur2 * 0.08, 0.0, 1.0);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    float furH = fur1 * 0.6 + fur2 * 0.4;
    float furFade = 1.0 - smoothstep(3.0, 14.0, length(vViewPosition));
    vec2 dH = vec2(dFdx(furH), dFdy(furH)) * 0.012 * furFade;
    normal = cw_perturb(-vViewPosition, normal, dH, faceDirection);
  }`);
  };
  mat.userData.hide = true;
  return mat;
}

// ---------------------------------------------------------------------------
// Shapes (cow space: ground at y = 0, facing +z, adult ~2.2 m long)
// ---------------------------------------------------------------------------
function barrelGeometry() {
  return sculpt(80, 56, (x, y, z, t) => {
    const hw = 0.37 + 0.05 * Math.sin(Math.PI * t) + 0.035 * gauss(t, 0.16, 0.1) - 0.05 * gauss(t, 0.97, 0.07);
    const top = 0.33 + 0.035 * gauss(t, 0.17, 0.1) + 0.05 * gauss(t, 0.84, 0.12);
    const bot = 0.39 + 0.075 * Math.sin(Math.PI * t) - 0.06 * gauss(t, 0.02, 0.1);
    const sx = Math.sign(x) * Math.pow(Math.abs(x), 0.9);
    const Y = y > 0 ? Math.pow(y, 0.85) * top : y * bot;
    // flatter rump end
    const Z = z < 0 ? -Math.pow(-z, 1.25) * 1.04 : z * 1.0;
    return [sx * hw, Y, Z];
  });
}

function skullGeometry() {
  return sculpt(56, 40, (x, y, z, t) => {
    const halfW = 0.2 * (1 - t) + 0.12 * t + 0.03 * gauss(t, 0.3, 0.14);
    const top = 0.165 * (1 - t) + 0.095 * t;
    const bot = 0.15 * (1 - t) + 0.095 * t + 0.035 * gauss(t, 0.45, 0.15);
    const yc = -0.02 - 0.03 * t;
    const sx = Math.sign(x) * Math.pow(Math.abs(x), 0.85);
    const Y = (y > 0 ? Math.pow(y, 0.75) * top : y * bot) + yc;
    return [sx * halfW, Y, t * 0.62 - 0.08];
  });
}

export class Cow {
  constructor(scene, { look, coat, seed = 11, age = 1 } = {}) {
    const L = this.look = normalizeLook(look || PRESETS[coat] || DEFAULT_LOOK);
    const model = this.model = useModel ? COW_MODEL : null;
    this.adultSize = L.size;
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    scene.add(this.root);

    const hide = makeHideMaterial(L, seed);
    const skin = new THREE.MeshStandardMaterial({ color: L.snout, roughness: 0.5 });
    const udderMat = new THREE.MeshStandardMaterial({ color: 0xe0a89c, roughness: 0.55 });
    const earInner = new THREE.MeshStandardMaterial({ color: 0xd99a90, roughness: 0.7, side: THREE.DoubleSide });
    const hornMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 });
    const hoof = new THREE.MeshStandardMaterial({ color: 0x2a221e, roughness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x241816, roughness: 0.6 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x3a2214, roughness: 0.08 });
    const pupil = new THREE.MeshStandardMaterial({ color: 0x050303, roughness: 0.05 });
    this.materials = [hide, skin, udderMat, earInner, hornMat, hoof, dark, eyeMat, pupil];

    let skip = !!model;
    const M = (geo, mat, parent, x = 0, y = 0, z = 0) => {
      if (skip) { geo.dispose(); return new THREE.Object3D(); }
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      parent.add(m);
      return m;
    };

    const body = this.body = new THREE.Group();
    this.root.add(body);

    // --- trunk ---
    this.barrel = M(barrelGeometry(), hide, body, 0, 1.05, -0.05);
    const brisket = M(new THREE.SphereGeometry(0.2, 20, 14), hide, body, 0, 0.82, 0.72);
    brisket.scale.set(1.1, 1, 1.1);

    // udder + teats
    const udder = this.udder = new THREE.Group();
    udder.position.set(0, 0.63, -0.5);
    body.add(udder);
    M(new THREE.SphereGeometry(0.16, 20, 14), udderMat, udder).scale.set(1.15, 0.8, 1.25);
    for (const [x, z] of [[0.07, 0.08], [-0.07, 0.08], [0.07, -0.08], [-0.07, -0.08]]) {
      M(new THREE.CapsuleGeometry(0.018, 0.06, 4, 8), udderMat, udder, x, -0.14, z);
    }

    // --- legs: hip pivot -> upper leg -> knee pivot -> lower leg + hoof ---
    this.legs = [];
    const legDefs = [
      { x: 0.2, z: 0.62, front: true, phase: Math.PI * 0.5 },
      { x: -0.2, z: 0.62, front: true, phase: Math.PI * 1.5 },
      { x: 0.22, z: -0.7, front: false, phase: 0 },
      { x: -0.22, z: -0.7, front: false, phase: Math.PI },
    ];
    const upperFront = [[0, 0.18], [0.13, 0.16], [0.15, 0.02], [0.125, -0.2], [0.088, -0.4], [0.084, -0.48], [0.07, -0.52], [0, -0.53]];
    const upperHind = [[0, 0.2], [0.17, 0.18], [0.19, 0.0], [0.15, -0.2], [0.094, -0.42], [0.1, -0.48], [0.075, -0.53], [0, -0.54]];
    const lower = [[0, 0.06], [0.07, 0.04], [0.074, -0.02], [0.058, -0.1], [0.05, -0.24], [0.062, -0.3], [0.056, -0.345], [0, -0.35]];
    const hoofProfile = [[0, -0.345], [0.052, -0.345], [0.064, -0.4], [0.07, -0.45], [0, -0.45]];
    for (const d of legDefs) {
      const hipP = new THREE.Group();
      hipP.position.set(d.x, 0.95, d.z);
      body.add(hipP);
      const up = M(lathe(d.front ? upperFront : upperHind), hide, hipP);
      up.scale.set(d.front ? 0.75 : 0.68, 1, 1);
      // muscle mass joining the leg to the trunk (shoulder / haunch)
      const mass = M(new THREE.SphereGeometry(1, 20, 14), hide, hipP, d.x > 0 ? -0.05 : 0.05, 0.16, d.front ? 0.02 : 0.0);
      mass.scale.set(d.front ? 0.1 : 0.1, d.front ? 0.24 : 0.24, d.front ? 0.17 : 0.18);
      const knee = new THREE.Group();
      knee.position.y = -0.5;
      hipP.add(knee);
      M(lathe(lower), hide, knee).scale.set(0.85, 1, 1);
      M(lathe(hoofProfile, 14), hoof, knee, 0, 0, 0.012);
      M(new THREE.BoxGeometry(0.008, 0.07, 0.09), dark, knee, 0, -0.415, 0.05); // cleft between the toes
      this.legs.push({ hip: hipP, knee, ...d, lastS: 0 });
    }

    // --- neck ---
    const neck = this.neck = new THREE.Group();
    neck.position.set(0, 1.22, 0.78);
    body.add(neck);
    const neckTube = taperedTube(
      [new THREE.Vector3(0, -0.16, -0.14), new THREE.Vector3(0, -0.04, 0.12), new THREE.Vector3(0, 0.09, 0.38), new THREE.Vector3(0, 0.19, 0.6)],
      28, 20, (t) => 0.29 - 0.12 * t, 0.74, 1.15,
    );
    M(neckTube.geo, hide, neck);
    const dewlap = M(new THREE.SphereGeometry(1, 16, 12), hide, neck, 0, -0.2, 0.18);
    dewlap.scale.set(0.07, 0.17, 0.26);

    // --- head (origin at the poll) ---
    const head = this.head = new THREE.Group();
    head.position.set(0, 0.2, 0.6);
    neck.add(head);
    const face = this.face = new THREE.Group();
    face.rotation.x = 0.75; // nose points down/forward
    head.add(face);
    M(skullGeometry(), hide, face);
    const muzzle = M(new THREE.SphereGeometry(1, 28, 20), skin, face, 0, -0.065, 0.55);
    muzzle.scale.set(0.135, 0.1, 0.1);
    for (const s of [1, -1]) {
      const n = M(new THREE.SphereGeometry(1, 12, 8), dark, face, s * 0.055, -0.04, 0.635);
      n.scale.set(0.024, 0.017, 0.012);
      n.rotation.z = s * 0.4;
    }
    const lip = M(new THREE.TorusGeometry(0.075, 0.006, 6, 20, Math.PI), dark, face, 0, -0.12, 0.575);
    lip.rotation.set(Math.PI / 2 - 0.2, 0, Math.PI);
    const chin = M(new THREE.SphereGeometry(1, 16, 10), hide, face, 0, -0.14, 0.47);
    chin.scale.set(0.09, 0.055, 0.1);
    for (const s of [1, -1]) {
      // eye: glossy brown ball, dark pupil, lid ring
      const eye = new THREE.Group();
      eye.position.set(s * 0.178, 0.045, 0.13);
      face.add(eye);
      M(new THREE.SphereGeometry(0.036, 16, 12), eyeMat, eye);
      const pu = M(new THREE.SphereGeometry(0.02, 12, 8), pupil, eye, s * 0.024, 0, 0.004);
      pu.scale.set(0.5, 0.7, 1.2);
      const lid = M(new THREE.TorusGeometry(0.037, 0.011, 8, 20), hide, eye, s * 0.005, 0, 0);
      lid.rotation.y = Math.PI / 2;
      const brow = M(new THREE.SphereGeometry(1, 12, 8), hide, eye, s * 0.004, 0.028, -0.004);
      brow.scale.set(0.03, 0.014, 0.045);
    }

    // ears: cupped, pink inside, sticking out sideways below the horns
    for (const s of [1, -1]) {
      const ear = new THREE.Group();
      ear.position.set(s * 0.17, -0.01, 0.03);
      ear.rotation.z = -s * 0.35;
      head.add(ear);
      const outer = M(new THREE.SphereGeometry(1, 20, 12), hide, ear, s * 0.13, 0, 0);
      outer.scale.set(0.14, 0.075, 0.035);
      const inner = M(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), earInner, ear, s * 0.13, 0, 0.012);
      inner.scale.set(0.12, 0.06, 0.03);
      inner.rotation.x = -Math.PI / 2;
      if (s > 0) this.earL = ear; else this.earR = ear;
    }

    // horns: tapered curve, cream at the base -> dark tip
    this.horns = [];
    for (const s of [1, -1]) {
      const long = L.horns === 'long';
      const k = long ? 1.7 : 1;
      const pts = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(s * 0.09 * k, 0.03 * k, 0.01),
        new THREE.Vector3(s * 0.16 * k, 0.1 * k, 0.04 * k),
        new THREE.Vector3(s * 0.18 * k, 0.19 * k, 0.07 * k),
      ];
      const { geo } = taperedTube(pts, 16, 10, (t) => 0.036 * (1 - t) + 0.006 * t);
      const col = [], cA = new THREE.Color(0xe8dcc0), cB = new THREE.Color(0x3a3228), tmp = new THREE.Color();
      const p = geo.attributes.position, curveLen = pts[3].length() || 1;
      for (let i = 0; i < p.count; i++) {
        const d = Math.min(1, new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).length() / curveLen);
        tmp.copy(cA).lerp(cB, smooth(0.55, 1, d));
        col.push(tmp.r, tmp.g, tmp.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const hornGroup = new THREE.Group();
      hornGroup.position.set(s * 0.1, 0.07, 0.01);
      head.add(hornGroup);
      M(geo, hornMat, hornGroup);
      hornGroup.visible = L.horns !== 'none';
      this.horns.push(hornGroup);
    }
    const poll = M(new THREE.SphereGeometry(1, 16, 10), hide, head, 0, 0.07, 0.02);
    poll.scale.set(0.12, 0.05, 0.08);

    // --- tail: chain of segments, hair switch at the end ---
    this.tail = [];
    let parent = this.tailRoot = new THREE.Group();
    parent.position.set(0, 1.25, -1.0);
    body.add(parent);
    for (let i = 0; i < 8; i++) {
      const seg = new THREE.Group();
      seg.position.y = i === 0 ? 0 : -0.1;
      parent.add(seg);
      const r = 0.03 - i * 0.0018;
      M(new THREE.CylinderGeometry(r * 0.92, r, 0.11, 8), hide, seg, 0, -0.05, 0);
      this.tail.push(seg);
      parent = seg;
    }
    const sw = M(new THREE.SphereGeometry(1, 14, 10), hide, parent, 0, -0.2, 0);
    sw.scale.set(0.055, 0.17, 0.05);

    skip = false;
    if (model) this._applyModel(model, L);
    this._buildAccessory(L, M);
    if (!model) this._bakeRestPositions();

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
    // lying down: `lying` is the wish, `lie` animates 0 (standing) .. 1 (lying)
    this.lying = false;
    this.lie = 0;
    // dead: the cow rolls over onto its side
    this.dead = false;
    this.deadK = 0;
    this.setAge(age);
  }

  // Store every hide vertex's rest-pose position in cow space; the hide shader
  // uses it so the pattern sticks to the skin while legs/neck/tail animate.
  _bakeRestPositions() {
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    this.root.traverse((o) => {
      if (!o.isMesh || !o.material.userData.hide) return;
      m.multiplyMatrices(inv, o.matrixWorld);
      const p = o.geometry.attributes.position;
      const rest = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m);
        rest[i * 3] = v.x; rest[i * 3 + 1] = v.y; rest[i * 3 + 2] = v.z;
      }
      o.geometry.setAttribute('aRest', new THREE.BufferAttribute(rest, 3));
    });
  }

  // age 0 = new-born calf (small, big head, no horns/udder), 1 = adult
  setAge(age) {
    age = Math.min(1, Math.max(0, age));
    this.age = age;
    this.size = CALF_SIZE + (this.adultSize - CALF_SIZE) * age;
    this.root.scale.setScalar(this.size);
    const young = 1 - age;
    this.head.scale.setScalar(1 + 0.32 * young);
    if (!this.model) {
      const sy = 1 - 0.1 * young, sz = 1 - 0.14 * young;
      this.barrel.scale.set(1 - 0.06 * young, sy, sz);
      // keep the tail attached to the (shorter) rump
      this.tailRoot.position.set(0, 1.05 + 0.2 * sy, -0.05 - 0.95 * sz);
    }
    const hornK = smooth(0.25, 0.9, age);
    for (const h of this.horns) {
      h.visible = this.look.horns !== 'none' && hornK > 0.02;
      h.scale.setScalar(Math.max(0.001, hornK) * (h.userData.k || 1));
    }
    const udderK = smooth(0.7, 1, age);
    this.udder.visible = udderK > 0.02;
    this.udder.scale.setScalar(Math.max(0.001, udderK));
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
  // fully down / fully up (used to block walking & actions while changing posture)
  get isDown() { return this.lie > 0.95; }
  get isUp() { return this.lie < 0.05; }

  knockback(dx, dz, power = 1) {
    this.lying = false;
    this.knock.set(dx * 9 * power, dz * 9 * power);
    if (this.air < 0.3) this.vy = Math.max(this.vy, 4.2 * Math.min(power, 1.3));
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

  // Realistic model: move the pivots onto the model's joints, skin the body to them
  // and hang the rigid parts (hooves, eyes, horns) on their pivots.
  _applyModel(model, L) {
    const rig = model.rig;
    this.legs.forEach((leg, i) => {
      const r = rig.legs[i];
      leg.hip.position.copy(r.hip);
      leg.knee.position.copy(r.knee).sub(r.hip);
    });
    this.neck.position.copy(rig.neck);
    this.head.position.copy(rig.head).sub(rig.neck);

    const pivots = [this.body, ...this.legs.map((l) => l.hip), ...this.legs.map((l) => l.knee), this.neck, this.head];
    const bones = pivots.map((p) => { const b = new THREE.Bone(); p.add(b); return b; });
    this.root.updateMatrixWorld(true);

    const hide = makeModelHide(L);
    this.materials.push(hide);
    const mesh = new THREE.SkinnedMesh(model.body, hide);
    mesh.userData.shared = true;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.frustumCulled = false; // its bounds are taken from one pose only; grazing / lying reach outside them
    this.root.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    this.skin = mesh;

    // rigid part: shared geometry in cow space, placed relative to its pivot's rest position
    const rigid = (geo, mat, pivot) => {
      const m = new THREE.Mesh(geo, mat);
      m.userData.shared = true;
      m.castShadow = true;
      m.position.copy(pivot.getWorldPosition(new THREE.Vector3()).negate());
      pivot.add(m);
      return m;
    };
    const hoofMat = new THREE.MeshStandardMaterial({ color: 0x2a221e, roughness: 0.55 });
    this.materials.push(hoofMat);
    model.hooves.forEach((g, i) => rigid(g, hoofMat, this.legs[i].knee));
    for (const e of model.eyes) {
      const em = new THREE.MeshStandardMaterial({ map: e.map || null, color: e.map ? 0xffffff : 0x2a1a10, roughness: 0.1 });
      this.materials.push(em);
      rigid(e.geo, em, this.head);
    }
    // horns hang on a pivot at the poll so they can be hidden / grown / made longer
    for (const h of this.horns) h.parent.remove(h);
    this.horns = [];
    if (model.horns) {
      const hornPivot = new THREE.Group();
      this.head.add(hornPivot);
      const hm = new THREE.MeshStandardMaterial({ map: model.horns.map || null, color: model.horns.map ? 0xffffff : 0xe8dcc0, roughness: 0.45 });
      this.materials.push(hm);
      const m = new THREE.Mesh(model.horns.geo, hm);
      m.userData.shared = true; m.castShadow = true;
      m.position.copy(rig.head).negate();
      hornPivot.add(m);
      hornPivot.userData.k = L.horns === 'long' ? 1.4 : 1;
      hornPivot.visible = L.horns !== 'none';
      this.horns.push(hornPivot);
    }
  }

  _buildAccessory(L, M) {
    if (L.acc === 'none') return;
    const mat = (color, extra = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });
      this.materials.push(m);
      return m;
    };
    const accMat = mat(L.accColor);
    // ring around the middle of the neck, following its forward-up tilt
    // neck cross-section the collar wraps around (neck space); the model measures its own
    const C = this.model ? this.model.rig.collar : { y: 0.06, z: 0.26, rx: 0.226, ry: 0.31, tilt: 0.25 };
    const collar = (radius, tube, material) => {
      const ring = M(new THREE.TorusGeometry(radius, tube, 10, 32), material, this.neck, 0, C.y, C.z);
      ring.rotation.x = -C.tilt;
      ring.scale.set(C.rx / radius, C.ry / radius, 1);
      return ring;
    };
    if (L.acc === 'bell') {
      collar(0.29, 0.03, mat(0x5a3a22, { roughness: 0.8 }));
      const gold = mat(0xd4a93a, { metalness: 0.85, roughness: 0.3 });
      const bell = M(new THREE.SphereGeometry(0.075, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), gold, this.neck, 0, C.y - C.ry - 0.03, C.z + 0.07);
      bell.scale.y = 1.25;
      M(new THREE.SphereGeometry(0.022, 8, 6), gold, this.neck, 0, C.y - C.ry - 0.11, C.z + 0.07);
    } else if (L.acc === 'scarf') {
      collar(0.29, 0.07, accMat).scale.z = 1.5;
      const tail = M(new THREE.BoxGeometry(0.12, 0.34, 0.04), accMat, this.neck, 0.1, C.y - C.ry - 0.08, C.z + 0.1);
      tail.rotation.set(0.3, 0, 0.25);
    } else if (L.acc === 'hat') {
      // Vietnamese conical hat (nón lá) with a coloured chin strap
      const straw = mat(0xd9c28a, { roughness: 0.9, side: THREE.DoubleSide });
      const hat = M(new THREE.ConeGeometry(0.42, 0.28, 32, 1, true), straw, this.head, 0, 0.3, 0.1);
      hat.rotation.x = -0.12;
      const rim = M(new THREE.TorusGeometry(0.42, 0.012, 6, 40), straw, this.head, 0, 0.165, 0.117);
      rim.rotation.x = Math.PI / 2 - 0.12;
      const strap = M(new THREE.TorusGeometry(0.22, 0.01, 6, 24, Math.PI), accMat, this.head, 0, 0.16, 0.12);
      strap.rotation.set(0, Math.PI / 2, Math.PI);
    } else if (L.acc === 'flowers') {
      const center = mat(0xf2c83a);
      const n = 8;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = Math.cos(a) * 0.17, z = 0.06 + Math.sin(a) * 0.14;
        const fl = M(new THREE.SphereGeometry(0.05, 10, 8), accMat, this.head, x, 0.13, z);
        fl.scale.y = 0.5;
        M(new THREE.SphereGeometry(0.02, 8, 6), center, this.head, x, 0.155, z);
      }
    }
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse(o => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
    for (const m of this.materials) m.dispose();
  }

  startGraze(seconds = 4) { this.grazeTimer = seconds; }
  get isGrazing() { return this.grazeTimer > 0; }

  animate(dt, running) {
    this.time += dt;
    // speed < 0 = walking backwards: same gait, legs cycle the other way
    const dir = this.speed < 0 ? -1 : 1;
    const sp = Math.abs(this.speed) / Math.max(0.5, this.size); // small calves take quicker steps
    const moving = Math.abs(this.speed) > 0.05;
    const freq = 1.35 + sp * 0.32;
    this.phase += dir * dt * freq * (moving ? 1 : 0) * Math.PI * 2 * Math.min(1, sp / 1.2 + 0.25);
    const amp = Math.min(0.62, sp * 0.2) * (running ? 1.15 : 1);

    const airK = smooth(0.02, 0.25, this.air);
    // lie down / stand up takes about a second
    this.lie += ((this.lying ? 1 : 0) - this.lie) * Math.min(1, dt * 2.2);
    if (Math.abs(this.lie - (this.lying ? 1 : 0)) < 0.002) this.lie = this.lying ? 1 : 0;
    const lieK = smooth(0, 1, this.lie);
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
      const planted = dir > 0 ? L.lastS > 0 && s <= 0 : L.lastS <= 0 && s > 0;
      if (moving && airK < 0.1 && planted && this.onStep) this.onStep(Math.abs(this.speed));
      L.lastS = s;
      // lying pose: front legs folded under the chest, hind legs tucked forward & splayed out
      if (lieK > 0) {
        const hipLie = L.front ? 1.35 : -1.25;
        const kneeLie = L.front ? -2.5 : 2.3;
        L.hip.rotation.x += (hipLie - L.hip.rotation.x) * lieK;
        L.knee.rotation.x += (kneeLie - L.knee.rotation.x) * lieK;
      }
      L.hip.rotation.z = L.front ? 0 : Math.sign(L.x) * 0.45 * lieK;
    }

    // body motion
    const bob = moving ? Math.abs(Math.sin(this.phase)) * 0.035 * Math.min(1, sp / 2) : 0;
    const breathe = Math.sin(this.time * 1.7) * 0.008;
    this.body.position.y = bob + breathe * (1 + lieK * 1.5) - lieK * 0.52;
    // resting cows lean a little to one side
    this.body.rotation.z = (moving ? Math.sin(this.phase) * 0.025 : 0) + lieK * 0.1;
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
    const grazeTarget = this.grazeTimer > 0 && !moving && !this.lying ? 1 : 0;
    this.graze += (grazeTarget - this.graze) * Math.min(1, dt * 2.5);
    const chew = this.graze > 0.8 ? Math.sin(this.time * 9) * 0.04 : 0;
    const headBob = moving ? Math.sin(this.phase * 2) * 0.04 : Math.sin(this.time * 0.6) * 0.03;
    // the model's neck pivots at the withers: bend it a bit more and tip the head back up so
    // the muzzle lands on the grass in front of the hooves instead of tucking under the chest
    const reach = this.model ? 1.13 : 1;
    this.neck.rotation.x = 0.05 + this.graze * 1.15 * reach + headBob + windup * 0.55 + thrust * 0.75 - airK * 0.15;
    // lying: head held a bit lower, slowly chewing the cud
    this.neck.rotation.x += lieK * 0.12;
    const cud = lieK * Math.sin(this.time * 5.5) * 0.025;
    this.head.rotation.x = -0.05 + this.graze * (this.model ? -0.6 : 0.3) + chew + thrust * 0.35 + cud;
    this.head.rotation.y = moving ? 0 : Math.sin(this.time * 0.35) * 0.25 * (1 - this.graze);

    // dead: roll onto the side, legs stiff, head down
    this.deadK += ((this.dead ? 1 : 0) - this.deadK) * Math.min(1, dt * 3);
    const dk = smooth(0, 1, this.deadK);
    if (dk > 0.001) {
      this.body.rotation.z += (1.45 - this.body.rotation.z) * dk;
      this.body.position.y += 0.3 * dk;
      this.body.position.x = -0.12 * dk;
      for (const L of this.legs) {
        L.hip.rotation.x += ((L.front ? -0.25 : 0.25) - L.hip.rotation.x) * dk;
        L.knee.rotation.x *= 1 - dk;
      }
      this.neck.rotation.x += (0.35 - this.neck.rotation.x) * dk;
      this.head.rotation.y *= 1 - dk;
    } else this.body.position.x = 0;

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
      this.tail[i].rotation.z = Math.sin(this.time * 2.2 - i * 0.5) * (0.05 + this.tailSwish * 0.3) * (0.5 + k);
      // lying: the tail slopes back so its tip rests on the ground
      this.tail[i].rotation.x = (i === 0 ? 0.1 + lieK * 0.35 : 0.012 + lieK * 0.06) + (moving ? Math.sin(this.phase - i * 0.4) * 0.04 : 0);
    }
  }
}
