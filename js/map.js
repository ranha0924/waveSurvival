// Map data and collision system
// 0 = empty, 1-4 = walls (different colors), 9 = spawn point
const GameMap = (() => {
  const W = 24, H = 24;
  // 24x24 arena with central walls/pillars and gate-like walls. Spawn (9) marks enemy spawn tiles.
  const data = [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,9,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,9,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,1],
    [1,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,9,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,9,1],
    [1,0,0,0,0,0,0,0,0,0,4,4,4,4,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,4,0,0,4,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,4,0,0,4,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,4,0,0,4,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,4,4,4,4,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,9,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,9,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,0,0,0,1],
    [1,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,9,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,9,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]
  ];

  // Wall colors per type
  const wallColors = {
    1: { light: '#7a6a55', dark: '#3d3528' }, // outer wall
    2: { light: '#aa5544', dark: '#552220' }, // brick pillar
    3: { light: '#446688', dark: '#223344' }, // metal column
    4: { light: '#666633', dark: '#333319' }  // central bunker
  };

  function getTile(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || ix >= W || iy < 0 || iy >= H) return 1;
    return data[iy][ix];
  }

  function isWall(x, y) {
    const t = getTile(x, y);
    return t >= 1 && t <= 4;
  }

  function getWallColor(type) {
    return wallColors[type] || wallColors[1];
  }

  function getSpawnPoints() {
    const pts = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (data[y][x] === 9) pts.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
    return pts;
  }

  // Check if point can be occupied (not in wall, has room)
  function canMove(x, y, radius = 0.25) {
    if (isWall(x - radius, y - radius)) return false;
    if (isWall(x + radius, y - radius)) return false;
    if (isWall(x - radius, y + radius)) return false;
    if (isWall(x + radius, y + radius)) return false;
    return true;
  }

  // Slide along walls
  function tryMove(curX, curY, dx, dy, radius = 0.25) {
    let nx = curX + dx;
    let ny = curY + dy;
    if (canMove(nx, ny, radius)) return { x: nx, y: ny };
    if (canMove(nx, curY, radius)) return { x: nx, y: curY };
    if (canMove(curX, ny, radius)) return { x: curX, y: ny };
    return { x: curX, y: curY };
  }

  // Line of sight check (simple raycast through grid)
  function hasLineOfSight(x1, y1, x2, y2, maxDist = 30) {
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
    getTile, isWall, getWallColor,
    getSpawnPoints, canMove, tryMove, hasLineOfSight
  };
})();
