// World clock: day/night cycle, seasons and random weather.
// Everything is derived from the real clock, so all players (and server restarts) agree.
const DAY_MS = 15 * 60 * 1000;          // one in-game day = 15 real minutes
const SEASON_DAYS = 2;                   // days per season -> a year is 8 days (2 hours)
const WEATHER_SLOT_MS = 4 * 60 * 1000;   // the weather may change every 4 minutes
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_WEATHER = { // chances per season (rain = snow in winter)
  spring: { clear: 0.45, cloudy: 0.25, rain: 0.25, fog: 0.05 },
  summer: { clear: 0.62, cloudy: 0.18, rain: 0.15, fog: 0.05 },
  autumn: { clear: 0.35, cloudy: 0.3, rain: 0.2, fog: 0.15 },
  winter: { clear: 0.35, cloudy: 0.3, rain: 0.25, fog: 0.1 },
};
// manual overrides from Ctrl+K (kept in memory)
const envOverride = { hourOffset: 0, seasonOffset: 0, weather: null, weatherSlot: -1 };

function slotRandom(slot) {
  let t = (slot * 2654435761) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function worldClock(now = Date.now()) {
  const dayFloat = now / DAY_MS + envOverride.hourOffset / 24;
  const hour = ((dayFloat % 1) + 1) % 1 * 24;
  const seasonFloat = dayFloat / SEASON_DAYS + envOverride.seasonOffset;
  const seasonIdx = ((Math.floor(seasonFloat) % 4) + 4) % 4;
  const season = SEASONS[seasonIdx];
  const slot = Math.floor(now / WEATHER_SLOT_MS);
  let weather;
  if (envOverride.weather && envOverride.weatherSlot === slot) weather = envOverride.weather;
  else {
    const table = SEASON_WEATHER[season];
    let r = slotRandom(slot), acc = 0;
    weather = 'clear';
    for (const [w, pr] of Object.entries(table)) { acc += pr; if (r < acc) { weather = w; break; } }
  }
  return {
    hour, day: Math.floor((((seasonFloat % 1) + 1) % 1) * SEASON_DAYS) + 1, // day within the season
    season, seasonT: ((seasonFloat % 1) + 1) % 1, weather,
    nextWeatherIn: WEATHER_SLOT_MS - (now % WEATHER_SLOT_MS),
  };
}

function envMsg() {
  const c = worldClock();
  return { t: 'env', weather: c.weather, hour: +c.hour.toFixed(4), dayHours: DAY_MS / 3600000, season: c.season, seasonT: +c.seasonT.toFixed(4), day: c.day, next: c.nextWeatherIn };
}

const TIMES = { morning: 7.9, noon: 12.5, sunset: 18.35, night: 23.0 }; // Ctrl+K time presets (hour)
const WEATHERS = ['clear', 'cloudy', 'rain', 'fog'];

// manual override (Ctrl+K): weather until the next random change, or jump the clock / season
function applyOverride(m) {
  if (WEATHERS.includes(m.weather)) { envOverride.weather = m.weather; envOverride.weatherSlot = Math.floor(Date.now() / WEATHER_SLOT_MS); }
  if (TIMES[m.time] !== undefined) envOverride.hourOffset += ((TIMES[m.time] - worldClock().hour) % 24 + 24) % 24;
  if (SEASONS.includes(m.season)) {
    const cur = SEASONS.indexOf(worldClock().season), want = SEASONS.indexOf(m.season);
    envOverride.seasonOffset += (want - cur + 4) % 4;
  }
}

module.exports = { worldClock, envMsg, applyOverride };
