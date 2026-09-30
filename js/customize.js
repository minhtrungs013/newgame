import * as THREE from 'three';
import { Cow, PRESETS, normalizeLook, randomLook } from './cow.js';

const STORAGE_KEY = 'cow.look';

const PRESET_LABELS = { holstein: 'Bò sữa', brown: 'Đốm nâu', jersey: 'Bò vàng', black: 'Bò đen' };
const PATTERN_LABELS = { none: 'Trơn', few: 'Ít đốm', many: 'Nhiều đốm', patches: 'Mảng lớn' };
const HORN_LABELS = { none: 'Không', short: 'Ngắn', long: 'Dài' };
const ACC_LABELS = { none: 'Không', bell: '🔔 Chuông', hat: '👒 Nón lá', flowers: '🌼 Vòng hoa', scarf: '🧣 Khăn' };
const SWATCHES = {
  base: ['#f2efe8', '#e8d8c0', '#b9804a', '#7a4a26', '#3a2a20', '#1f1d1c', '#9aa0a6', '#f0c8d8'],
  spot: ['#121212', '#6b3a1e', '#4a2c18', '#8a5a30', '#f0ede6', '#5a6070', '#2a4a8a', '#8a2a4a'],
  snout: ['#dca59a', '#e8b8a8', '#8a7a74', '#3a302a'],
  accColor: ['#d83a3a', '#f0a030', '#f2d23a', '#4ab85a', '#3a8ad8', '#8a4ad8', '#f06ab0', '#f0f0f0'],
};

function loadLook() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeLook(JSON.parse(saved));
    const oldCoat = localStorage.getItem('cow.coat'); // from the earlier coat picker
    if (oldCoat && PRESETS[oldCoat]) return normalizeLook(PRESETS[oldCoat]);
  } catch {}
  return normalizeLook(PRESETS.holstein);
}

// Character creator on the start screen: option controls + a turntable 3D preview.
export class Customizer {
  constructor(root) {
    this.root = root;
    this.look = loadLook();
    this.seed = 11 + Math.floor(Math.random() * 1000);
    this._buildUI();
    this._initPreview();
    this._rebuildCow();
    this._syncUI();
  }

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.look)); } catch {}
  }

  set(patch) {
    this.look = normalizeLook({ ...this.look, ...patch });
    this._syncUI();
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => this._rebuildCow(), 60); // debounce while dragging pickers
  }

  // ---------- UI ----------
  _buildUI() {
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    };
    const panel = this.root.querySelector('.cz-options');
    this.controls = {};

    const row = (label) => {
      const r = el('div', 'cz-row');
      r.append(el('div', 'cz-label', label));
      const body = el('div', 'cz-body');
      r.append(body);
      panel.append(r);
      return body;
    };
    const chips = (body, key, labels) => {
      const btns = {};
      for (const [value, text] of Object.entries(labels)) {
        const b = el('button', 'cz-chip', text);
        b.type = 'button';
        b.addEventListener('click', () => this.set({ [key]: value }));
        body.append(b);
        btns[value] = b;
      }
      this.controls[key] = { type: 'chips', btns };
    };
    const colors = (body, key) => {
      const sw = [];
      for (const c of SWATCHES[key]) {
        const b = el('button', 'cz-swatch');
        b.type = 'button';
        b.style.background = c;
        b.title = c;
        b.addEventListener('click', () => this.set({ [key]: c }));
        body.append(b);
        sw.push(b);
      }
      const input = el('input', 'cz-color');
      input.type = 'color';
      input.title = 'Chọn màu khác';
      input.addEventListener('input', () => this.set({ [key]: input.value }));
      body.append(input);
      this.controls[key] = { type: 'color', sw, input };
    };

    // presets + random
    const pr = row('Mẫu nhanh');
    for (const [key, label] of Object.entries(PRESET_LABELS)) {
      const b = el('button', 'cz-chip', label);
      b.type = 'button';
      b.addEventListener('click', () => this.set({ ...PRESETS[key], acc: this.look.acc, accColor: this.look.accColor, size: this.look.size }));
      pr.append(b);
    }
    const rnd = el('button', 'cz-chip cz-random', '🎲 Ngẫu nhiên');
    rnd.type = 'button';
    rnd.addEventListener('click', () => { this.seed = 11 + Math.floor(Math.random() * 1000); this.set(randomLook()); });
    pr.append(rnd);

    colors(row('Màu lông'), 'base');
    chips(row('Hoa văn'), 'pattern', PATTERN_LABELS);
    colors(row('Màu đốm'), 'spot');
    colors(row('Màu mõm'), 'snout');
    chips(row('Sừng'), 'horns', HORN_LABELS);

    const sizeBody = row('Cỡ khi lớn');
    const range = el('input', 'cz-range');
    Object.assign(range, { type: 'range', min: '0.85', max: '1.2', step: '0.01' });
    const sizeText = el('span', 'cz-size-text');
    range.addEventListener('input', () => this.set({ size: parseFloat(range.value) }));
    sizeBody.append(el('span', 'cz-hint', 'Nhỏ'), range, el('span', 'cz-hint', 'Bò mộng'), sizeText);
    this.controls.size = { type: 'range', range, sizeText };

    chips(row('Phụ kiện'), 'acc', ACC_LABELS);
    this.accColorRow = row('Màu phụ kiện');
    colors(this.accColorRow, 'accColor');
  }

  _syncUI() {
    const L = this.look;
    for (const [key, c] of Object.entries(this.controls)) {
      if (c.type === 'chips') for (const [v, b] of Object.entries(c.btns)) b.classList.toggle('sel', v === L[key]);
      if (c.type === 'color') {
        for (const b of c.sw) b.classList.toggle('sel', b.title.toLowerCase() === L[key]);
        c.input.value = L[key];
      }
      if (c.type === 'range') {
        c.range.value = String(L.size);
        c.sizeText.textContent = `${Math.round(L.size * 100)}%`;
      }
    }
    // spot colour is meaningless on a plain coat, accessory colour only for some accessories
    this.controls.spot.sw[0].parentElement.parentElement.classList.toggle('cz-disabled', L.pattern === 'none');
    this.accColorRow.parentElement.classList.toggle('cz-disabled', !['scarf', 'flowers', 'hat'].includes(L.acc));
  }

  // ---------- 3D preview ----------
  _initPreview() {
    const canvas = this.root.querySelector('.cz-preview');
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.camera.position.set(3.4, 2.1, 4.6);
    this.camera.lookAt(0, 0.95, 0);
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a4a2a, 1.3));
    const key = new THREE.DirectionalLight(0xfff0dd, 2.6);
    key.position.set(3, 6, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 });
    this.scene.add(key);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 48),
      new THREE.MeshStandardMaterial({ color: 0x3c5a2a, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // drag to spin the turntable
    this.spin = 0.6;
    this.autoSpin = true;
    let dragging = false, lastX = 0;
    canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; this.autoSpin = false; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (dragging) { this.spin += (e.clientX - lastX) * 0.012; lastX = e.clientX; } });
    const stop = () => { dragging = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);

    // preview as calf / adult
    this.previewAge = 1;
    for (const b of this.root.querySelectorAll('.cz-age button')) {
      b.addEventListener('click', () => {
        this.previewAge = Number(b.dataset.age);
        for (const o of this.root.querySelectorAll('.cz-age button')) o.classList.toggle('sel', o === b);
        if (this.cow) { this.cow.setAge(this.previewAge); this._frame(); }
      });
    }

    this.clock = new THREE.Clock();
    this.alive = true;
    const loop = () => {
      if (!this.alive) return;
      const dt = Math.min(this.clock.getDelta(), 0.05);
      this._resize();
      if (this.autoSpin) this.spin += dt * 0.5;
      if (this.cow) {
        this.cow.root.rotation.y = this.spin;
        this.cow.animate(dt, false);
      }
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  _resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h || (w === this._w && h === this._h)) return;
    this._w = w; this._h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._frame();
  }

  // keep the whole cow in view whatever the cow size and the canvas shape
  _frame() {
    const s = this.cow ? this.cow.size : this.look.size;
    const fit = Math.max(0.9, 1.05 / (this.camera.aspect || 1)) * s;
    this.camera.position.set(3.4 * fit, 1.2 * s + 1.0 * fit, 4.6 * fit);
    this.camera.lookAt(0, 0.95 * s, 0);
  }

  _rebuildCow() {
    if (this.cow) this.cow.dispose();
    this.cow = new Cow(this.scene, { look: this.look, seed: this.seed, age: this.previewAge ?? 1 });
    this._frame();
  }

  // stop the preview and free its GPU context once the game starts
  dispose() {
    this.alive = false;
    clearTimeout(this._rebuildTimer);
    if (this.cow) this.cow.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
