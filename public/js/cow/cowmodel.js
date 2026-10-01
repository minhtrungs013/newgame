import * as THREE from 'three';
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js';

// Realistic cow model (models/cow/cow.3ds) with an automatic rig.
// The mesh has no skeleton, so we fit the procedural cow's pivots (hips, knees,
// neck, head) to the model and skin every body vertex to them by position.
// cow.js then animates exactly the same pivots, so all animations keep working.

const URL = 'models/cow/cow.3ds';
const RES = 'models/cow/';
const BACK_HEIGHT = 1.42;   // top of the back in cow space (matches the procedural cow)
const HOLSTEIN = { base: '#f4f1ea', spot: '#141212' };

export let COW_MODEL = null; // { geo, hooves[], eyes, horns, rig, maps }

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export async function loadCowModel() {
  if (COW_MODEL) return COW_MODEL;
  const loader = new TDSLoader();
  loader.setResourcePath(RES);
  const group = await loader.loadAsync(URL);
  group.updateMatrixWorld(true);
  const parts = {};
  group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    parts[o.name] = { geo: g, map: o.material && o.material.map };
  });
  const body = parts.COWBODY;
  if (!body) throw new Error('COWBODY missing');
  const hoofNames = Object.keys(parts).filter((n) => /casco/i.test(n));
  const eyeNames = Object.keys(parts).filter((n) => /eye/i.test(n));
  const hornName = Object.keys(parts).find((n) => /cuern/i.test(n));

  // --- normalise to cow space: Y up, facing +Z, hooves on y = 0 ---
  let all = new THREE.Box3();
  for (const p of Object.values(parts)) { p.geo.computeBoundingBox(); all.union(p.geo.boundingBox); }
  // up axis = the one the hooves sit at the bottom of (3DS files are usually Z-up)
  {
    const hc = new THREE.Vector3();
    for (const n of hoofNames) hc.add(parts[n].geo.boundingBox.getCenter(new THREE.Vector3()));
    hc.multiplyScalar(1 / Math.max(1, hoofNames.length));
    const sz = all.getSize(new THREE.Vector3());
    const rel = (a) => Math.min(hc[a] - all.min[a], all.max[a] - hc[a]) / sz[a];
    const up = ['x', 'y', 'z'].reduce((b, a) => (rel(a) < rel(b) ? a : b));
    const down = hc[up] - all.min[up] > all.max[up] - hc[up]; // hooves at the max end?
    const r = new THREE.Matrix4();
    if (up === 'z') r.makeRotationX(down ? Math.PI / 2 : -Math.PI / 2);
    else if (up === 'x') r.makeRotationZ(down ? -Math.PI / 2 : Math.PI / 2);
    else if (down) r.makeRotationX(Math.PI);
    all = new THREE.Box3();
    for (const p of Object.values(parts)) { p.geo.applyMatrix4(r); p.geo.computeBoundingBox(); all.union(p.geo.boundingBox); }
  }
  const size = all.getSize(new THREE.Vector3());
  const lengthAxis = size.x > size.z ? 'x' : 'z';
  const eyeC = new THREE.Vector3();
  for (const n of eyeNames) eyeC.add(parts[n].geo.boundingBox.getCenter(new THREE.Vector3()));
  eyeC.multiplyScalar(1 / Math.max(1, eyeNames.length));
  const ctr = all.getCenter(new THREE.Vector3());
  const headSign = Math.sign(eyeC[lengthAxis] - ctr[lengthAxis]) || 1;
  // rotation taking the head direction to +Z (Y stays up)
  const m = new THREE.Matrix4();
  if (lengthAxis === 'x') m.makeRotationY(headSign > 0 ? -Math.PI / 2 : Math.PI / 2);
  else if (headSign < 0) m.makeRotationY(Math.PI);
  for (const p of Object.values(parts)) p.geo.applyMatrix4(m);
  // scale so the back is BACK_HEIGHT high, then centre on x and put the hooves on the ground
  const bb = new THREE.Box3();
  for (const p of Object.values(parts)) { p.geo.computeBoundingBox(); bb.union(p.geo.boundingBox); }
  const pb = body.geo.attributes.position;
  body.geo.computeBoundingBox();
  const bz0 = body.geo.boundingBox.min.z, bz1 = body.geo.boundingBox.max.z;
  let backTop = -Infinity;
  for (let i = 0; i < pb.count; i++) {
    const z = pb.getZ(i), t = (z - bz0) / (bz1 - bz0);
    if (t > 0.2 && t < 0.6) backTop = Math.max(backTop, pb.getY(i));
  }
  const s = BACK_HEIGHT / (backTop - bb.min.y);
  const fit = new THREE.Matrix4().makeScale(s, s, s).multiply(
    new THREE.Matrix4().makeTranslation(-(bb.min.x + bb.max.x) / 2, -bb.min.y, 0));
  for (const p of Object.values(parts)) { p.geo.applyMatrix4(fit); p.geo.computeBoundingBox(); }
  // centre the legs around z = -0.04 like the procedural cow
  const feet = hoofNames.map((n) => ({ name: n, c: parts[n].geo.boundingBox.getCenter(new THREE.Vector3()) }));
  const midZ = feet.reduce((a, f) => a + f.c.z, 0) / feet.length;
  const shift = new THREE.Matrix4().makeTranslation(0, 0, -0.04 - midZ);
  for (const p of Object.values(parts)) { p.geo.applyMatrix4(shift); p.geo.computeBoundingBox(); }
  for (const f of feet) f.c.z += -0.04 - midZ;

  // --- rig: fit the pivots to the model ---
  const P = body.geo.attributes.position;
  const N = P.count;
  const v = new THREE.Vector3();
  // legs in cow.js order: front +x, front -x, hind +x, hind -x
  const order = [[true, 1], [true, -1], [false, 1], [false, -1]];
  const legs = order.map(([front, sx]) => {
    const f = feet.find((ft) => (ft.c.z > -0.04) === front && Math.sign(ft.c.x) === sx);
    return { front, foot: f.c.clone(), hoof: f.name };
  });
  const HIP_Y = 0.95, KNEE_Y = 0.45, LEG_TOP = 0.8;
  // knee position: centroid of the leg's vertices at knee height (legs aren't vertical)
  for (const L of legs) {
    const slice = (y0, y1) => {
      const c = new THREE.Vector3(); let n = 0;
      for (let i = 0; i < N; i++) {
        v.fromBufferAttribute(P, i);
        if (v.y < y0 || v.y > y1) continue;
        if (Math.hypot(v.x - L.foot.x, v.z - L.foot.z) > 0.22) continue;
        c.add(v); n++;
      }
      return n ? c.multiplyScalar(1 / n) : null;
    };
    L.knee = slice(KNEE_Y - 0.04, KNEE_Y + 0.04) || new THREE.Vector3(L.foot.x, KNEE_Y, L.foot.z);
    L.upper = slice(0.62, 0.72) || L.knee.clone();
    L.hip = new THREE.Vector3(L.upper.x, HIP_Y, L.upper.z + (L.upper.z - L.knee.z) * 0.5);
  }
  // leg axis at height y (piecewise line foot -> knee -> upper)
  const axisAt = (L, y) => {
    if (y <= L.knee.y) { const t = THREE.MathUtils.clamp(y / L.knee.y, 0, 1); return [L.foot.x + (L.knee.x - L.foot.x) * t, L.foot.z + (L.knee.z - L.foot.z) * t]; }
    const t = Math.min(1.5, (y - L.knee.y) / (L.upper.y - L.knee.y));
    return [L.knee.x + (L.upper.x - L.knee.x) * t, L.knee.z + (L.upper.z - L.knee.z) * t];
  };

  // head pivot = poll (base of the horns), neck pivot in front of the shoulders
  const horn = hornName && parts[hornName].geo.boundingBox;
  const frontZ = (legs[0].knee.z + legs[1].knee.z) / 2;
  const headP = horn ? new THREE.Vector3(0, horn.min.y + 0.02, (horn.min.z + horn.max.z) / 2) : new THREE.Vector3(0, 1.42, 1.38);
  const neckP = new THREE.Vector3(0, 1.22, frontZ + 0.04); // at the withers, so the head can reach the grass

  // The tail is modelled as part of the rump surface (not a separate strand), so it can't
  // swing without tearing the rump: it stays on the body bone.

  // collar fit (bell / scarf): cross-section of the neck half-way to the head, in neck space
  // (the mesh is low-poly, so sample a 10 cm thick slice; the dewlap on the centre line is ignored)
  const neckSlice = (zc) => {
    let top = -Infinity, bot = Infinity, rx = 0;
    for (let i = 0; i < N; i++) {
      v.fromBufferAttribute(P, i);
      if (Math.abs(v.z - zc) > 0.05 || v.y < 0.6) continue;
      top = Math.max(top, v.y); rx = Math.max(rx, Math.abs(v.x));
      if (Math.abs(v.x) > 0.06) bot = Math.min(bot, v.y);
    }
    return { top, bot, rx };
  };
  const zc = neckP.z + 0.55 * (headP.z - neckP.z);
  const sl = neckSlice(zc), sa = neckSlice(zc - 0.1), sb = neckSlice(zc + 0.1);
  const collar = {
    y: (sl.top + sl.bot) / 2 - neckP.y, z: zc - neckP.z,
    rx: sl.rx * 1.08, ry: (sl.top - sl.bot) / 2 * 1.04,
    tilt: Math.atan2((sb.top + sb.bot) - (sa.top + sa.bot), 0.4),
  };

  // --- weights ---
  // bone ids: 0 body, 1-4 hips, 5-8 knees, 9 neck, 10 head
  const BODY = 0, HIP = 1, KNEE = 5, NECK = 9, HEAD = 10;
  const skinIndex = new Uint16Array(N * 4), skinWeight = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    v.fromBufferAttribute(P, i);
    const w = new Map();
    const add = (b, x) => { if (x > 1e-4) w.set(b, (w.get(b) || 0) + x); };
    let rest = 1;
    {
      // legs
      let best = -1, bestD = Infinity;
      for (let l = 0; l < 4; l++) {
        const [ax, az] = axisAt(legs[l], v.y);
        const d = Math.hypot(v.x - ax, v.z - az);
        if (d < bestD) { bestD = d; best = l; }
      }
      const L = legs[best];
      const legK = (1 - smooth(LEG_TOP - 0.16, LEG_TOP, v.y)) * (1 - smooth(0.17, 0.24, bestD)) * (Math.abs(v.x) > 0.04 ? 1 : 0);
      if (legK > 0) {
        const kneeK = 1 - smooth(L.knee.y - 0.05, L.knee.y + 0.05, v.y);
        add(KNEE + best, legK * kneeK);
        add(HIP + best, legK * (1 - kneeK));
        rest -= legK;
      }
      // neck & head (front of the shoulders, above the brisket)
      if (rest > 0) {
        const nk = smooth(neckP.z - 0.04, neckP.z + 0.4, v.z) * Math.max(smooth(0.8, 1.05, v.y), smooth(neckP.z + 0.3, neckP.z + 0.6, v.z));
        const hk = smooth(headP.z - 0.16, headP.z - 0.02, v.z);
        const hw = rest * nk * hk, nw = rest * nk * (1 - hk);
        add(HEAD, hw); add(NECK, nw);
        rest -= hw + nw;
      }
    }
    add(BODY, rest);
    const top = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((a, e) => a + e[1], 0) || 1;
    top.forEach(([b, x], j) => { skinIndex[i * 4 + j] = b; skinWeight[i * 4 + j] = x / sum; });
  }
  body.geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  body.geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  body.geo.computeBoundingSphere();
  body.geo.boundingSphere.radius *= 1.4; // poses (lying, grazing) reach outside the bind pose

  const maps = {};
  for (const [k, p] of Object.entries(parts)) if (p.map) { p.map.colorSpace = THREE.SRGBColorSpace; p.map.anisotropy = 4; maps[k] = p.map; }
  COW_MODEL = {
    body: body.geo, bodyMap: body.map,
    hooves: legs.map((L) => parts[L.hoof].geo),
    eyes: eyeNames.map((n) => ({ geo: parts[n].geo, map: parts[n].map })),
    horns: horn ? { geo: parts[hornName].geo, map: parts[hornName].map } : null,
    rig: {
      legs: legs.map((L) => ({ hip: L.hip, knee: L.knee })),
      neck: neckP, head: headP, collar,
    },
  };
  return COW_MODEL;
}

// Hide material: the model's texture, or the texture recoloured to the cow's colours
// (dark texels -> spot colour, light texels -> base colour; pattern "none" = plain).
export function makeModelHide(look) {
  const recolor = look.pattern === 'none' || look.base !== HOLSTEIN.base || look.spot !== HOLSTEIN.spot;
  const uniforms = {
    uBase: { value: new THREE.Color(look.base) },
    uSpot: { value: new THREE.Color(look.spot) },
    uRecolor: { value: recolor ? 1 : 0 },
    uPlain: { value: look.pattern === 'none' ? 1 : 0 },
  };
  const mat = new THREE.MeshStandardMaterial({ map: COW_MODEL.bodyMap, roughness: 0.82, metalness: 0 });
  mat.customProgramCacheKey = () => 'cow-model-hide';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uBase, uSpot;\nuniform float uRecolor, uPlain;')
      .replace('#include <map_fragment>', `
  vec4 texel = texture2D(map, vMapUv);
  float lum = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));
  float lightK = mix(smoothstep(0.03, 0.3, lum), 1.0, uPlain);
  // keep the texture's shading (folds, fur) but swap its two colours
  float shade = mix(0.75 + 0.25 * smoothstep(0.2, 0.75, lum), 0.85 + 0.15 * smoothstep(0.0, 0.08, lum), 1.0 - lightK);
  vec3 rec = mix(uSpot, uBase, lightK) * mix(shade, 0.96 + 0.04 * smoothstep(0.2, 0.8, lum), uPlain);
  diffuseColor.rgb *= mix(texel.rgb, rec, uRecolor);
`);
  };
  return mat;
}
