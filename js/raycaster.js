// Raycasting renderer with DDA wall projection + sprite billboards.
// Outdoor variant: theme-driven sky, skyline silhouettes, textured walls,
// long draw distance, atmospheric darkness/fog.
const Raycaster = (() => {
  let canvas, ctx;
  let W, H;
  let zBuffer;
  const FOV = Math.PI / 3; // 60deg

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    const targetW = Math.min(window.innerWidth, 1280);
    const targetH = Math.min(window.innerHeight, 800);
    canvas.width = Math.floor(targetW);
    canvas.height = Math.floor(targetH);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    W = canvas.width;
    H = canvas.height;
    zBuffer = new Float32Array(W);
  }

  function render(player, enemies, particles, horizonOffset, theme) {
    theme = theme || Environment.themeForWave(1);

    drawSky(theme, horizonOffset);
    drawClouds(player, theme, horizonOffset);
    drawSkyline(player, theme, horizonOffset);
    drawFloor(theme, horizonOffset);

    castWalls(player, horizonOffset, theme);

    drawSmokeColumns(player, theme, horizonOffset);

    // Sprite pass: enemies, particles, dust.
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
    const dust = Environment.getDust();
    for (const d of dust) {
      const dx = d.x - player.x, dy = d.y - player.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 400) continue;
      sprites.push({ x: d.x, y: d.y, dist: d2, type: 'dust', ref: d });
    }
    sprites.sort((a, b) => b.dist - a.dist);

    for (const s of sprites) {
      if (s.type === 'enemy') drawEnemySprite(player, s.ref, horizonOffset, theme);
      else if (s.type === 'particle') drawParticle(player, s.ref, horizonOffset, theme);
      else drawDust(player, s.ref, horizonOffset, theme);
    }

    // Lightning + global darkness pass.
    const lf = Environment.getLightningFlash();
    if (lf > 0) {
      ctx.fillStyle = `rgba(220, 230, 255, ${Math.min(0.55, lf * 0.5)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (theme.darkness > 0 && lf < 0.4) {
      ctx.fillStyle = `rgba(0, 0, 8, ${theme.darkness * 0.55})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawSky(theme, horizonOffset) {
    const horizon = H / 2 + horizonOffset;
    const top = Math.max(0, horizon - H);
    const grad = ctx.createLinearGradient(0, top, 0, horizon);
    grad.addColorStop(0, theme.skyTop);
    grad.addColorStop(0.6, theme.skyMid);
    grad.addColorStop(1, theme.skyBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, Math.max(0, horizon));
  }

  function drawFloor(theme, horizonOffset) {
    const horizon = H / 2 + horizonOffset;
    if (horizon >= H) return;
    const grad = ctx.createLinearGradient(0, horizon, 0, H);
    grad.addColorStop(0, theme.floorFar);
    grad.addColorStop(1, theme.floorNear);
    ctx.fillStyle = grad;
    ctx.fillRect(0, horizon, W, H - horizon);
  }

  function drawClouds(player, theme, horizonOffset) {
    const horizon = H / 2 + horizonOffset;
    const clouds = Environment.getClouds();
    const halfFov = FOV / 2;
    const c = theme.cloudColor;
    for (const cloud of clouds) {
      // Angular distance from camera direction, normalized to [-π, π]
      let da = cloud.angle - player.angle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) > halfFov + cloud.width) continue;
      const screenX = W / 2 + (da / halfFov) * (W / 2);
      const cloudW = (cloud.width / halfFov) * (W / 2);
      const cloudH = cloud.height * H;
      const cy = horizon - cloud.height * H * 1.2 - cloudH / 2;
      const grad = ctx.createRadialGradient(screenX, cy, 4, screenX, cy, cloudW);
      const alpha = theme.cloudAlpha * cloud.opacityJitter;
      grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${alpha})`);
      grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(screenX, cy, cloudW, cloudH, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSkyline(player, theme, horizonOffset) {
    const horizon = H / 2 + horizonOffset;
    if (horizon <= 0) return;
    const halfFov = FOV / 2;
    // Far mountain layer
    ctx.fillStyle = theme.skylineFar;
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    for (let x = 0; x <= W; x += 4) {
      const a = player.angle + ((x / W) - 0.5) * FOV;
      const h = Environment.silhouetteHeightFar(a);
      ctx.lineTo(x, horizon - h);
    }
    ctx.lineTo(W, horizon);
    ctx.closePath();
    ctx.fill();

    // Mid ruins / antennae layer
    ctx.fillStyle = theme.skylineMid;
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    for (let x = 0; x <= W; x += 3) {
      const a = player.angle + ((x / W) - 0.5) * FOV;
      const h = Environment.silhouetteHeightMid(a);
      ctx.lineTo(x, horizon - h);
    }
    ctx.lineTo(W, horizon);
    ctx.closePath();
    ctx.fill();
  }

  function castWalls(player, horizonOffset, theme) {
    const cosA = Math.cos(player.angle);
    const sinA = Math.sin(player.angle);
    const tanFov = Math.tan(FOV / 2);
    const fogDist = theme.fogDist;
    const ambient = theme.ambient;
    const horizon = H / 2 + horizonOffset;

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

      let hit = 0, side = 0, wallType = 1;
      let safety = 96;
      while (!hit && safety-- > 0) {
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
        if (t >= 1 && t <= 8) { hit = 1; wallType = t; }
      }
      if (!hit) { zBuffer[x] = 1e6; continue; }

      let perpDist;
      if (side === 0) perpDist = (mapX - player.x + (1 - stepX) / 2) / (rayDirX || 1e-9);
      else perpDist = (mapY - player.y + (1 - stepY) / 2) / (rayDirY || 1e-9);
      perpDist = Math.max(0.0001, perpDist);

      zBuffer[x] = perpDist;

      // Sandbag walls render at half height for a low-cover look.
      const heightScale = wallType === 5 ? 0.55 : 1.0;
      const lineH = Math.floor(H / perpDist) * heightScale;
      const drawStart = Math.floor(horizon - lineH / 2 + (1 - heightScale) * (H / perpDist) / 2);
      const drawEnd = drawStart + lineH;

      // World-space coordinate along the wall surface, used for texture sampling.
      const wallU = side === 0
        ? (player.y + perpDist * rayDirY)
        : (player.x + perpDist * rayDirX);

      drawWallColumn(x, drawStart, drawEnd, wallType, side, perpDist, wallU, fogDist, ambient);
    }
  }

  function drawWallColumn(x, y0, y1, type, side, dist, wallU, fogDist, ambient) {
    const colors = GameMap.getWallColor(type);
    const baseLight = side === 1 ? colors.dark : colors.light;
    const baseDark = colors.dark;
    const fog = Math.min(1, dist / fogDist);
    const lightFactor = ambient * (1 - fog * 0.7);

    const pattern = colors.pattern;
    const colLight = shadeColor(baseLight, lightFactor);
    const colDark = shadeColor(baseDark, lightFactor);

    const colHeight = y1 - y0;

    if (pattern === 'corrugated') {
      // Vertical ridges; pick color from sub-stripe based on wallU.
      const stripe = Math.floor(wallU * 6);
      const phase = (Math.sin(stripe * 1.7) + 1) * 0.5; // 0..1 deterministic
      const f = 0.7 + phase * 0.4;
      ctx.fillStyle = shadeColor(side === 1 ? baseDark : baseLight, lightFactor * f);
      ctx.fillRect(x, y0, 1, colHeight);
      // Rust streaks every few stripes
      if ((stripe % 4) === 0) {
        ctx.fillStyle = `rgba(80,40,20,${0.25 * (1 - fog * 0.6)})`;
        ctx.fillRect(x, y0, 1, colHeight);
      }
      return;
    }

    if (pattern === 'rivet') {
      ctx.fillStyle = colLight;
      ctx.fillRect(x, y0, 1, colHeight);
      // Rivet rows at periodic Y intervals (in screen space, scaled by lineH).
      const rivetSpacing = colHeight / 5;
      for (let i = 1; i < 5; i++) {
        const rivetY = y0 + i * rivetSpacing;
        // Rivet column phase varies along wallU for visual variety.
        const phase = Math.floor(wallU * 4) % 2;
        if (((i + phase) % 2) === 0) {
          ctx.fillStyle = colDark;
          ctx.fillRect(x, Math.floor(rivetY), 1, Math.max(1, Math.floor(colHeight * 0.04)));
        }
      }
      return;
    }

    if (pattern === 'sandbag') {
      // Horizontal bands.
      const bands = 4;
      const bandH = colHeight / bands;
      for (let i = 0; i < bands; i++) {
        const yy = y0 + i * bandH;
        const f = (i % 2 === 0) ? 1.0 : 0.78;
        ctx.fillStyle = shadeColor(side === 1 ? baseDark : baseLight, lightFactor * f);
        ctx.fillRect(x, Math.floor(yy), 1, Math.ceil(bandH));
      }
      // Stitch line at top of every band: subtle dark pixel.
      ctx.fillStyle = colDark;
      for (let i = 1; i < bands; i++) {
        ctx.fillRect(x, Math.floor(y0 + i * bandH), 1, 1);
      }
      return;
    }

    if (pattern === 'hazard') {
      // Diagonal yellow/black stripes; phase by (wallU + screen x).
      const stripe = Math.floor((wallU * 4 + x * 0.02)) % 2;
      const c = stripe === 0 ? '#d4b020' : '#16140a';
      ctx.fillStyle = shadeColor(c, lightFactor);
      ctx.fillRect(x, y0, 1, colHeight);
      return;
    }

    if (pattern === 'concrete') {
      ctx.fillStyle = colLight;
      ctx.fillRect(x, y0, 1, colHeight);
      // Crack noise (deterministic): a few darker pixels per column.
      const seed = Math.abs(Math.sin(wallU * 12.9898 + side * 78.233)) * 43758.5453;
      const cracks = (seed % 3) | 0;
      for (let i = 0; i < cracks; i++) {
        const yy = y0 + ((seed * (i + 1)) % colHeight);
        ctx.fillStyle = colDark;
        ctx.fillRect(x, Math.floor(yy), 1, Math.max(1, Math.floor(colHeight * 0.05)));
      }
      // Moss tint at base
      const baseStart = y1 - colHeight * 0.18;
      ctx.fillStyle = `rgba(40,70,40,${0.35 * ambient})`;
      ctx.fillRect(x, Math.floor(baseStart), 1, Math.ceil(y1 - baseStart));
      return;
    }

    if (pattern === 'stone') {
      // Mottled gray with a faint horizontal split.
      ctx.fillStyle = colLight;
      ctx.fillRect(x, y0, 1, colHeight);
      const seed = (Math.sin(wallU * 7.13 + side * 3.17) + 1) * 0.5;
      ctx.fillStyle = `rgba(0,0,0,${0.08 + seed * 0.18})`;
      ctx.fillRect(x, y0, 1, colHeight);
      return;
    }

    if (pattern === 'vehicle') {
      ctx.fillStyle = colLight;
      ctx.fillRect(x, y0, 1, colHeight);
      // Black wheel suggestion at the bottom.
      const wheelTop = y0 + colHeight * 0.78;
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(x, Math.floor(wheelTop), 1, Math.ceil(y1 - wheelTop));
      return;
    }

    if (pattern === 'steel') {
      ctx.fillStyle = colLight;
      ctx.fillRect(x, y0, 1, colHeight);
      // Vertical highlight at center
      const phase = Math.abs(Math.sin(wallU * 3.0));
      if (phase > 0.92) {
        ctx.fillStyle = `rgba(180,200,220,${0.2 * ambient})`;
        ctx.fillRect(x, y0, 1, colHeight);
      }
      return;
    }

    // Fallback flat fill
    ctx.fillStyle = colLight;
    ctx.fillRect(x, y0, 1, colHeight);
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
      const bodyBottom = drawStartY + spriteH;
      const headTop = drawStartY;
      const headBottom = drawStartY + spriteH * 0.3;

      ctx.fillStyle = flash ? '#ffffff' : bodyColor;
      if (fromCenter < 0.85) ctx.fillRect(x, bodyTop, 1, bodyBottom - bodyTop);
      if (fromCenter < 0.5) {
        ctx.fillStyle = flash ? '#ffffff' : headColor;
        ctx.fillRect(x, headTop, 1, headBottom - headTop);
      }
    }

    // Eyes — boosted glow on dark themes for visibility.
    const eyeBoost = theme.darkness > 0.4 ? 1.0 : 0.0;
    if (proj.dist < 16 && !flash) {
      const eyeSize = Math.max(2, spriteH * (0.04 + eyeBoost * 0.04));
      const eyeY = drawStartY + spriteH * 0.12;
      const eyeOffsetX = spriteW * 0.1;
      const ex1 = proj.screenX - eyeOffsetX;
      const ex2 = proj.screenX + eyeOffsetX;
      const eyeColor = def.eyeColor || '#ff2222';
      const drawEye = (cx) => {
        if (cx < 0 || cx >= W) return;
        if (zBuffer[Math.floor(cx)] <= proj.dist) return;
        if (eyeBoost > 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = eyeColor;
          ctx.beginPath();
          ctx.arc(cx, eyeY, eyeSize * 1.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.fillStyle = eyeColor;
        ctx.fillRect(cx - eyeSize / 2, eyeY, eyeSize, eyeSize);
      };
      drawEye(ex1);
      drawEye(ex2);
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
    const fog = Math.min(1, proj.dist / theme.fogDist);
    ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${p.life * (1 - fog * 0.5)})`;
    ctx.fillRect(drawX - sz / 2, drawY - sz / 2, sz, sz);
  }

  function drawDust(player, d, horizonOffset, theme) {
    const proj = projectSprite(player, d.x, d.y);
    if (!proj) return;
    const horizon = H / 2 + horizonOffset;
    const cx = Math.floor(proj.screenX);
    if (cx < 0 || cx >= W) return;
    if (zBuffer[cx] < proj.dist) return;
    const sz = Math.max(1, Math.floor(2 * d.size / proj.dist * 4));
    const drawY = Math.floor(horizon + (Math.sin(d.life * 4) * 0.15) * H / proj.dist);
    const fog = Math.min(1, proj.dist / theme.fogDist);
    const a = 0.25 * (1 - fog) * theme.ambient;
    ctx.fillStyle = `rgba(220, 200, 170, ${a})`;
    ctx.fillRect(proj.screenX - sz / 2, drawY - sz / 2, sz, sz);
  }

  function drawSmokeColumns(player, theme, horizonOffset) {
    const horizon = H / 2 + horizonOffset;
    const halfFov = FOV / 2;
    const cols = Environment.getSmokeColumns();
    for (const sm of cols) {
      let da = sm.worldAngle - player.angle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) > halfFov + 0.3) continue;
      const screenX = W / 2 + (da / halfFov) * (W / 2);
      // Smoke column rises from horizon up. Width ~ 30-50px, height ~ H * 0.3.
      const colH = H * 0.32 * sm.intensity;
      const colW = 32 + 24 * sm.intensity;
      const c = sm.color;
      const grad = ctx.createLinearGradient(screenX, horizon, screenX, horizon - colH);
      grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]}, ${0.55 * theme.ambient})`);
      grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(screenX, horizon - colH * 0.5, colW * 0.7, colH * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function getDimensions() { return { W, H }; }

  return { init, render, getDimensions };
})();
