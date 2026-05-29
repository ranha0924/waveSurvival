// Map data and collision system.
//
// Setting: 산속 외딴 굿당 — a remote shamanic shrine deep in the woods.
// A 한옥 main hall sits at the centre of a small forest clearing, ringed
// by 장독 jars, 솟대 spirit poles, and 짚단 straw bundles. 부적 토담
// (paper-talisman mud walls) form a half-collapsed protective ring;
// stacked timber + roof-tile rubble (폐 한옥 자재) is strewn across the
// grounds. The whole site is fenced by a 흙담 (earth wall) perimeter,
// beyond which Environment.placeTrees plants a wall of pine and broadleaf
// trees so the player always reads the level as "small ritual ground
// surrounded by woods".
//
// Tile types (numeric IDs match WallTextures + raycaster lookups):
//   0  = empty floor (forest earth)
//   1  = 흙담 (hwangto perimeter wall)
//   2  = 한옥 기와벽 (main hall — only the central building uses this)
//   3  = 이끼 낀 돌담 (mossy stone piles)
//   4  = 부적 토담 (talisman-papered mud wall)
//   5  = 짚단 묶음 (woven straw bundles — chest-high cover)
//   6  = 폐 한옥 자재 (collapsed timber + tile rubble)
//   7  = 솟대 (sotdae spirit pole — tall vertical landmark)
//   8  = 장독대 항아리 (jangdok ceramic jar — short ring around the hall)
//   9  = 적 spawn gate (walkable; rendered as a gate decal)
const GameMap = (() => {
  function build() {
    const W = 42, H = 42;
    const data = [];
    for (let y = 0; y < H; y++) data.push(new Array(W).fill(0));

    const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    function rect(x0, y0, x1, y1, t) {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          if (inb(x, y)) data[y][x] = t;
    }
    function hollow(x0, y0, x1, y1, t) {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          if ((x === x0 || x === x1 || y === y0 || y === y1) && inb(x, y))
            data[y][x] = t;
    }
    function clear(x0, y0, x1, y1) {
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          if (inb(x, y)) data[y][x] = 0;
    }

    // ── 1. Perimeter earth wall (흙담) ────────────────────────────────
    hollow(0, 0, W - 1, H - 1, 1);

    // ── 2. Central 한옥 main hall ────────────────────────────────────
    // 9×7 hollow ceramic-roof building, south-facing entrance.
    hollow(17, 13, 25, 19, 2);
    // South entrance — three tiles wide
    data[19][20] = 0;
    data[19][21] = 0;
    data[19][22] = 0;
    // A second small back exit so the boss has somewhere to flank from
    data[13][21] = 0;

    // ── 3. Jangdok jar ring (8) — line of jars hugging the main hall ──
    // East flank
    for (let y = 14; y <= 18; y += 2) data[y][27] = 8;
    // West flank
    for (let y = 14; y <= 18; y += 2) data[y][15] = 8;
    // North side (back of the hall) — only a couple, less dense
    data[11][19] = 8; data[11][23] = 8;

    // ── 4. Sotdae spirit poles (7) — two flanking the south courtyard ─
    data[22][19] = 7;
    data[22][23] = 7;

    // ── 5. Straw bundles (5) — chest-high cover scattered in the yard ─
    rect(19, 25, 23, 25, 5);     // straight line in front of hall
    rect(13, 28, 15, 28, 5);     // west yard
    rect(28, 28, 30, 28, 5);     // east yard
    rect(11, 17, 11, 19, 5);     // small west pile
    rect(31, 17, 31, 19, 5);     // small east pile

    // ── 6. 부적 토담 ring (4) — half-collapsed talisman mud-wall arcs
    //         that suggest a protective barrier without sealing the play
    //         area. Left intentionally with gaps so enemies path through.
    rect(13, 9, 17, 9, 4);       // NW arc
    rect(25, 9, 29, 9, 4);       // NE arc
    rect(8, 13, 8, 17, 4);       // W arc
    rect(34, 13, 34, 17, 4);     // E arc
    rect(13, 32, 17, 32, 4);     // SW arc
    rect(25, 32, 29, 32, 4);     // SE arc

    // ── 7. Collapsed hanok material (6) — stacked beams + tile rubble ─
    rect(10, 23, 12, 24, 6);
    rect(30, 23, 32, 24, 6);
    rect(20, 35, 22, 36, 6);
    rect(5, 5, 7, 6, 6);
    rect(35, 5, 37, 6, 6);
    rect(5, 35, 7, 36, 6);
    rect(35, 35, 37, 36, 6);

    // ── 8. Mossy stone heaps (3) — small clusters around the grounds ──
    rect(15, 5, 16, 5, 3);
    rect(26, 5, 27, 5, 3);
    rect(5, 25, 5, 27, 3);
    rect(36, 25, 36, 27, 3);
    rect(15, 38, 18, 38, 3);
    rect(24, 38, 27, 38, 3);

    // ── 9. Spawn gates (9) — 8 around the perimeter so enemies can come
    //         from any direction relative to the player at the courtyard.
    //         Tiles must be walkable so they overwrite any earth-wall.
    const gates = [
      [Math.floor(W / 2), 1],
      [Math.floor(W / 2) + 1, 1],
      [Math.floor(W / 2), H - 2],
      [Math.floor(W / 2) + 1, H - 2],
      [1, Math.floor(H / 2)],
      [1, Math.floor(H / 2) + 1],
      [W - 2, Math.floor(H / 2)],
      [W - 2, Math.floor(H / 2) + 1]
    ];
    for (const [gx, gy] of gates) data[gy][gx] = 9;

    return { W, H, data };
  }

  const built = build();
  const W = built.W;
  const H = built.H;
  const data = built.data;

  // Wall colors per type. Each entry: { light, dark, pattern }. The
  // raycaster only uses these as a fallback tint when the textured
  // WallTextures pass doesn't run; the actual look comes from
  // walltextures.js which paints the 굿판 motifs.
  const wallColors = {
    1: { light: '#8a6a3a', dark: '#3a2818', pattern: 'concrete'   }, // 흙담
    2: { light: '#3a3a3e', dark: '#15151a', pattern: 'rivet'      }, // 한옥 기와
    3: { light: '#5a655a', dark: '#252a25', pattern: 'stone'      }, // 돌담
    4: { light: '#6e5230', dark: '#322010', pattern: 'corrugated' }, // 부적 토담
    5: { light: '#b89438', dark: '#3a2810', pattern: 'sandbag'    }, // 짚단
    6: { light: '#4a2614', dark: '#1c0c06', pattern: 'vehicle'    }, // 폐 자재
    7: { light: '#3a2010', dark: '#0a0604', pattern: 'steel'      }, // 솟대
    8: { light: '#7a4a20', dark: '#1a0c06', pattern: 'hazard'     }  // 장독
  };

  // Structural silhouette per wall type, read by the raycaster.
  //   heightFactor — vertical extent vs the default unit cube (1.0). >1
  //                  grows upward (sotdae spirit poles); <1 is short
  //                  cover (jars, straw bundles, rubble).
  //   seeOver       — ray continues past the wall so the world behind
  //                  still renders. Used for chest-high cover.
  //   topDeco       — silhouette drawn above the wall body; catalogue in
  //                  drawTopDeco() inside raycaster.js.
  const wallShapes = {
    1: { heightFactor: 1.00, seeOver: false, topDeco: 'jagged'  }, // 흙담 — uneven crest
    2: { heightFactor: 1.25, seeOver: false, topDeco: 'roof'    }, // 한옥 — pitched roofline
    3: { heightFactor: 0.65, seeOver: true,  topDeco: null      }, // 돌담 — chest-high stones, see over
    4: { heightFactor: 1.00, seeOver: false, topDeco: 'jagged'  }, // 부적 토담 — half-broken mud
    5: { heightFactor: 0.50, seeOver: true,  topDeco: null      }, // 짚단 — low cover
    6: { heightFactor: 0.55, seeOver: true,  topDeco: null      }, // 폐 자재 — debris pile, see over
    7: { heightFactor: 1.60, seeOver: false, topDeco: null     }, // 솟대 — billboard prop; shape blocks bullets via seeOver:false
    8: { heightFactor: 0.65, seeOver: true,  topDeco: null      }  // 장독 — jar height, see over
  };

  function getTile(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || ix >= W || iy < 0 || iy >= H) return 1;
    return data[iy][ix];
  }

  // A tile that physically blocks movement / sight as a full wall. Only the
  // perimeter (1), main hall (2) and 부적 토담 (4) qualify. The freestanding
  // shrine objects (3/5/6/7/8) are drawn as shaped billboards and use a small
  // circular collision (Environment.propBlocks) instead of blocking their whole
  // tile, so the player can walk right up to and between them.
  function isWall(x, y) {
    const t = getTile(x, y);
    return t === 1 || t === 2 || t === 4;
  }

  // Tiles the raycaster renders as solid wall columns. The freestanding shrine
  // objects — 3 돌무더기, 5 짚단, 6 폐자재, 7 솟대, 8 장독 — are drawn as shaped
  // billboard sprites (Environment props) instead of square tiles, so they're
  // excluded here even though they still block movement / sight (isWall). Only
  // the perimeter (1), main hall (2) and 부적 토담 (4) read as actual walls.
  function isRenderWall(t) { return t === 1 || t === 2 || t === 4; }

  function getWallColor(type) { return wallColors[type] || wallColors[1]; }
  function getPattern(type) { return (wallColors[type] && wallColors[type].pattern) || 'concrete'; }
  function getShape(type) { return wallShapes[type] || wallShapes[1]; }

  function getSpawnPoints() {
    const pts = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (data[y][x] === 9) pts.push({ x: x + 0.5, y: y + 0.5 });
    return pts;
  }

  // Player start: south courtyard, in front of the main hall, so the
  // opening view frames the 한옥 between the two sotdae poles.
  const PLAYER_START = { x: 21.5, y: 27.5 };
  // Guarantee a clear pocket around the spawn so we never start inside
  // a wall (the straw row in front of the hall is intentionally close
  // to the spawn, but the pocket carves a clear space).
  for (let y = 26; y <= 29; y++)
    for (let x = 19; x <= 24; x++)
      if (data[y][x] >= 1 && data[y][x] <= 8) data[y][x] = 0;

  function canMove(x, y, radius = 0.25) {
    if (isWall(x - radius, y - radius)) return false;
    if (isWall(x + radius, y - radius)) return false;
    if (isWall(x - radius, y + radius)) return false;
    if (isWall(x + radius, y + radius)) return false;
    // Point-in-footprint collision for the shaped shrine props + tree trunks so
    // they feel solid without the full-tile invisible wall the player used to
    // bump into.
    if (typeof Environment !== 'undefined') {
      if (Environment.propBlocks && Environment.propBlocks(x, y)) return false;
      if (Environment.treeBlocks && Environment.treeBlocks(x, y)) return false;
    }
    return true;
  }

  function tryMove(curX, curY, dx, dy, radius = 0.25) {
    let nx = curX + dx;
    let ny = curY + dy;
    if (canMove(nx, ny, radius)) return { x: nx, y: ny };
    if (canMove(nx, curY, radius)) return { x: nx, y: curY };
    if (canMove(curX, ny, radius)) return { x: curX, y: ny };
    return { x: curX, y: curY };
  }

  function hasLineOfSight(x1, y1, x2, y2, maxDist = 50) {
    const dx = x2 - x1, dy = y2 - y1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxDist) return false;
    const steps = Math.ceil(dist * 8);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = x1 + dx * t;
      const y = y1 + dy * t;
      if (isWall(x, y)) return false;
    }
    return true;
  }

  return {
    W, H, data,
    getTile, isWall, isRenderWall, getWallColor, getPattern, getShape,
    getSpawnPoints, canMove, tryMove, hasLineOfSight,
    PLAYER_START
  };
})();
