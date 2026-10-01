import { SEASON_ORDER, SEASON_INFO } from '../world/environment.js';

// Top-right HUD: the four seasons around a ring (marker = where we are in the year),
// a day/night dial with the clock in the middle, and a line of text underneath.
export class SeasonWheel {
  constructor(canvas, textEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.textEl = textEl;
  }

  draw(env) {
    const ctx = this.ctx, wheel = this.canvas;
    const W = 110, R = W / 2, ring = R - 6; // drawn in CSS pixels, canvas is 2x for sharpness
    const idx = SEASON_ORDER.indexOf(env.season);
    const year = (idx + env.seasonT) / 4; // 0..1 position in the year
    ctx.setTransform(wheel.width / W, 0, 0, wheel.width / W, 0, 0);
    ctx.clearRect(0, 0, W, W);
    // four season arcs (spring starts at the top, clockwise)
    for (let i = 0; i < 4; i++) {
      const a0 = -Math.PI / 2 + (i / 4) * Math.PI * 2, a1 = a0 + Math.PI / 2;
      ctx.beginPath();
      ctx.arc(R, R, ring, a0 + 0.04, a1 - 0.04);
      ctx.strokeStyle = SEASON_INFO[SEASON_ORDER[i]].color;
      ctx.globalAlpha = i === idx ? 1 : 0.38;
      ctx.lineWidth = i === idx ? 9 : 7;
      ctx.lineCap = 'round';
      ctx.stroke();
      // icon in the middle of each arc
      const am = (a0 + a1) / 2;
      ctx.globalAlpha = i === idx ? 1 : 0.55;
      ctx.font = `${i === idx ? 15 : 12}px "Segoe UI Emoji", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(SEASON_INFO[SEASON_ORDER[i]].icon, R + Math.cos(am) * (ring - 17), R + Math.sin(am) * (ring - 17));
    }
    ctx.globalAlpha = 1;
    // marker: where we are in the year
    const am = -Math.PI / 2 + year * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(R + Math.cos(am) * ring, R + Math.sin(am) * ring, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.stroke();
    // centre: day / night dial (sun or moon moving round with the hour)
    const inner = ring - 30;
    const g2 = ctx.createRadialGradient(R, R, 2, R, R, inner);
    const day = env.dayness;
    g2.addColorStop(0, day > 0.5 ? 'rgba(120,170,230,.55)' : 'rgba(30,40,80,.65)');
    g2.addColorStop(1, 'rgba(0,0,0,.25)');
    ctx.beginPath(); ctx.arc(R, R, inner, 0, Math.PI * 2); ctx.fillStyle = g2; ctx.fill();
    const ha = (env.hour / 24) * Math.PI * 2 + Math.PI / 2; // midnight at the bottom, noon at the top
    ctx.font = '13px "Segoe UI Emoji", sans-serif';
    ctx.fillText(day > 0.5 ? '☀️' : '🌙', R + Math.cos(ha) * (inner - 9), R + Math.sin(ha) * (inner - 9));
    ctx.fillStyle = '#fff';
    ctx.font = '600 11px "Segoe UI", sans-serif';
    const hh = Math.floor(env.hour), mm = Math.floor((env.hour % 1) * 60);
    ctx.fillText(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, R, R + 1);
    const si = SEASON_INFO[env.season];
    this.textEl.textContent = `${si.icon} ${si.name} · Ngày ${env.day}/2 · ${env.weatherIcon()} ${env.weatherLabel()}`;
  }
}
