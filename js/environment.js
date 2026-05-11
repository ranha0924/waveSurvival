// Outdoor atmosphere: theme by wave (sky/floor palette + fog).
// Background props (mountains, clouds, smoke, dust, lightning) were
// removed; this module now only owns the per-wave palette.
const Environment = (() => {
  // Per-theme palette. `name` is read by the raycaster's sky pass to pick
  // which celestial bodies / lightning to draw. `haze` is an rgb triplet
  // used for the ground-fog band right at the horizon.
  const themes = {
    sunset: {
      name: 'sunset',
      skyTop: '#1a1530',
      skyMid: '#7b3c3c',
      skyBottom: '#d8884a',
      floorNear: '#3a3632',
      floorFar: '#161412',
      ambient: 1.0,
      fogDist: 32,
      haze: '210,140,80',
      concreteTint: '120,90,70'
    },
    dusk: {
      name: 'dusk',
      skyTop: '#0a0a20',
      skyMid: '#3b1f55',
      skyBottom: '#a8324e',
      floorNear: '#26252c',
      floorFar: '#0c0c12',
      ambient: 0.85,
      fogDist: 26,
      haze: '160,90,90',
      concreteTint: '80,60,80'
    },
    night: {
      name: 'night',
      skyTop: '#020208',
      skyMid: '#070a18',
      skyBottom: '#16182e',
      floorNear: '#181a1e',
      floorFar: '#05070a',
      ambient: 0.65,
      fogDist: 20,
      haze: '60,70,110',
      concreteTint: '50,55,75'
    },
    storm: {
      name: 'storm',
      skyTop: '#020205',
      skyMid: '#0a0c18',
      skyBottom: '#1a1822',
      floorNear: '#13161a',
      floorFar: '#04050a',
      ambient: 0.55,
      fogDist: 16,
      haze: '70,75,95',
      concreteTint: '55,65,80'
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
