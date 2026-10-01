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

// ---------- seasons ----------
// Visual / gameplay parameters per season; the world blends into the next season
// during the last 20% of the current one.
export const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_INFO = {
  spring: { name: 'Xuân', icon: '🌸', color: '#8fd86a' },
  summer: { name: 'Hạ', icon: '☀️', color: '#f2c83a' },
  autumn: { name: 'Thu', icon: '🍂', color: '#e8803a' },
  winter: { name: 'Đông', icon: '❄️', color: '#8ec8f0' },
};
const SEASON_PARAMS = {
  //        grass tint           foliage tint          snow  flowers leaves leaf colour  sun   ice  hunger
  spring: { grass: [0.95, 1.12, 0.85], foliage: [1.0, 1.12, 0.85], snow: 0, flowers: 1.6, leaves: 1.0, leaf: 0xf4a6c8, sun: 1.0,  ice: 0, hunger: 1.0 },
  summer: { grass: [1.06, 1.0, 0.78], foliage: [0.95, 1.0, 0.85], snow: 0, flowers: 1.0, leaves: 0.5, leaf: 0xe0c050, sun: 1.12, ice: 0, hunger: 1.0 },
  autumn: { grass: [1.4, 1.0, 0.45], foliage: [1.75, 0.85, 0.3], snow: 0, flowers: 0.3, leaves: 2.2, leaf: 0xe0762a, sun: 0.95, ice: 0, hunger: 1.1 },
  winter: { grass: [1.2, 1.25, 1.35], foliage: [1.55, 1.6, 1.7], snow: 0.85, flowers: 0, leaves: 0, leaf: 0xffffff, sun: 0.8,  ice: 1, hunger: 1.3 },
};
export const WEATHER_NAMES = { clear: 'Nắng', cloudy: 'Nhiều mây', rain: 'Mưa', fog: 'Sương mù' };

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
    // world clock (driven by the server; see server/world-clock.js)
    this.dayHours = 0.25;          // real hours per in-game day (15 min)
    this.day = 1;
    this.season = 'spring';
    this.seasonT = 0;              // 0..1 progress through the season
    this.weatherName = 'rain';
    this.s = { ...SEASON_PARAMS.spring, leafColor: new THREE.Color(SEASON_PARAMS.spring.leaf) }; // blended season params
    this.seasonBlend();
    this.compute();
  }

  setWeather(name) { this.weatherName = name; this.targetWeather = WEATHERS[name]; }

  // name / icon for the HUD and toasts (rain falls as snow in winter)
  get isWinter() { return this.s.snow > 0.5; }
  weatherLabel(w = this.weatherName) { return w === 'rain' && this.isWinter ? 'Tuyết rơi' : WEATHER_NAMES[w]; }
  weatherIcon(w = this.weatherName) {
    if (w === 'rain') return this.isWinter ? '🌨️' : '🌧️';
    return w === 'cloudy' ? '☁️' : w === 'fog' ? '🌫️' : this.dayness > 0.5 ? '☀️' : '🌙';
  }

  // state from the server: jump if far off, otherwise nudge so the sky never snaps
  applyServer(m, instant = false) {
    if (typeof m.dayHours === 'number') this.dayHours = m.dayHours;
    if (m.season) { this.season = m.season; this.seasonT = m.seasonT || 0; this.day = m.day || 1; }
    if (m.weather) this.setWeather(m.weather);
    if (typeof m.hour === 'number') {
      const diff = ((m.hour - this.hour + 36) % 24) - 12;
      if (instant || Math.abs(diff) > 0.75) this.hour = m.hour; else this.hour = (this.hour + diff * 0.5 + 24) % 24;
    }
    if (instant) this.weather = { ...this.targetWeather };
  }

  // blend the current season's parameters towards the next one near the season's end
  seasonBlend() {
    const i = SEASON_ORDER.indexOf(this.season);
    const a = SEASON_PARAMS[this.season], b = SEASON_PARAMS[SEASON_ORDER[(i + 1) % 4]];
    const k = THREE.MathUtils.smoothstep(this.seasonT, 0.8, 1);
    const mix = (x, y) => x + (y - x) * k;
    const s = this.s;
    for (const key of ['snow', 'flowers', 'leaves', 'sun', 'ice', 'hunger']) s[key] = mix(a[key], b[key]);
    s.grass = a.grass.map((v, j) => mix(v, b.grass[j]));
    s.foliage = a.foliage.map((v, j) => mix(v, b.foliage[j]));
    s.leafColor.set(a.leaf).lerp(new THREE.Color(b.leaf), k);
    s.snowing = this.weather.rain * THREE.MathUtils.smoothstep(s.snow, 0.3, 0.7); // rain falls as snow in winter
  }

  update(dt) {
    // the day never stops: one in-game day every `dayHours` real hours
    this.hour = (this.hour + dt * 24 / (this.dayHours * 3600)) % 24;
    this.seasonT = Math.min(0.9999, this.seasonT + dt / (this.dayHours * 3600 * 2));
    const k = Math.min(1, dt * 0.15); // weather drifts over ~20 s
    for (const key of Object.keys(this.weather)) {
      this.weather[key] += (this.targetWeather[key] - this.weather[key]) * k;
    }
    this.flash = Math.max(0, this.flash - dt * 3);
    this.seasonBlend();
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
    this.sunI *= (1 - w.cloud * 0.62) * (this.s ? this.s.sun : 1);
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
