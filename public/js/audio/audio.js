// Fully procedural sound: no audio files needed.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 1;
    this.birdTimer = 2;
    this.cricketTimer = 1;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 * this.volume : 0;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // shared noise buffer
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // brown noise for rumble
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }

    // wind bed
    const wind = this._loop(this.brown);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 500; this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    // leaves/grass rustle
    const rustle = this._loop(this.noise);
    this.rustleFilter = ctx.createBiquadFilter();
    this.rustleFilter.type = 'bandpass'; this.rustleFilter.frequency.value = 3500; this.rustleFilter.Q.value = 0.4;
    this.rustleGain = ctx.createGain(); this.rustleGain.gain.value = 0;
    rustle.connect(this.rustleFilter).connect(this.rustleGain).connect(this.master);
    // rain bed
    const rain = this._loop(this.noise);
    const rhp = ctx.createBiquadFilter(); rhp.type = 'highpass'; rhp.frequency.value = 900;
    const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 7000;
    this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
    rain.connect(rhp).connect(rlp).connect(this.rainGain).connect(this.master);
  }

  _loop(buf) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.loopStart = Math.random();
    s.start(0, Math.random() * 1.5);
    return s;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(on ? 0.8 * this.volume : 0, this.ctx.currentTime, 0.1);
    if (on && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.ctx && this.enabled) this.master.gain.setTargetAtTime(0.8 * this.volume, this.ctx.currentTime, 0.05);
  }

  update(dt, env, time) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const w = env.weather;
    const gust = 0.6 + 0.4 * Math.sin(time * 0.37) * Math.sin(time * 0.13 + 1);
    this.windGain.gain.setTargetAtTime((0.05 + w.wind * 0.09) * gust, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(350 + gust * 300 * w.wind, t, 0.5);
    this.rustleGain.gain.setTargetAtTime(0.012 * w.wind * gust, t, 0.3);
    this.rainGain.gain.setTargetAtTime((env.rainSound ?? w.rain) * 0.16, t, 0.5); // snow is silent

    // birds by day when dry, crickets at night
    this.birdTimer -= dt;
    if (this.birdTimer < 0) {
      this.birdTimer = 2 + Math.random() * 6;
      if (env.dayness > 0.6 && w.rain < 0.3) this.bird();
    }
    this.cricketTimer -= dt;
    if (this.cricketTimer < 0) {
      this.cricketTimer = 0.4 + Math.random() * 1.2;
      if (env.dayness < 0.3 && w.rain < 0.3) this.cricket();
    }
  }

  _env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  // vol/pan let other players' cows sound quieter and positioned by distance
  moo(vol = 1, pan = 0, pitch = 1) {
    if (!this.ctx || !this.enabled || vol <= 0.01) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const dur = 1.3 + Math.random() * 0.7;
    const base = (88 + Math.random() * 30) * pitch;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.55 * vol, t + 0.18);
    out.gain.setValueAtTime(0.5 * vol, t + dur * 0.65);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 7;
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.linearRampToValueAtTime(1100, t + 0.35);
    lp.frequency.linearRampToValueAtTime(650, t + dur * 0.7);
    lp.frequency.linearRampToValueAtTime(300, t + dur);
    const formant = ctx.createBiquadFilter();
    formant.type = 'peaking'; formant.frequency.value = 700; formant.Q.value = 2; formant.gain.value = 8;

    const vib = ctx.createOscillator(); vib.frequency.value = 5.5;
    const vibG = ctx.createGain(); vibG.gain.value = 2.2;
    vib.connect(vibG);
    for (const [type, mul, gain] of [['sawtooth', 1, 0.6], ['square', 1.004, 0.25], ['sawtooth', 0.5, 0.35]]) {
      const o = ctx.createOscillator();
      o.type = type;
      const f = base * mul;
      o.frequency.setValueAtTime(f * 0.82, t);
      o.frequency.linearRampToValueAtTime(f * 1.12, t + 0.3);
      o.frequency.linearRampToValueAtTime(f * 1.02, t + dur * 0.7);
      o.frequency.linearRampToValueAtTime(f * 0.72, t + dur);
      vibG.connect(o.frequency);
      const g = ctx.createGain(); g.gain.value = gain;
      o.connect(g).connect(lp);
      o.start(t); o.stop(t + dur + 0.05);
    }
    // breathy component
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 900; nb.Q.value = 1;
    const ng = ctx.createGain(); ng.gain.value = 0.05;
    n.connect(nb).connect(ng).connect(lp);
    n.start(t); n.stop(t + dur);
    vib.start(t); vib.stop(t + dur);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    lp.connect(formant).connect(out).connect(panner).connect(this.master);
  }

  step(speed, wet) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const vol = Math.min(1, 0.35 + speed * 0.12);
    // soft thud
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70 + Math.random() * 20, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const og = ctx.createGain();
    this._env(og, t, 0.01, 0.18 * vol, 0.15);
    o.connect(og).connect(this.master);
    o.start(t); o.stop(t + 0.16);
    // grass swish
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = wet ? 1200 : 2600 + Math.random() * 800; f.Q.value = 0.8;
    const ng = ctx.createGain();
    this._env(ng, t, 0.02, (wet ? 0.09 : 0.06) * vol, 0.2);
    n.connect(f).connect(ng).connect(this.master);
    n.start(t, Math.random()); n.stop(t + 0.22);
  }

  chew() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800 + Math.random() * 1200; f.Q.value = 1.5;
    const g = ctx.createGain();
    this._env(g, t, 0.01, 0.07, 0.09);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random()); n.stop(t + 0.1);
  }

  bird() {
    const ctx = this.ctx, t0 = ctx.currentTime;
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1;
    pan.connect(this.master);
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2600 + Math.random() * 1800;
    for (let i = 0; i < notes; i++) {
      const t = t0 + i * (0.09 + Math.random() * 0.08);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.2), t);
      o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), t + 0.06);
      const g = ctx.createGain();
      this._env(g, t, 0.01, 0.035, 0.08);
      o.connect(g).connect(pan);
      o.start(t); o.stop(t + 0.09);
    }
  }

  cricket() {
    const ctx = this.ctx, t0 = ctx.currentTime;
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1;
    pan.connect(this.master);
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.07;
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 4300 + Math.random() * 300;
      const g = ctx.createGain();
      this._env(g, t, 0.005, 0.012, 0.045);
      o.connect(g).connect(pan);
      o.start(t); o.stop(t + 0.05);
    }
  }

  _noiseBurst(t, type, freq, q, peak, dur, dest = this.master) {
    const n = this.ctx.createBufferSource(); n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    this._env(g, t, 0.01, peak, dur);
    n.connect(f).connect(g).connect(dest);
    n.start(t, Math.random()); n.stop(t + dur + 0.02);
    return f;
  }

  // low rumbling growl of a crocodile closing in
  growl(vol = 1) {
    if (!this.ctx || !this.enabled || vol <= 0.01) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(58, t);
    o.frequency.linearRampToValueAtTime(46, t + 1.2);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 17;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.5;
    const amp = ctx.createGain(); amp.gain.value = 0.5;
    lfo.connect(lfoG).connect(amp.gain);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    const g = ctx.createGain();
    this._env(g, t, 0.15, 0.5 * vol, 1.3);
    o.connect(lp).connect(amp).connect(g).connect(this.master);
    o.start(t); o.stop(t + 1.35); lfo.start(t); lfo.stop(t + 1.35);
  }

  // jaws snapping shut + a big splash
  snap() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this._noiseBurst(t, 'bandpass', 1800, 2, 0.5, 0.08);
    this._noiseBurst(t, 'lowpass', 500, 0.7, 0.6, 0.35);
    this._noiseBurst(t + 0.02, 'bandpass', 900, 0.6, 0.4, 0.9);
    this._noiseBurst(t + 0.05, 'highpass', 2500, 0.5, 0.18, 0.7);
  }

  // short sad sting when the cow dies
  death() {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime + 0.2;
    [392, 330, 262, 196].forEach((f, i) => {
      const t = t0 + i * 0.32;
      const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = this.ctx.createGain();
      this._env(g, t, 0.02, 0.18, i === 3 ? 1.4 : 0.4);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 1.5);
    });
  }

  // two-tone chime for admin announcements
  chime() {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime;
    for (const [f, dt] of [[880, 0], [1320, 0.16]]) {
      const t = t0 + dt;
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = this.ctx.createGain();
      this._env(g, t, 0.01, 0.22, 0.9);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 0.95);
    }
  }

  // lapping water with the tongue
  slurp() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const f = this._noiseBurst(t, 'bandpass', 900, 3, 0.09, 0.12);
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(500, t + 0.1);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.08);
    const g = this.ctx.createGain();
    this._env(g, t, 0.005, 0.03, 0.09);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.1);
  }

  // hoof splashing through shallow water
  splash(vol = 1) {
    if (!this.ctx || !this.enabled || vol <= 0.01) return;
    const t = this.ctx.currentTime;
    this._noiseBurst(t, 'bandpass', 1100 + Math.random() * 600, 0.9, 0.14 * vol, 0.25);
    this._noiseBurst(t + 0.03, 'highpass', 2500, 0.7, 0.05 * vol, 0.18);
  }

  // effort "huff" + grass swish when jumping
  jump(vol = 1) {
    if (!this.ctx || !this.enabled || vol <= 0.01) return;
    const t = this.ctx.currentTime;
    const f = this._noiseBurst(t, 'bandpass', 700, 1.2, 0.12 * vol, 0.18);
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(1400, t + 0.15);
    this._noiseBurst(t, 'bandpass', 3000, 0.7, 0.06 * vol, 0.25);
  }

  // heavy landing thud, louder for harder landings
  land(power = 1, vol = 1) {
    if (!this.ctx || !this.enabled || vol <= 0.01) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const k = Math.min(1.3, power / 6) * vol;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.2);
    const g = ctx.createGain();
    this._env(g, t, 0.008, 0.45 * k, 0.25);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.26);
    this._noiseBurst(t, 'lowpass', 400, 0.7, 0.25 * k, 0.18);
    this._noiseBurst(t, 'bandpass', 2400, 0.6, 0.08 * k, 0.3);
  }

  // swoosh of the head swinging
  whoosh(vol = 1) {
    if (!this.ctx || !this.enabled || vol <= 0.01) return;
    const t = this.ctx.currentTime + 0.12;
    const f = this._noiseBurst(t, 'bandpass', 600, 2, 0.14 * vol, 0.22);
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.2);
  }

  // cartoon "bonk" when two heads collide
  bonk(vol = 1, pan = 0) {
    if (!this.ctx || !this.enabled || vol <= 0.01) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.master);
    for (const [f0, f1, type, peak] of [[180, 70, 'sine', 0.7], [520, 260, 'triangle', 0.25]]) {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + 0.18);
      const g = ctx.createGain();
      this._env(g, t, 0.004, peak * vol, 0.28);
      o.connect(g).connect(p);
      o.start(t); o.stop(t + 0.3);
    }
    this._noiseBurst(t, 'lowpass', 900, 0.8, 0.35 * vol, 0.12, p);
  }

  thunder(delay = 0) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const n = ctx.createBufferSource(); n.buffer = this.brown;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(90, t + 3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, Math.random()); n.stop(t + 4.2);
  }
}
