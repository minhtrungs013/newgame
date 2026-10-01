// Gameplay tuning and graphics presets. Server-side checks live in server/config.js -
// keep the shared numbers (XP and eating / drinking rates) in sync.

// Levels 0..30: grazing (and a little drinking) earns XP; each level makes the cow bigger.
// Hunger and thirst cost XP (you can drop levels).
export const XP_GRAZE = 1;      // per second of eating grass (Lv 30 takes ~78 min of grazing)
export const XP_DRINK = 0.25;   // per second of drinking
export const XP_HUNGER = 0.75;  // lost per second for each unmet need
// XP only comes with food / water actually gained, so a full cow can't farm XP by holding E
export const GRAZE_RATE = 0.06; // food gained per second of grazing
export const DRINK_RATE = 0.15; // water gained per second of drinking
export const FULL = 0.995;

// health: drains while starving or parched; at 0 the cow dies
export const HEALTH_DRAIN = 1 / 90;  // per second for each unmet need (hunger / thirst)
export const HEALTH_REGEN = 1 / 60;  // per second when fed and watered

export const CARD_RANGE = 10; // metres: how close you must be to inspect another cow

const dpr = window.devicePixelRatio || 1;
export const QUALITY = {
  low:    { blades: 45000,  patch: 64,  segs: 3, pr: Math.min(dpr, 1) * 0.75, shadows: false, shadowMap: 1024, flowers: 700,  rain: 1500 },
  medium: { blades: 160000, patch: 84,  segs: 4, pr: Math.min(dpr, 1),        shadows: true,  shadowMap: 1024, flowers: 1800, rain: 3000 },
  high:   { blades: 300000, patch: 104, segs: 5, pr: Math.min(dpr, 1.5),      shadows: true,  shadowMap: 2048, flowers: 3000, rain: 4500 },
  ultra:  { blades: 500000, patch: 128, segs: 5, pr: Math.min(dpr, 2),        shadows: true,  shadowMap: 4096, flowers: 4500, rain: 6000 },
};

// ---------- milk & coins (the server decides; these are for the HUD / prompts) ----------
export const MILK_MIN_LEVEL = 20;
export const UDDER_MAX = 10;
export const BOTTLE_L = 5, BOTTLES_MAX = 3;
export const MILK_TIME = 3; // seconds of milking

// ---------- farm buildings (must match server/config.js) ----------
// x, z = centre; yaw = rotation (local +z is the front: the barn door / the counters)
export const BARN = { x: 20.4, z: -12.7, yaw: -1.014, w: 9, d: 11 };
export const MARKET = { x: -7.3, z: 29.1, yaw: 2.89 };
export const COUNTERS = { milk: { lx: -3.4, lz: 2.4 }, shop: { lx: 3.4, lz: 2.4 } }; // stand-here spots, market space
export function toLocal(b, x, z) {
  const dx = x - b.x, dz = z - b.z, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}
export function toWorld(b, lx, lz) {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
}
export function inBarn(x, z) {
  const { lx, lz } = toLocal(BARN, x, z);
  return Math.abs(lx) < BARN.w / 2 - 0.5 && Math.abs(lz) < BARN.d / 2 - 0.5;
}
// 'milk' | 'shop' | null: which market counter the cow is standing at
export function counterAt(x, z, range = 3) {
  for (const [k, c] of Object.entries(COUNTERS)) {
    const p = toWorld(MARKET, c.lx, c.lz);
    if (Math.hypot(x - p.x, z - p.z) < range) return k;
  }
  return null;
}
