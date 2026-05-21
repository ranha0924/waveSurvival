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
  // All four themes are now Korean mountain-forest at night — cold blue
  // sky, mossy-blue forest haze, dark earth floor — and just get a touch
  // darker / colder as the wave number climbs. The 'storm' band keeps a
  // faint red bleed at the very bottom so the player can still feel a
  // shift after wave 15, but the dominant palette stays blue-night.
  const themes = {
    // Waves 1–5 — 산속 어둑한 밤. Deep blue sky over damp forest earth.
    sunset: {
      name: 'sunset',
      skyTop:    '#02030a',
      skyMid:    '#080f22',
      skyBottom: '#101a30',
      floorNear: '#1a1208',
      floorFar:  '#060403',
      ambient: 0.75,
      fogDist: 22,
      haze: '40,60,90',
      concreteTint: '90,60,30'
    },
    // Waves 6–10 — 더 깊은 밤. Tighter fog, slightly cooler.
    dusk: {
      name: 'dusk',
      skyTop:    '#01020a',
      skyMid:    '#05091e',
      skyBottom: '#0c142a',
      floorNear: '#15100a',
      floorFar:  '#040302',
      ambient: 0.68,
      fogDist: 20,
      haze: '35,55,85',
      concreteTint: '80,55,28'
    },
    // Waves 11–15 — 삼경. Cold moonlit night, ground steeped in blue mist.
    night: {
      name: 'night',
      skyTop:    '#000005',
      skyMid:    '#02061a',
      skyBottom: '#080f22',
      floorNear: '#100a06',
      floorFar:  '#020203',
      ambient: 0.60,
      fogDist: 18,
      haze: '28,48,80',
      concreteTint: '70,48,25'
    },
    // Waves 16+ — 검은 굿판. Near-pitch with the faintest blood bleed at
    // the horizon — atmosphere shifts, palette stays blue-night.
    storm: {
      name: 'storm',
      skyTop:    '#000003',
      skyMid:    '#010312',
      skyBottom: '#06081c',
      floorNear: '#0a0604',
      floorFar:  '#010102',
      ambient: 0.52,
      fogDist: 15,
      haze: '25,40,70',
      concreteTint: '60,38,20'
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
