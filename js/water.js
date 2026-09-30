import * as THREE from 'three';
import { pondsNear, POND_CELL } from './terrain.js';

const vert = /* glsl */`
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const frag = /* glsl */`
uniform float uTime, uRain;
uniform vec3 uSky, uSkyTop, uSunDir, uSunColor, uDeep, uShallow;
uniform vec2 uCenter;
uniform float uRadius;
varying vec3 vWorld;
#include <common>
#include <fog_pars_fragment>

// sum of travelling waves -> surface slope
vec2 waveSlope(vec2 p, float t) {
  vec2 s = vec2(0.0);
  s += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 1.3 + t * 1.4) * 0.05;
  s += vec2(-0.5, 0.85) * cos(dot(p, vec2(-0.5, 0.85)) * 2.1 + t * 1.9) * 0.035;
  s += vec2(0.95, -0.3) * cos(dot(p, vec2(0.95, -0.3)) * 3.7 + t * 2.6) * 0.022;
  s += vec2(-0.2, -1.0) * cos(dot(p, vec2(-0.2, -1.0)) * 6.3 + t * 3.1) * 0.012;
  return s;
}
// expanding rain rings
float rainRipples(vec2 p, float t) {
  vec2 cell = floor(p * 1.3);
  vec2 f = fract(p * 1.3) - 0.5;
  float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  float ph = fract(t * 0.9 + h);
  float r = length(f - (vec2(h, fract(h * 7.1)) - 0.5) * 0.5);
  return sin((r - ph * 0.45) * 60.0) * (1.0 - ph) * smoothstep(0.08, 0.0, abs(r - ph * 0.45));
}

void main() {
  vec2 p = vWorld.xz;
  vec2 slope = waveSlope(p, uTime);
  slope += vec2(rainRipples(p, uTime), rainRipples(p + 7.3, uTime * 1.1)) * 0.06 * uRain;
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  vec3 r = reflect(-v, n);
  vec3 sky = mix(uSky, uSkyTop, clamp(r.y * 1.4, 0.0, 1.0));
  // a little lighter near the shore
  float edge = smoothstep(uRadius * 0.55, uRadius * 1.0, length(p - uCenter));
  vec3 body = mix(uDeep, uShallow, edge * 0.6);
  vec3 col = mix(body, sky, 0.18 + 0.72 * fres);
  float spec = pow(max(dot(r, uSunDir), 0.0), 180.0);
  col += uSunColor * spec * 2.5;
  gl_FragColor = vec4(col, mix(0.8, 0.96, fres));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

// Water surfaces for the ponds around the player (created / removed as you travel).
export class Water {
  constructor(scene) {
    this.scene = scene;
    this.meshes = new Map(); // pond id -> mesh
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uRain: { value: 0 },
      uSky: { value: new THREE.Color() }, uSkyTop: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color(0x0e2a2c) }, uShallow: { value: new THREE.Color(0x3a5a48) },
    }]);
    this.geo = new THREE.CircleGeometry(1, 64);
    this.geo.rotateX(-Math.PI / 2);
    this._lx = null; this._lz = null;
  }

  update(px, pz) {
    const cx = Math.floor(px / POND_CELL), cz = Math.floor(pz / POND_CELL);
    if (cx === this._lx && cz === this._lz) return;
    this._lx = cx; this._lz = cz;
    const keep = new Set();
    for (const p of pondsNear(px, pz, 3)) {
      keep.add(p.id);
      if (this.meshes.has(p.id)) continue;
      // every pond gets its own material instance (for its centre/radius), sharing the rest
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...this.uniforms, uCenter: { value: new THREE.Vector2(p.x, p.z) }, uRadius: { value: p.R * 1.5 } },
        vertexShader: vert, fragmentShader: frag,
        transparent: true, depthWrite: false, fog: true,
      });
      const m = new THREE.Mesh(this.geo, mat);
      m.position.set(p.x, p.level, p.z);
      m.scale.setScalar(p.R * 1.5);
      m.renderOrder = 1;
      this.scene.add(m);
      this.meshes.set(p.id, m);
    }
    for (const [id, m] of this.meshes) {
      if (!keep.has(id)) { this.scene.remove(m); m.material.dispose(); this.meshes.delete(id); }
    }
  }

  // env: Environment (sky / sun colours), rain 0..1
  setFrame(time, env, rain) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uRain.value = rain;
    u.uSky.value.copy(env.horizon);
    u.uSkyTop.value.copy(env.top);
    u.uSunDir.value.copy(env.lightDir);
    u.uSunColor.value.copy(env.sunColor).multiplyScalar(env.sunI * 0.5 * env.dayness + 0.05);
    const light = 0.35 + 0.65 * env.dayness;
    u.uDeep.value.setRGB(0.012, 0.045, 0.05).multiplyScalar(light);
    u.uShallow.value.setRGB(0.06, 0.11, 0.08).multiplyScalar(light);
  }
}
