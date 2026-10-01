import { pondsNear } from '../world/terrain.js';

const RANGE = 120; // metres from centre to edge

// Round minimap, rotated so the camera's forward points up: ponds, big obstacles,
// other players (clan mates in the clan colour) and an arrow for the local cow.
export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  // cow: local cow, camYaw: camera yaw, colliders: world obstacles, remotes: other players, clan: my clan,
  // places: landmarks [{ x, z, icon }] (shown at the edge when far away)
  draw({ cow, camYaw, colliders, remotes, clan, places = [] }) {
    const ctx = this.ctx, W = this.canvas.width, R = W / 2, sc = (R - 8) / RANGE;
    const sy = Math.sin(camYaw), cy = Math.cos(camYaw);
    // world offset -> minimap pixels
    const toScreen = (dx, dz) => [R + (dx * cy - dz * sy) * sc, R + (dx * sy + dz * cy) * sc];
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(90,150,210,0.55)';
    for (const p of pondsNear(cow.pos.x, cow.pos.z, 1)) {
      const [x, y] = toScreen(p.x - cow.pos.x, p.z - cow.pos.z);
      ctx.beginPath(); ctx.arc(x, y, Math.max(3, p.R * 1.15 * sc), 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(160,170,150,0.45)';
    for (const c of colliders) {
      if (c.r < 0.5) continue;
      const [x, y] = toScreen(c.x - cow.pos.x, c.z - cow.pos.z);
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.2, c.r * sc), 0, Math.PI * 2); ctx.fill();
    }
    // landmarks (barn, market): pinned to the edge when out of range
    ctx.font = '15px "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const pl of places) {
      let dx = pl.x - cow.pos.x, dz = pl.z - cow.pos.z;
      const d = Math.hypot(dx, dz), max = RANGE * 0.94;
      if (d > max) { dx *= max / d; dz *= max / d; }
      const [x, y] = toScreen(dx, dz);
      ctx.globalAlpha = d > max ? 0.75 : 1;
      ctx.fillText(pl.icon, x, y);
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.arc(R, R, (R - 8) / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.font = '600 10px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    for (const r of remotes) {
      let dx = r.cow.pos.x - cow.pos.x, dz = r.cow.pos.z - cow.pos.z;
      const d = Math.hypot(dx, dz);
      const far = d > RANGE;
      if (far) { dx *= RANGE / d; dz *= RANGE / d; }
      const [x, y] = toScreen(dx, dz);
      const mate = clan && r.clan && r.clan.id === clan.id;
      ctx.fillStyle = mate ? clan.color : far ? 'rgba(255,196,90,0.7)' : '#ffc45a';
      ctx.beginPath(); ctx.arc(x, y, far ? 3 : 4, 0, Math.PI * 2); ctx.fill();
      if (!far) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillText(r.name, x, y - 7); }
    }
    ctx.restore();
    // local cow arrow
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(camYaw + Math.PI - cow.heading);
    ctx.fillStyle = '#d8e8a8';
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
