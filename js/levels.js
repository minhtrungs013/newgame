// Level system (0..30). The same formula lives in server.js - keep them identical.
// XP needed to go from level L to L+1 grows slowly: 40, 48, 56, ...
export const LEVEL_MAX = 30;
export const xpNeed = (level) => 40 + 8 * level;
export const xpForLevel = (level) => 40 * level + 4 * level * (level - 1); // total XP to reach `level`
export const XP_MAX = xpForLevel(LEVEL_MAX);

export function levelInfo(xp) {
  xp = Math.max(0, Math.min(XP_MAX, xp || 0));
  let level = 0;
  while (level < LEVEL_MAX && xp >= xpForLevel(level + 1)) level++;
  const into = xp - xpForLevel(level);
  const need = level < LEVEL_MAX ? xpNeed(level) : 1;
  return { level, into, need, frac: level < LEVEL_MAX ? into / need : 1 };
}

// life stages shown in the HUD
export function stageName(level) {
  return level >= 20 ? 'Bò trưởng thành' : level >= 10 ? 'Bò tơ' : 'Bê con';
}
