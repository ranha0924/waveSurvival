// Map data and collision system
// Tile types:
//   0  = empty floor
//   1  = concrete blast wall (cracked gray)
//   2  = hangar wall (riveted military green metal)
//   3  = watchtower stone (dark gray)
//   4  = shipping container (corrugated rusted brown/green)
//   5  = sandbag barricade (khaki bands)
//   6  = destroyed vehicle (olive)
//   7  = comms tower / steel pillar (dark steel)
//   8  = hazard stripe panel (yellow-black diagonal)
//   9  = enemy spawn gate (walkable; rendered as gate decal)
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

    // Perimeter concrete wall
    hollow(0, 0, W - 1, H - 1, 1);

    // Hangar (east side) — 11×11 with an open south face
    hollow(28, 6, 38, 16, 2);
    clear(32, 16, 34, 16); // open gate

    // Corner watchtowers (3x3 hollow stone shells with doorways inward)
    hollow(3, 3, 5, 5, 3);   data[5][4] = 0;
    hollow(36, 3, 38, 5, 3); data[5][37] = 0;
    hollow(3, 36, 5, 38, 3); data[36][4] = 0;
    hollow(36, 36, 38, 38, 3); data[36][37] = 0;

    // Container alleys (sets of paired blocks creating corridors)
    rect(9, 18, 11, 19, 4);
    rect(9, 22, 11, 23, 4);
    rect(9, 26, 11, 27, 4);

    rect(15, 30, 17, 31, 4);
    rect(19, 30, 21, 31, 4);
    rect(23, 30, 25, 31, 4);

    rect(15, 8, 17, 9, 4);

    // Concrete blast walls (T and L shapes for cover)
    rect(20, 12, 20, 16, 1);  // vertical
    rect(18, 14, 22, 14, 1);  // crossbar of T

    rect(26, 22, 30, 22, 1);  // L shape
    rect(30, 22, 30, 25, 1);

    rect(8, 35, 12, 35, 1);
    rect(8, 33, 8, 35, 1);

    // Sandbag barricades (half-height look, full collision)
    rect(13, 20, 18, 20, 5);
    rect(22, 18, 26, 18, 5);
    rect(30, 30, 33, 30, 5);
    rect(7, 14, 7, 17, 5);

    // Destroyed vehicles scattered as cover
    rect(7, 11, 9, 12, 6);
    rect(24, 25, 26, 26, 6);
    rect(32, 19, 34, 20, 6);
    rect(13, 35, 15, 36, 6);

    // Comms tower (landmark) — single tile near map middle
    data[15][24] = 7;
    data[26][16] = 7;

    // Hazard panels near gate approaches
    data[2][20] = 8; data[2][21] = 8;
    data[H - 3][20] = 8; data[H - 3][21] = 8;
    data[20][2] = 8; data[21][2] = 8;
    data[20][W - 3] = 8; data[21][W - 3] = 8;

    // Enemy spawn gates: 8 along the perimeter, just inside the outer wall.
    // Spawn tiles must be walkable, so they overwrite any existing wall.
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

  // Wall colors per type. Each entry: { light, dark, pattern }
  // pattern hint is consumed by the raycaster for texture variation.
  const wallColors = {
    1: { light: '#7d7a76', dark: '#3d3b38', pattern: 'concrete' },   // blast wall
    2: { light: '#5a6b48', dark: '#2c351f', pattern: 'rivet' },      // hangar
    3: { light: '#4a4a4a', dark: '#222222', pattern: 'stone' },      // watchtower
    4: { light: '#7a4a30', dark: '#3a2010', pattern: 'corrugated' }, // container
    5: { light: '#a08a55', dark: '#5a4a28', pattern: 'sandbag' },    // sandbag
    6: { light: '#5d5a32', dark: '#26241a', pattern: 'vehicle' },    // vehicle
    7: { light: '#3a3d44', dark: '#16181c', pattern: 'steel' },      // comms tower
    8: { light: '#d4b020', dark: '#16140a', pattern: 'hazard' }      // hazard
  };

  function getTile(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || ix >= W || iy < 0 || iy >= H) return 1;
    return data[iy][ix];
  }

  function isWall(x, y) {
    const t = getTile(x, y);
    return t >= 1 && t <= 8;
  }

  function getWallColor(type) { return wallColors[type] || wallColors[1]; }
  function getPattern(type) { return (wallColors[type] && wallColors[type].pattern) || 'concrete'; }

  function getSpawnPoints() {
    const pts = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (data[y][x] === 9) pts.push({ x: x + 0.5, y: y + 0.5 });
    return pts;
  }

  // Player start: open zone west-center of the map, away from structures.
  const PLAYER_START = { x: 5.5, y: 20.5 };
  // Guarantee a clear pocket around the spawn so we never start inside a wall.
  for (let y = 19; y <= 22; y++)
    for (let x = 4; x <= 7; x++)
      if (data[y][x] >= 1 && data[y][x] <= 8) data[y][x] = 0;

  function canMove(x, y, radius = 0.25) {
    if (isWall(x - radius, y - radius)) return false;
    if (isWall(x + radius, y - radius)) return false;
    if (isWall(x - radius, y + radius)) return false;
    if (isWall(x + radius, y + radius)) return false;
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
    getTile, isWall, getWallColor, getPattern,
    getSpawnPoints, canMove, tryMove, hasLineOfSight,
    PLAYER_START
  };
})();
