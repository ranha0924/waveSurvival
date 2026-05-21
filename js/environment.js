// Outdoor atmosphere: theme by wave (sky/floor palette + fog).
// Background props (mountains, clouds, smoke, dust, lightning) were
// removed; this module now only owns the per-wave palette.
//
// The 굿판 themes walk from sunset through dawn → blood-night → black
// gutpan, so the player feels the world get more haunted as the run drags
// on. Names are still ASCII so the raycaster's switch statements (sky
// pass, particle tint) keep matching without a translation table.
const Environment = (() => {
  // Per-theme palette. `name` is read by the raycaster's sky pass to pick
  // which celestial bodies / lightning to draw. `haze` is an rgb triplet
  // used for the ground-fog band right at the horizon.
  const themes = {
    // Waves 1–5 — 황혼 (dusk). Smoky-red sky over a brown earthen floor.
    sunset: {
      name: 'sunset',
      skyTop: '#0e0610',
      skyMid: '#5a1a1f',
      skyBottom: '#a13a2c',
      floorNear: '#3a2a1c',
      floorFar: '#10090a',
      ambient: 1.0,
      fogDist: 32,
      haze: '180,80,60',
      concreteTint: '90,55,40'
    },
    // Waves 6–10 — 저녁 굿당. Purple-rose sky with incense haze.
    dusk: {
      name: 'dusk',
      skyTop: '#08050f',
      skyMid: '#42164a',
      skyBottom: '#7e253f',
      floorNear: '#2a1f22',
      floorFar: '#08050a',
      ambient: 0.85,
      fogDist: 26,
      haze: '140,70,90',
      concreteTint: '70,45,55'
    },
    // Waves 11–15 — 삼경. Full-moon night, cold blue fog.
    night: {
      name: 'night',
      skyTop: '#01010a',
      skyMid: '#080d22',
      skyBottom: '#1a2042',
      floorNear: '#10141c',
      floorFar: '#03040a',
      ambient: 0.65,
      fogDist: 20,
      haze: '60,80,120',
      concreteTint: '40,50,70'
    },
    // Waves 16+ — 검은 굿판. Near-pitch sky bleeding red at the horizon.
    storm: {
      name: 'storm',
      skyTop: '#000004',
      skyMid: '#0a040a',
      skyBottom: '#2a0608',
      floorNear: '#0a0506',
      floorFar: '#020102',
      ambient: 0.55,
      fogDist: 16,
      haze: '120,30,30',
      concreteTint: '50,20,20'
    }
  };

  function themeForWave(wave) {
    if (wave <= 5) return themes.sunset;
    if (wave <= 10) return themes.dusk;
    if (wave <= 15) return themes.night;
    return themes.storm;
  }

  function init() {}
  function update() {}

  return { init, update, themeForWave };
})();
