// Input sanitising shared by the game and the API.
const crypto = require('crypto');
const { HEX, PATTERNS, HORNS, ACCESSORIES } = require('./config');

const num = (v, lo, hi, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
function cleanLook(l) {
  if (!l || typeof l !== 'object') return null;
  const hex = (v, d) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  return {
    base: hex(l.base, '#f2efe8'), spot: hex(l.spot, '#121212'), pattern: pick(l.pattern, PATTERNS, 'many'),
    snout: hex(l.snout, '#dca59a'), horns: pick(l.horns, HORNS, 'short'), size: Math.round(num(l.size, 0.85, 1.2, 1) * 100) / 100,
    acc: pick(l.acc, ACCESSORIES, 'none'), accColor: hex(l.accColor, '#d83a3a'),
  };
}

// constant-time string compare (admin key)
function sameKey(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { num, clean, cleanLook, sameKey };
