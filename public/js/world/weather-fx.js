import * as THREE from 'three';
import { heightAt } from './terrain.js';

// Particle weather around the camera: rain streaks, snowflakes, drifting leaves / petals.

export class Rain {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.mat = new THREE.LineBasicMaterial({ color: 0xc8d0d8, transparent: true, opacity: 0.35, depthWrite: false });
    this.lines = null;
  }
  // (re)create the drops; the count follows the graphics quality
  build(count) {
    if (this.lines) { this.scene.remove(this.lines); this.lines.geometry.dispose(); }
    this.count = count;
    this.drops = new Float32Array(count * 4); // x,y,z,speed
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
    this.scene.add(this.lines);
    for (let i = 0; i < count; i++) this._reset(i, this.camera.position, true);
  }
  _reset(i, c, randomY) {
    const d = this.drops;
    d[i * 4] = c.x + (Math.random() - 0.5) * 60;
    d[i * 4 + 2] = c.z + (Math.random() - 0.5) * 60;
    d[i * 4 + 1] = c.y + (randomY ? (Math.random() - 0.3) * 40 : 20 + Math.random() * 10);
    d[i * 4 + 3] = 18 + Math.random() * 8;
  }
  update(dt, amount, wind, windDir) {
    this.lines.visible = amount > 0.02;
    this.mat.opacity = 0.32 * amount;
    if (!this.lines.visible) return;
    const d = this.drops, p = this.lines.geometry.attributes.position.array, c = this.camera.position;
    const wx = windDir.x * wind * 3.5, wz = windDir.y * wind * 3.5;
    const active = Math.floor(this.count * amount);
    for (let i = 0; i < this.count; i++) {
      const o = i * 4;
      const s = d[o + 3];
      d[o] += wx * dt; d[o + 1] -= s * dt; d[o + 2] += wz * dt;
      if (d[o + 1] < c.y - 15 || Math.abs(d[o] - c.x) > 32 || Math.abs(d[o + 2] - c.z) > 32 ||
          d[o + 1] < heightAt(d[o], d[o + 2])) this._reset(i, c, false);
      const k = i < active ? 0.045 : 0;
      p[i * 6] = d[o]; p[i * 6 + 1] = d[o + 1]; p[i * 6 + 2] = d[o + 2];
      p[i * 6 + 3] = d[o] - wx * k; p[i * 6 + 4] = d[o + 1] + s * k; p[i * 6 + 5] = d[o + 2] - wz * k;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}

// winter "rain"
export class Snow {
  constructor(scene, camera, count = 2500) {
    this.camera = camera;
    this.count = count;
    this.flakes = new Float32Array(count * 4); // x, y, z, phase
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    // soft round flake sprite
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'), rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.5, 'rgba(255,255,255,.6)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 32, 32);
    this.mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthWrite: false });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < count; i++) this._reset(i, camera.position, true);
  }
  _reset(i, c, anyY) {
    const d = this.flakes;
    d[i * 4] = c.x + (Math.random() - 0.5) * 50;
    d[i * 4 + 2] = c.z + (Math.random() - 0.5) * 50;
    d[i * 4 + 1] = c.y + (anyY ? (Math.random() - 0.4) * 30 : 12 + Math.random() * 8);
    d[i * 4 + 3] = Math.random() * 10;
  }
  update(dt, amount, wind, windDir) {
    this.points.visible = amount > 0.02;
    this.mat.opacity = 0.85 * amount;
    if (!this.points.visible) return;
    const d = this.flakes, p = this.points.geometry.attributes.position.array, c = this.camera.position;
    const active = Math.floor(this.count * amount);
    for (let i = 0; i < this.count; i++) {
      const o = i * 4;
      d[o + 3] += dt;
      d[o] += (windDir.x * wind * 1.2 + Math.sin(d[o + 3] * 1.3) * 0.4) * dt;
      d[o + 2] += (windDir.y * wind * 1.2 + Math.cos(d[o + 3] * 1.1) * 0.4) * dt;
      d[o + 1] -= (1.2 + (i % 7) * 0.12) * dt;
      if (d[o + 1] < c.y - 12 || Math.abs(d[o] - c.x) > 26 || Math.abs(d[o + 2] - c.z) > 26 || d[o + 1] < heightAt(d[o], d[o + 2])) this._reset(i, c, false);
      const hide = i >= active ? -1000 : 0;
      p[i * 3] = d[o]; p[i * 3 + 1] = d[o + 1] + hide; p[i * 3 + 2] = d[o + 2];
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// drifting leaves / petals around the player (colour & amount follow the season)
const LEAVES = 220;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1);

export class Leaves {
  constructor(scene) {
    this.mat = new THREE.MeshStandardMaterial({ color: 0xe0c050, side: THREE.DoubleSide, roughness: 0.8 });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.1, 0.06), this.mat, LEAVES);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.data = Array.from({ length: LEAVES }, () => ({ p: new THREE.Vector3(), r: new THREE.Euler(), s: Math.random() * 10, v: 0.3 + Math.random() * 0.5 }));
  }
  _reset(l, around, anywhere) {
    const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 26;
    l.p.set(around.x + Math.cos(a) * r, 0, around.z + Math.sin(a) * r);
    l.p.y = heightAt(l.p.x, l.p.z) + (anywhere ? 0.2 + Math.random() * 4 : 3 + Math.random() * 3);
  }
  // amount: season's leaf factor (0 = none), color: season's leaf colour, light: 0..1 daylight
  update(dt, around, amount, color, light, wind, windDir) {
    const mesh = this.mesh;
    mesh.count = Math.min(LEAVES, Math.round(90 * amount));
    for (let i = 0; i < mesh.count; i++) {
      const l = this.data[i];
      if (!l.init) { this._reset(l, around, true); l.init = true; }
      l.s += dt;
      l.p.x += (windDir.x * wind * 1.4 + Math.sin(l.s * 1.3) * 0.3) * dt;
      l.p.z += (windDir.y * wind * 1.4 + Math.cos(l.s * 1.1) * 0.3) * dt;
      l.p.y -= l.v * dt * (0.5 + 0.5 * Math.sin(l.s * 2.0) ** 2);
      const gh = heightAt(l.p.x, l.p.z);
      if (l.p.y < gh + 0.05) l.p.y = gh + 0.05, l.rest = (l.rest || 0) + dt;
      const dx = l.p.x - around.x, dz = l.p.z - around.z;
      if ((l.rest || 0) > 6 || dx * dx + dz * dz > 34 * 34) { this._reset(l, around, false); l.rest = 0; }
      l.r.set(l.s * 2.1, l.s * 1.3, l.s * 1.7);
      _q.setFromEuler(l.r);
      _m.compose(l.p, _q, _one);
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.mat.color.copy(color).multiplyScalar(0.6 + 0.4 * light);
  }
}
