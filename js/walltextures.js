// Per-tile-type body textures, generated procedurally at startup so each
// wall surface reads as its actual material (한옥 mud wall, woven straw
// bundles, jangdok pottery, etc.) instead of a flat color column.
//
// Each texture is a 64×64 canvas; the raycaster picks a 1-pixel-wide
// vertical slice based on the hit's U coordinate and stretches it to fit
// the column's screen height. Side darkening + fog are still applied as
// an overlay in the raycaster, so this module only owns the base look.
//
// The 굿판 rebuild maps the original 8 military materials onto their
// shamanic counterparts (same tile IDs, same gameplay walls — only the
// pixels change). The wall list is comment-aligned so swapping in/out a
// motif is a one-builder change.
const WallTextures = (() => {
  // ---------- Constants + helpers ----------
  // 128×128 base resolution — double what we had before so the painterly
  // shrine textures (hanok roof tiles, talisman calligraphy, jangdok
  // belly highlights) read with detail instead of blurring to flat
  // colour at close range. The raycaster pulls 1-px vertical slices so
  // the larger source mostly costs memory, not draw cost.
  const TEX_W = 128, TEX_H = 128;
  const cache = {};

  // Numeric tile types this module renders. Mirrors the legend at the top
  // of map.js; kept named here so buildAll's wiring reads as material →
  // builder instead of a column of magic numbers. The trailing comment is
  // the 굿판 motif each ID now represents.
  const TILE = {
    CONCRETE:  1,   // 황토 흙담
    HANGAR:    2,   // 한옥 기와벽
    STONE:     3,   // 이끼 낀 돌담
    CONTAINER: 4,   // 부적 붙은 토담
    SANDBAG:   5,   // 짚단 묶음
    VEHICLE:   6,   // 폐 한옥 자재
    COMMS:     7,   // 솟대 (sotdae)
    HAZARD:    8    // 장독대 항아리
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
  // Hwangto (yellow-earth) wall — Korean traditional mud-and-straw wall
  // at 128 px so the strata + straw + weathering can carry visible
  // detail rather than mash together into a single warm tone.
  function buildConcrete() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(1101);
    // Base — vary the underlying mud colour with a soft horizontal
    // gradient (lighter where light hits, darker in shadow).
    c.fillStyle = '#7a5a2e';
    c.fillRect(0, 0, TEX_W, TEX_H);
    const baseWash = c.createLinearGradient(0, 0, 0, TEX_H);
    baseWash.addColorStop(0,    '#9a7038');
    baseWash.addColorStop(0.45, '#7a5828');
    baseWash.addColorStop(1,    '#3a2a14');
    c.fillStyle = baseWash;
    c.globalAlpha = 0.55;
    c.fillRect(0, 0, TEX_W, TEX_H);
    c.globalAlpha = 1;
    // Rough trowel strata — 6 layer joins with paired highlight/shadow
    for (let i = 0; i < 6; i++) {
      const y = 12 + i * 19 + Math.floor((r() - 0.5) * 4);
      c.fillStyle = 'rgba(30,18,8,0.55)';
      c.fillRect(0, y, TEX_W, 2);
      c.fillStyle = 'rgba(255,220,160,0.18)';
      c.fillRect(0, y + 2, TEX_W, 1);
      // Wavy bumps where the strata meet
      for (let bx = 0; bx < TEX_W; bx += 4 + Math.floor(r() * 5)) {
        if (r() < 0.4) {
          c.fillStyle = `rgba(40,25,12,${(0.3 + r() * 0.3).toFixed(3)})`;
          c.fillRect(bx, y - 1, 2, 1);
        }
      }
    }
    // Embedded straw fibres — longer, more visible at 128
    for (let i = 0; i < 110; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = Math.floor(r() * TEX_H);
      const len = 5 + Math.floor(r() * 10);
      const tone = 180 + Math.floor(r() * 60);
      c.fillStyle = `rgba(${tone},${tone - 40},${tone - 110},${(0.40 + r() * 0.30).toFixed(3)})`;
      c.fillRect(x, y, len, 1);
      if (r() < 0.4) {
        c.fillStyle = 'rgba(0,0,0,0.45)';
        c.fillRect(x, y + 1, len, 1);
      }
    }
    // Mud aggregate — coarse darker grain
    for (let i = 0; i < 900; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = Math.floor(r() * TEX_H);
      c.fillStyle = `rgba(30,15,5,${(0.10 + r() * 0.25).toFixed(3)})`;
      c.fillRect(x, y, 1, 1);
    }
    // Brighter ochre flecks
    for (let i = 0; i < 220; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = Math.floor(r() * TEX_H);
      c.fillStyle = `rgba(255,210,140,${(0.06 + r() * 0.10).toFixed(3)})`;
      c.fillRect(x, y, 1, 1);
    }
    // Chunky pebble inclusions
    for (let i = 0; i < 18; i++) {
      const x = r() * TEX_W, y = r() * TEX_H;
      const shade = 80 + Math.floor(r() * 50);
      c.fillStyle = `rgb(${shade},${shade - 12},${shade - 28})`;
      c.beginPath();
      c.arc(x, y, 1.5 + r() * 1.8, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.18)';
      c.fillRect(Math.floor(x - 1), Math.floor(y - 1), 1, 1);
    }
    // Weathering cracks — branched and contrast-stronger
    c.strokeStyle = 'rgba(20,8,3,0.70)';
    c.lineWidth = 1.2;
    for (let i = 0; i < 9; i++) {
      let cx = r() * TEX_W, cy = r() * TEX_H;
      c.beginPath();
      c.moveTo(cx, cy);
      for (let j = 0; j < 7; j++) {
        cx += (r() - 0.5) * 22;
        cy += (r() - 0.5) * 22;
        c.lineTo(cx, cy);
      }
      c.stroke();
    }
    // Top moonlight rim — thin highlight along the top edge so the
    // wall has a clear top in dark scenes
    c.fillStyle = 'rgba(180,200,220,0.18)';
    c.fillRect(0, 0, TEX_W, 2);
    return cv;
  }

  // Hanok wall — 128×128 elevation of a traditional Korean building:
  // plastered wall on top, dark wooden eave header, three rows of
  // semi-cylindrical ceramic roof tiles below, with paint-style
  // shading + speckle so the surface doesn't look flat.
  function buildHangar() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(2202);
    // ---- Upper third: lime-plaster wall ----
    const plasterH = 46;
    const plasterGrd = c.createLinearGradient(0, 0, 0, plasterH);
    plasterGrd.addColorStop(0,    '#dcd0b6');
    plasterGrd.addColorStop(0.55, '#b8a888');
    plasterGrd.addColorStop(1,    '#7e6b4c');
    c.fillStyle = plasterGrd;
    c.fillRect(0, 0, TEX_W, plasterH);
    // Plaster grain
    for (let i = 0; i < 520; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = Math.floor(r() * plasterH);
      c.fillStyle = `rgba(60,40,20,${(0.05 + r() * 0.12).toFixed(3)})`;
      c.fillRect(x, y, 1, 1);
    }
    // Vertical wood lattice on the plaster (한옥 격자 hint) — three
    // dark thin posts breaking the white surface
    for (let i = 0; i < 3; i++) {
      const px = 22 + i * 40;
      c.fillStyle = 'rgba(30,18,8,0.45)';
      c.fillRect(px, 4, 3, plasterH - 8);
      c.fillStyle = 'rgba(0,0,0,0.30)';
      c.fillRect(px + 3, 4, 1, plasterH - 8);
    }
    // Horizontal cross-beam mid-plaster
    c.fillStyle = 'rgba(30,18,8,0.40)';
    c.fillRect(0, plasterH * 0.55, TEX_W, 2);
    // ---- Wooden eave / header band ----
    const eaveY = plasterH;
    c.fillStyle = '#1a0c06';
    c.fillRect(0, eaveY, TEX_W, 8);
    // Lighter underside of the beam (sunlit edge)
    c.fillStyle = '#4a2c14';
    c.fillRect(0, eaveY + 1, TEX_W, 2);
    // Decorative dentils — small alternating darker/lighter squares
    for (let bx = 4; bx < TEX_W; bx += 12) {
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.fillRect(bx, eaveY + 3, 6, 4);
      c.fillStyle = 'rgba(120,80,40,0.4)';
      c.fillRect(bx + 1, eaveY + 4, 4, 1);
    }
    // ---- Ceramic roof tiles — 3 rows of semi-cylinders ----
    const tilesStart = eaveY + 8;
    const rows = 3;
    const tileH = (TEX_H - tilesStart) / rows;
    for (let row = 0; row < rows; row++) {
      const y0 = tilesStart + row * tileH;
      const tileW = 14;
      const offset = (row % 2) * (tileW / 2);
      for (let col = -1; col <= TEX_W / tileW + 1; col++) {
        const bx = col * tileW + offset;
        // Cylindrical shading via sine
        for (let x = 0; x < tileW; x++) {
          const t = Math.sin((x / tileW) * Math.PI);
          const shade = 30 + Math.floor(t * 56);
          c.fillStyle = `rgb(${shade},${shade + 2},${shade + 8})`;
          c.fillRect(bx + x, y0, 1, tileH - 1);
        }
        // Highlight rim along top of each tile
        c.fillStyle = 'rgba(180,200,220,0.30)';
        c.fillRect(bx + tileW * 0.30, y0, tileW * 0.45, 1);
        // Deep dark groove between tiles
        c.fillStyle = 'rgba(0,0,0,0.75)';
        c.fillRect(bx, y0, 2, tileH);
        // Drip stain
        if (r() < 0.35) {
          c.fillStyle = `rgba(20,30,40,${(0.20 + r() * 0.30).toFixed(3)})`;
          c.fillRect(bx + 4 + Math.floor(r() * 6), y0 + 2, 1, tileH - 4);
        }
      }
      // Heavy shadow under each row
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.fillRect(0, y0 + tileH - 2, TEX_W, 2);
    }
    // Mossy patches creeping along the lowest tile row
    for (let i = 0; i < 30; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = TEX_H - Math.floor(r() * 20);
      c.fillStyle = `rgba(60,90,50,${(0.30 + r() * 0.30).toFixed(3)})`;
      c.fillRect(x, y, 1 + Math.floor(r() * 2), 1);
    }
    // Top moonlight rim across the very top of the wall
    c.fillStyle = 'rgba(180,200,220,0.25)';
    c.fillRect(0, 0, TEX_W, 1);
    return cv;
  }

  // Mossy mountain stones — irregular fieldstones bound by dark mortar
  // with mossy joints. 128×128 lets each stone carry shape variation +
  // a separate highlight + crack instead of flat blocks.
  function buildStone() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(3303);
    // Dark mortar base
    c.fillStyle = '#15140f';
    c.fillRect(0, 0, TEX_W, TEX_H);
    // Stones laid in 5 rough rows with brick offset, each stone slightly
    // wobbled in size + position so the grid doesn't read as machined.
    const rows = 5;
    const baseRowH = TEX_H / rows;
    for (let row = 0; row < rows; row++) {
      const y = row * baseRowH;
      const offset = Math.floor(r() * 22);
      let x = -10;
      while (x < TEX_W) {
        const sw = 14 + Math.floor(r() * 14);
        const sh = baseRowH - 2 + Math.floor((r() - 0.5) * 4);
        const bx = x + offset;
        const moss = r() < 0.30;
        const grey = 65 + Math.floor(r() * 45);
        // Body — slightly rounded with corners cut
        c.fillStyle = moss
          ? `rgb(${grey - 18},${grey + 10},${grey - 8})`
          : `rgb(${grey},${grey - 6},${grey - 12})`;
        c.beginPath();
        c.moveTo(bx + 2, y + 1);
        c.lineTo(bx + sw - 2, y + 1);
        c.lineTo(bx + sw, y + 3);
        c.lineTo(bx + sw, y + sh - 3);
        c.lineTo(bx + sw - 2, y + sh - 1);
        c.lineTo(bx + 2, y + sh - 1);
        c.lineTo(bx, y + sh - 3);
        c.lineTo(bx, y + 3);
        c.closePath();
        c.fill();
        // Top moonlight highlight
        c.fillStyle = moss ? 'rgba(140,180,120,0.35)' : 'rgba(200,210,220,0.18)';
        c.fillRect(bx + 2, y + 1, sw - 4, 1);
        // Bottom shadow
        c.fillStyle = 'rgba(0,0,0,0.45)';
        c.fillRect(bx + 2, y + sh - 2, sw - 4, 1);
        // Per-stone surface speckle
        for (let i = 0; i < 18; i++) {
          const sx = bx + 2 + Math.floor(r() * (sw - 4));
          const sy = y + 2 + Math.floor(r() * (sh - 4));
          c.fillStyle = `rgba(0,0,0,${(0.18 + r() * 0.20).toFixed(3)})`;
          c.fillRect(sx, sy, 1, 1);
        }
        // Subtle crack through some stones
        if (r() < 0.30) {
          c.strokeStyle = 'rgba(0,0,0,0.65)';
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(bx + 2 + r() * (sw - 4), y + 2);
          c.lineTo(bx + 2 + r() * (sw - 4), y + sh - 2);
          c.stroke();
        }
        x += sw + 1;
      }
    }
    // Moss tufts overlapping the mortar joints
    for (let i = 0; i < 28; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = Math.floor(r() * TEX_H);
      c.fillStyle = `rgba(90,140,70,${(0.40 + r() * 0.30).toFixed(3)})`;
      c.beginPath();
      c.arc(x, y, 1 + r() * 2.5, 0, Math.PI * 2);
      c.fill();
      // Darker centre
      c.fillStyle = `rgba(40,70,30,${(0.40 + r() * 0.30).toFixed(3)})`;
      c.fillRect(x, y, 1, 1);
    }
    // Top moonlight rim
    c.fillStyle = 'rgba(180,200,220,0.18)';
    c.fillRect(0, 0, TEX_W, 1);
    return cv;
  }

  // Talisman-papered mud wall — same hwangto base as CONCRETE but with
  // several yellow 부적 papers glued at irregular positions, each one
  // carrying a red calligraphy mark. 128 px gives enough room for the
  // talismans to actually look like papers + script instead of yellow
  // rectangles.
  function buildContainer() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(4404);
    // Mud base — slightly darker than CONCRETE so the yellow talismans pop
    c.fillStyle = '#5e4628';
    c.fillRect(0, 0, TEX_W, TEX_H);
    const wash = c.createLinearGradient(0, 0, 0, TEX_H);
    wash.addColorStop(0,    'rgba(140,100,55,0.4)');
    wash.addColorStop(0.5,  'rgba(0,0,0,0)');
    wash.addColorStop(1,    'rgba(0,0,0,0.45)');
    c.fillStyle = wash;
    c.fillRect(0, 0, TEX_W, TEX_H);
    // Mud grain
    for (let i = 0; i < 700; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = Math.floor(r() * TEX_H);
      c.fillStyle = `rgba(20,12,5,${(0.10 + r() * 0.22).toFixed(3)})`;
      c.fillRect(x, y, 1, 1);
    }
    // Straw fibres
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = Math.floor(r() * TEX_H);
      const len = 4 + Math.floor(r() * 6);
      c.fillStyle = `rgba(210,170,80,${(0.35 + r() * 0.25).toFixed(3)})`;
      c.fillRect(x, y, len, 1);
    }
    // Talisman papers — 5 at 128 px so the wall feels actively warded.
    // Each one slightly tilted via 4-corner outline + body fill.
    const tals = [
      { x: 12,  y:  8,  w: 22, h: 38, tilt: -0.06 },
      { x: 70,  y: 16,  w: 22, h: 40, tilt:  0.05 },
      { x: 38,  y: 62,  w: 24, h: 42, tilt: -0.04 },
      { x: 92,  y: 64,  w: 22, h: 40, tilt:  0.07 },
      { x: 10,  y: 78,  w: 20, h: 36, tilt:  0.03 }
    ];
    for (const t of tals) {
      // Paper body
      c.save();
      const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
      c.translate(cx, cy);
      c.rotate(t.tilt);
      c.translate(-cx, -cy);
      // Drop shadow
      c.fillStyle = 'rgba(0,0,0,0.50)';
      c.fillRect(t.x + 2, t.y + 2, t.w, t.h);
      // Paper body — warm yellow with slight gradient
      const paperGrd = c.createLinearGradient(t.x, t.y, t.x, t.y + t.h);
      paperGrd.addColorStop(0,    '#f0c860');
      paperGrd.addColorStop(0.5,  '#d8a838');
      paperGrd.addColorStop(1,    '#a07820');
      c.fillStyle = paperGrd;
      c.fillRect(t.x, t.y, t.w, t.h);
      // Paper top edge highlight
      c.fillStyle = 'rgba(255,240,180,0.75)';
      c.fillRect(t.x, t.y, t.w, 1);
      c.fillStyle = 'rgba(0,0,0,0.30)';
      c.fillRect(t.x, t.y + t.h - 1, t.w, 1);
      c.fillRect(t.x, t.y, 1, t.h);
      // Red calligraphy — vertical column of strokes resembling Hanja.
      // We draw 2–3 character-shaped clusters.
      const ccx = t.x + t.w / 2;
      const ccol = '#8a1010';
      const charH = Math.floor((t.h - 6) / 3);
      for (let ch = 0; ch < 3; ch++) {
        const top = t.y + 3 + ch * charH;
        c.fillStyle = ccol;
        // Vertical main stroke
        c.fillRect(ccx - 1, top + 1, 2, charH - 2);
        // Cross stroke
        c.fillRect(ccx - 5, top + 2 + Math.floor(r() * 2), 10, 2);
        // Lower hook
        c.fillRect(ccx - 4, top + charH - 4, 8, 2);
        // Stray ink dot
        if (r() < 0.5) c.fillRect(ccx + 2, top + 5 + Math.floor(r() * 4), 1, 1);
      }
      // Paper crinkle lines
      for (let k = 0; k < 4; k++) {
        const ky = t.y + 6 + Math.floor(r() * (t.h - 12));
        c.fillStyle = 'rgba(0,0,0,0.18)';
        c.fillRect(t.x + 2, ky, t.w - 4, 1);
      }
      // Frayed edge tatters at the bottom
      for (let f = 0; f < 4; f++) {
        const fx = t.x + 2 + Math.floor(r() * (t.w - 4));
        const fh = 2 + Math.floor(r() * 4);
        c.fillStyle = 'rgba(0,0,0,0.4)';
        c.fillRect(fx, t.y + t.h, 1, fh);
        c.fillStyle = `rgba(${200 + Math.floor(r() * 40)},${140 + Math.floor(r() * 40)},${50 + Math.floor(r() * 30)},0.75)`;
        c.fillRect(fx, t.y + t.h, 1, fh - 1);
      }
      c.restore();
    }
    // Top moonlight rim
    c.fillStyle = 'rgba(180,200,220,0.18)';
    c.fillRect(0, 0, TEX_W, 2);
    return cv;
  }

  // Woven straw bundles (짚단) stacked in 4 rows. Bright golden straw
  // with darker fibre grooves, twine wraps across each bundle.
  function buildSandbag() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(5505);
    c.fillStyle = '#2a1c0a';
    c.fillRect(0, 0, TEX_W, TEX_H);
    const ROWS = 4;
    const bagH = TEX_H / ROWS;       // 16
    const bagW = 16;
    for (let row = 0; row < ROWS; row++) {
      const y = row * bagH;
      const offset = (row % 2) * (bagW / 2);
      for (let col = -1; col <= TEX_W / bagW; col++) {
        const bx = col * bagW + offset;
        // Bundle body — straw colour gradient (lit top → shadow bottom)
        const grd = c.createLinearGradient(bx, y, bx, y + bagH);
        grd.addColorStop(0,    '#e6c560');
        grd.addColorStop(0.45, '#b89438');
        grd.addColorStop(0.85, '#765820');
        grd.addColorStop(1,    '#3a2810');
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
        // Side rounding shadow
        const sideGrd = c.createLinearGradient(bx, 0, bx + bagW, 0);
        sideGrd.addColorStop(0,    'rgba(0,0,0,0.30)');
        sideGrd.addColorStop(0.18, 'rgba(0,0,0,0)');
        sideGrd.addColorStop(0.82, 'rgba(0,0,0,0)');
        sideGrd.addColorStop(1,    'rgba(0,0,0,0.30)');
        c.fillStyle = sideGrd;
        c.fillRect(bx, y, bagW, bagH);
        // Twine wrap — dark band across the middle
        c.fillStyle = 'rgba(40,25,10,0.85)';
        c.fillRect(bx + 1, y + bagH / 2 - 1, bagW - 2, 2);
        c.fillStyle = 'rgba(255,230,150,0.30)';
        c.fillRect(bx + 1, y + bagH / 2 - 1, bagW - 2, 1);
        // Vertical fibre grooves
        for (let g = 0; g < 5; g++) {
          const gx = bx + 2 + Math.floor(r() * (bagW - 4));
          c.fillStyle = `rgba(0,0,0,${(0.10 + r() * 0.15).toFixed(3)})`;
          c.fillRect(gx, y + 1, 1, bagH - 2);
        }
        // Shadow groove between rows
        c.strokeStyle = 'rgba(0,0,0,0.55)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(bx + 1, y + bagH - 0.5);
        c.lineTo(bx + bagW - 1, y + bagH - 0.5);
        c.stroke();
      }
    }
    // Stray straw wisps
    for (let i = 0; i < 16; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = Math.floor(r() * TEX_H);
      c.fillStyle = `rgba(255,220,130,${(0.40 + r() * 0.35).toFixed(3)})`;
      c.fillRect(x, y, 2 + Math.floor(r() * 3), 1);
    }
    return cv;
  }

  // Collapsed hanok timber + broken roof tiles. Dark blood-brown wooden
  // beams stacked irregularly, with grey tile shards lodged in the gaps
  // and rusty iron nails visible. Reads as a ruined building's debris.
  function buildVehicle() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(6606);
    c.fillStyle = '#2a160c';
    c.fillRect(0, 0, TEX_W, TEX_H);
    // Horizontal wooden beam planks
    let y = 0;
    while (y < TEX_H) {
      const h = 7 + Math.floor(r() * 6);
      const baseR = 60 + Math.floor(r() * 30);
      const baseG = 30 + Math.floor(r() * 18);
      const baseB = 18 + Math.floor(r() * 10);
      c.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
      c.fillRect(0, y, TEX_W, h);
      // Wood grain (darker streaks)
      for (let g = 0; g < 7; g++) {
        const gy = y + Math.floor(r() * h);
        c.fillStyle = `rgba(0,0,0,${(0.20 + r() * 0.25).toFixed(3)})`;
        c.fillRect(0, gy, TEX_W, 1);
      }
      // Plank shadow at bottom
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.fillRect(0, y + h - 1, TEX_W, 1);
      c.fillStyle = 'rgba(255,200,150,0.10)';
      c.fillRect(0, y, TEX_W, 1);
      y += h;
    }
    // Broken roof-tile shards — small dark grey curved fragments
    for (let i = 0; i < 6; i++) {
      const cx = Math.floor(r() * TEX_W);
      const cy = Math.floor(r() * TEX_H);
      c.fillStyle = '#3a3a3e';
      c.beginPath();
      c.arc(cx, cy, 2 + r() * 2, 0, Math.PI);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.18)';
      c.beginPath();
      c.arc(cx, cy - 1, 1.5 + r(), 0, Math.PI);
      c.fill();
    }
    // Rusty iron nails — small dark dots with rust halo
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(r() * TEX_W);
      const y2 = Math.floor(r() * TEX_H);
      c.fillStyle = '#0a0604';
      c.fillRect(x, y2, 2, 2);
      c.fillStyle = 'rgba(120,55,20,0.35)';
      c.fillRect(x - 1, y2 - 1, 4, 4);
    }
    return cv;
  }

  // Sotdae — Korean shamanic spirit pole. Dark weathered wood column up
  // the middle with a perched wooden duck/bird silhouette at the top
  // and a red ritual cord tied around the upper third. The whole
  // texture reads vertically since the raycaster pulls 1-px columns from
  // it.
  function buildComms() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(7707);
    // Dark sky / background (this tile usually sits against open ground)
    c.fillStyle = '#0a0808';
    c.fillRect(0, 0, TEX_W, TEX_H);
    // Wood pole down the middle
    const cx = TEX_W / 2;
    const poleW = 10;
    const grd = c.createLinearGradient(cx - poleW, 0, cx + poleW, 0);
    grd.addColorStop(0,    '#1c1208');
    grd.addColorStop(0.5,  '#4a2c14');
    grd.addColorStop(1,    '#1c1208');
    c.fillStyle = grd;
    c.fillRect(cx - poleW, 0, poleW * 2, TEX_H);
    // Wood grain — long vertical streaks
    for (let i = 0; i < 14; i++) {
      const x = cx - poleW + Math.floor(r() * (poleW * 2));
      c.fillStyle = `rgba(0,0,0,${(0.20 + r() * 0.20).toFixed(3)})`;
      c.fillRect(x, 0, 1, TEX_H);
    }
    // Knots along the pole — small dark ovals
    for (let i = 0; i < 4; i++) {
      const x = cx - 3 + Math.floor(r() * 6);
      const y = 8 + i * 14 + Math.floor(r() * 4);
      c.fillStyle = '#0a0604';
      c.beginPath();
      c.ellipse(x, y, 2, 1.5, 0, 0, Math.PI * 2);
      c.fill();
    }
    // Red ritual cord wrapped near the top — three diagonal stripes
    c.fillStyle = '#a51818';
    for (let i = 0; i < 3; i++) {
      c.fillRect(cx - poleW - 1, 14 + i * 4, poleW * 2 + 2, 2);
    }
    c.fillStyle = 'rgba(255,180,120,0.30)';
    c.fillRect(cx - poleW - 1, 14, poleW * 2 + 2, 1);
    // Carved bird silhouette perched on top — a simple duck profile
    c.fillStyle = '#1c1208';
    // Body
    c.beginPath();
    c.ellipse(cx, 6, 7, 3, 0, 0, Math.PI * 2);
    c.fill();
    // Head
    c.beginPath();
    c.arc(cx + 5, 4, 2.5, 0, Math.PI * 2);
    c.fill();
    // Beak
    c.fillRect(cx + 6, 4, 4, 1);
    // Tail flare
    c.beginPath();
    c.moveTo(cx - 6, 5);
    c.lineTo(cx - 10, 3);
    c.lineTo(cx - 6, 7);
    c.closePath();
    c.fill();
    // Eye dot
    c.fillStyle = '#a51818';
    c.fillRect(cx + 5, 4, 1, 1);
    return cv;
  }

  // Jangdok — Korean earthenware fermentation jar. Round-bellied dark
  // brown pottery shape filling the texture vertically, with a glazed
  // sheen highlight down one side and a black mouth opening at the top.
  // Reads as the side of a giant 항아리 when slice-sampled.
  function buildHazard() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(8808);
    // Dark ground behind the jar
    c.fillStyle = '#0c0806';
    c.fillRect(0, 0, TEX_W, TEX_H);
    // Jar silhouette — fat in the middle, narrows at top & base
    const cx = TEX_W / 2;
    function jarHalfWidth(y) {
      // 0 at very top/bottom, peaks in the middle
      const t = y / TEX_H;
      const bulge = Math.sin(t * Math.PI);
      const neckTaper = t < 0.10 ? (t / 0.10) * 0.7 + 0.3 : 1;
      const baseTaper = t > 0.92 ? Math.max(0, (1 - (t - 0.92) / 0.08)) * 0.85 + 0.15 : 1;
      return bulge * 30 * neckTaper * baseTaper;
    }
    // Body fill row by row so the silhouette is exact
    for (let y = 0; y < TEX_H; y++) {
      const hw = jarHalfWidth(y);
      if (hw < 1) continue;
      // Horizontal shading gradient across the jar's width: dark left,
      // light highlight just right of centre, dark right
      for (let dx = -hw; dx <= hw; dx++) {
        const u = (dx + hw) / (2 * hw); // 0..1 across body
        // Highlight at u ≈ 0.35
        const highlight = Math.max(0, 1 - Math.abs(u - 0.35) * 3.5);
        const baseR = 70 + Math.floor(highlight * 80);
        const baseG = 36 + Math.floor(highlight * 50);
        const baseB = 18 + Math.floor(highlight * 30);
        c.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
        c.fillRect(cx + dx, y, 1, 1);
      }
    }
    // Glaze sheen — a brighter narrow vertical band where the highlight peaks
    for (let y = 4; y < TEX_H - 4; y++) {
      const hw = jarHalfWidth(y);
      if (hw < 4) continue;
      const xh = cx - hw + (2 * hw) * 0.32;
      c.fillStyle = 'rgba(255,220,180,0.18)';
      c.fillRect(Math.round(xh), y, 1, 1);
      c.fillStyle = 'rgba(255,220,180,0.10)';
      c.fillRect(Math.round(xh) + 1, y, 1, 1);
    }
    // Rim — dark band at the top of the jar mouth
    c.fillStyle = '#0a0604';
    c.fillRect(cx - 8, 2, 16, 3);
    c.fillStyle = '#1a0e08';
    c.fillRect(cx - 7, 4, 14, 2);
    // Speckle the pottery body with kiln blemishes
    for (let i = 0; i < 70; i++) {
      const y = 4 + Math.floor(r() * (TEX_H - 8));
      const hw = jarHalfWidth(y);
      if (hw < 2) continue;
      const x = cx - hw + Math.floor(r() * (2 * hw));
      c.fillStyle = `rgba(0,0,0,${(0.15 + r() * 0.25).toFixed(3)})`;
      c.fillRect(x, y, 1, 1);
    }
    // Cord tied below the mouth — yellow rope wrap
    c.fillStyle = '#caa044';
    c.fillRect(cx - 9, 8, 18, 1);
    c.fillStyle = 'rgba(255,230,150,0.5)';
    c.fillRect(cx - 9, 8, 18, 1);
    c.fillStyle = '#a8801f';
    c.fillRect(cx - 9, 9, 18, 1);
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
