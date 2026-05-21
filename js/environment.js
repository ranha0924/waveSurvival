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
    // Tuned darker than a normal moonlit reference so colourful prop
    // accents (오방기, lanterns) carry the contrast.
    sunset: {
      name: 'sunset',
      skyTop:    '#01020a',
      skyMid:    '#040814',
      skyBottom: '#080f20',
      floorNear: '#120c06',
      floorFar:  '#030202',
      ambient: 0.55,
      fogDist: 18,
      haze: '30,45,75',
      concreteTint: '70,45,22'
    },
    // Waves 6–10 — 더 깊은 밤. Tighter fog, slightly cooler.
    dusk: {
      name: 'dusk',
      skyTop:    '#00010a',
      skyMid:    '#020614',
      skyBottom: '#060c1e',
      floorNear: '#0e0906',
      floorFar:  '#020201',
      ambient: 0.50,
      fogDist: 16,
      haze: '25,42,70',
      concreteTint: '62,40,20'
    },
    // Waves 11–15 — 삼경. Cold moonlit night, ground steeped in blue mist.
    night: {
      name: 'night',
      skyTop:    '#000004',
      skyMid:    '#010412',
      skyBottom: '#040a1a',
      floorNear: '#0a0604',
      floorFar:  '#010102',
      ambient: 0.44,
      fogDist: 14,
      haze: '20,36,65',
      concreteTint: '54,36,18'
    },
    // Waves 16+ — 검은 굿판. Near-pitch with the faintest blood bleed at
    // the horizon — atmosphere shifts, palette stays blue-night.
    storm: {
      name: 'storm',
      skyTop:    '#000002',
      skyMid:    '#01020a',
      skyBottom: '#030516',
      floorNear: '#070403',
      floorFar:  '#010101',
      ambient: 0.38,
      fogDist: 12,
      haze: '18,28,55',
      concreteTint: '46,28,15'
    }
  };

  function themeForWave(wave) {
    if (wave <= 5) return themes.sunset;
    if (wave <= 10) return themes.dusk;
    if (wave <= 15) return themes.night;
    return themes.storm;
  }

  // ---------- Tree assets ----------
  // Trees can be either an external WebP/PNG (preferred) loaded
  // asynchronously, or — until the file lands or if it 404s — the
  // procedural canvas built by buildPineTall / buildPineFull /
  // buildBroadleaf below acting as a fallback.
  //
  // Variant lookup goes through treeAssets[variant] which is always
  // either an HTMLImageElement (once ready) or the fallback canvas.
  // The raycaster's drawTreeSprite blits either form via ctx.drawImage
  // so the swap is invisible at the call site.
  const trees = [];           // { x, y, variant, scale } in world coords
  const treeAssets = [];      // index → Image | canvas
  const treeFallbackCanvases = []; // same index → procedural canvas
  // External tree art, in variant order. Picked so the forest's silhouette
  // mix reads as: lots of straight conifers + scattered red pines + a
  // few broadleaf + occasional creepy dead tree.
  const TREE_FILES = [
    'assets/trees/pine_tall.webp',  // 0 — straight conifer, most common
    'assets/trees/pine_red.webp',   // 1 — gnarled Korean red pine
    'assets/trees/broadleaf.webp',  // 2 — rounded oak crown
    'assets/trees/dead.webp'        // 3 — twisted dead tree with talismans
  ];
  // Weighted draw — sums to 1.0. Adjust here to rebalance the silhouette.
  const TREE_WEIGHTS = [0.40, 0.30, 0.22, 0.08];

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

  function pickVariant(rfn) {
    const v = rfn();
    let acc = 0;
    for (let i = 0; i < TREE_WEIGHTS.length; i++) {
      acc += TREE_WEIGHTS[i];
      if (v < acc) return i;
    }
    return TREE_WEIGHTS.length - 1;
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
  // the player spawn pocket, and any tile adjacent to a structure so the
  // shrine's walls / jars / poles don't visually fuse with tree trunks.
  // Density was tuned to feel 'surrounded' without spamming hundreds of
  // sprites — the raycaster sorts every sprite each frame so a tighter
  // forest gets expensive fast.
  function placeTrees() {
    if (typeof GameMap === 'undefined') return;
    trees.length = 0;
    const r = rng(424242);
    const start = GameMap.PLAYER_START || { x: 5.5, y: 20.5 };
    // Chebyshev-radius check: skip any cell that has a wall (1–8) or a
    // spawn gate (9) within the 3×3 neighborhood. Keeps trees off the
    // shrine's grounds and out of gate funnels.
    function blockedByStructure(cx, cy) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const t = GameMap.getTile(cx + dx, cy + dy);
          // Perimeter earth wall (1) is fine to brush against — trees
          // pressing into the boundary actually sells the 'edge of the
          // clearing' feel. Only the shrine furniture (2–8) and spawn
          // gates (9) get a clear 1-tile buffer.
          if (t >= 2 && t <= 9) return true;
        }
      }
      return false;
    }
    for (let y = 1; y < GameMap.H - 1; y++) {
      for (let x = 1; x < GameMap.W - 1; x++) {
        const t = GameMap.getTile(x, y);
        if (t !== 0) continue;
        const wx = x + 0.5;
        const wy = y + 0.5;
        // Clear pocket around player spawn (radius ~4 tiles) — the
        // opening view should look down the courtyard at the hall, not
        // into a thicket.
        const dxs = wx - start.x, dys = wy - start.y;
        if (dxs * dxs + dys * dys < 16) continue;
        if (blockedByStructure(x, y)) continue;
        if (r() > 0.55) continue;
        const jx = (r() - 0.5) * 0.6;
        const jy = (r() - 0.5) * 0.6;
        trees.push({
          x: wx + jx,
          y: wy + jy,
          variant: pickVariant(r),
          scale: 0.85 + r() * 0.45
        });
      }
    }
  }

  // ---------- 오방기 (5-colour shaman flag pole) ----------
  // The five 오방색 — 청 (east), 적 (south), 황 (centre), 백 (west),
  // 흑 (north) — hung as triangular pennants from a tall wooden pole.
  // Built once at init time as a single billboard sprite; placed in
  // front of the main hall so the opening view frames the shrine the
  // way the reference does.
  const flags = [];          // { x, y, scale } in world coords
  let flagCanvas = null;

  function buildFlagPole() {
    const W = 56, H = 160;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    // Pole — tall dark wooden stake
    const px = W / 2;
    c.fillStyle = '#2a160a';
    c.fillRect(px - 2, 4, 4, H - 8);
    c.fillStyle = '#4a2814';
    c.fillRect(px - 2, 4, 1, H - 8);
    // Top finial — small ball + cap
    c.fillStyle = '#5a2810';
    c.beginPath(); c.arc(px, 5, 4, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#a85020';
    c.fillRect(px - 1, 1, 2, 6);
    // Horizontal crossbar near the top to hang the pennants from
    c.fillStyle = '#1a0c06';
    c.fillRect(px - 22, 12, 44, 2);
    // 5 오방색 pennants — triangular, each tied to the crossbar by a
    // thin tie. Colours intentionally muted (alpha 0.85) so they sit in
    // the night atmosphere without blowing out.
    const colours = [
      { r: 30,  g: 90,  b: 200 },  // 청 — east, blue
      { r: 200, g: 30,  b: 40  },  // 적 — south, red
      { r: 230, g: 180, b: 50  },  // 황 — centre, yellow
      { r: 235, g: 230, b: 220 },  // 백 — west, white
      { r: 20,  g: 20,  b: 30  }   // 흑 — north, black
    ];
    const fW = 10;
    for (let i = 0; i < 5; i++) {
      const fx = px - 22 + i * 9 + 2;
      const col = colours[i];
      // Tie string
      c.fillStyle = 'rgba(60,30,15,0.8)';
      c.fillRect(fx + fW / 2 - 0.5, 14, 1, 4);
      // Pennant body — long triangle hanging down
      c.fillStyle = `rgba(${col.r},${col.g},${col.b},0.92)`;
      c.beginPath();
      c.moveTo(fx,           18);
      c.lineTo(fx + fW,      18);
      c.lineTo(fx + fW / 2,  80 + i * 6);  // staggered tip lengths
      c.closePath();
      c.fill();
      // Subtle wind-shading down the lit edge
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.beginPath();
      c.moveTo(fx + fW * 0.7, 18);
      c.lineTo(fx + fW,       18);
      c.lineTo(fx + fW / 2,   80 + i * 6);
      c.closePath();
      c.fill();
    }
    return cv;
  }

  function placeFlags() {
    flags.length = 0;
    if (typeof GameMap === 'undefined') return;
    // Two flagpoles framing the south courtyard so the opening view
    // shows them silhouetted against the hall's entrance. Coordinates
    // are world-space; the raycaster anchors the trunk base on the
    // floor at the projected distance.
    flags.push({ x: 18.5, y: 21.5, scale: 1.0 });
    flags.push({ x: 24.5, y: 21.5, scale: 1.0 });
  }

  function init() {
    treeAssets.length = 0;
    treeFallbackCanvases.length = 0;
    // Fallback canvases keep the forest looking populated immediately
    // even if the WebP assets take a moment to decode (or fail entirely).
    const fallbacks = [buildPineTall(), buildPineFull(), buildBroadleaf(), buildPineTall()];
    for (let i = 0; i < TREE_FILES.length; i++) {
      treeFallbackCanvases[i] = fallbacks[i];
      treeAssets[i] = fallbacks[i];           // start as fallback
      const img = new Image();
      img.onload = () => {
        // Once decoded, point this variant at the real image. All future
        // draws pick it up; trees already placed don't need updating
        // since they reference by variant index.
        treeAssets[i] = img;
      };
      img.onerror = () => { /* keep fallback */ };
      img.src = TREE_FILES[i];
    }
    flagCanvas = buildFlagPole();
    placeTrees();
    placeFlags();
  }
  function update() {}

  function getTrees() { return trees; }
  function getTreeCanvas(variant) {
    return treeAssets[variant] || treeFallbackCanvases[variant] || treeFallbackCanvases[0];
  }
  function getFlags() { return flags; }
  function getFlagCanvas() { return flagCanvas; }

  return {
    init, update, themeForWave,
    getTrees, getTreeCanvas,
    getFlags, getFlagCanvas
  };
})();
