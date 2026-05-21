// Outdoor atmosphere: theme by wave (sky/floor palette + fog) plus the
// static tree population that surrounds the play area.
//
// The 굿판 themes walk from sunset through dawn → blood-night → black
// gutpan, so the player feels the world get more haunted as the run drags
// on. Names are still ASCII so the raycaster's switch statements (sky
// pass, particle tint) keep matching without a translation table.
//
// Trees are billboard sprites placed at init() time on every empty tile
// that isn't near the player spawn or an enemy gate. They're drawn by
// the raycaster just like enemies/pickups but have no collision — the
// player and enemies pass straight through. The point is atmosphere
// (surrounded-by-woods feel), not navigation.
const Environment = (() => {
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

  // ---------- Tree canvases ----------
  // Three variants built once at init so the forest looks varied without
  // each tree owning its own canvas. Variant 0 is a tall pine (conifer
  // crown), variant 1 a denser pine, variant 2 a broadleaf with a
  // rounded crown. All face the camera (billboard) so the variant
  // mostly governs silhouette shape.
  const trees = [];           // { x, y, variant, scale } in world coords
  const treeCanvases = [];    // one canvas per variant

  function rng(seed) {
    let s = seed | 0;
    return () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Tall conifer: narrow brown trunk + 3 stacked dark green triangle
  // tiers. Drawn dark so the silhouette reads at night without needing
  // the lighting pass to know about it.
  function buildPineTall() {
    const W = 48, H = 96;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const r = rng(1001);
    // Trunk
    c.fillStyle = '#1a0d06';
    c.fillRect(W / 2 - 3, H - 22, 6, 22);
    c.fillStyle = '#3a2010';
    c.fillRect(W / 2 - 3, H - 22, 2, 22);
    // Three foliage tiers (top → bottom, each wider)
    const tiers = [
      { y: 4,  w: 18 },
      { y: 26, w: 28 },
      { y: 50, w: 40 }
    ];
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      const baseY = t.y + 28;
      // Outer silhouette
      c.fillStyle = '#0a1408';
      c.beginPath();
      c.moveTo(W / 2, t.y);
      c.lineTo(W / 2 - t.w / 2, baseY);
      c.lineTo(W / 2 + t.w / 2, baseY);
      c.closePath();
      c.fill();
      // Subtle inner highlight on the lit (right) side
      c.fillStyle = '#13201a';
      c.beginPath();
      c.moveTo(W / 2 + 1, t.y + 2);
      c.lineTo(W / 2 + t.w / 2 - 3, baseY - 2);
      c.lineTo(W / 2 + 1, baseY - 4);
      c.closePath();
      c.fill();
      // Speckle texture along the silhouette edges
      for (let s = 0; s < 14; s++) {
        const u = r();
        const v = r() * 0.85;
        const sx = (W / 2) + (u - 0.5) * (t.w * (1 - v));
        const sy = t.y + v * 28;
        c.fillStyle = `rgba(0,0,0,${(0.30 + r() * 0.30).toFixed(3)})`;
        c.fillRect(Math.floor(sx), Math.floor(sy), 1, 1);
      }
    }
    return cv;
  }

  // Denser pine — fuller tiers with overlap; reads as a healthier tree.
  function buildPineFull() {
    const W = 56, H = 96;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const r = rng(2002);
    c.fillStyle = '#1a0d06';
    c.fillRect(W / 2 - 3, H - 18, 6, 18);
    c.fillStyle = '#3a2010';
    c.fillRect(W / 2 - 3, H - 18, 2, 18);
    const tiers = [
      { y: 2,  w: 22 },
      { y: 18, w: 32 },
      { y: 38, w: 44 },
      { y: 58, w: 52 }
    ];
    for (const t of tiers) {
      const baseY = t.y + 26;
      c.fillStyle = '#0c1a0c';
      c.beginPath();
      c.moveTo(W / 2, t.y);
      c.lineTo(W / 2 - t.w / 2, baseY);
      c.lineTo(W / 2 + t.w / 2, baseY);
      c.closePath();
      c.fill();
      // Lighter side
      c.fillStyle = '#16261a';
      c.beginPath();
      c.moveTo(W / 2 + 1, t.y + 2);
      c.lineTo(W / 2 + t.w / 2 - 4, baseY - 2);
      c.lineTo(W / 2 + 1, baseY - 5);
      c.closePath();
      c.fill();
      for (let s = 0; s < 18; s++) {
        const u = r();
        const v = r();
        const sx = (W / 2) + (u - 0.5) * (t.w * (1 - v));
        const sy = t.y + v * 26;
        c.fillStyle = `rgba(0,0,0,${(0.20 + r() * 0.30).toFixed(3)})`;
        c.fillRect(Math.floor(sx), Math.floor(sy), 1, 1);
      }
    }
    return cv;
  }

  // Broadleaf — rounded mushroom-cloud crown over a thicker trunk.
  // Provides shape variety against the pointed pines.
  function buildBroadleaf() {
    const W = 56, H = 88;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const r = rng(3003);
    c.fillStyle = '#1f110a';
    c.fillRect(W / 2 - 4, H - 36, 8, 36);
    c.fillStyle = '#42220e';
    c.fillRect(W / 2 - 4, H - 36, 2, 36);
    // 4 round blobs forming a crown
    const blobs = [
      { x: W / 2,     y: 16, r: 18 },
      { x: W / 2 - 14, y: 22, r: 14 },
      { x: W / 2 + 14, y: 22, r: 14 },
      { x: W / 2,     y: 28, r: 16 }
    ];
    for (const b of blobs) {
      c.fillStyle = '#0c1a10';
      c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.fill();
    }
    // Highlights on lit side
    for (const b of blobs) {
      c.fillStyle = '#162a18';
      c.beginPath(); c.arc(b.x + b.r * 0.3, b.y - b.r * 0.3, b.r * 0.55, 0, Math.PI * 2); c.fill();
    }
    // Edge speckle
    for (let i = 0; i < 60; i++) {
      const ang = r() * Math.PI * 2;
      const rad = 8 + r() * 18;
      const x = W / 2 + Math.cos(ang) * rad;
      const y = 22 + Math.sin(ang) * rad * 0.7;
      c.fillStyle = `rgba(0,0,0,${(0.20 + r() * 0.30).toFixed(3)})`;
      c.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
    return cv;
  }

  // Decide which tiles get a tree. Skips perimeter walls, spawn gates,
  // the player spawn pocket, and any tile too close to the player start
  // so the opening view isn't a wall of trunks pressed against the
  // crosshair. Density was tuned to feel 'surrounded' without spamming
  // hundreds of sprites — the raycaster sorts every sprite each frame
  // so a tighter forest gets expensive fast.
  function placeTrees() {
    if (typeof GameMap === 'undefined') return;
    trees.length = 0;
    const r = rng(424242);
    const start = GameMap.PLAYER_START || { x: 5.5, y: 20.5 };
    // Iterate every empty floor tile. We tile-by-tile decide whether
    // to drop a tree at a jittered position inside the cell.
    for (let y = 1; y < GameMap.H - 1; y++) {
      for (let x = 1; x < GameMap.W - 1; x++) {
        const t = GameMap.getTile(x, y);
        if (t !== 0) continue;
        const wx = x + 0.5;
        const wy = y + 0.5;
        // Clear pocket around player spawn (radius ~3 tiles)
        const dxs = wx - start.x, dys = wy - start.y;
        if (dxs * dxs + dys * dys < 9) continue;
        // Avoid landing on spawn gates (tile 9). placeTrees scans floor
        // (tile 0) so this is only here in case future maps mix the two.
        // Density: 45% of eligible tiles get a tree. Keeps it dense but
        // not totally walled-in.
        if (r() > 0.45) continue;
        const jx = (r() - 0.5) * 0.7;
        const jy = (r() - 0.5) * 0.7;
        trees.push({
          x: wx + jx,
          y: wy + jy,
          variant: Math.floor(r() * 3),
          scale: 0.85 + r() * 0.45
        });
      }
    }
  }

  function init() {
    treeCanvases.length = 0;
    treeCanvases.push(buildPineTall());
    treeCanvases.push(buildPineFull());
    treeCanvases.push(buildBroadleaf());
    placeTrees();
  }
  function update() {}

  function getTrees() { return trees; }
  function getTreeCanvas(variant) { return treeCanvases[variant] || treeCanvases[0]; }

  return { init, update, themeForWave, getTrees, getTreeCanvas };
})();
