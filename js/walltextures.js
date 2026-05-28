// Per-tile-type body textures, generated procedurally at startup so each
// wall surface reads as its actual material (한옥 mud wall, woven straw
// bundles, jangdok pottery, etc.) instead of a flat color column.
//
// Each texture is a 128×128 canvas; the raycaster picks a 1-pixel-wide
// vertical slice based on the hit's U coordinate and stretches it to fit
// the column's screen height (nearest-neighbour — imageSmoothing is off —
// so fine carving stays crisp at any range). Side darkening + fog ride on
// top as an overlay in the raycaster, so this module only owns the base
// look.
//
// The 굿판 rebuild maps the original 8 military materials onto their
// shamanic counterparts (same tile IDs, same gameplay walls — only the
// pixels change). The wall list is comment-aligned so swapping in/out a
// motif is a one-builder change.
const WallTextures = (() => {
  // ---------- Constants + helpers ----------
  const TEX_W = 128, TEX_H = 128;
  const cache = {};

  const TILE = {
    CONCRETE:  1,   // 흙담 (hwangto rammed-earth perimeter wall)
    HANGAR:    2,   // 한옥 기와벽 (tiled-roof main hall facade)
    STONE:     3,   // 이끼 낀 돌담 (mossy field-stone wall)
    CONTAINER: 4,   // 부적 토담 (talisman-papered mud wall)
    SANDBAG:   5,   // 짚단 묶음 (bound straw sheaves)
    VEHICLE:   6,   // 폐 한옥 자재 (collapsed timber + tile rubble)
    COMMS:     7,   // 솟대 (spirit pole)
    HAZARD:    8    // 장독대 항아리 (glazed onggi jar)
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

  // Rounded-rect path (canvas roundRect isn't universal on older engines).
  function roundRect(c, x, y, w, h, rad) {
    rad = Math.min(rad, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rad, y);
    c.arcTo(x + w, y, x + w, y + h, rad);
    c.arcTo(x + w, y + h, x, y + h, rad);
    c.arcTo(x, y + h, x, y, rad);
    c.arcTo(x, y, x + w, y, rad);
    c.closePath();
  }

  // A rounded course of foundation stones (죽담 / 기단) along a band.
  function footing(c, r, y0, h) {
    c.fillStyle = '#27211b';
    c.fillRect(0, y0, TEX_W, h);
    let x = -Math.floor(r() * 12);
    while (x < TEX_W) {
      const w = 15 + Math.floor(r() * 16);
      const g = 64 + Math.floor(r() * 28);
      c.fillStyle = `rgb(${g},${g - 4},${g - 10})`;
      roundRect(c, x + 1, y0 + 2, w - 2, h - 4, Math.min(6, (h - 4) / 2));
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.10)';
      roundRect(c, x + 1, y0 + 2, w - 2, 3, 2);
      c.fill();
      c.fillStyle = 'rgba(0,0,0,0.40)';
      c.fillRect(x, y0 + 2, 1, h - 4);
      x += w;
    }
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(0, y0 - 1, TEX_W, 2);
  }

  // ---------- Texture builders (one per tile material) ----------

  // 흙담 — Korea's rammed-earth / mud-and-straw perimeter wall. Warm ochre
  // body with horizontal compaction strata, embedded straw, weathering
  // cracks, a damp-darkened base and a dressed-stone footing course.
  function buildConcrete() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(1101);
    c.fillStyle = '#9a7038';
    c.fillRect(0, 0, TEX_W, TEX_H);
    // Vertical lighting wash — sun-bleached crown, damp shaded base.
    const wash = c.createLinearGradient(0, 0, 0, TEX_H);
    wash.addColorStop(0,    'rgba(255,225,165,0.12)');
    wash.addColorStop(0.45, 'rgba(0,0,0,0)');
    wash.addColorStop(0.78, 'rgba(0,0,0,0.10)');
    wash.addColorStop(1,    'rgba(0,0,0,0.34)');
    c.fillStyle = wash;
    c.fillRect(0, 0, TEX_W, TEX_H);
    // Rammed-earth strata — compaction joins every ~15px.
    for (let y = 14; y < 104; y += 15) {
      c.fillStyle = 'rgba(45,28,12,0.40)';
      c.fillRect(0, y, TEX_W, 1);
      c.fillStyle = 'rgba(255,225,160,0.10)';
      c.fillRect(0, y + 1, TEX_W, 1);
      for (let i = 0; i < 10; i++) {
        const x = Math.floor(r() * TEX_W);
        c.fillStyle = 'rgba(40,24,10,0.25)';
        c.fillRect(x, y, 2, 1);
      }
    }
    // Embedded straw fibres.
    for (let i = 0; i < 90; i++) {
      const x = Math.floor(r() * TEX_W);
      const y = Math.floor(r() * 104);
      const len = 3 + Math.floor(r() * 7);
      const horiz = r() < 0.6;
      c.fillStyle = `rgba(222,184,96,${(0.30 + r() * 0.30).toFixed(3)})`;
      c.fillRect(x, y, horiz ? len : 1, horiz ? 1 : len);
    }
    // Coarse mud grain + bright mineral specks.
    for (let i = 0; i < 900; i++) {
      c.fillStyle = `rgba(40,22,10,${(0.06 + r() * 0.18).toFixed(3)})`;
      c.fillRect(Math.floor(r() * TEX_W), Math.floor(r() * 104), 1, 1);
    }
    for (let i = 0; i < 240; i++) {
      c.fillStyle = `rgba(255,232,176,${(0.04 + r() * 0.08).toFixed(3)})`;
      c.fillRect(Math.floor(r() * TEX_W), Math.floor(r() * 104), 1, 1);
    }
    // Weathering cracks.
    c.strokeStyle = 'rgba(28,14,6,0.55)';
    c.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      let cx = r() * TEX_W, cy = r() * 100;
      c.beginPath();
      c.moveTo(cx, cy);
      for (let j = 0; j < 6; j++) {
        cx += (r() - 0.5) * 26;
        cy += (r() - 0.3) * 22;
        c.lineTo(cx, cy);
      }
      c.stroke();
    }
    footing(c, r, 104, 24);
    return cv;
  }

  // 한옥 기와벽 — the central hall facade. Top to bottom: a stacked ceramic
  // roof with 막새 eave-end discs, a 단청 painted beam, a white-plaster wall
  // framed by dark timber posts around a hanji-lit 창호 lattice window, and a
  // dressed-stone 기단 base course.
  function buildHangar() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(2202);
    // ── Roof: ceramic tiles in three rows ──
    c.fillStyle = '#23232a';
    c.fillRect(0, 0, TEX_W, 46);
    const tileH = 14, tileW = 16;
    for (let row = 0; row < 3; row++) {
      const y0 = row * tileH;
      const offset = (row % 2) * (tileW / 2);
      for (let col = -1; col <= TEX_W / tileW + 1; col++) {
        const bx = col * tileW + offset;
        for (let x = 0; x < tileW; x++) {
          const t = Math.sin((x / tileW) * Math.PI);
          const sh = 30 + Math.floor(t * 40);
          c.fillStyle = `rgb(${sh},${sh},${sh + 6})`;
          c.fillRect(bx + x, y0, 1, tileH - 1);
        }
        c.fillStyle = 'rgba(0,0,0,0.55)';
        c.fillRect(bx, y0, 1, tileH);
        c.fillStyle = 'rgba(210,214,224,0.12)';
        c.fillRect(bx + Math.floor(tileW / 2), y0, 1, 2);
      }
      c.fillStyle = 'rgba(0,0,0,0.40)';
      c.fillRect(0, y0 + tileH - 1, TEX_W, 1);
    }
    // 막새 — round eave-end tiles along the roof bottom.
    for (let x = 8; x < TEX_W; x += tileW) {
      c.fillStyle = '#3a3a42';
      c.beginPath(); c.arc(x, 46, 5, Math.PI, 2 * Math.PI); c.fill();
      c.fillStyle = '#1a1a20';
      c.beginPath(); c.arc(x, 46, 2.4, Math.PI, 2 * Math.PI); c.fill();
      c.fillStyle = 'rgba(210,214,224,0.18)';
      c.beginPath(); c.arc(x, 45, 5, Math.PI * 1.08, Math.PI * 1.5); c.fill();
    }
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(0, 46, TEX_W, 2);
    // ── 단청 painted beam ──
    c.fillStyle = '#23402f';
    c.fillRect(0, 48, TEX_W, 14);
    for (let x = 0; x < TEX_W; x += 16) {
      c.fillStyle = '#9e2f1d'; c.fillRect(x + 2, 50, 12, 4);
      c.fillStyle = '#d8cdb0'; c.fillRect(x + 4, 51, 8, 1);
      c.fillStyle = '#2b4f8a'; c.fillRect(x + 1, 56, 5, 4);
      c.fillStyle = '#c9a23a'; c.fillRect(x + 9, 56, 5, 4);
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x, 48, 1, 14);
    }
    c.fillStyle = '#140d06';
    c.fillRect(0, 61, TEX_W, 2);
    // ── Wall body: plaster + timber posts + 창호 window ──
    c.fillStyle = '#cfc4a8';
    c.fillRect(0, 63, TEX_W, 49);
    for (let i = 0; i < 260; i++) {
      c.fillStyle = `rgba(90,70,46,${(0.05 + r() * 0.10).toFixed(3)})`;
      c.fillRect(Math.floor(r() * TEX_W), 63 + Math.floor(r() * 49), 1, 1);
    }
    const post = (px) => {
      const grd = c.createLinearGradient(px, 0, px + 12, 0);
      grd.addColorStop(0, '#1e120a');
      grd.addColorStop(0.5, '#4a2c16');
      grd.addColorStop(1, '#1e120a');
      c.fillStyle = grd;
      c.fillRect(px, 63, 12, 49);
      for (let i = 0; i < 10; i++) {
        c.fillStyle = `rgba(0,0,0,${(0.15 + r() * 0.20).toFixed(3)})`;
        c.fillRect(px + Math.floor(r() * 12), 63, 1, 49);
      }
    };
    post(0);
    post(TEX_W - 12);
    // 창호 lattice window with warm hanji glow.
    const wx = 40, wy = 68, ww = 48, wh = 40;
    c.fillStyle = '#2a1a0e';
    c.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
    c.fillStyle = '#e6c47a';
    c.fillRect(wx, wy, ww, wh);
    const gg = c.createRadialGradient(wx + ww / 2, wy + wh / 2, 2, wx + ww / 2, wy + wh / 2, ww / 1.4);
    gg.addColorStop(0, 'rgba(255,228,150,0.5)');
    gg.addColorStop(1, 'rgba(180,120,40,0)');
    c.fillStyle = gg;
    c.fillRect(wx, wy, ww, wh);
    c.fillStyle = '#2a1a0e';
    for (let gx = wx; gx <= wx + ww; gx += 8) c.fillRect(gx, wy, 2, wh);
    for (let gy = wy; gy <= wy + wh; gy += 8) c.fillRect(wx, gy, ww, 2);
    // ── 기단 stone base ──
    footing(c, r, 112, 16);
    return cv;
  }

  // 이끼 낀 돌담 — chest-high wall of irregular stacked field stones bound by
  // dark mortar, with moss in the joints, lichen speckle, and rim-light on
  // each stone's upper edge.
  function buildStone() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(3303);
    c.fillStyle = '#16160f';
    c.fillRect(0, 0, TEX_W, TEX_H);
    let y = 2;
    while (y < TEX_H) {
      const rh = 14 + Math.floor(r() * 10);
      let x = -Math.floor(r() * 20);
      while (x < TEX_W) {
        const w = 18 + Math.floor(r() * 22);
        const g = 58 + Math.floor(r() * 34);
        const moss = r() < 0.30;
        c.fillStyle = moss
          ? `rgb(${g - 14},${g + 10},${g - 6})`
          : `rgb(${g},${g - 5},${g - 10})`;
        roundRect(c, x + 1, y + 1, w - 2, rh - 2, Math.min(7, rh / 2));
        c.fill();
        c.fillStyle = moss ? 'rgba(150,185,120,0.30)' : 'rgba(255,255,255,0.12)';
        roundRect(c, x + 2, y + 2, w - 4, 3, 2);
        c.fill();
        c.fillStyle = 'rgba(0,0,0,0.35)';
        c.fillRect(x + 2, y + rh - 3, w - 4, 2);
        for (let i = 0; i < 6; i++) {
          c.fillStyle = `rgba(0,0,0,${(0.10 + r() * 0.20).toFixed(3)})`;
          c.fillRect(x + 2 + Math.floor(r() * (w - 4)), y + 2 + Math.floor(r() * (rh - 4)), 1, 1);
        }
        x += w;
      }
      y += rh;
    }
    for (let i = 0; i < 26; i++) {
      c.fillStyle = `rgba(95,135,72,${(0.35 + r() * 0.30).toFixed(3)})`;
      c.beginPath();
      c.arc(Math.floor(r() * TEX_W), Math.floor(r() * TEX_H), 1 + r() * 2.5, 0, Math.PI * 2);
      c.fill();
    }
    for (let i = 0; i < 40; i++) {
      c.fillStyle = `rgba(180,190,150,${(0.10 + r() * 0.15).toFixed(3)})`;
      c.fillRect(Math.floor(r() * TEX_W), Math.floor(r() * TEX_H), 1, 1);
    }
    return cv;
  }

  // 부적 토담 — mud wall papered with yellow shamanic talismans. Hwangto base
  // (grain + straw + strata + cracks) overlaid with several 부적 sheets, each
  // with red brush calligraphy, an aged border and a paste strip at the top.
  function buildContainer() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(4404);
    c.fillStyle = '#6e5230';
    c.fillRect(0, 0, TEX_W, TEX_H);
    const wash = c.createLinearGradient(0, 0, 0, TEX_H);
    wash.addColorStop(0, 'rgba(255,220,160,0.10)');
    wash.addColorStop(0.5, 'rgba(0,0,0,0)');
    wash.addColorStop(1, 'rgba(0,0,0,0.30)');
    c.fillStyle = wash;
    c.fillRect(0, 0, TEX_W, TEX_H);
    for (let i = 0; i < 800; i++) {
      c.fillStyle = `rgba(28,16,8,${(0.08 + r() * 0.16).toFixed(3)})`;
      c.fillRect(Math.floor(r() * TEX_W), Math.floor(r() * 108), 1, 1);
    }
    for (let i = 0; i < 70; i++) {
      const len = 3 + Math.floor(r() * 6);
      c.fillStyle = `rgba(220,180,90,${(0.28 + r() * 0.25).toFixed(3)})`;
      c.fillRect(Math.floor(r() * TEX_W), Math.floor(r() * 108), len, 1);
    }
    for (let y = 16; y < 104; y += 18) {
      c.fillStyle = 'rgba(40,24,10,0.30)';
      c.fillRect(0, y, TEX_W, 1);
    }
    c.strokeStyle = 'rgba(26,14,6,0.5)';
    c.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      let cx = r() * TEX_W, cy = r() * 104;
      c.beginPath();
      c.moveTo(cx, cy);
      for (let j = 0; j < 5; j++) {
        cx += (r() - 0.5) * 24;
        cy += (r() - 0.3) * 22;
        c.lineTo(cx, cy);
      }
      c.stroke();
    }
    const tals = [
      { x: 14, y: 12, w: 26, h: 40 },
      { x: 78, y: 30, w: 24, h: 44 },
      { x: 46, y: 60, w: 24, h: 40 },
      { x: 98, y: 74, w: 22, h: 30 }
    ];
    for (const t of tals) drawTalisman(c, r, t.x, t.y, t.w, t.h);
    footing(c, r, 108, 20);
    return cv;
  }

  function drawTalisman(c, r, x, y, w, h) {
    c.fillStyle = '#e3bd54';
    c.fillRect(x, y, w, h);
    c.fillStyle = 'rgba(120,80,20,0.25)';
    c.fillRect(x, y, w, 2); c.fillRect(x, y + h - 2, w, 2);
    c.fillRect(x, y, 2, h); c.fillRect(x + w - 2, y, 2, h);
    c.fillStyle = 'rgba(255,242,190,0.6)';
    c.fillRect(x, y, w, 1);
    const cx = x + w / 2;
    c.fillStyle = '#8e1414';
    c.fillRect(cx - 4, y + 3, 8, 5);                 // header block
    c.fillStyle = '#9a1818';
    c.fillRect(cx - 1, y + 10, 2, h - 16);           // vertical column
    for (let i = 0; i < 4; i++) {                    // glyph crossbars
      const gy = y + 12 + i * ((h - 18) / 4);
      const gw = 4 + Math.floor(r() * 6);
      c.fillRect(cx - gw / 2, gy, gw, 2);
    }
    c.fillRect(cx - 3, y + h - 10, 7, 2);            // bottom flick
    c.fillStyle = 'rgba(220,210,180,0.5)';
    c.fillRect(cx - 3, y - 1, 6, 2);                 // paste strip
  }

  // 짚단 묶음 — bound straw sheaves stacked as chest-high cover. Each bundle
  // gets a lit-to-shadow straw gradient, individual fibre streaks, an X twine
  // binding, a mid twine band, and frayed straw tips poking above.
  function buildSandbag() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(5505);
    c.fillStyle = '#241708';
    c.fillRect(0, 0, TEX_W, TEX_H);
    const ROWS = 4, bagH = TEX_H / ROWS, bagW = 26;
    for (let row = 0; row < ROWS; row++) {
      const y = row * bagH;
      const offset = (row % 2) * (bagW / 2);
      for (let col = -1; col <= TEX_W / bagW + 1; col++) {
        const bx = col * bagW + offset;
        const grd = c.createLinearGradient(bx, y, bx, y + bagH);
        grd.addColorStop(0,    '#ecc964');
        grd.addColorStop(0.5,  '#bd9838');
        grd.addColorStop(0.86, '#7a5c22');
        grd.addColorStop(1,    '#3a2810');
        c.fillStyle = grd;
        roundRect(c, bx + 1, y + 1, bagW - 2, bagH - 2, 6);
        c.fill();
        const sg = c.createLinearGradient(bx, 0, bx + bagW, 0);
        sg.addColorStop(0,    'rgba(0,0,0,0.32)');
        sg.addColorStop(0.2,  'rgba(0,0,0,0)');
        sg.addColorStop(0.8,  'rgba(0,0,0,0)');
        sg.addColorStop(1,    'rgba(0,0,0,0.32)');
        c.fillStyle = sg;
        c.fillRect(bx, y, bagW, bagH);
        for (let g = 0; g < bagW; g++) {
          if (r() < 0.5) {
            c.fillStyle = `rgba(0,0,0,${(0.05 + r() * 0.12).toFixed(3)})`;
            c.fillRect(bx + g, y + 2, 1, bagH - 4);
          }
        }
        for (let g = 0; g < 10; g++) {
          c.fillStyle = `rgba(255,232,150,${(0.20 + r() * 0.30).toFixed(3)})`;
          c.fillRect(bx + 2 + Math.floor(r() * (bagW - 4)), y + 2, 1, bagH - 4);
        }
        c.strokeStyle = 'rgba(60,38,14,0.9)';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(bx + 3, y + 8); c.lineTo(bx + bagW - 3, y + bagH - 8);
        c.moveTo(bx + bagW - 3, y + 8); c.lineTo(bx + 3, y + bagH - 8);
        c.stroke();
        c.fillStyle = 'rgba(40,25,10,0.85)';
        c.fillRect(bx + 2, y + bagH / 2 - 1, bagW - 4, 2);
        c.fillStyle = 'rgba(255,230,150,0.25)';
        c.fillRect(bx + 2, y + bagH / 2 - 1, bagW - 4, 1);
        for (let s = 0; s < 5; s++) {
          const sx = bx + 3 + Math.floor(r() * (bagW - 6));
          c.strokeStyle = `rgba(230,200,120,${(0.40 + r() * 0.30).toFixed(3)})`;
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(sx, y + 2);
          c.lineTo(sx + (r() - 0.5) * 5, y - 2 - Math.floor(r() * 3));
          c.stroke();
        }
      }
      c.fillStyle = 'rgba(0,0,0,0.5)';
      c.fillRect(0, y + bagH - 1, TEX_W, 1);
    }
    return cv;
  }

  // 폐 한옥 자재 — debris from a collapsed hanok: stacked broken timber planks
  // with grain and splintered ends, grey roof-tile shards wedged in the gaps,
  // rusty nails, and a fallen diagonal post.
  function buildVehicle() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(6606);
    c.fillStyle = '#1c0f08';
    c.fillRect(0, 0, TEX_W, TEX_H);
    let y = 0;
    while (y < TEX_H) {
      const h = 12 + Math.floor(r() * 12);
      const bR = 58 + Math.floor(r() * 34);
      const bG = 30 + Math.floor(r() * 18);
      const bB = 16 + Math.floor(r() * 10);
      c.fillStyle = `rgb(${bR},${bG},${bB})`;
      c.fillRect(0, y, TEX_W, h);
      for (let g = 0; g < 10; g++) {
        c.fillStyle = `rgba(0,0,0,${(0.15 + r() * 0.25).toFixed(3)})`;
        c.fillRect(0, y + Math.floor(r() * h), TEX_W, 1);
      }
      const ex = Math.floor(r() * 100);
      c.fillStyle = 'rgba(0,0,0,0.6)';
      c.fillRect(ex, y, 3, h);
      for (let s = 0; s < 4; s++) {
        c.fillStyle = `rgba(${bR + 20},${bG + 15},${bB + 8},0.8)`;
        c.fillRect(ex + 3, y + Math.floor(r() * h), 2 + Math.floor(r() * 4), 1);
      }
      c.fillStyle = 'rgba(255,200,150,0.10)';
      c.fillRect(0, y, TEX_W, 1);
      c.fillStyle = 'rgba(0,0,0,0.55)';
      c.fillRect(0, y + h - 1, TEX_W, 1);
      y += h;
    }
    for (let i = 0; i < 10; i++) {
      const cx = Math.floor(r() * TEX_W), cy = Math.floor(r() * TEX_H);
      c.fillStyle = '#34343a';
      c.beginPath(); c.arc(cx, cy, 3 + r() * 3, 0, Math.PI); c.fill();
      c.fillStyle = 'rgba(220,224,230,0.18)';
      c.beginPath(); c.arc(cx, cy - 1, 2 + r() * 1.5, Math.PI, 2 * Math.PI); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.4)';
      c.fillRect(cx - 3, cy, 6, 1);
    }
    for (let i = 0; i < 14; i++) {
      const x = Math.floor(r() * TEX_W), y2 = Math.floor(r() * TEX_H);
      c.fillStyle = 'rgba(120,55,20,0.4)';
      c.fillRect(x - 1, y2 - 1, 4, 4);
      c.fillStyle = '#0a0604';
      c.fillRect(x, y2, 2, 2);
    }
    c.save();
    c.translate(18, 92);
    c.rotate(-0.5);
    const pg = c.createLinearGradient(0, -7, 0, 7);
    pg.addColorStop(0, '#5a3318');
    pg.addColorStop(0.5, '#3a2010');
    pg.addColorStop(1, '#1c0e06');
    c.fillStyle = pg;
    c.fillRect(0, -7, 92, 14);
    c.fillStyle = 'rgba(0,0,0,0.4)';
    for (let i = 0; i < 6; i++) c.fillRect(0, -6 + i * 2, 92, 1);
    c.restore();
    return cv;
  }

  // 솟대 — a shamanic spirit pole. Weathered wood column with grain + knots,
  // five 오방색 cloth strips tied near the top, and a small stone base cairn.
  // The carved duck that crowns it is drawn by the raycaster's top-deco pass
  // so it can poke above the wall body against the sky.
  function buildComms() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(7707);
    c.fillStyle = '#0a0a0c';
    c.fillRect(0, 0, TEX_W, TEX_H);
    const cx = TEX_W / 2, poleW = 18;
    // Base cairn.
    c.fillStyle = '#1a1a1e';
    c.fillRect(0, 108, TEX_W, 20);
    for (let i = 0; i < 10; i++) {
      const sx = 8 + i * 12 + Math.floor(r() * 4);
      const g = 50 + Math.floor(r() * 26);
      c.fillStyle = `rgb(${g},${g},${g + 3})`;
      c.beginPath();
      c.arc(sx, 118 + Math.floor(r() * 6), 5 + r() * 3, 0, Math.PI * 2);
      c.fill();
    }
    // Wood pole.
    const grd = c.createLinearGradient(cx - poleW / 2, 0, cx + poleW / 2, 0);
    grd.addColorStop(0, '#170d05');
    grd.addColorStop(0.5, '#523016');
    grd.addColorStop(1, '#170d05');
    c.fillStyle = grd;
    c.fillRect(cx - poleW / 2, 0, poleW, 116);
    for (let i = 0; i < 22; i++) {
      c.fillStyle = `rgba(0,0,0,${(0.15 + r() * 0.20).toFixed(3)})`;
      c.fillRect(cx - poleW / 2 + Math.floor(r() * poleW), 0, 1, 116);
    }
    for (let i = 0; i < 6; i++) {
      const x = cx - 4 + Math.floor(r() * 8);
      const y = 12 + i * 18 + Math.floor(r() * 6);
      c.fillStyle = 'rgba(90,55,25,0.5)';
      c.beginPath(); c.ellipse(x, y, 4, 2.6, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#0a0604';
      c.beginPath(); c.ellipse(x, y, 2.5, 1.8, 0, 0, Math.PI * 2); c.fill();
    }
    // 오방색 cloth strips.
    const colors = ['#b32018', '#1f6fae', '#e8d24a', '#d8d0bc', '#2f7a44'];
    for (let i = 0; i < colors.length; i++) {
      const yy = 30 + i * 5;
      c.fillStyle = colors[i];
      c.fillRect(cx - poleW / 2 - 1, yy, poleW + 2, 3);
      const dir = i % 2 === 0 ? 1 : -1;
      c.fillRect(cx + dir * (poleW / 2), yy, dir * (8 + Math.floor(r() * 8)), 3);
    }
    c.fillStyle = 'rgba(255,200,150,0.12)';
    c.fillRect(cx - 2, 0, 2, 116);
    return cv;
  }

  // 장독대 항아리 — glazed onggi fermentation jars. A fat-bellied main jar
  // with a domed lid, glossy glaze sheen, finger-drawn wavy shoulder lines and
  // kiln speckle, plus a smaller jar set beside it on the platform.
  function buildHazard() {
    const cv = newTex();
    const c = cv.getContext('2d');
    const r = rng(8808);
    c.fillStyle = '#0c0806';
    c.fillRect(0, 0, TEX_W, TEX_H);
    drawJar(c, r, 52, 6, 124, 52);   // main jar
    drawJar(c, r, 98, 52, 126, 22);  // smaller front jar
    return cv;
  }

  function drawJar(c, r, cx, top, bot, maxHW) {
    const H2 = bot - top;
    const hw = (y) => {
      const t = (y - top) / H2;
      if (t < 0 || t > 1) return 0;
      const bulge = Math.sin(t * Math.PI * 0.92 + 0.08);
      const neck = t < 0.12 ? (0.45 + (t / 0.12) * 0.55) : 1;
      const base = t > 0.9 ? Math.max(0.25, 1 - ((t - 0.9) / 0.1) * 0.5) : 1;
      return bulge * maxHW * neck * base;
    };
    for (let y = top; y <= bot; y++) {
      const w = hw(y);
      if (w < 1) continue;
      for (let dx = -w; dx <= w; dx++) {
        const u = (dx + w) / (2 * w);
        const hl = Math.max(0, 1 - Math.abs(u - 0.34) * 3.2);
        const rr = 58 + Math.floor(hl * 70);
        const gg = 30 + Math.floor(hl * 42);
        const bb = 14 + Math.floor(hl * 22);
        c.fillStyle = `rgb(${rr},${gg},${bb})`;
        c.fillRect(Math.round(cx + dx), y, 1, 1);
      }
    }
    // Glaze sheen band.
    for (let y = top + 3; y < bot - 3; y++) {
      const w = hw(y);
      if (w < 4) continue;
      const xh = cx - w + 2 * w * 0.30;
      c.fillStyle = 'rgba(255,225,180,0.18)';
      c.fillRect(Math.round(xh), y, 1, 1);
      c.fillStyle = 'rgba(255,225,180,0.10)';
      c.fillRect(Math.round(xh) + 1, y, 1, 1);
    }
    // Finger-drawn wavy shoulder lines.
    c.strokeStyle = 'rgba(20,10,5,0.4)';
    c.lineWidth = 1;
    for (let k = 0; k < 2; k++) {
      const yy = top + H2 * (0.30 + k * 0.10);
      c.beginPath();
      let started = false;
      for (let dx = -maxHW; dx <= maxHW; dx += 2) {
        if (Math.abs(dx) > hw(yy)) { started = false; continue; }
        const yyy = yy + Math.sin(dx * 0.5 + k) * 2;
        if (!started) { c.moveTo(cx + dx, yyy); started = true; }
        else c.lineTo(cx + dx, yyy);
      }
      c.stroke();
    }
    // Mouth + domed lid.
    const topHW = hw(top + H2 * 0.05);
    c.fillStyle = '#0a0604';
    c.fillRect(Math.round(cx - topHW * 0.7), top + 1, Math.round(topHW * 1.4), 3);
    c.fillStyle = '#3a2414';
    c.beginPath(); c.ellipse(cx, top + 1, topHW * 0.8, 4, 0, Math.PI, 2 * Math.PI); c.fill();
    c.fillStyle = 'rgba(255,210,160,0.2)';
    c.beginPath(); c.ellipse(cx, top, topHW * 0.5, 2, 0, Math.PI, 2 * Math.PI); c.fill();
    // Kiln speckle.
    for (let i = 0; i < 60; i++) {
      const y = top + Math.floor(r() * H2);
      const w = hw(y);
      if (w < 2) continue;
      const x = cx - w + Math.floor(r() * 2 * w);
      c.fillStyle = `rgba(0,0,0,${(0.12 + r() * 0.22).toFixed(3)})`;
      c.fillRect(Math.round(x), y, 1, 1);
    }
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
