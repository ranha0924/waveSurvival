// Per-tile-type body textures, generated procedurally at startup so each
// wall surface reads as its actual material (stacked sandbags, corrugated
// container ribs, brick courses, etc.) instead of a flat color column.
//
// Each texture is a 64×64 canvas; the raycaster picks a 1-pixel-wide
// vertical slice based on the hit's U coordinate and stretches it to fit
// the column's screen height. Side darkening + fog are still applied as
// an overlay in the raycaster, so this module only owns the base look.
const WallTextures = (() => {
  // ---------- Constants + helpers ----------
  const TEX_W = 64, TEX_H = 64;
  const cache = {};

  // Numeric tile types this module renders. Mirrors the legend at the top
  // of map.js; kept named here so buildAll's wiring reads as material →
  // builder instead of a column of magic numbers.
  const TILE = {
    CONCRETE:  1,
    HANGAR:    2,
    STONE:     3,
    CONTAINER: 4,
    SANDBAG:   5,
    VEHICLE:   6,
    COMMS:     7,
    HAZARD:    8
  };

  function newTex() {
    const cv = document.createElement('canvas');
    cv.width = TEX_W;
    cv.height = TEX_H;
    return cv;
  }

  // Mulberry32 — same generator the gameplay RNG uses, seeded per texture
  // so each surface's noise is stable across runs.
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

  // ---------- Texture builders (one per tile material) ----------
  // Concrete blast wall: weathered slab with horizontal pour-line joints,
  // vertical streaks, speckled grain, and a few hairline cracks.
  function buildConcrete() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(1101);
    c.fillStyle = '#6e6c68';
    c.fillRect(0, 0, TEX_W, TEX_H);
    // Vertical lighting wash so the slab reads as 3D
    const wash = c.createLinearGradient(0, 0, 0, TEX_H);
    wash.addColorStop(0, 'rgba(255,255,255,0.06)');
    wash.addColorStop(0.5, 'rgba(0,0,0,0)');
    wash.addColorStop(1, 'rgba(0,0,0,0.18)');
    c.fillStyle = wash;
    c.fillRect(0, 0, TEX_W, TEX_H);
    // Horizontal joint lines (pour seams)
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(0, 21, TEX_W, 1);
    c.fillRect(0, 43, TEX_W, 1);
    c.fillStyle = 'rgba(255,255,255,0.10)';
    c.fillRect(0, 22, TEX_W, 1);
    c.fillRect(0, 44, TEX_W, 1);
    // Highlight speckles
    for (let i = 0; i < 90; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = Math.floor(r() * TEX_H);
      c.fillStyle = `rgba(255,255,255,${(0.04 + r() * 0.06).toFixed(3)})`;
      c.fillRect(x, y, 1 + Math.floor(r() * 2), 1 + Math.floor(r() * 2));
    }
    // Dark grain
    for (let i = 0; i < 280; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = Math.floor(r() * TEX_H);
      c.fillStyle = `rgba(0,0,0,${(0.08 + r() * 0.15).toFixed(3)})`;
      c.fillRect(x, y, 1, 1);
    }
    // Hairline cracks
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      let cx = r() * TEX_W, cy = r() * TEX_H;
      c.beginPath();
      c.moveTo(cx, cy);
      for (let j = 0; j < 5; j++) {
        cx += (r() - 0.5) * 16;
        cy += (r() - 0.5) * 16;
        c.lineTo(cx, cy);
      }
      c.stroke();
    }
    // Vertical staining streaks
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(r() * TEX_W);
      c.fillStyle = `rgba(20,18,15,${(0.10 + r() * 0.12).toFixed(3)})`;
      c.fillRect(x, 0, 1, TEX_H);
    }
    return cv;
  }

  // Hangar metal: olive painted panels split by seam lines into 32×32
  // panels with rivets at each corner, plus rust patches and paint wear.
  function buildHangar() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(2202);
    c.fillStyle = '#56664a';
    c.fillRect(0, 0, TEX_W, TEX_H);
    // Vertical paint wear bands
    for (let x = 0; x < TEX_W; x++) {
      if (r() < 0.10) {
        c.fillStyle = `rgba(0,0,0,${(0.05 + r() * 0.08).toFixed(3)})`;
        c.fillRect(x, 0, 1, TEX_H);
      }
    }
    // Panel seams
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = 1;
    for (let x = 0; x <= TEX_W; x += 32) {
      c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, TEX_H); c.stroke();
    }
    for (let y = 0; y <= TEX_H; y += 32) {
      c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(TEX_W, y + 0.5); c.stroke();
    }
    // Rivets at panel corners — dark dot with a tiny highlight
    for (let y = 4; y <= TEX_H; y += 32) {
      for (let x = 4; x <= TEX_W; x += 32) {
        c.fillStyle = '#1c2210';
        c.fillRect(x, y, 2, 2);
        c.fillStyle = '#86996a';
        c.fillRect(x, y, 1, 1);
      }
    }
    // Rust patches
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = Math.floor(r() * TEX_H);
      c.fillStyle = `rgba(140,60,30,${(0.15 + r() * 0.25).toFixed(3)})`;
      c.beginPath();
      c.arc(x, y, 1 + r() * 3, 0, Math.PI * 2);
      c.fill();
    }
    return cv;
  }

  // Watchtower stone: staggered brick courses with mortar gaps, varied
  // brick shades, and a few weathering cracks.
  function buildStone() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(3303);
    c.fillStyle = '#2c2c2c'; // mortar color
    c.fillRect(0, 0, TEX_W, TEX_H);
    const bw = 16, bh = 8;
    for (let row = 0; row * bh < TEX_H; row++) {
      const y = row * bh;
      const offset = (row % 2) * (bw / 2);
      for (let x = -bw; x < TEX_W; x += bw) {
        const bx = x + offset;
        const shade = 60 + Math.floor(r() * 35);
        c.fillStyle = `rgb(${shade},${shade - 2},${shade - 5})`;
        c.fillRect(bx + 1, y + 1, bw - 1, bh - 1);
        c.fillStyle = 'rgba(255,255,255,0.06)';
        c.fillRect(bx + 1, y + 1, bw - 1, 1);
        c.fillStyle = 'rgba(0,0,0,0.20)';
        c.fillRect(bx + 1, y + bh - 1, bw - 1, 1);
      }
    }
    // Weathering cracks
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      let cx = r() * TEX_W, cy = r() * TEX_H;
      c.beginPath(); c.moveTo(cx, cy);
      for (let j = 0; j < 4; j++) {
        cx += (r() - 0.5) * 12;
        cy += (r() - 0.5) * 12;
        c.lineTo(cx, cy);
      }
      c.stroke();
    }
    return cv;
  }

  // Shipping container: strong vertical corrugated ribs (sine-wave shading
  // along U), a horizontal seam at mid-height where two halves meet, plus
  // rust drips and impact dings.
  function buildContainer() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(4404);
    c.fillStyle = '#6a3a20';
    c.fillRect(0, 0, TEX_W, TEX_H);
    // Vertical corrugation
    for (let x = 0; x < TEX_W; x++) {
      const t = (Math.sin(x * 0.55) + 1) / 2;
      if (t > 0.5) {
        c.fillStyle = `rgba(255,255,255,${((t - 0.5) * 0.40).toFixed(3)})`;
        c.fillRect(x, 0, 1, TEX_H);
      } else {
        c.fillStyle = `rgba(0,0,0,${((0.5 - t) * 0.50).toFixed(3)})`;
        c.fillRect(x, 0, 1, TEX_H);
      }
    }
    // Horizontal mid-seam (container stacked on container)
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(0, TEX_H / 2 - 1, TEX_W, 2);
    c.fillStyle = 'rgba(255,255,255,0.08)';
    c.fillRect(0, TEX_H / 2 + 1, TEX_W, 1);
    // Rust drips
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(r() * TEX_W);
      const startY = Math.floor(r() * TEX_H);
      const len = 8 + r() * 22;
      const grd = c.createLinearGradient(0, startY, 0, startY + len);
      grd.addColorStop(0, 'rgba(120,40,15,0.55)');
      grd.addColorStop(1, 'rgba(120,40,15,0)');
      c.fillStyle = grd;
      c.fillRect(x, startY, 1 + Math.floor(r() * 2), len);
    }
    // Impact dings
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = Math.floor(r() * TEX_H);
      c.fillStyle = 'rgba(15,10,6,0.55)';
      c.beginPath();
      c.arc(x, y, 1 + r() * 2, 0, Math.PI * 2);
      c.fill();
    }
    return cv;
  }

  // Sandbag wall: 4 staggered rows of rounded khaki bags with a vertical
  // shading gradient (lit top, shadow under each bag), stitching highlight,
  // and burlap grain.
  function buildSandbag() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(5505);
    c.fillStyle = '#3e2f18';
    c.fillRect(0, 0, TEX_W, TEX_H);
    const ROWS = 4;
    const bagH = TEX_H / ROWS;       // 16
    const bagW = 16;
    for (let row = 0; row < ROWS; row++) {
      const y = row * bagH;
      const offset = (row % 2) * (bagW / 2);
      for (let col = -1; col <= TEX_W / bagW; col++) {
        const bx = col * bagW + offset;
        // Shape: pill / rounded rectangle across full bag width
        const grd = c.createLinearGradient(bx, y, bx, y + bagH);
        grd.addColorStop(0,    '#c4a565');
        grd.addColorStop(0.45, '#9a7e44');
        grd.addColorStop(0.85, '#6b5028');
        grd.addColorStop(1,    '#3e2f18');
        c.fillStyle = grd;
        c.beginPath();
        c.moveTo(bx + 2, y);
        c.lineTo(bx + bagW - 2, y);
        c.quadraticCurveTo(bx + bagW, y, bx + bagW, y + 3);
        c.lineTo(bx + bagW, y + bagH - 3);
        c.quadraticCurveTo(bx + bagW, y + bagH, bx + bagW - 2, y + bagH);
        c.lineTo(bx + 2, y + bagH);
        c.quadraticCurveTo(bx, y + bagH, bx, y + bagH - 3);
        c.lineTo(bx, y + 3);
        c.quadraticCurveTo(bx, y, bx + 2, y);
        c.closePath();
        c.fill();
        // Side roundness shading: darken left+right edges
        const sideGrd = c.createLinearGradient(bx, 0, bx + bagW, 0);
        sideGrd.addColorStop(0,    'rgba(0,0,0,0.30)');
        sideGrd.addColorStop(0.18, 'rgba(0,0,0,0)');
        sideGrd.addColorStop(0.82, 'rgba(0,0,0,0)');
        sideGrd.addColorStop(1,    'rgba(0,0,0,0.30)');
        c.fillStyle = sideGrd;
        c.fillRect(bx, y, bagW, bagH);
        // Top highlight stitch
        c.strokeStyle = 'rgba(255,240,200,0.22)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(bx + 3, y + 2);
        c.lineTo(bx + bagW - 3, y + 2);
        c.stroke();
        // Shadow groove between rows
        c.strokeStyle = 'rgba(0,0,0,0.55)';
        c.beginPath();
        c.moveTo(bx + 1, y + bagH - 0.5);
        c.lineTo(bx + bagW - 1, y + bagH - 0.5);
        c.stroke();
      }
    }
    // Burlap grain noise
    for (let i = 0; i < 240; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = Math.floor(r() * TEX_H);
      c.fillStyle = `rgba(0,0,0,${(0.05 + r() * 0.10).toFixed(3)})`;
      c.fillRect(x, y, 1, 1);
    }
    return cv;
  }

  // Wrecked vehicle: olive sheet-metal panels with seams, rust patches,
  // and bullet holes ringed by chipped paint.
  function buildVehicle() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(6606);
    c.fillStyle = '#4a4a26';
    c.fillRect(0, 0, TEX_W, TEX_H);
    // Olive paint patches
    for (let i = 0; i < 14; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = Math.floor(r() * TEX_H);
      const w = 4 + r() * 12, h = 4 + r() * 12;
      c.fillStyle = `rgba(${60 + Math.floor(r() * 30)},${60 + Math.floor(r() * 30)},${30 + Math.floor(r() * 15)},0.5)`;
      c.fillRect(x, y, w, h);
    }
    // Plate seams
    c.strokeStyle = 'rgba(0,0,0,0.55)';
    c.lineWidth = 1;
    for (let y = 8; y < TEX_H; y += 18) {
      c.beginPath();
      c.moveTo(0, y + Math.floor(r() * 2));
      c.lineTo(TEX_W, y + Math.floor(r() * 2));
      c.stroke();
    }
    // Rust drips
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(r() * TEX_W);
      const startY = Math.floor(r() * TEX_H);
      const len = 6 + r() * 14;
      const grd = c.createLinearGradient(0, startY, 0, startY + len);
      grd.addColorStop(0, 'rgba(140,60,30,0.5)');
      grd.addColorStop(1, 'rgba(140,60,30,0)');
      c.fillStyle = grd;
      c.fillRect(x, startY, 1, len);
    }
    // Bullet holes
    for (let i = 0; i < 8; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = Math.floor(r() * TEX_H);
      c.fillStyle = '#0a0805';
      c.beginPath(); c.arc(x, y, 1.4, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(180,160,80,0.4)';
      c.beginPath(); c.arc(x, y, 2.4, 0, Math.PI * 2); c.stroke();
    }
    return cv;
  }

  // Comms tower / steel pillar: I-beam shading with darker central web,
  // horizontal cross-bars and bolt heads up the flange.
  function buildComms() {
    const cv = newTex();
    const c = cv.getContext('2d');
    c.fillStyle = '#1a1c20';
    c.fillRect(0, 0, TEX_W, TEX_H);
    const beamW = 14;
    const cx = TEX_W / 2;
    const grd = c.createLinearGradient(cx - beamW, 0, cx + beamW, 0);
    grd.addColorStop(0,    '#1e2026');
    grd.addColorStop(0.5,  '#52555c');
    grd.addColorStop(1,    '#1e2026');
    c.fillStyle = grd;
    c.fillRect(cx - beamW, 0, beamW * 2, TEX_H);
    c.fillStyle = '#16181c';
    c.fillRect(cx - 2, 0, 4, TEX_H);
    for (let y = 4; y < TEX_H; y += 12) {
      c.fillStyle = '#3a3d44';
      c.fillRect(cx - beamW, y, beamW * 2, 1);
    }
    for (let y = 6; y < TEX_H; y += 12) {
      c.fillStyle = '#0a0c10';
      c.fillRect(cx - beamW + 2, y, 2, 2);
      c.fillRect(cx + beamW - 4, y, 2, 2);
      c.fillStyle = '#5a5d65';
      c.fillRect(cx - beamW + 2, y, 1, 1);
      c.fillRect(cx + beamW - 4, y, 1, 1);
    }
    return cv;
  }

  // Hazard panel: yellow-and-black diagonal stripes with worn dots and
  // bottom-edge scuffs from foot traffic.
  function buildHazard() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(8808);
    c.fillStyle = '#16140a';
    c.fillRect(0, 0, TEX_W, TEX_H);
    c.save();
    c.fillStyle = '#d4b020';
    c.translate(TEX_W / 2, TEX_H / 2);
    c.rotate(Math.PI / 4);
    c.translate(-TEX_W, -TEX_H);
    for (let x = 0; x < TEX_W * 3; x += 14) {
      c.fillRect(x, 0, 8, TEX_H * 3);
    }
    c.restore();
    for (let i = 0; i < 90; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = Math.floor(r() * TEX_H);
      c.fillStyle = `rgba(0,0,0,${(0.10 + r() * 0.20).toFixed(3)})`;
      c.fillRect(x, y, 1, 1);
    }
    for (let i = 0; i < 4; i++) {
      const y = TEX_H - 2 - i * 4;
      c.fillStyle = `rgba(0,0,0,${(0.08 + r() * 0.15).toFixed(3)})`;
      c.fillRect(0, y, TEX_W, 1);
    }
    return cv;
  }

  // ---------- Public API ----------
  function buildAll() {
    cache[TILE.CONCRETE]  = buildConcrete();
    cache[TILE.HANGAR]    = buildHangar();
    cache[TILE.STONE]     = buildStone();
    cache[TILE.CONTAINER] = buildContainer();
    cache[TILE.SANDBAG]   = buildSandbag();
    cache[TILE.VEHICLE]   = buildVehicle();
    cache[TILE.COMMS]     = buildComms();
    cache[TILE.HAZARD]    = buildHazard();
  }

  function get(type) { return cache[type]; }

  return { buildAll, get };
})();
