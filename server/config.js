// Server settings and game rules. The numbers shared with the browser (levels, XP and
// eating / drinking rates) must match public/js/game/levels.js and public/js/game/config.js.

const PORT = Number(process.env.PORT) || 5173;
const MAX_PLAYERS = 32;
// Admin announcements (/ONADMIN <text>, /OFFADMIN). If ADMIN_KEY is set, a player must
// first unlock admin commands with /ADMIN <key>; otherwise anyone may use them.
const ADMIN_KEY = process.env.ADMIN_KEY || '';

// accounts
const SESSION_TTL = 60 * 60 * 24 * 30; // login lasts 30 days
const USER_RE = /^[a-zA-Z0-9_]{3,16}$/;

// cow appearance options (must match public/js/cow/cow.js)
const COATS = ['holstein', 'brown', 'jersey', 'black'];
const PATTERNS = ['none', 'few', 'many', 'patches'];
const HORNS = ['none', 'short', 'long'];
const ACCESSORIES = ['none', 'bell', 'hat', 'flowers', 'scarf'];
const HEX = /^#[0-9a-f]{6}$/i;
const CALF_SIZE = 0.5;

// levels 0..30 from XP
const LEVEL_MAX = 30;
const xpForLevel = (l) => 40 * l + 4 * l * (l - 1);
const XP_MAX = xpForLevel(LEVEL_MAX);
const levelOf = (xp) => { let l = 0; while (l < LEVEL_MAX && xp >= xpForLevel(l + 1)) l++; return l; };

// XP only comes from actually eating / drinking: a full cow that keeps holding E gains nothing.
// Food / water may rise only as fast as eating / drinking allows, and every bit they rise puts
// XP in a small "bank" that the reported XP can draw from.
const XP_GRAZE = 1, XP_DRINK = 0.25;          // XP per second of eating / drinking
const GRAZE_RATE = 0.06, DRINK_RATE = 0.15;   // food / water gained per second
const RISE_SLACK = 1.25;                      // network jitter on how fast food / water may rise
const XP_SLACK = 1.15;
const XP_BANK_MAX = 40;
// food / water can't drop faster than hunger / thirst do (running in winter ~0.005 / s), so a
// modified client can't "empty and refill" them over and over to farm XP
const FOOD_DROP_MAX = 0.0055, WATER_DROP_MAX = 0.0055;
// movement: running is 5.2 m/s; knockbacks / headbutt lunges add short bursts
const MOVE_SPEED_MAX = 7;     // m/s the position budget refills at
const MOVE_BURST = 12;        // m of budget that can be saved up
const CORRECT_AFTER = 3;      // m off before the client is pulled back to the server's position

// combat
const BUTT_DAMAGE = 0.12;          // health lost per headbutt from a non-teammate (x power 0.6..1.8)
const MAX_HEAL_PER_SEC = 1 / 40;   // clients regen at 1/60 per s; anything faster is ignored

// ---------- milk & coins ----------
const MILK_MIN_LEVEL = 20;          // adult cows only
const UDDER_MAX = 10;               // litres the udder holds
const BOTTLE_L = 5, BOTTLES_MAX = 3; // milk is carried in bottles: 3 x 5 L
// litres per second while fed & watered: 1 L / 90 s at Lv 20 -> 1 L / 50 s at Lv 30
const milkRate = (level) => (level < MILK_MIN_LEVEL ? 0 : 1 / 90 + ((level - MILK_MIN_LEVEL) / (30 - MILK_MIN_LEVEL)) * (1 / 50 - 1 / 90));
const MILK_NEED = 0.4;              // food and water must both be above this to make milk
const MILK_TIME = 3;                // seconds of milking
const DEFAULT_MILK_PRICE = 5;       // coins per litre (admins change it in the game)
const DEATH_COIN_LOSS = 0.5;        // share of coins lost on death
const ADMIN_USERS = (process.env.ADMIN_USERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

// ---------- farm buildings (must match public/js/game/config.js) ----------
// x, z = centre; yaw = rotation (local +z is the front: the barn door / the counters)
const BARN = { x: 20.4, z: -12.7, yaw: -1.014, w: 9, d: 11 };
const MARKET = { x: -7.3, z: 29.1, yaw: 2.89 };
const COUNTERS = { milk: { lx: -3.4, lz: 2.4 }, shop: { lx: 3.4, lz: 2.4 } }; // stand-here spots, market space
const toLocal = (b, x, z) => {
  const dx = x - b.x, dz = z - b.z, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
};
const toWorld = (b, lx, lz) => {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
};
const inBarn = (x, z, slack = 0) => {
  const { lx, lz } = toLocal(BARN, x, z);
  return Math.abs(lx) < BARN.w / 2 - 0.5 + slack && Math.abs(lz) < BARN.d / 2 - 0.5 + slack;
};
const nearCounter = (which, x, z, range = 3) => {
  const c = COUNTERS[which], p = toWorld(MARKET, c.lx, c.lz);
  return Math.hypot(x - p.x, z - p.z) < range;
};

module.exports = {
  MILK_MIN_LEVEL, UDDER_MAX, BOTTLE_L, BOTTLES_MAX, milkRate, MILK_NEED, MILK_TIME, DEFAULT_MILK_PRICE, DEATH_COIN_LOSS, ADMIN_USERS,
  BARN, MARKET, COUNTERS, inBarn, nearCounter,
  PORT, MAX_PLAYERS, ADMIN_KEY, SESSION_TTL, USER_RE,
  COATS, PATTERNS, HORNS, ACCESSORIES, HEX, CALF_SIZE,
  LEVEL_MAX, XP_MAX, levelOf,
  XP_GRAZE, XP_DRINK, GRAZE_RATE, DRINK_RATE, RISE_SLACK, XP_SLACK, XP_BANK_MAX,
  FOOD_DROP_MAX, WATER_DROP_MAX, MOVE_SPEED_MAX, MOVE_BURST, CORRECT_AFTER,
  BUTT_DAMAGE, MAX_HEAL_PER_SEC,
};
