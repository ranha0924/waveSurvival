// Outdoor atmosphere: theme by wave, sky/skyline, clouds, dust, smoke, lightning.
const Environment = (() => {
  // Wave themes — palette + atmospheric parameters.
  const themes = {
    sunset: {
      skyTop: '#1a1530',
      skyMid: '#7b3c3c',
      skyBottom: '#d8884a',
      skylineFar: '#1a1626',
      skylineMid: '#262236',
      floorNear: '#3e3a2a',
      floorFar: '#1c1a14',
      ambient: 1.0,
      fogDist: 32,
      darkness: 0.0,
      dustIntensity: 0.6,
      lightning: false,
      cloudAlpha: 0.35,
      cloudColor: [255, 200, 160]
    },
    dusk: {
      skyTop: '#0a0a20',
      skyMid: '#3b1f55',
      skyBottom: '#a8324e',
      skylineFar: '#100c1c',
      skylineMid: '#1d1828',
      floorNear: '#2c2820',
      floorFar: '#14120e',
      ambient: 0.8,
      fogDist: 26,
      darkness: 0.25,
      dustIntensity: 0.9,
      lightning: false,
      cloudAlpha: 0.28,
      cloudColor: [200, 160, 200]
    },
    night: {
      skyTop: '#020208',
      skyMid: '#070a18',
      skyBottom: '#16182e',
      skylineFar: '#06070e',
      skylineMid: '#0a0c18',
      floorNear: '#16141c',
      floorFar: '#08070d',
      ambient: 0.55,
      fogDist: 18,
      darkness: 0.6,
      dustIntensity: 0.5,
      lightning: false,
      cloudAlpha: 0.18,
      cloudColor: [120, 130, 170],
      emergencyLights: true
    },
    storm: {
      skyTop: '#020205',
      skyMid: '#0a0c18',
      skyBottom: '#1a1822',
      skylineFar: '#04050a',
      skylineMid: '#080a12',
      floorNear: '#181620',
      floorFar: '#080610',
      ambient: 0.45,
      fogDist: 14,
      darkness: 0.7,
      dustIntensity: 1.6,
      lightning: true,
      cloudAlpha: 0.45,
      cloudColor: [80, 90, 120],
      emergencyLights: true
    }
  };

  function themeForWave(wave) {
    if (wave <= 5) return themes.sunset;
    if (wave <= 10) return themes.dusk;
    if (wave <= 15) return themes.night;
    return themes.storm;
  }

  // Persistent world objects placed once per map.
  let clouds = [];
  let smokeColumns = [];
  let dust = [];
  let mountainSeed = 0;
  let lightningTimer = 0;
  let lightningFlash = 0;

  function init() {
    clouds = [];
    for (let i = 0; i < 6; i++) {
      clouds.push({
        angle: Math.random() * Math.PI * 2,
        height: 0.05 + Math.random() * 0.18, // fraction of H above horizon
        width: 0.15 + Math.random() * 0.25,  // angular width in radians
        drift: (Math.random() - 0.5) * 0.015,
        opacityJitter: 0.6 + Math.random() * 0.4
      });
    }

    smokeColumns = [
      { worldAngle: 0.4, color: [60, 60, 70], intensity: 1.0 },
      { worldAngle: 2.1, color: [80, 70, 60], intensity: 0.8 },
      { worldAngle: 4.5, color: [70, 60, 60], intensity: 0.9 }
    ];

    dust = [];
    for (let i = 0; i < 80; i++) dust.push(spawnDustParticle());

    mountainSeed = Math.floor(Math.random() * 1000);
    lightningTimer = 0;
    lightningFlash = 0;
  }

  function spawnDustParticle() {
    return {
      x: Math.random() * GameMap.W,
      y: Math.random() * GameMap.H,
      vx: 1.2 + Math.random() * 0.8,
      vy: -0.2 + Math.random() * 0.4,
      life: 1.0 + Math.random() * 2.0,
      maxLife: 3.0,
      size: 1 + Math.random() * 2
    };
  }

  function update(dt, wave, particles) {
    const theme = themeForWave(wave);

    for (const c of clouds) c.angle = (c.angle + c.drift * dt) % (Math.PI * 2);

    // Dust drifting across the map.
    const intensity = theme.dustIntensity;
    for (let i = dust.length - 1; i >= 0; i--) {
      const d = dust[i];
      d.x += d.vx * intensity * dt;
      d.y += d.vy * intensity * dt;
      d.life -= dt;
      if (d.life <= 0 || d.x < -2 || d.x > GameMap.W + 2 || d.y < -2 || d.y > GameMap.H + 2) {
        dust[i] = spawnDustParticle();
        // Re-enter from west edge for a steady wind feel.
        dust[i].x = -1 + Math.random() * 2;
      }
    }

    // Lightning flash management for storm theme.
    lightningFlash = Math.max(0, lightningFlash - dt * 4);
    if (theme.lightning) {
      lightningTimer -= dt;
      if (lightningTimer <= 0) {
        lightningFlash = 0.9 + Math.random() * 0.3;
        lightningTimer = 4 + Math.random() * 9;
      }
    }
  }

  // Procedural skyline silhouette height at angle a.
  // Two layers (far mountains, mid ruins) given separately by caller.
  function silhouetteHeightFar(a) {
    // Smooth mountain ridge — sum of sines.
    const s = mountainSeed * 0.137;
    return 38
      + Math.sin(a * 1.7 + s) * 14
      + Math.sin(a * 3.3 + s * 1.4) * 10
      + Math.sin(a * 7.1 + s * 2.3) * 6
      + Math.sin(a * 13.0 + s * 3.1) * 4;
  }
  function silhouetteHeightMid(a) {
    // Blocky ruins — quantized + spikes for antennas.
    const s = mountainSeed * 0.211;
    let h = 14 + Math.sin(a * 4.3 + s) * 6 + Math.sin(a * 9.7 + s * 1.5) * 4;
    // Sparse antennas
    const ant = Math.sin(a * 21 + s * 0.7);
    if (ant > 0.92) h += 18;
    else if (ant > 0.84) h += 9;
    return Math.max(4, h);
  }

  function getClouds() { return clouds; }
  function getSmokeColumns() { return smokeColumns; }
  function getDust() { return dust; }
  function getLightningFlash() { return lightningFlash; }

  return {
    init, update, themeForWave,
    silhouetteHeightFar, silhouetteHeightMid,
    getClouds, getSmokeColumns, getDust, getLightningFlash
  };
})();
