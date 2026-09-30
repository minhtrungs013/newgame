import * as THREE from 'three';

// Key frames over a 24h day. Colours are sRGB hex, converted to linear by THREE.Color.
const KEYS = [
  { h: 0,    top: 0x02040c, hor: 0x0b1222, sun: 0x9fb4ff, sunI: 0.6,  amb: 0x3a4c7a, ambI: 0.65, stars: 1 },
  { h: 5.0,  top: 0x02040c, hor: 0x0b1222, sun: 0x9fb4ff, sunI: 0.6,  amb: 0x3a4c7a, ambI: 0.65, stars: 1 },
  { h: 6.3,  top: 0x2a3560, hor: 0xe0906a, sun: 0xff8a50, sunI: 0.9,  amb: 0x6a6080, ambI: 0.5,  stars: 0.25 },
  { h: 7.8,  top: 0x6f95c9, hor: 0xdcd3c3, sun: 0xffd2a8, sunI: 2.3,  amb: 0x93a6bc, ambI: 0.85, stars: 0 },
  { h: 12.5, top: 0x3d7fd9, hor: 0xbcd4ec, sun: 0xfff6e8, sunI: 3.0,  amb: 0xa9c4e0, ambI: 1.0,  stars: 0 },
  { h: 16.5, top: 0x4f86cf, hor: 0xd8d6cc, sun: 0xffe2b8, sunI: 2.6,  amb: 0x9fb3c8, ambI: 0.9,  stars: 0 },
  { h: 18.3, top: 0x3b4a7a, hor: 0xf0a070, sun: 0xff9a5a, sunI: 1.8,  amb: 0x9a8aa0, ambI: 0.8, stars: 0.05 },
  { h: 19.6, top: 0x141a38, hor: 0x40304a, sun: 0x6a78b8, sunI: 0.4,  amb: 0x303a5a, ambI: 0.4,  stars: 0.6 },
  { h: 21.0, top: 0x02040c, hor: 0x0b1222, sun: 0x9fb4ff, sunI: 0.6,  amb: 0x3a4c7a, ambI: 0.65, stars: 1 },
  { h: 24.0, top: 0x02040c, hor: 0x0b1222, sun: 0x9fb4ff, sunI: 0.6,  amb: 0x3a4c7a, ambI: 0.65, stars: 1 },
].map(k => ({ ...k, top: new THREE.Color(k.top), hor: new THREE.Color(k.hor), sun: new THREE.Color(k.sun), amb: new THREE.Color(k.amb) }));

export const TIME_PRESETS = { morning: 7.9, noon: 12.5, sunset: 18.35, night: 23.0 };

export const WEATHERS = {
  clear:  { cloud: 0.25, dark: 1.0,  desat: 0.0,  fog: 0.0055, wind: 0.55, rain: 0, fogTint: 0 },
  cloudy: { cloud: 0.75, dark: 0.72, desat: 0.45, fog: 0.008,  wind: 0.85, rain: 0, fogTint: 0.2 },
  rain:   { cloud: 1.0,  dark: 0.5,  desat: 0.8,  fog: 0.0135, wind: 1.25, rain: 1, fogTint: 0.4 },
  fog:    { cloud: 0.65, dark: 0.78, desat: 0.75, fog: 0.042,  wind: 0.25, rain: 0, fogTint: 0.85 },
};

const gray = (c, amt) => {
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  c.r += (l - c.r) * amt; c.g += (l - c.g) * amt; c.b += (l - c.b) * amt;
  return c;
};

export class Environment {
  constructor() {
    this.hour = TIME_PRESETS.morning;
    this.targetHour = this.hour;
    this.cycle = false;
    this.weather = { ...WEATHERS.rain };
    this.targetWeather = WEATHERS.rain;
    // outputs
    this.top = new THREE.Color();
    this.horizon = new THREE.Color();
    this.fogColor = new THREE.Color();
    this.cloudColor = new THREE.Color();
    this.sunColor = new THREE.Color();
    this.ambient = new THREE.Color();
    this.ground = new THREE.Color();
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.sunI = 1; this.ambI = 1; this.stars = 0; this.sunVis = 1; this.dayness = 1;
    this.flash = 0;
    this.compute();
  }

  setTime(name) {
    if (name === 'cycle') { this.cycle = true; return; }
    this.cycle = false;
    this.targetHour = TIME_PRESETS[name];
  }
  setWeather(name) { this.targetWeather = WEATHERS[name]; }

  update(dt) {
    if (this.cycle) {
      this.hour = (this.hour + dt / 25) % 24; // one in-game hour every 25 s
      this.targetHour = this.hour;
    } else {
      // advance forward through the day toward the target so transitions look natural
      let diff = (this.targetHour - this.hour + 24) % 24;
      if (diff > 0.001) {
        const step = Math.max(dt * 0.5, diff * Math.min(1, dt * 1.6));
        this.hour = (this.hour + Math.min(diff, step)) % 24;
      }
    }
    const k = Math.min(1, dt * 0.6);
    for (const key of Object.keys(this.weather)) {
      this.weather[key] += (this.targetWeather[key] - this.weather[key]) * k;
    }
    this.flash = Math.max(0, this.flash - dt * 3);
    this.compute();
  }

  compute() {
    const hr = this.hour;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].h <= hr) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = THREE.MathUtils.smoothstep(hr, a.h, b.h);
    const w = this.weather;

    this.top.copy(a.top).lerp(b.top, t);
    this.horizon.copy(a.hor).lerp(b.hor, t);
    this.sunColor.copy(a.sun).lerp(b.sun, t);
    this.ambient.copy(a.amb).lerp(b.amb, t);
    this.sunI = a.sunI + (b.sunI - a.sunI) * t;
    this.ambI = a.ambI + (b.ambI - a.ambI) * t;
    this.stars = a.stars + (b.stars - a.stars) * t;

    // sun path
    const dayT = (hr - 6) / 12; // 0 at sunrise, 1 at sunset
    const el = Math.sin(dayT * Math.PI) * THREE.MathUtils.degToRad(62);
    const az = THREE.MathUtils.degToRad(-100 + dayT * 200);
    this.sunDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
    this.moonDir.set(-0.4, 0.62, -0.68).normalize();
    this.dayness = THREE.MathUtils.smoothstep(this.sunDir.y, -0.08, 0.1);
    this.lightDir.copy(this.moonDir).lerp(this.sunDir, this.dayness).normalize();
    if (this.lightDir.y < 0.08) { this.lightDir.y = 0.08; this.lightDir.normalize(); }
    this.sunVis = THREE.MathUtils.smoothstep(this.sunDir.y, -0.05, 0.03);

    // weather grading
    gray(this.top, w.desat).multiplyScalar(w.dark);
    gray(this.horizon, w.desat * 0.9).multiplyScalar(0.35 + 0.65 * w.dark);
    gray(this.sunColor, w.desat * 0.6);
    gray(this.ambient, w.desat * 0.5);
    this.sunI *= 1 - w.cloud * 0.62;
    this.ambI *= 0.85 + w.cloud * 0.25 * this.dayness;
    this.ambI *= 0.7 + 0.3 * w.dark;

    const fogGray = new THREE.Color(0.55, 0.57, 0.58).multiplyScalar(0.25 + 0.75 * this.ambI * this.dayness + 0.03);
    this.fogColor.copy(this.horizon).lerp(fogGray, w.fogTint);
    this.horizon.lerp(this.fogColor, 0.6);
    this.cloudColor.copy(this.horizon).lerp(new THREE.Color(1, 1, 1).multiplyScalar(0.25 + 0.6 * this.dayness * w.dark), 0.5);

    this.ground.set(0x2b3320).multiplyScalar(0.5 + 0.5 * this.dayness);
    if (this.flash > 0) {
      this.ambI += this.flash * 2.5;
      this.fogColor.lerp(new THREE.Color(0.7, 0.75, 0.9), this.flash * 0.4);
    }
  }
}
