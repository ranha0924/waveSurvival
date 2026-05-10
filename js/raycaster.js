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
  const FOV = Math.PI / 3; // 60deg

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

    if (isTouch) {
      // Cap aspect at 16:9 so portrait phones don't inflate the vertical FOV
      // (wallH = H/dist) and turn walls into giant slabs. Letterbox the
      // unused area; cap pixel width for performance.
      const maxAspect = 16 / 9;
      let fitW, fitH;
      if (winW / winH < maxAspect) {
        fitW = winW;
        fitH = winW / maxAspect;
      } else {
        fitH = Math.min(winH, winW / maxAspect);
        fitW = fitH * maxAspect;
      }
      const maxRenderW = 960;
      const scale = Math.min(1, maxRenderW / fitW);
      canvas.width = Math.floor(fitW * scale);
      canvas.height = Math.floor(fitH * scale);
      canvas.style.width = Math.round(fitW) + 'px';
      canvas.style.height = Math.round(fitH) + 'px';
    } else {
      // Desktop: keep filling the viewport like before.
      canvas.width = Math.min(winW, 1280);
      canvas.height = Math.min(winH, 800);
      canvas.style.width = winW + 'px';
      canvas.style.height = winH + 'px';
    }

    W = canvas.width;
    H = canvas.height;
    zBuffer = new Float32Array(W);
    shortDist = new Float32Array(W);
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
    sprites.sort((a, b) => b.dist - a.dist);

    for (const s of sprites) {
      if (s.type === 'enemy') drawEnemySprite(player, s.ref, horizonOffset, theme);
      else drawParticle(player, s.ref, horizonOffset, theme);
    }
  }

  function drawSky(theme, horizonOffset) {
    const horizon = H / 2 + horizonOffset;
    // Over-paint past the canvas edges so the camera-shake translate never
    // exposes uncleared pixels along the borders.
    const M = 64;
    const top = -M;
    const grad = ctx.createLinearGradient(0, top, 0, horizon);
    grad.addColorStop(0, theme.skyTop);
    grad.addColorStop(0.6, theme.skyMid);
    grad.addColorStop(1, theme.skyBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(-M, -M, W + 2 * M, Math.max(0, horizon) + M);
  }

  function drawFloor(theme, horizonOffset) {
    const horizon = H / 2 + horizonOffset;
    if (horizon >= H) return;
    const M = 64;
    const grad = ctx.createLinearGradient(0, horizon, 0, H + M);
    grad.addColorStop(0, theme.floorFar);
    grad.addColorStop(1, theme.floorNear);
    ctx.fillStyle = grad;
    ctx.fillRect(-M, horizon, W + 2 * M, H - horizon + M);
  }

  function castWalls(player, horizonOffset, theme) {
    const cosA = Math.cos(player.angle);
    const sinA = Math.sin(player.angle);
    const tanFov = Math.tan(FOV / 2);
    const fogDist = theme.fogDist;
    const ambient = theme.ambient;
    const horizon = H / 2 + horizonOffset;

    for (let i = 0; i < W; i++) shortDist[i] = Infinity;

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

      // Walk the ray. Short walls (type 5 sandbags) are recorded but do not
      // terminate the cast — the world behind them must still render so the
      // player can see over the barricade.
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
        let perpDist;
        if (side === 0) perpDist = (mapX - player.x + (1 - stepX) / 2) / (rayDirX || 1e-9);
        else perpDist = (mapY - player.y + (1 - stepY) / 2) / (rayDirY || 1e-9);
        perpDist = Math.max(0.0001, perpDist);
        if (t === 5) {
          shortHits.push({ wallType: t, perpDist, side });
        } else {
          tallHit = { wallType: t, perpDist, side };
          break;
        }
      }

      // Sprites should be visible over short walls, so the z-buffer tracks
      // only the nearest opaque (tall) wall.
      zBuffer[x] = tallHit ? tallHit.perpDist : 1e6;

      if (tallHit) {
        const lineH = Math.floor(H / tallHit.perpDist);
        const drawStart = Math.floor(horizon - lineH / 2);
        const drawEnd = drawStart + lineH;
        const wallU = tallHit.side === 0
          ? (player.y + tallHit.perpDist * rayDirY)
          : (player.x + tallHit.perpDist * rayDirX);
        drawWallColumn(x, drawStart, drawEnd, tallHit.wallType, tallHit.side, tallHit.perpDist, wallU, fogDist, ambient);
      }

      // Short walls render half-height (sitting on the floor), far→near so
      // closer barricades overdraw farther ones.
      let nearestShortVisible = Infinity;
      const shortTopY = Math.floor(horizon);
      for (let i = shortHits.length - 1; i >= 0; i--) {
        const h = shortHits[i];
        if (tallHit && h.perpDist >= tallHit.perpDist) continue;
        if (h.perpDist < nearestShortVisible) nearestShortVisible = h.perpDist;
        const halfH = Math.floor(H / h.perpDist / 2);
        const drawStart = shortTopY;
        const drawEnd = drawStart + halfH;
        const wallU = h.side === 0
          ? (player.y + h.perpDist * rayDirY)
          : (player.x + h.perpDist * rayDirX);
        drawWallColumn(x, drawStart, drawEnd, h.wallType, h.side, h.perpDist, wallU, fogDist, ambient);
      }
      shortDist[x] = nearestShortVisible;
    }
  }

  function drawWallColumn(x, y0, y1, type, side, dist, wallU, fogDist, ambient) {
    const colors = GameMap.getWallColor(type);
    const baseColor = side === 1 ? colors.dark : colors.light;
    const fog = Math.min(1, dist / fogDist);
    const lightFactor = ambient * (1 - fog * 0.7);
    ctx.fillStyle = shadeColor(baseColor, lightFactor);
    ctx.fillRect(x, y0, 1, y1 - y0);
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
    const spriteH = Math.floor(H / proj.dist);
    const spriteW = spriteH;
    const drawStartY = Math.floor(horizon - spriteH / 2);
    const drawStartX = proj.screenX - Math.floor(spriteW / 2);

    const x0 = Math.max(0, drawStartX);
    const x1 = Math.min(W - 1, drawStartX + spriteW);
    const fog = Math.min(1, proj.dist / theme.fogDist);
    const lightFactor = theme.ambient * (1 - fog * 0.6);

    const def = e.type;
    const bodyColor = shadeColor(def.color, lightFactor);
    const headColor = shadeColor(def.headColor, lightFactor);
    const flash = e.hitFlash > 0;

    for (let x = x0; x < x1; x++) {
      if (zBuffer[x] < proj.dist) continue;
      const localX = (x - drawStartX) / spriteW;
      const fromCenter = Math.abs(localX - 0.5) * 2;
      if (fromCenter > 0.95) continue;

      const bodyTop = drawStartY + spriteH * 0.3;
      let bodyBottom = drawStartY + spriteH;
      const headTop = drawStartY;
      const headBottom = drawStartY + spriteH * 0.3;

      // If a short (see-over) wall stands between the player and this sprite
      // in this column, clip the body at the horizon line — only the upper
      // body should peek above the barricade.
      if (proj.dist > shortDist[x]) bodyBottom = Math.min(bodyBottom, horizon);

      ctx.fillStyle = flash ? '#ffffff' : bodyColor;
      if (fromCenter < 0.85 && bodyBottom > bodyTop) {
        ctx.fillRect(x, bodyTop, 1, bodyBottom - bodyTop);
      }
      if (fromCenter < 0.5) {
        ctx.fillStyle = flash ? '#ffffff' : headColor;
        ctx.fillRect(x, headTop, 1, headBottom - headTop);
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

    if (e.hp < e.maxHp && proj.dist < 24) {
      const barW = spriteW * 0.6;
      const barH = Math.max(2, spriteH * 0.03);
      const barX = proj.screenX - barW / 2;
      const barY = drawStartY - barH * 2;
      const cx = Math.floor(proj.screenX);
      if (cx >= 0 && cx < W && zBuffer[cx] > proj.dist) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = '#ff3344';
        ctx.fillRect(barX, barY, barW * (e.hp / e.maxHp), barH);
      }
    }
  }

  function drawParticle(player, p, horizonOffset, theme) {
    const proj = projectSprite(player, p.x, p.y);
    if (!proj) return;
    const horizon = H / 2 + horizonOffset;
    const sz = Math.max(2, Math.floor(H / proj.dist * p.size * 0.05));
    const drawY = Math.floor(horizon - p.zOffset * H / proj.dist);
    const drawX = proj.screenX;
    const cx = Math.floor(drawX);
    if (cx < 0 || cx >= W) return;
    if (zBuffer[cx] < proj.dist) return;
    if (proj.dist > shortDist[cx] && drawY > horizon) return;
    const fog = Math.min(1, proj.dist / theme.fogDist);
    ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${p.life * (1 - fog * 0.5)})`;
    ctx.fillRect(drawX - sz / 2, drawY - sz / 2, sz, sz);
  }

  function getDimensions() { return { W, H }; }

  return { init, render, getDimensions };
})();
