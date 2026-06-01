// Seeded RNG used for the daily-challenge mode. mulberry32 — small,
// deterministic, plenty good for a wave shooter.
//
// Only "shape-of-the-run" decisions go through this stream (wave
// composition, spawn-point pick, upgrade card selection). Cosmetic
// randomness (particles, spread, AI sidestep) keeps using Math.random
// so moment-to-moment combat still feels alive.
const Random = (() => {
  let state = 1;

  function mulberry32() {
    state = (state + 0x6D2B79F5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // YYYYMMDD as a 32-bit integer — same all day, different next day.
  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return y * 10000 + m * 100 + day;
  }
  function todayString() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Bump this to re-roll the daily challenge (a fresh 권능/wave sequence for
  // every date). Each increment shifts the seed so "today's daily" becomes a
  // new deterministic run — used to refresh the day's pick on request.
  const DAILY_SEED_VERSION = 1;

  function seed(n) { state = (n | 0) || 1; }
  function seedToday() { seed((todayKey() + DAILY_SEED_VERSION * 0x9E3779B1) | 0); }
  function next() { return mulberry32(); }
  function int(maxExclusive) { return Math.floor(next() * maxExclusive); }
  function pick(arr) { return arr[int(arr.length)]; }

  return { seed, seedToday, next, int, pick, todayKey, todayString };
})();
