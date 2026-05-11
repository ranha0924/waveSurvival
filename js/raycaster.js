// Raycasting renderer with DDA wall projection + sprite billboards.
// Outdoor variant: theme-driven sky, skyline silhouettes, textured walls,
// long draw distance, atmospheric darkness/fog.
const Raycaster = (() => {
  let canvas, ctx;
  let W, H;
  let zBuffer;
  // Per-column distance to the nearest short (see-over) wall, used by sprites
  // to clip their lower body so enemies behind a sandbag are obscured below
  // the wall's top while remaining visible above it.
  let shortDist;
  // Per-column screen Y of the nearest opaque wall's TOP. Sprites behind a
  // wall are clipped against this so a tall enemy still visibly pokes above
  // a shorter wall — the column-scalar zBuffer alone would hide the entire
  // sprite, which made the boss look like it had a ceiling sitting on it.
  let wallTopY;
  const FOV = Math.PI / 3; // 60deg

  // Offscreen buffer used to apply per-frame fog/flash tint to image sprites
  // before blitting them column-by-column. Reused across enemies; resized
  // on demand to match the source sprite's native dimensions.
  const tintBuf = document.createElement('canvas');
  const tintCtx = tintBuf.getContext('2d');

  // Pre-baked sky/floor decoration canvases. Built lazily so init order
  // doesn't matter. Stars + skyline are seeded so they're stable run-to-run.
  let concreteTile = null;       // small repeating concrete texture
  let skylineCanvas = null;      // building silhouettes baked at canvas width
  let skylineWidth = 0;          // width skylineCanvas was baked for
  let starField = null;          // [{x,y,size,twinkleRate,twinklePhase}]
  let cloudBank = null;          // dark cloud blobs for storm/dusk

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    resize();
    // Crisp pixel-art scaling for image sprites.
    ctx.imageSmoothingEnabled = false;
    // Bake the per-tile wall body textures (sandbag bags, container ribs,
    // brick courses, etc.) so drawWall can sample 1px columns from them.
    if (typeof WallTextures !== 'undefined') WallTextures.buildAll();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', resize);
    }
  }

  function resize() {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

    // Always fill the viewport — no letterboxing. Cap internal pixel size for
    // performance; mobile renders at a lower internal resolution and CSS
    // upscales it.
    const maxW = isTouch ? 960 : 1280;
    const maxH = isTouch ? 540 : 800;
    const scale = Math.min(1, maxW / winW, maxH / winH);
    canvas.width = Math.max(1, Math.floor(winW * scale));
    canvas.height = Math.max(1, Math.floor(winH * scale));
    canvas.style.width = winW + 'px';
    canvas.style.height = winH + 'px';

    W = canvas.width;
    H = canvas.height;
    zBuffer = new Float32Array(W);
    shortDist = new Float32Array(W);
    wallTopY = new Float32Array(W);
    if (ctx) ctx.imageSmoothingEnabled = false;
  }

  function render(player, enemies, particles, horizonOffset, theme) {
    theme = theme || Environment.themeForWave(1);

    drawSky(theme, horizonOffset);
    drawFloor(theme, horizonOffset);

    castWalls(player, horizonOffset, theme);

    const sprites = [];
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - player.x, dy = e.y - player.y;
      sprites.push({ x: e.x, y: e.y, dist: dx * dx + dy * dy, type: 'enemy', ref: e });
    }
    for (const p of particles) {
      const dx = p.x - player.x, dy = p.y - player.y;
      sprites.push({ x: p.x, y: p.y, dist: dx * dx + dy * dy, type: 'particle', ref: p });
    }
    if (typeof Pickups !== 'undefined') {
      for (const k of Pickups.getList()) {
        const dx = k.x - player.x, dy = k.y - player.y;
        sprites.push({ x: k.x, y: k.y, dist: dx * dx + dy * dy, type: 'pickup', ref: k });
      }
    }
    sprites.sort((a, b) => b.dist - a.dist);

    for (const s of sprites) {
      if (s.type === 'enemy') drawEnemySprite(player, s.ref, horizonOffset, theme);
      else if (s.type === 'pickup') drawPickupSprite(player, s.ref, horizonOffset, theme);
      else drawParticle(player, s.ref, horizonOffset, theme);
    }
  }

  // Pickup billboards sit on the floor and bob slightly. Rendered like enemy
  // sprites (column-by-column blit so the existing zBuffer / wallTopY /
  // shortDist clipping all still apply), but at ~30% of an enemy's size.
  function drawPickupSprite(player, k, horizonOffset, theme) {
    const proj = projectSprite(player, k.x, k.y);
    if (!proj) return;
    const canvas = Pickups.getCanvas(k.typeId);
    if (!canvas) return;

    const horizon = H / 2 + horizonOffset;
    const lineH = H / proj.dist;
    const pickupH = Math.max(4, Math.floor(lineH * 0.32));
    const aspect = canvas.width / canvas.height;
    const pickupW = Math.max(4, Math.floor(pickupH * aspect));
    const bob = Math.sin(k.bobPhase) * (lineH * 0.04);
    const groundedBottom = horizon + lineH / 2;
    const drawStartY = Math.floor(groundedBottom - pickupH + bob);
    const drawStartX = Math.floor(proj.screenX - pickupW / 2);

    // Soft pre-despawn fade in the last 3 seconds.
    const lifeFade = Math.min(1, k.life / 3);

    const xStart = Math.max(0, drawStartX);
    const xEnd = Math.min(W, drawStartX + pickupW);
    ctx.save();
    ctx.globalAlpha = lifeFade;
    for (let x = xStart; x < xEnd; x++) {
      let dstY1 = drawStartY + pickupH;
      if (zBuffer[x] < proj.dist) dstY1 = Math.min(dstY1, wallTopY[x]);
      if (proj.dist > shortDist[x]) dstY1 = Math.min(dstY1, horizon);
      if (dstY1 <= drawStartY) continue;
      const u = (x - drawStartX) / pickupW;
      const srcX = Math.min(canvas.width - 1, Math.max(0, Math.floor(u * canvas.width)));
      const dstH = dstY1 - drawStartY;
      const srcH = Math.max(1, Math.floor((dstH / pickupH) * canvas.height));
      ctx.drawImage(canvas, srcX, 0, 1, srcH, x, drawStartY, 1, dstH);
    }
    ctx.restore();
  }

  // Mulberry32 — same generator we use for wall textures, seeded per asset
  // so star positions / skyline rooftops / concrete cracks stay stable.
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

  // Build a 128×128 concrete tile: cool gray base, scattered light/dark
  // speckles, two expansion joints crossing it, a couple of hairline cracks.
  function buildConcreteTile() {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const c = cv.getContext('2d');
    const r = rng(9911);
    // Base
    c.fillStyle = '#9a9a9a';
    c.fillRect(0, 0, 128, 128);
    // Light blotches
    for (let i = 0; i < 70; i++) {
      const x = r() * 128, y = r() * 128;
      c.fillStyle = `rgba(255,255,255,${(0.04 + r() * 0.06).toFixed(3)})`;
      c.fillRect(Math.floor(x), Math.floor(y), 1 + Math.floor(r() * 3), 1 + Math.floor(r() * 3));
    }
    // Dark grain
    for (let i = 0; i < 380; i++) {
      const x = r() * 128, y = r() * 128;
      c.fillStyle = `rgba(0,0,0,${(0.05 + r() * 0.15).toFixed(3)})`;
      c.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
    // Stains
    for (let i = 0; i < 6; i++) {
      const x = r() * 128, y = r() * 128;
      const w = 6 + r() * 22, h = 6 + r() * 22;
      c.fillStyle = `rgba(40,30,20,${(0.05 + r() * 0.08).toFixed(3)})`;
      c.beginPath();
      c.ellipse(x, y, w / 2, h / 2, r() * Math.PI, 0, Math.PI * 2);
      c.fill();
    }
    // Expansion joints (one horizontal, one vertical, slightly off-center)
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(0, 62, 128, 2);
    c.fillRect(64, 0, 2, 128);
    c.fillStyle = 'rgba(255,255,255,0.10)';
    c.fillRect(0, 64, 128, 1);
    c.fillRect(66, 0, 1, 128);
    // Hairline cracks
    c.strokeStyle = 'rgba(0,0,0,0.45)';
    c.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      let cx = r() * 128, cy = r() * 128;
      c.beginPath(); c.moveTo(cx, cy);
      for (let j = 0; j < 5; j++) {
        cx += (r() - 0.5) * 22;
        cy += (r() - 0.5) * 22;
        c.lineTo(cx, cy);
      }
      c.stroke();
    }
    return cv;
  }

  // Bake building silhouettes once per canvas width. Each rooftop has a
  // jagged top + occasional antenna so the horizon doesn't read as a flat
  // line. Drawn in black at varying heights so the sky tint comes from the
  // sky gradient behind them.
  function buildSkylineCanvas(targetW) {
    const buildings = [];
    const r = rng(2027);
    let x = -20;
    while (x < targetW + 20) {
      const w = 18 + Math.floor(r() * 70);
      const h = 14 + Math.floor(r() * 70);
      const hasAntenna = r() < 0.35;
      buildings.push({ x, w, h, hasAntenna, antennaH: 8 + Math.floor(r() * 18) });
      x += w + Math.floor(r() * 14 - 4);
    }
    const maxH = 100;
    const cv = document.createElement('canvas');
    cv.width = targetW;
    cv.height = maxH + 24;
    const c = cv.getContext('2d');
    c.fillStyle = '#000000';
    for (const b of buildings) {
      const top = maxH - b.h;
      c.fillRect(b.x, top, b.w, b.h + 4);
      // Tiny lit window every now and then so the silhouette reads as a
      // city, not a black bar.
      const lr = rng(b.x * 73 + 1);
      const cols = Math.max(1, Math.floor(b.w / 7));
      const rows = Math.max(1, Math.floor(b.h / 7));
      c.fillStyle = '#3a3a26';
      for (let cc = 0; cc < cols; cc++) {
        for (let rr = 0; rr < rows; rr++) {
          if (lr() < 0.16) {
            c.fillRect(b.x + 2 + cc * 7, top + 2 + rr * 7, 2, 2);
          }
        }
      }
      c.fillStyle = '#000000';
      if (b.hasAntenna) {
        c.fillRect(b.x + Math.floor(b.w / 2), top - b.antennaH, 1, b.antennaH);
        c.fillRect(b.x + Math.floor(b.w / 2) - 2, top - b.antennaH, 5, 1);
      }
    }
    return cv;
  }

  function buildStarField() {
    const r = rng(7777);
    const stars = [];
    for (let i = 0; i < 70; i++) {
      stars.push({
        u: r(),
        v: r() * 0.55,
        size: 1 + Math.floor(r() * 2),
        twinkleRate: 1.0 + r() * 2.5,
        twinklePhase: r() * Math.PI * 2,
        baseAlpha: 0.45 + r() * 0.45
      });
    }
    return stars;
  }

  function buildCloudBank() {
    const r = rng(4242);
    const clouds = [];
    for (let i = 0; i < 10; i++) {
      clouds.push({
        u: r(),
        v: r() * 0.7,
        w: 0.18 + r() * 0.22,
        h: 0.04 + r() * 0.05,
        alpha: 0.20 + r() * 0.25
      });
    }
    return clouds;
  }

  function ensureBakedAssets() {
    if (!concreteTile) concreteTile = buildConcreteTile();
    if (!starField)    starField    = buildStarField();
    if (!cloudBank)    cloudBank    = buildCloudBank();
    if (!skylineCanvas || skylineWidth !== W) {
      skylineCanvas = buildSkylineCanvas(W);
      skylineWidth = W;
    }
  }

  function drawSky(theme, horizonOffset) {
    ensureBakedAssets();
    const horizon = H / 2 + horizonOffset;
    // Over-paint past the canvas edges so the camera-shake translate never
    // exposes uncleared pixels along the borders.
    const M = 64;
    const grad = ctx.createLinearGradient(0, -M, 0, horizon);
    grad.addColorStop(0, theme.skyTop);
    grad.addColorStop(0.6, theme.skyMid);
    grad.addColorStop(1, theme.skyBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(-M, -M, W + 2 * M, Math.max(0, horizon) + M);

    const name = theme.name || 'sunset';
    if (name === 'sunset') drawSunsetSky(horizon);
    else if (name === 'dusk') drawDuskSky(horizon);
    else if (name === 'night') drawNightSky(horizon);
    else if (name === 'storm') drawStormSky(horizon);

    drawSkyline(horizon, theme);
  }

  function drawSunsetSky(horizon) {
    // Big low sun + warm halo so the gradient reads as a real horizon line.
    const sunX = W * 0.62;
    const sunY = horizon - 12;
    const sunR = Math.min(W, H) * 0.06;
    const halo = ctx.createRadialGradient(sunX, sunY, sunR, sunX, sunY, sunR * 4.5);
    halo.addColorStop(0, 'rgba(255,180,90,0.55)');
    halo.addColorStop(1, 'rgba(255,160,80,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR * 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fde4a8';
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fill();
    // A pair of warm cloud streaks
    drawCloudStreak(W * 0.20, horizon * 0.55, W * 0.30, 'rgba(255,200,140,0.18)');
    drawCloudStreak(W * 0.75, horizon * 0.32, W * 0.22, 'rgba(255,180,120,0.14)');
  }

  function drawDuskSky(horizon) {
    // Dim moon high, a few stars, soft purple clouds.
    drawStars(horizon, 25, 0.35);
    drawCloudStreak(W * 0.30, horizon * 0.4,  W * 0.30, 'rgba(120,80,140,0.20)');
    drawCloudStreak(W * 0.70, horizon * 0.55, W * 0.28, 'rgba(180,90,130,0.18)');
    const moonX = W * 0.78, moonY = horizon * 0.22, moonR = Math.min(W, H) * 0.035;
    const glow = ctx.createRadialGradient(moonX, moonY, moonR, moonX, moonY, moonR * 3);
    glow.addColorStop(0, 'rgba(240,220,200,0.35)');
    glow.addColorStop(1, 'rgba(240,220,200,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e0d6b8';
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawNightSky(horizon) {
    drawStars(horizon, 70, 1.0);
    const moonX = W * 0.75, moonY = horizon * 0.20, moonR = Math.min(W, H) * 0.045;
    const glow = ctx.createRadialGradient(moonX, moonY, moonR, moonX, moonY, moonR * 3.5);
    glow.addColorStop(0, 'rgba(230,230,210,0.45)');
    glow.addColorStop(1, 'rgba(230,230,210,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR * 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4f0d8';
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
    ctx.fill();
    // Crater hint
    ctx.fillStyle = 'rgba(150,150,135,0.4)';
    ctx.beginPath();
    ctx.arc(moonX - moonR * 0.3, moonY - moonR * 0.2, moonR * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(moonX + moonR * 0.25, moonY + moonR * 0.15, moonR * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawStormSky(horizon) {
    // Heavy cloud bands first
    for (const cd of cloudBank) {
      drawCloudStreak(cd.u * W, cd.v * horizon, cd.w * W,
        `rgba(20,18,30,${(cd.alpha + 0.15).toFixed(3)})`);
    }
    // Occasional lightning flash — deterministic enough to feel like weather
    // without storing per-frame state. Uses performance.now() so it pulses
    // briefly every few seconds.
    const t = performance.now() / 1000;
    const cycle = t % 7;
    if (cycle < 0.12) {
      const alpha = (1 - cycle / 0.12) * 0.55;
      ctx.fillStyle = `rgba(220,220,255,${alpha.toFixed(3)})`;
      ctx.fillRect(0, 0, W, horizon);
    }
  }

  function drawStars(horizon, count, intensity) {
    const t = performance.now() / 1000;
    for (let i = 0; i < Math.min(count, starField.length); i++) {
      const s = starField[i];
      const x = Math.floor(s.u * W);
      const y = Math.floor(s.v * horizon);
      const twinkle = 0.5 + 0.5 * Math.sin(t * s.twinkleRate + s.twinklePhase);
      const a = (s.baseAlpha * (0.6 + 0.4 * twinkle) * intensity).toFixed(3);
      ctx.fillStyle = `rgba(255,250,225,${a})`;
      ctx.fillRect(x, y, s.size, s.size);
    }
  }

  function drawCloudStreak(cx, cy, length, fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    ctx.ellipse(cx, cy, length * 0.5, length * 0.10, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSkyline(horizon, theme) {
    if (!skylineCanvas) return;
    // Draw the baked silhouette so its bottom sits on the horizon line.
    const sh = skylineCanvas.height;
    const dy = Math.floor(horizon - sh + 4);
    ctx.save();
    ctx.globalAlpha = theme.skyline || 0.6;
    ctx.drawImage(skylineCanvas, 0, dy);
    ctx.restore();
  }

  function drawFloor(theme, horizonOffset) {
    ensureBakedAssets();
    const horizon = H / 2 + horizonOffset;
    if (horizon >= H) return;
    const M = 64;
    // Base gradient — cool concrete tones (set in environment.js)
    const grad = ctx.createLinearGradient(0, horizon, 0, H + M);
    grad.addColorStop(0, theme.floorFar);
    grad.addColorStop(1, theme.floorNear);
    ctx.fillStyle = grad;
    ctx.fillRect(-M, horizon, W + 2 * M, H - horizon + M);

    // Concrete tile overlay. The pattern is screen-aligned (not properly
    // perspective-warped) but the alpha fades to zero at the horizon so the
    // eye reads the texture as ground detail rather than a wallpaper.
    if (concreteTile) {
      const pattern = ctx.createPattern(concreteTile, 'repeat');
      ctx.save();
      ctx.fillStyle = pattern;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(-M, horizon, W + 2 * M, H - horizon + M);
      // Distance fade — darker overlay from horizon outward.
      const fade = ctx.createLinearGradient(0, horizon, 0, H);
      fade.addColorStop(0,    `rgba(${theme.floorFar ? hexToRgb(theme.floorFar) : '0,0,0'},0.90)`);
      fade.addColorStop(0.20, `rgba(${theme.floorFar ? hexToRgb(theme.floorFar) : '0,0,0'},0.55)`);
      fade.addColorStop(1,    'rgba(0,0,0,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = fade;
      ctx.fillRect(-M, horizon, W + 2 * M, H - horizon + M);
      ctx.restore();
    }

    // Horizon haze band — pulls the eye toward the vanishing point and ties
    // the floor color into the sky's warm/cool palette.
    const haze = theme.haze || '180,160,140';
    const hazeH = Math.min(60, (H - horizon) * 0.35);
    const hazeGrad = ctx.createLinearGradient(0, horizon, 0, horizon + hazeH);
    hazeGrad.addColorStop(0, `rgba(${haze},0.50)`);
    hazeGrad.addColorStop(1, `rgba(${haze},0)`);
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(-M, horizon, W + 2 * M, hazeH);
  }

  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r},${g},${b}`;
  }

  function castWalls(player, horizonOffset, theme) {
    const cosA = Math.cos(player.angle);
    const sinA = Math.sin(player.angle);
    const tanFov = Math.tan(FOV / 2);
    const fogDist = theme.fogDist;
    const ambient = theme.ambient;
    const horizon = H / 2 + horizonOffset;

    for (let i = 0; i < W; i++) {
      shortDist[i] = Infinity;
      // Default to bottom-of-screen so "no wall in this column" is treated as
      // "doesn't clip anything" by the per-column min(dstY1, wallTopY[x]).
      wallTopY[i] = H + 1;
    }

    for (let x = 0; x < W; x++) {
      const cameraX = 2 * x / W - 1;
      const rayDirX = cosA + (-sinA) * cameraX * tanFov;
      const rayDirY = sinA + cosA * cameraX * tanFov;

      let mapX = Math.floor(player.x);
      let mapY = Math.floor(player.y);

      const deltaDistX = Math.abs(1 / (rayDirX || 1e-9));
      const deltaDistY = Math.abs(1 / (rayDirY || 1e-9));

      let stepX, stepY, sideDistX, sideDistY;
      if (rayDirX < 0) { stepX = -1; sideDistX = (player.x - mapX) * deltaDistX; }
      else { stepX = 1; sideDistX = (mapX + 1.0 - player.x) * deltaDistX; }
      if (rayDirY < 0) { stepY = -1; sideDistY = (player.y - mapY) * deltaDistY; }
      else { stepY = 1; sideDistY = (mapY + 1.0 - player.y) * deltaDistY; }

      // Walk the ray. Walls flagged seeOver (sandbags, vehicle wrecks) are
      // recorded but do not terminate the cast — the world behind them must
      // still render so the player can see over the chest-high cover.
      const shortHits = [];
      let tallHit = null;
      let side = 0;
      let safety = 96;
      while (safety-- > 0) {
        if (sideDistX < sideDistY) {
          sideDistX += deltaDistX;
          mapX += stepX;
          side = 0;
        } else {
          sideDistY += deltaDistY;
          mapY += stepY;
          side = 1;
        }
        const t = GameMap.getTile(mapX, mapY);
        if (t < 1 || t > 8) continue;
        const shape = GameMap.getShape(t);
        let perpDist;
        if (side === 0) perpDist = (mapX - player.x + (1 - stepX) / 2) / (rayDirX || 1e-9);
        else perpDist = (mapY - player.y + (1 - stepY) / 2) / (rayDirY || 1e-9);
        perpDist = Math.max(0.0001, perpDist);
        if (shape.seeOver) {
          shortHits.push({ wallType: t, perpDist, side, shape });
        } else {
          tallHit = { wallType: t, perpDist, side, shape };
          break;
        }
      }

      // Sprites should be visible over short walls, so the z-buffer tracks
      // only the nearest opaque (tall) wall. wallTopY is set in lockstep so
      // sprites behind that wall can still draw the silhouette that pokes
      // above the wall's top (boss / tank / comms tower).
      zBuffer[x] = tallHit ? tallHit.perpDist : 1e6;

      if (tallHit) {
        const wallU = tallHit.side === 0
          ? (player.y + tallHit.perpDist * rayDirY)
          : (player.x + tallHit.perpDist * rayDirX);
        const lineH = H / tallHit.perpDist;
        // Body top in screen coords — same formula drawWall() uses. Stored
        // as a float so sprite clipping can compare without losing fractions.
        wallTopY[x] = horizon + lineH / 2 - tallHit.shape.heightFactor * lineH;
        drawWall(x, horizon, tallHit.wallType, tallHit.shape, tallHit.side, tallHit.perpDist, wallU, fogDist, ambient);
      }

      // See-over walls draw far→near so closer cover overdraws farther.
      let nearestShortVisible = Infinity;
      for (let i = shortHits.length - 1; i >= 0; i--) {
        const h = shortHits[i];
        if (tallHit && h.perpDist >= tallHit.perpDist) continue;
        if (h.perpDist < nearestShortVisible) nearestShortVisible = h.perpDist;
        const wallU = h.side === 0
          ? (player.y + h.perpDist * rayDirY)
          : (player.x + h.perpDist * rayDirX);
        drawWall(x, horizon, h.wallType, h.shape, h.side, h.perpDist, wallU, fogDist, ambient);
      }
      shortDist[x] = nearestShortVisible;
    }
  }

  // Render one screen column of a wall. The wall sits on the floor at
  // `horizon + lineH/2`; its top is pushed up by `shape.heightFactor * lineH`
  // so towers tower, sandbags squat, and wrecks stay low. The body samples a
  // 1px slice from the type's pre-baked WallTextures canvas so the surface
  // reads as its actual material (stacked sandbags, corrugated container,
  // brick, etc.) rather than a flat-shaded rectangle. Side darkening + fog
  // ride on top as a single rgba overlay.
  function drawWall(x, horizon, type, shape, side, dist, wallU, fogDist, ambient) {
    const colors = GameMap.getWallColor(type);
    const baseColor = side === 1 ? colors.dark : colors.light;
    const fog = Math.min(1, dist / fogDist);
    const sideShade = side === 1 ? 0.65 : 1.0;
    const lightFactor = ambient * sideShade * (1 - fog * 0.7);

    const lineH = H / dist;
    const bottomY = Math.floor(horizon + lineH / 2);
    const topY = Math.floor(horizon + lineH / 2 - shape.heightFactor * lineH);
    const dstH = bottomY - topY;
    if (dstH > 0) {
      const tex = (typeof WallTextures !== 'undefined') ? WallTextures.get(type) : null;
      if (tex) {
        const u = ((wallU % 1) + 1) % 1;
        const srcX = Math.min(tex.width - 1, Math.max(0, Math.floor(u * tex.width)));
        ctx.drawImage(tex, srcX, 0, 1, tex.height, x, topY, 1, dstH);
        if (lightFactor < 1) {
          ctx.fillStyle = `rgba(0,0,0,${(1 - lightFactor).toFixed(3)})`;
          ctx.fillRect(x, topY, 1, dstH);
        }
      } else {
        ctx.fillStyle = shadeColor(baseColor, lightFactor);
        ctx.fillRect(x, topY, 1, dstH);
      }
    }

    if (shape.topDeco) {
      drawTopDeco(x, topY, lineH, shape.topDeco, baseColor, lightFactor, wallU, side);
    }
  }

  // Per-column silhouette drawer for the optional decoration that sits above
  // a wall body. Each kind keys off `wallU` (the world-coordinate U of the
  // hit point) so the pattern stays tile-aligned and stable as the camera
  // moves. Heights scale with `lineH` so they shrink with distance like the
  // wall body does.
  function drawTopDeco(x, topY, lineH, kind, baseColor, lightFactor, wallU, side) {
    const fract = wallU - Math.floor(wallU);
    const dark  = shadeColor(baseColor, lightFactor * 0.55);
    const lit   = shadeColor(baseColor, Math.min(1.6, lightFactor * 1.25));

    switch (kind) {
      case 'crenel': {
        // Battlement: 4 merlons per tile, alternating raised/embrasure.
        const phase = Math.floor(fract * 8);
        if (phase % 2 === 0) {
          const h = Math.max(2, lineH * 0.10);
          ctx.fillStyle = dark;
          ctx.fillRect(x, topY - h, 1, h);
          ctx.fillStyle = lit;
          ctx.fillRect(x, topY - h, 1, 1); // top highlight
        }
        break;
      }
      case 'jagged': {
        // Broken concrete crown: deterministic per-slot height + a thin
        // barbed-wire dotted line a bit above.
        const slot = Math.floor(wallU * 18);
        const n = Math.sin(slot * 12.9898) * 43758.5453;
        const noise = n - Math.floor(n);
        const h = Math.max(1, lineH * (0.03 + noise * 0.06));
        ctx.fillStyle = dark;
        ctx.fillRect(x, topY - h, 1, h);
        if (Math.floor(wallU * 48) % 4 === 0) {
          ctx.fillStyle = '#181614';
          ctx.fillRect(x, Math.floor(topY - lineH * 0.13), 1, 1);
        }
        break;
      }
      case 'antenna': {
        // Tall central spire with a few cross-bars; thin "guy wires" tapering
        // outward make the silhouette read as a comms tower from any angle.
        const dx = Math.abs(fract - 0.5);
        if (dx < 0.025) {
          const h = lineH * 0.75;
          ctx.fillStyle = '#0e1014';
          ctx.fillRect(x, topY - h, 1, h);
        } else if (dx < 0.18) {
          // Cross-bars
          const bars = [0.30, 0.45, 0.58, 0.68];
          for (const hf of bars) {
            ctx.fillStyle = shadeColor('#3a3d44', lightFactor);
            ctx.fillRect(x, Math.floor(topY - lineH * hf), 1, 1);
          }
        }
        // Spire tip beacon pulse
        if (dx < 0.04 && Math.floor((performance.now() / 400)) % 2 === 0) {
          ctx.fillStyle = '#ff5544';
          ctx.fillRect(x, Math.floor(topY - lineH * 0.78), 1, 2);
        }
        break;
      }
      case 'turret': {
        // Center-of-tile raised cab/turret box with a top edge highlight.
        if (fract > 0.28 && fract < 0.72) {
          const h = lineH * 0.28;
          ctx.fillStyle = dark;
          ctx.fillRect(x, topY - h, 1, h);
          ctx.fillStyle = lit;
          ctx.fillRect(x, topY - h, 1, 1);
          // Slit window on the front of the cab
          if (fract > 0.42 && fract < 0.58) {
            ctx.fillStyle = '#0a0a0a';
            ctx.fillRect(x, Math.floor(topY - h * 0.55), 1, Math.max(1, Math.floor(h * 0.18)));
          }
        }
        break;
      }
      case 'beacon': {
        // Hazard panel: warning bar across the top with a slow-blinking light.
        ctx.fillStyle = '#ffd040';
        ctx.fillRect(x, topY, 1, 2);
        ctx.fillStyle = '#a06a00';
        ctx.fillRect(x, topY + 2, 1, 1);
        const blink = Math.floor(performance.now() / 600) % 2 === 0;
        if (blink && fract > 0.45 && fract < 0.55) {
          ctx.fillStyle = '#ff3322';
          ctx.fillRect(x, Math.floor(topY - lineH * 0.04), 1, 2);
        }
        break;
      }
      case 'roof': {
        // Subtle roofline shadow + a peak in the center of each tile so the
        // hangar reads as having a slightly pitched roof.
        ctx.fillStyle = dark;
        ctx.fillRect(x, topY, 1, 2);
        const dx = Math.abs(fract - 0.5);
        if (dx < 0.04) {
          const h = lineH * 0.06;
          ctx.fillStyle = dark;
          ctx.fillRect(x, topY - h, 1, h);
        }
        break;
      }
      case 'corners': {
        // Container corner caps + a thin top rail so the box edge reads
        // clearly even at distance.
        ctx.fillStyle = dark;
        ctx.fillRect(x, topY, 1, 1);
        if (fract < 0.06 || fract > 0.94) {
          const h = Math.max(2, lineH * 0.07);
          ctx.fillStyle = '#1a1208';
          ctx.fillRect(x, topY - h, 1, h);
        }
        break;
      }
    }
  }

  function shadeColor(hex, factor) {
    factor = Math.max(0, factor);
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const nr = Math.min(255, Math.floor(r * factor));
    const ng = Math.min(255, Math.floor(g * factor));
    const nb = Math.min(255, Math.floor(b * factor));
    return `rgb(${nr},${ng},${nb})`;
  }

  function projectSprite(player, sx, sy) {
    const dx = sx - player.x, dy = sy - player.y;
    const cosA = Math.cos(-player.angle);
    const sinA = Math.sin(-player.angle);
    const transformX = dx * cosA - dy * sinA;
    const transformY = dx * sinA + dy * cosA;
    if (transformX <= 0.05) return null;
    const screenX = Math.floor((W / 2) * (1 + transformY / (transformX * Math.tan(FOV / 2))));
    return { screenX, dist: transformX };
  }

  function drawEnemySprite(player, e, horizonOffset, theme) {
    const proj = projectSprite(player, e.x, e.y);
    if (!proj) return;
    const horizon = H / 2 + horizonOffset;
    const baseH = H / proj.dist;
    const def = e.type;
    const flash = e.hitFlash > 0;
    const sprite = (typeof Sprites !== 'undefined') ? Sprites.get(def.id) : null;

    let spriteH, spriteW, drawStartX, drawStartY;
    if (sprite) {
      // Honor the sprite's native aspect ratio and per-type render scale, and
      // bottom-anchor so larger enemies (e.g. tank ×1.5) grow upward instead
      // of sinking into the floor.
      const scale = sprite.scale || 1;
      const aspect = sprite.w / sprite.h;
      spriteH = Math.floor(baseH * scale);
      spriteW = Math.floor(spriteH * aspect);
      const groundedBottom = horizon + baseH / 2;
      drawStartY = Math.floor(groundedBottom - spriteH);
      drawStartX = proj.screenX - Math.floor(spriteW / 2);
    } else {
      spriteH = Math.floor(baseH);
      spriteW = spriteH;
      drawStartY = Math.floor(horizon - spriteH / 2);
      drawStartX = proj.screenX - Math.floor(spriteW / 2);
    }

    const x0 = Math.max(0, drawStartX);
    const x1 = Math.min(W, drawStartX + spriteW);
    const fog = Math.min(1, proj.dist / theme.fogDist);
    const lightFactor = theme.ambient * (1 - fog * 0.6);

    if (sprite) {
      drawImageBillboard(sprite, drawStartX, drawStartY, spriteW, spriteH,
        proj.dist, lightFactor, flash, horizon);
    } else {
      const bodyColor = shadeColor(def.color, lightFactor);
      const headColor = shadeColor(def.headColor, lightFactor);

      for (let x = x0; x < x1; x++) {
        const localX = (x - drawStartX) / spriteW;
        const fromCenter = Math.abs(localX - 0.5) * 2;
        if (fromCenter > 0.95) continue;

        const bodyTopY = drawStartY + spriteH * 0.3;
        let bodyBottom = drawStartY + spriteH;
        const headTopY = drawStartY;
        let headBottomY = drawStartY + spriteH * 0.3;

        // Tall opaque wall in front: cap the visible Y at the wall's top so
        // we still draw whatever silhouette pokes above it.
        if (zBuffer[x] < proj.dist) {
          const cap = wallTopY[x];
          bodyBottom = Math.min(bodyBottom, cap);
          headBottomY = Math.min(headBottomY, cap);
        }
        // Short (see-over) wall in front: clip body at horizon line.
        if (proj.dist > shortDist[x]) bodyBottom = Math.min(bodyBottom, horizon);

        ctx.fillStyle = flash ? '#ffffff' : bodyColor;
        if (fromCenter < 0.85 && bodyBottom > bodyTopY) {
          ctx.fillRect(x, bodyTopY, 1, bodyBottom - bodyTopY);
        }
        if (fromCenter < 0.5 && headBottomY > headTopY) {
          ctx.fillStyle = flash ? '#ffffff' : headColor;
          ctx.fillRect(x, headTopY, 1, headBottomY - headTopY);
        }
      }

      if (proj.dist < 12 && !flash) {
        const eyeSize = Math.max(2, spriteH * 0.04);
        const eyeY = drawStartY + spriteH * 0.12;
        const eyeOffsetX = spriteW * 0.1;
        const ex1 = proj.screenX - eyeOffsetX;
        const ex2 = proj.screenX + eyeOffsetX;
        const eyeColor = def.eyeColor || '#ff2222';
        ctx.fillStyle = eyeColor;
        if (zBuffer[Math.floor(ex1)] > proj.dist) {
          ctx.fillRect(ex1 - eyeSize / 2, eyeY, eyeSize, eyeSize);
        }
        if (zBuffer[Math.floor(ex2)] > proj.dist) {
          ctx.fillRect(ex2 - eyeSize / 2, eyeY, eyeSize, eyeSize);
        }
      }
    }

    if (e.hp < e.maxHp && proj.dist < 24) {
      const barW = spriteW * 0.6;
      const barH = Math.max(2, spriteH * 0.03);
      const barX = proj.screenX - barW / 2;
      // Anchor above the head, but pin to a small top margin so very tall /
      // very close scaled enemies (boss × 2.2) still show their HP bar
      // on-screen instead of drifting off above the canvas.
      const barY = Math.max(2, drawStartY - barH * 2);
      const cx = Math.floor(proj.screenX);
      if (cx >= 0 && cx < W && zBuffer[cx] > proj.dist) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = '#ff3344';
        ctx.fillRect(barX, barY, barW * (e.hp / e.maxHp), barH);
      }
    }
  }

  // Blit a registered image sprite as a billboard, column by column so the
  // z-buffer (walls) and shortDist[] (see-over barricades) clip it correctly.
  // Tinting is applied once into an offscreen buffer so transparent pixels
  // stay transparent — using source-atop directly on the main canvas would
  // bleed the tint into already-drawn walls/sky.
  function drawImageBillboard(sprite, x0, y0, w, h, dist, light, flash, horizon) {
    const sw = sprite.w, sh = sprite.h;
    if (sw === 0 || sh === 0) return;

    if (tintBuf.width !== sw || tintBuf.height !== sh) {
      tintBuf.width = sw;
      tintBuf.height = sh;
    } else {
      tintCtx.clearRect(0, 0, sw, sh);
    }
    tintCtx.imageSmoothingEnabled = false;
    tintCtx.globalCompositeOperation = 'source-over';
    tintCtx.drawImage(sprite.canvas, 0, 0);
    if (flash) {
      tintCtx.globalCompositeOperation = 'source-atop';
      tintCtx.fillStyle = '#ffffff';
      tintCtx.fillRect(0, 0, sw, sh);
    } else if (light < 1) {
      tintCtx.globalCompositeOperation = 'source-atop';
      tintCtx.fillStyle = `rgba(0,0,0,${(1 - light).toFixed(3)})`;
      tintCtx.fillRect(0, 0, sw, sh);
    }
    tintCtx.globalCompositeOperation = 'source-over';

    const xStart = Math.max(0, x0);
    const xEnd = Math.min(W, x0 + w);
    for (let x = xStart; x < xEnd; x++) {
      const u = (x - x0) / w;
      const srcX = Math.min(sw - 1, Math.max(0, Math.floor(u * sw)));
      let dstY1 = y0 + h;
      // Tall opaque wall in front: clip the sprite to the area above the
      // wall's top so the silhouette of a big enemy still pokes over.
      if (zBuffer[x] < dist) dstY1 = Math.min(dstY1, wallTopY[x]);
      // Short cover (sandbag / wreck) in front: hide everything below the
      // horizon line in this column.
      if (dist > shortDist[x]) dstY1 = Math.min(dstY1, horizon);
      if (dstY1 <= y0) continue;
      const dstH = dstY1 - y0;
      const srcH = Math.max(1, Math.floor((dstH / h) * sh));
      ctx.drawImage(tintBuf, srcX, 0, 1, srcH, x, y0, 1, dstH);
    }
  }

  function drawParticle(player, p, horizonOffset, theme) {
    const proj = projectSprite(player, p.x, p.y);
    if (!proj) return;
    const horizon = H / 2 + horizonOffset;
    const drawY = Math.floor(horizon - p.zOffset * H / proj.dist);
    const drawX = proj.screenX;
    const cx = Math.floor(drawX);
    if (cx < 0 || cx >= W) return;
    if (zBuffer[cx] < proj.dist) return;
    if (proj.dist > shortDist[cx] && drawY > horizon) return;
    const fog = Math.min(1, proj.dist / theme.fogDist);

    if (p.text) {
      // Floating damage number: scale font by distance so far hits stay
      // legible without dwarfing close ones, draw a black outline so it
      // reads against bright walls/sprites, and fade by remaining life.
      const baseSize = p.headshot ? 36 : 28;
      const fontSize = Math.max(11, Math.min(48, Math.floor(baseSize / proj.dist * 4)));
      const alpha = Math.min(1, p.life * 1.4) * (1 - fog * 0.4);
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;
      ctx.fillText(p.text, drawX - 1, drawY);
      ctx.fillText(p.text, drawX + 1, drawY);
      ctx.fillText(p.text, drawX, drawY - 1);
      ctx.fillText(p.text, drawX, drawY + 1);
      ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${alpha.toFixed(3)})`;
      ctx.fillText(p.text, drawX, drawY);
      return;
    }

    const sz = Math.max(2, Math.floor(H / proj.dist * p.size * 0.05));
    ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${p.life * (1 - fog * 0.5)})`;
    ctx.fillRect(drawX - sz / 2, drawY - sz / 2, sz, sz);
  }

  function getDimensions() { return { W, H }; }

  return { init, render, getDimensions };
})();
