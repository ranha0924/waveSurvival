// Outdoor atmosphere: theme by wave (sky/floor palette + fog).
// Background props (mountains, clouds, smoke, dust, lightning) were
// removed; this module now only owns the per-wave palette.
const Environment = (() => {
  const themes = {
    sunset: {
      skyTop: '#1a1530',
      skyMid: '#7b3c3c',
      skyBottom: '#d8884a',
      floorNear: '#3e3a2a',
      floorFar: '#1c1a14',
      ambient: 1.0,
      fogDist: 32
    },
    dusk: {
      skyTop: '#0a0a20',
      skyMid: '#3b1f55',
      skyBottom: '#a8324e',
      floorNear: '#2c2820',
      floorFar: '#14120e',
      ambient: 0.85,
      fogDist: 26
    },
    night: {
      skyTop: '#020208',
      skyMid: '#070a18',
      skyBottom: '#16182e',
      floorNear: '#16141c',
      floorFar: '#08070d',
      ambient: 0.65,
      fogDist: 20
    },
    storm: {
      skyTop: '#020205',
      skyMid: '#0a0c18',
      skyBottom: '#1a1822',
      floorNear: '#181620',
      floorFar: '#080610',
      ambient: 0.55,
      fogDist: 16
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
