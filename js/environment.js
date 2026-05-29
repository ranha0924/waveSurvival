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
      floorNear: '#15110c',
      floorFar:  '#040303',
      ambient: 0.55,
      fogDist: 18,
      haze: '30,45,75',
      concreteTint: '74,62,52'
    },
    // Waves 6–10 — 더 깊은 밤. Tighter fog, slightly cooler.
    dusk: {
      name: 'dusk',
      skyTop:    '#00010a',
      skyMid:    '#020614',
      skyBottom: '#060c1e',
      floorNear: '#100d0a',
      floorFar:  '#020202',
      ambient: 0.50,
      fogDist: 16,
      haze: '25,42,70',
      concreteTint: '66,56,48'
    },
    // Waves 11–15 — 삼경. Cold moonlit night, ground steeped in blue mist.
    night: {
      name: 'night',
      skyTop:    '#000004',
      skyMid:    '#010412',
      skyBottom: '#040a1a',
      floorNear: '#0c0a08',
      floorFar:  '#020202',
      ambient: 0.44,
      fogDist: 14,
      haze: '20,36,65',
      concreteTint: '58,50,42'
    },
    // Waves 16+ — 검은 굿판. Near-pitch with the faintest blood bleed at
    // the horizon — atmosphere shifts, palette stays blue-night.
    storm: {
      name: 'storm',
      skyTop:    '#000002',
      skyMid:    '#01020a',
      skyBottom: '#030516',
      floorNear: '#070605',
      floorFar:  '#010101',
      ambient: 0.38,
      fogDist: 12,
      haze: '18,28,55',
      concreteTint: '48,42,36'
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

  // ---------- Shrine prop billboards ----------
  // Free-standing ritual objects (jars, spirit poles, straw bundles, timber
  // rubble, stone cairns) are drawn as shaped billboard sprites instead of
  // square wall tiles, so they read as actual objects with a silhouette.
  // Collision still comes from the map grid (the tiles stay solid); these
  // canvases only own the shape. Each is built once with a transparent
  // background and a baked contact shadow so it grounds on the floor.
  const props = [];               // { x, y, type, scale, flip } in world coords
  const propCanvases = {};        // tile type → canvas

  function newPropCanvas(w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return cv;
  }
  function propRoundRect(c, x, y, w, h, rad) {
    rad = Math.min(rad, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rad, y);
    c.arcTo(x + w, y, x + w, y + h, rad);
    c.arcTo(x + w, y + h, x, y + h, rad);
    c.arcTo(x, y + h, x, y, rad);
    c.arcTo(x, y, x + w, y, rad);
    c.closePath();
  }

  // 장독 — round-bellied onggi jar with a domed lid, glaze sheen, finger-drawn
  // shoulder lines, two ear handles and kiln speckle.
  function buildJar() {
    const W = 56, H = 64, cv = newPropCanvas(W, H), c = cv.getContext('2d'), r = rng(8801);
    const cx = W / 2, top = 8, bot = 60, maxHW = 23, span = bot - top;
    const hw = (y) => {
      const t = (y - top) / span;
      if (t < 0 || t > 1) return 0;
      const bulge = Math.sin(t * Math.PI * 0.94 + 0.06);
      const neck = t < 0.14 ? (0.5 + (t / 0.14) * 0.5) : 1;
      const base = t > 0.88 ? Math.max(0.30, 1 - ((t - 0.88) / 0.12) * 0.55) : 1;
      return bulge * maxHW * neck * base;
    };
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath(); c.ellipse(cx, bot + 1, maxHW * 0.8, 3, 0, 0, Math.PI * 2); c.fill();
    for (let y = top; y <= bot; y++) {
      const w = hw(y);
      if (w < 1) continue;
      for (let dx = -w; dx <= w; dx++) {
        const u = (dx + w) / (2 * w);
        const hl = Math.max(0, 1 - Math.abs(u - 0.33) * 3.0);
        const R = 44 + Math.floor(hl * 86), G = 24 + Math.floor(hl * 52), B = 12 + Math.floor(hl * 28);
        c.fillStyle = `rgb(${R},${G},${B})`;
        c.fillRect(Math.round(cx + dx), y, 1, 1);
      }
    }
    for (let y = top + 3; y < bot - 3; y++) {
      const w = hw(y);
      if (w < 4) continue;
      const xh = cx - w + 2 * w * 0.30;
      c.fillStyle = 'rgba(255,228,185,0.20)'; c.fillRect(Math.round(xh), y, 1, 1);
      c.fillStyle = 'rgba(255,228,185,0.10)'; c.fillRect(Math.round(xh) + 1, y, 1, 1);
    }
    c.strokeStyle = 'rgba(20,10,5,0.4)'; c.lineWidth = 1;
    for (let k = 0; k < 2; k++) {
      const yy = top + span * (0.30 + k * 0.10);
      c.beginPath();
      let started = false;
      for (let dx = -maxHW; dx <= maxHW; dx += 2) {
        if (Math.abs(dx) > hw(yy)) { started = false; continue; }
        const yyy = yy + Math.sin(dx * 0.5 + k) * 1.6;
        if (!started) { c.moveTo(cx + dx, yyy); started = true; } else c.lineTo(cx + dx, yyy);
      }
      c.stroke();
    }
    const shY = top + span * 0.32, shW = hw(shY);
    c.strokeStyle = '#2e1a0c'; c.lineWidth = 3;
    c.beginPath(); c.arc(cx - shW + 1, shY + 3, 4, Math.PI * 0.2, Math.PI * 1.1); c.stroke();
    c.beginPath(); c.arc(cx + shW - 1, shY + 3, 4, -Math.PI * 0.1, Math.PI * 0.8, true); c.stroke();
    const topHW = hw(top + span * 0.04);
    c.fillStyle = '#160c06'; c.fillRect(Math.round(cx - topHW * 0.75), top + 1, Math.round(topHW * 1.5), 3);
    c.fillStyle = '#3a2414'; c.beginPath(); c.ellipse(cx, top + 1, topHW * 0.85, 4, 0, Math.PI, 2 * Math.PI); c.fill();
    c.fillStyle = 'rgba(255,210,160,0.22)'; c.beginPath(); c.ellipse(cx, top, topHW * 0.5, 2, 0, Math.PI, 2 * Math.PI); c.fill();
    for (let i = 0; i < 50; i++) {
      const y = top + Math.floor(r() * span), w = hw(y);
      if (w < 2) continue;
      const x = cx - w + Math.floor(r() * 2 * w);
      c.fillStyle = `rgba(0,0,0,${(0.10 + r() * 0.20).toFixed(3)})`;
      c.fillRect(Math.round(x), y, 1, 1);
    }
    return cv;
  }

  // 솟대 — weathered spirit pole with grain + knots, five 오방색 cloth strips
  // near the top, a small base cairn, and a carved wooden duck crowning it.
  function buildSotdae() {
    const W = 40, H = 128, cv = newPropCanvas(W, H), c = cv.getContext('2d'), r = rng(7701);
    const cx = W / 2;
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath(); c.ellipse(cx, 124, 12, 3, 0, 0, Math.PI * 2); c.fill();
    for (let i = 0; i < 4; i++) {
      const sx = cx - 9 + i * 6 + Math.floor(r() * 3), g = 48 + Math.floor(r() * 24);
      c.fillStyle = `rgb(${g},${g},${g + 3})`;
      c.beginPath(); c.arc(sx, 121 + Math.floor(r() * 4), 4 + r() * 2, 0, Math.PI * 2); c.fill();
    }
    const poleW = 7;
    const grd = c.createLinearGradient(cx - poleW / 2, 0, cx + poleW / 2, 0);
    grd.addColorStop(0, '#150b04'); grd.addColorStop(0.5, '#4e2e14'); grd.addColorStop(1, '#150b04');
    c.fillStyle = grd; c.fillRect(cx - poleW / 2, 20, poleW, 100);
    for (let i = 0; i < 16; i++) {
      c.fillStyle = `rgba(0,0,0,${(0.15 + r() * 0.20).toFixed(3)})`;
      c.fillRect(cx - poleW / 2 + Math.floor(r() * poleW), 20, 1, 100);
    }
    for (let i = 0; i < 5; i++) {
      const y = 34 + i * 16 + Math.floor(r() * 5);
      c.fillStyle = '#0a0604';
      c.beginPath(); c.ellipse(cx - 2 + Math.floor(r() * 4), y, 2, 1.4, 0, 0, Math.PI * 2); c.fill();
    }
    const colors = ['#b32018', '#1f6fae', '#e8d24a', '#dcd4c0', '#2f7a44'];
    for (let i = 0; i < colors.length; i++) {
      const yy = 26 + i * 4;
      c.fillStyle = colors[i];
      c.fillRect(cx - poleW / 2 - 1, yy, poleW + 2, 2);
      const dir = i % 2 === 0 ? 1 : -1;
      c.fillRect(cx + dir * (poleW / 2), yy, dir * (5 + Math.floor(r() * 6)), 2);
    }
    // Carved duck on top, facing right.
    c.fillStyle = '#171008';
    c.beginPath(); c.ellipse(cx - 2, 12, 9, 4, 0, 0, Math.PI * 2); c.fill();        // body
    c.beginPath(); c.moveTo(cx - 10, 12); c.lineTo(cx - 16, 8); c.lineTo(cx - 9, 14); c.closePath(); c.fill(); // tail
    c.fillRect(cx + 4, 8, 4, 5);                                                    // neck
    c.beginPath(); c.ellipse(cx + 7, 8, 3, 3.5, 0, 0, Math.PI * 2); c.fill();       // head
    c.fillRect(cx + 9, 7, 6, 2);                                                    // beak
    c.fillStyle = 'rgba(120,80,40,0.5)';
    c.beginPath(); c.ellipse(cx - 3, 10.5, 5, 2, 0, 0, Math.PI * 2); c.fill();      // highlight
    c.fillStyle = '#8a1414'; c.fillRect(cx + 7, 7, 1, 1);                           // eye
    return cv;
  }

  // 짚단 — a cluster of bound rice-straw sheaves: golden gradient, fibre
  // streaks, a twine band and frayed straw tops poking up.
  function buildStraw() {
    const W = 64, H = 44, cv = newPropCanvas(W, H), c = cv.getContext('2d'), r = rng(5501);
    c.fillStyle = 'rgba(0,0,0,0.30)';
    c.beginPath(); c.ellipse(W / 2, H - 3, 26, 3, 0, 0, Math.PI * 2); c.fill();
    const bundles = [{ x: 18, w: 24, h: 34 }, { x: 44, w: 22, h: 30 }, { x: 31, w: 20, h: 38 }];
    for (const bi of [1, 0, 2]) {
      const b = bundles[bi], bx = b.x - b.w / 2, by = H - b.h - 2;
      const grd = c.createLinearGradient(0, by, 0, by + b.h);
      grd.addColorStop(0, '#f0cf6a'); grd.addColorStop(0.5, '#c39a3a');
      grd.addColorStop(0.85, '#7e5e22'); grd.addColorStop(1, '#3c2a10');
      c.fillStyle = grd; propRoundRect(c, bx, by, b.w, b.h, b.w / 2.2); c.fill();
      c.save();
      propRoundRect(c, bx, by, b.w, b.h, b.w / 2.2); c.clip();
      const sg = c.createLinearGradient(bx, 0, bx + b.w, 0);
      sg.addColorStop(0, 'rgba(0,0,0,0.30)'); sg.addColorStop(0.25, 'rgba(0,0,0,0)');
      sg.addColorStop(0.75, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,0.30)');
      c.fillStyle = sg; c.fillRect(bx, by, b.w, b.h);
      for (let g = 0; g < b.w; g++) {
        if (r() < 0.5) { c.fillStyle = `rgba(0,0,0,${(0.05 + r() * 0.12).toFixed(3)})`; c.fillRect(bx + g, by, 1, b.h); }
      }
      for (let g = 0; g < 8; g++) {
        c.fillStyle = `rgba(255,235,160,${(0.20 + r() * 0.30).toFixed(3)})`;
        c.fillRect(bx + 2 + Math.floor(r() * (b.w - 4)), by, 1, b.h);
      }
      c.restore();
      c.fillStyle = 'rgba(55,35,12,0.9)'; c.fillRect(bx + 1, by + b.h * 0.55, b.w - 2, 2);
      c.fillStyle = 'rgba(255,230,150,0.25)'; c.fillRect(bx + 1, by + b.h * 0.55, b.w - 2, 1);
      for (let s = 0; s < 7; s++) {
        const sx = bx + 2 + Math.floor(r() * (b.w - 4));
        c.strokeStyle = `rgba(230,200,120,${(0.40 + r() * 0.30).toFixed(3)})`; c.lineWidth = 1;
        c.beginPath(); c.moveTo(sx, by + 2); c.lineTo(sx + (r() - 0.5) * 6, by - 3 - Math.floor(r() * 4)); c.stroke();
      }
    }
    return cv;
  }

  // 폐 한옥 자재 — a low pile of broken, crisscrossed timber beams with
  // splintered ends, grey roof-tile shards and rusty nails.
  function buildRubble() {
    const W = 72, H = 40, cv = newPropCanvas(W, H), c = cv.getContext('2d'), r = rng(6601);
    c.fillStyle = 'rgba(0,0,0,0.30)';
    c.beginPath(); c.ellipse(W / 2, H - 3, 30, 3, 0, 0, Math.PI * 2); c.fill();
    const beams = [
      { x: 8, y: 26, len: 50, ang: -0.16, th: 8 },
      { x: 14, y: 32, len: 46, ang: 0.12, th: 7 },
      { x: 26, y: 20, len: 34, ang: -0.5, th: 6 },
      { x: 30, y: 30, len: 42, ang: 0.05, th: 7 }
    ];
    for (const b of beams) {
      c.save(); c.translate(b.x, b.y); c.rotate(b.ang);
      const g = c.createLinearGradient(0, -b.th / 2, 0, b.th / 2);
      g.addColorStop(0, '#5a3318'); g.addColorStop(0.5, '#3a2010'); g.addColorStop(1, '#1c0e06');
      c.fillStyle = g; c.fillRect(0, -b.th / 2, b.len, b.th);
      c.fillStyle = 'rgba(0,0,0,0.35)';
      for (let i = 0; i < 4; i++) c.fillRect(0, -b.th / 2 + i * 2, b.len, 1);
      c.fillStyle = 'rgba(90,55,25,0.8)';
      for (let s = 0; s < 3; s++) c.fillRect(b.len - 2, -b.th / 2 + Math.floor(r() * b.th), 2, 1);
      c.restore();
    }
    for (let i = 0; i < 6; i++) {
      const x = 10 + Math.floor(r() * 52), y = 16 + Math.floor(r() * 20);
      c.fillStyle = '#34343a'; c.beginPath(); c.arc(x, y, 3 + r() * 2, Math.PI, 2 * Math.PI); c.fill();
      c.fillStyle = 'rgba(220,224,230,0.18)'; c.beginPath(); c.arc(x, y - 1, 2, Math.PI, 2 * Math.PI); c.fill();
    }
    for (let i = 0; i < 8; i++) {
      const x = 8 + Math.floor(r() * 56), y = 18 + Math.floor(r() * 18);
      c.fillStyle = 'rgba(120,55,20,0.4)'; c.fillRect(x - 1, y - 1, 4, 4);
      c.fillStyle = '#0a0604'; c.fillRect(x, y, 2, 2);
    }
    return cv;
  }

  // 돌무더기 — a cairn of stacked rounded field stones with moss patches,
  // rim-light and contact shadows.
  function buildStoneCairn() {
    const W = 60, H = 52, cv = newPropCanvas(W, H), c = cv.getContext('2d'), r = rng(3301);
    c.fillStyle = 'rgba(0,0,0,0.30)';
    c.beginPath(); c.ellipse(W / 2, H - 3, 24, 3, 0, 0, Math.PI * 2); c.fill();
    const stones = [
      { x: 16, y: 40, r: 11 }, { x: 34, y: 42, r: 12 }, { x: 46, y: 40, r: 9 },
      { x: 25, y: 30, r: 11 }, { x: 40, y: 30, r: 10 },
      { x: 32, y: 20, r: 10 }
    ];
    for (const s of stones) {
      const moss = r() < 0.4, g = 58 + Math.floor(r() * 30);
      c.fillStyle = moss ? `rgb(${g - 12},${g + 10},${g - 4})` : `rgb(${g},${g - 5},${g - 10})`;
      c.beginPath(); c.ellipse(s.x, s.y, s.r, s.r * 0.82, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = moss ? 'rgba(150,185,120,0.35)' : 'rgba(255,255,255,0.15)';
      c.beginPath(); c.ellipse(s.x - s.r * 0.3, s.y - s.r * 0.4, s.r * 0.5, s.r * 0.3, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.30)';
      c.beginPath(); c.ellipse(s.x, s.y + s.r * 0.5, s.r * 0.8, s.r * 0.25, 0, 0, Math.PI * 2); c.fill();
      for (let i = 0; i < 6; i++) {
        c.fillStyle = `rgba(0,0,0,${(0.10 + r() * 0.20).toFixed(3)})`;
        c.fillRect(s.x - s.r + Math.floor(r() * 2 * s.r), s.y - s.r * 0.5 + Math.floor(r() * s.r), 1, 1);
      }
      if (moss) {
        c.fillStyle = 'rgba(95,135,72,0.5)';
        c.beginPath(); c.arc(s.x + (r() - 0.5) * s.r, s.y - s.r * 0.5, 2, 0, Math.PI * 2); c.fill();
      }
    }
    return cv;
  }

  // Scan the map and drop one shaped prop on each shrine-object tile. A small
  // seeded jitter / scale / horizontal flip keeps rows of identical tiles
  // (a line of jars, a heap of rubble) from looking cloned.
  function placeProps() {
    props.length = 0;
    if (typeof GameMap === 'undefined') return;
    const r = rng(70707);
    for (let y = 0; y < GameMap.H; y++) {
      for (let x = 0; x < GameMap.W; x++) {
        const t = GameMap.getTile(x, y);
        if (t === 3 || t === 5 || t === 6 || t === 7 || t === 8) {
          props.push({
            x: x + 0.5 + (r() - 0.5) * 0.16,
            y: y + 0.5 + (r() - 0.5) * 0.16,
            type: t,
            scale: 0.88 + r() * 0.28,
            flip: r() < 0.5
          });
        }
      }
    }
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
    propCanvases[3] = buildStoneCairn();
    propCanvases[5] = buildStraw();
    propCanvases[6] = buildRubble();
    propCanvases[7] = buildSotdae();
    propCanvases[8] = buildJar();
    placeTrees();
    placeFlags();
    placeProps();
  }
  function update() {}

  function getTrees() { return trees; }
  function getTreeCanvas(variant) {
    return treeAssets[variant] || treeFallbackCanvases[variant] || treeFallbackCanvases[0];
  }
  function getFlags() { return flags; }
  function getFlagCanvas() { return flagCanvas; }
  function getProps() { return props; }
  function getPropCanvas(type) { return propCanvases[type] || null; }

  return {
    init, update, themeForWave,
    getTrees, getTreeCanvas,
    getFlags, getFlagCanvas,
    getProps, getPropCanvas
  };
})();
