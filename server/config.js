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
const RISE_SLACK = 1.5;                       // network jitter on how fast food / water may rise
const XP_SLACK = 1.15;
const XP_BANK_MAX = 40;

// combat
const BUTT_DAMAGE = 0.12;          // health lost per headbutt from a non-teammate (x power 0.6..1.8)
const MAX_HEAL_PER_SEC = 1 / 40;   // clients regen at 1/60 per s; anything faster is ignored

module.exports = {
  PORT, MAX_PLAYERS, ADMIN_KEY, SESSION_TTL, USER_RE,
  COATS, PATTERNS, HORNS, ACCESSORIES, HEX, CALF_SIZE,
  LEVEL_MAX, XP_MAX, levelOf,
  XP_GRAZE, XP_DRINK, GRAZE_RATE, DRINK_RATE, RISE_SLACK, XP_SLACK, XP_BANK_MAX,
  BUTT_DAMAGE, MAX_HEAL_PER_SEC,
};
