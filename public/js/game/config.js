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
