import * as THREE from 'three';

const vert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const frag = /* glsl */`
uniform vec3 uTop, uHorizon, uSunColor, uSunDir, uMoonDir, uCloudColor;
uniform float uCloud, uTime, uStars, uSunVis, uFlash;
varying vec3 vDir;
#include <common>

float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * n2(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = mix(uHorizon, uTop, pow(clamp(y, 0.0, 1.0), 0.55));
  col = mix(col, uHorizon * 0.85, smoothstep(0.0, -0.25, y));

  // sun glow + disc
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 90.0) * 0.5) * uSunVis;
  col += uSunColor * smoothstep(0.9993, 0.9997, sd) * 6.0 * uSunVis * (1.0 - uCloud * 0.85);

  // moon
  float md = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.8, 0.85, 1.0) * smoothstep(0.9994, 0.9996, md) * uStars * 1.5 * (1.0 - uCloud * 0.8);
  col += vec3(0.25, 0.3, 0.45) * pow(md, 30.0) * uStars * 0.3;

  // stars
  if (uStars > 0.0 && y > 0.0) {
    vec3 sp = d * 280.0;
    vec3 cell = floor(sp);
    float r = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float star = step(0.9975, r) * smoothstep(0.5, 0.1, length(fract(sp) - 0.5));
    float tw = 0.6 + 0.4 * sin(uTime * 3.0 + r * 100.0);
    col += vec3(star * tw * uStars * (1.0 - uCloud) * smoothstep(0.0, 0.2, y));
  }

  // clouds (flat layer projected onto the dome)
  if (y > 0.0) {
    vec2 uv = d.xz / (y + 0.12) * 1.3 + vec2(uTime * 0.006, uTime * 0.003);
    float n = fbm(uv);
    float cov = mix(0.72, 0.28, uCloud);
    float c = smoothstep(cov, cov + 0.25, n);
    float shade = 1.0 - smoothstep(0.4, 1.0, fbm(uv * 1.7 + 3.0)) * 0.35;
    vec3 cc = uCloudColor * shade + uSunColor * pow(sd, 4.0) * 0.25 * uSunVis;
    col = mix(col, cc, c * smoothstep(0.0, 0.25, y) * min(1.0, 0.55 + uCloud));
    // overcast veil
    col = mix(col, uCloudColor, uCloud * uCloud * 0.55 * smoothstep(-0.05, 0.3, y));
  }
  col += vec3(0.8, 0.85, 1.0) * uFlash;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uCloudColor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uCloud: { value: 0.3 },
      uTime: { value: 0 },
      uStars: { value: 0 },
      uSunVis: { value: 1 },
      uFlash: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }
}
