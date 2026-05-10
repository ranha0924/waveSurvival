// Raycasting renderer with DDA wall projection + sprite billboards
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
    // Use device-pixel-aware sizing but keep moderate render res for performance
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

  function render(player, enemies, particles, bobOffset) {
    // Sky/ceiling
    const ceilGrad = ctx.createLinearGradient(0, 0, 0, H / 2);
    ceilGrad.addColorStop(0, '#0a0a14');
    ceilGrad.addColorStop(1, '#1a1a28');
    ctx.fillStyle = ceilGrad;
    ctx.fillRect(0, 0, W, H / 2);

    // Floor
    const floorGrad = ctx.createLinearGradient(0, H / 2, 0, H);
    floorGrad.addColorStop(0, '#222218');
    floorGrad.addColorStop(1, '#3a3a2a');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, H / 2, W, H / 2);

    // Cast walls
    castWalls(player, bobOffset);

    // Draw sprites (enemies, particles) with z-buffer occlusion
    const sprites = [];
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const dist = dx * dx + dy * dy;
      sprites.push({ x: e.x, y: e.y, dist, type: 'enemy', ref: e });
    }
    for (const p of particles) {
      const dx = p.x - player.x;
      const dy = p.y - player.y;
      const dist = dx * dx + dy * dy;
      sprites.push({ x: p.x, y: p.y, dist, type: 'particle', ref: p });
    }
    sprites.sort((a, b) => b.dist - a.dist);

    for (const s of sprites) {
      if (s.type === 'enemy') drawEnemySprite(player, s.ref, bobOffset);
      else drawParticle(player, s.ref, bobOffset);
    }
  }

  function castWalls(player, bobOffset) {
    const cosA = Math.cos(player.angle);
    const sinA = Math.sin(player.angle);

    for (let x = 0; x < W; x++) {
      const cameraX = 2 * x / W - 1;
      const rayDirX = cosA + (-sinA) * cameraX * Math.tan(FOV / 2);
      const rayDirY = sinA + cosA * cameraX * Math.tan(FOV / 2);

      let mapX = Math.floor(player.x);
      let mapY = Math.floor(player.y);

      const deltaDistX = Math.abs(1 / (rayDirX || 1e-9));
      const deltaDistY = Math.abs(1 / (rayDirY || 1e-9));

      let stepX, stepY, sideDistX, sideDistY;
      if (rayDirX < 0) {
        stepX = -1;
        sideDistX = (player.x - mapX) * deltaDistX;
      } else {
        stepX = 1;
        sideDistX = (mapX + 1.0 - player.x) * deltaDistX;
      }
      if (rayDirY < 0) {
        stepY = -1;
        sideDistY = (player.y - mapY) * deltaDistY;
      } else {
        stepY = 1;
        sideDistY = (mapY + 1.0 - player.y) * deltaDistY;
      }

      let hit = 0, side = 0, wallType = 1;
      let safety = 64;
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
        if (t >= 1 && t <= 4) { hit = 1; wallType = t; }
      }

      // Camera-space depth (no fish-eye correction needed because rayDir = forward + plane*cameraX)
      let perpDist;
      if (side === 0) perpDist = (mapX - player.x + (1 - stepX) / 2) / (rayDirX || 1e-9);
      else perpDist = (mapY - player.y + (1 - stepY) / 2) / (rayDirY || 1e-9);
      perpDist = Math.max(0.0001, perpDist);

      zBuffer[x] = perpDist;

      const lineH = Math.floor(H / perpDist);
      const drawStart = Math.floor(-lineH / 2 + H / 2 + bobOffset);
      const drawEnd = drawStart + lineH;

      const colors = GameMap.getWallColor(wallType);
      const baseColor = side === 1 ? colors.dark : colors.light;
      // Fog/shading by distance
      const fog = Math.min(1, perpDist / 16);
      const c = shadeColor(baseColor, 1 - fog * 0.7);
      ctx.fillStyle = c;
      ctx.fillRect(x, drawStart, 1, drawEnd - drawStart);
    }
  }

  function shadeColor(hex, factor) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const nr = Math.floor(r * factor);
    const ng = Math.floor(g * factor);
    const nb = Math.floor(b * factor);
    return `rgb(${nr},${ng},${nb})`;
  }

  function projectSprite(player, sx, sy) {
    const dx = sx - player.x;
    const dy = sy - player.y;

    // Transform sprite to camera space
    const cosA = Math.cos(-player.angle);
    const sinA = Math.sin(-player.angle);
    const transformX = dx * cosA - dy * sinA;
    const transformY = dx * sinA + dy * cosA;

    if (transformX <= 0.05) return null; // behind player

    const screenX = Math.floor((W / 2) * (1 + transformY / (transformX * Math.tan(FOV / 2))));
    return { screenX, dist: transformX };
  }

  function drawEnemySprite(player, e, bobOffset) {
    const proj = projectSprite(player, e.x, e.y);
    if (!proj) return;

    const spriteH = Math.floor(H / proj.dist);
    const spriteW = spriteH;
    const drawStartY = Math.floor(-spriteH / 2 + H / 2 + bobOffset);
    const drawStartX = proj.screenX - Math.floor(spriteW / 2);

    // Draw enemy body (silhouette + color by type)
    const x0 = Math.max(0, drawStartX);
    const x1 = Math.min(W - 1, drawStartX + spriteW);
    const fog = Math.min(1, proj.dist / 16);

    const def = e.type;
    const bodyColor = shadeColor(def.color, 1 - fog * 0.6);
    const headColor = shadeColor(def.headColor, 1 - fog * 0.6);

    // Hit flash
    const flash = e.hitFlash > 0;

    for (let x = x0; x < x1; x++) {
      if (zBuffer[x] < proj.dist) continue;
      const localX = (x - drawStartX) / spriteW; // 0..1
      const fromCenter = Math.abs(localX - 0.5) * 2; // 0 center, 1 edge
      if (fromCenter > 0.95) continue;

      // Body: lower 70%
      const bodyTop = drawStartY + spriteH * 0.3;
      const bodyBottom = drawStartY + spriteH;
      // Head: upper 30%
      const headTop = drawStartY;
      const headBottom = drawStartY + spriteH * 0.3;

      ctx.fillStyle = flash ? '#ffffff' : bodyColor;
      const bodyW = (1 - fromCenter) * 1;
      if (fromCenter < 0.85) {
        ctx.fillRect(x, bodyTop, 1, bodyBottom - bodyTop);
      }

      // Head smaller
      if (fromCenter < 0.5) {
        ctx.fillStyle = flash ? '#ffffff' : headColor;
        ctx.fillRect(x, headTop, 1, headBottom - headTop);
      }
    }

    // Eyes (simple)
    if (proj.dist < 12 && !flash) {
      const eyeSize = Math.max(2, spriteH * 0.04);
      const eyeY = drawStartY + spriteH * 0.12;
      const eyeOffsetX = spriteW * 0.1;
      const ex1 = proj.screenX - eyeOffsetX;
      const ex2 = proj.screenX + eyeOffsetX;
      if (zBuffer[Math.floor(ex1)] > proj.dist) {
        ctx.fillStyle = def.eyeColor || '#ff2222';
        ctx.fillRect(ex1 - eyeSize/2, eyeY, eyeSize, eyeSize);
      }
      if (zBuffer[Math.floor(ex2)] > proj.dist) {
        ctx.fillStyle = def.eyeColor || '#ff2222';
        ctx.fillRect(ex2 - eyeSize/2, eyeY, eyeSize, eyeSize);
      }
    }

    // HP bar above head
    if (e.hp < e.maxHp && proj.dist < 20) {
      const barW = spriteW * 0.6;
      const barH = Math.max(2, spriteH * 0.03);
      const barX = proj.screenX - barW / 2;
      const barY = drawStartY - barH * 2;
      // Check zbuffer center
      const cx = Math.floor(proj.screenX);
      if (cx >= 0 && cx < W && zBuffer[cx] > proj.dist) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = '#ff3344';
        ctx.fillRect(barX, barY, barW * (e.hp / e.maxHp), barH);
      }
    }
  }

  function drawParticle(player, p, bobOffset) {
    const proj = projectSprite(player, p.x, p.y);
    if (!proj) return;
    const sz = Math.max(2, Math.floor(H / proj.dist * p.size * 0.05));
    const drawY = Math.floor(H / 2 + bobOffset - p.zOffset * H / proj.dist);
    const drawX = proj.screenX;
    const cx = Math.floor(drawX);
    if (cx < 0 || cx >= W) return;
    if (zBuffer[cx] < proj.dist) return;
    const fog = Math.min(1, proj.dist / 16);
    ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${p.life * (1 - fog * 0.5)})`;
    ctx.fillRect(drawX - sz / 2, drawY - sz / 2, sz, sz);
  }

  function getDimensions() { return { W, H }; }

  return { init, render, getDimensions };
})();
