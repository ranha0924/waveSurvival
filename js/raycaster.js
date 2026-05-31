// Raycasting renderer with DDA wall projection + sprite billboards.
// Outdoor variant: theme-driven sky, textured walls, long draw distance,
// atmospheric darkness/fog.
const Raycaster = (() => {
  // ---------- State ----------
  const FOV = Math.PI / 3; // 60deg

  let canvas, ctx;
  let W, H;

  // Per-column depth + clipping buffers. Filled by castWalls each frame and
  // consumed by sprite rendering so enemies clip against walls correctly.
  //   zBuffer  : distance to the nearest OPAQUE wall in this column
  //   shortDist: distance to the nearest SEE-OVER wall (sandbag, wreck)
  //   wallTopY : screen-Y of the opaque wall's TOP, so a tall enemy can still
  //              poke above a shorter wall instead of being fully hidden
  let zBuffer, shortDist, wallTopY;

  // Offscreen buffer used to apply per-frame fog/flash tint to image sprites
  // before blitting them column-by-column. Reused across enemies; resized
  // on demand to match the source sprite's native dimensions.
  const tintBuf = document.createElement('canvas');
  const tintCtx = tintBuf.getContext('2d');

  // Pre-baked decoration assets. Built lazily so script-load order doesn't
  // matter; seeded so positions stay stable run-to-run.
  let concreteTile = null;       // small repeating concrete texture
  let concreteTileData = null;   // cached Uint8ClampedArray for per-pixel reads
  let starField = null;          // [{u,v,size,twinkleRate,twinklePhase,baseAlpha}]

  // Reusable buffer for the floor cast. castFloor overwrites every pixel each
  // frame, so we use createImageData (no GPU→CPU readback) and reuse the
  // same Uint8ClampedArray across frames — getImageData + reallocation per
  // frame was the bottleneck that made the game unplayable on lower-end
  // machines.
  let floorBuf = null;
  let floorBufW = 0;
  let floorBufH = 0;

  // ---------- Init / resize ----------
  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    resize();
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
    floorBuf = null;
    if (ctx) ctx.imageSmoothingEnabled = false;
  }

  // ---------- Frame orchestration ----------
  function render(player, enemies, particles, horizonOffset, theme) {
    theme = theme || Environment.themeForWave(1);

    // Sky pass is fully detached from the player's pitch + bob so the
    // backdrop (gradient, stars) stays painted-on-screen regardless of camera
    // direction. The floor still tracks the real horizon so the world below
    // the eye line bobs / tilts naturally.
    drawSky(theme, player);
    drawFloor(player, theme, horizonOffset);
    castWalls(player, horizonOffset, theme);
    drawSprites(player, enemies, particles, horizonOffset, theme);
  }

  // Collect every billboarded thing in the world, sort far→near so closer
  // sprites overdraw farther ones, then dispatch to its type-specific draw.
  // Trees are static decoration from Environment — added to the same pool
  // so they z-sort against enemies/pickups/particles correctly.
  function drawSprites(player, enemies, particles, horizonOffset, theme) {
    const sprites = [];
    const push = (x, y, type, ref) => {
      const dx = x - player.x, dy = y - player.y;
      sprites.push({ dist: dx * dx + dy * dy, type, ref });
    };
    for (const e of enemies) {
      if (e.alive) push(e.x, e.y, 'enemy', e);
    }
    for (const p of particles) push(p.x, p.y, 'particle', p);
    if (typeof Pickups !== 'undefined') {
      for (const k of Pickups.getList()) push(k.x, k.y, 'pickup', k);
    }
    if (typeof Environment !== 'undefined' && Environment.getTrees) {
      // Cull trees past the fog: they fade to nothing anyway, so skip the
      // projection + sort cost for the hundreds ringing the map.
      const maxTreeD2 = Math.pow((theme.fogDist || 18) * 1.45, 2);
      for (const t of Environment.getTrees()) {
        const dx = t.x - player.x, dy = t.y - player.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > maxTreeD2) continue;
        sprites.push({ dist: d2, type: 'tree', ref: t });
      }
    }
    if (typeof Environment !== 'undefined' && Environment.getFlags) {
      for (const f of Environment.getFlags()) push(f.x, f.y, 'flag', f);
    }
    if (typeof Environment !== 'undefined' && Environment.getProps) {
      for (const p of Environment.getProps()) push(p.x, p.y, 'prop', p);
    }
    if (typeof Environment !== 'undefined' && Environment.getGrass) {
      // Grass is low to the ground and small, so cull it tighter than trees —
      // distant tufts vanish into the soil anyway and there are a lot of them.
      const maxGrassD2 = Math.pow((theme.fogDist || 16) * 0.9, 2);
      for (const g of Environment.getGrass()) {
        const dx = g.x - player.x, dy = g.y - player.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > maxGrassD2) continue;
        sprites.push({ dist: d2, type: 'grass', ref: g });
      }
    }
    sprites.sort((a, b) => b.dist - a.dist);

    for (const s of sprites) {
      if (s.type === 'enemy') drawEnemySprite(player, s.ref, horizonOffset, theme);
      else if (s.type === 'pickup') drawPickupSprite(player, s.ref, horizonOffset, theme);
      else if (s.type === 'tree') drawTreeSprite(player, s.ref, horizonOffset, theme);
      else if (s.type === 'flag') drawFlagSprite(player, s.ref, horizonOffset, theme);
      else if (s.type === 'prop') drawPropSprite(player, s.ref, horizonOffset, theme);
      else if (s.type === 'grass') drawGrassSprite(player, s.ref, horizonOffset, theme);
      else drawParticle(player, s.ref, horizonOffset, theme);
    }
  }

  // Ground grass tufts — small floor decoration anchored with its base on the
  // floor, like a short prop. No collision; wall zBuffer clipping still applies
  // so a tuft behind a wall stays hidden. Fades into the haze with distance.
  function drawGrassSprite(player, g, horizonOffset, theme) {
    const proj = projectSprite(player, g.x, g.y);
    if (!proj) return;
    const canvas = Environment.getGrassCanvas(g.variant);
    if (!canvas) return;
    const horizon = H / 2 + horizonOffset;
    const lineH = H / proj.dist;
    const aspect = canvas.width / canvas.height;
    const grassH = Math.max(2, Math.floor(lineH * 0.42 * (g.scale || 1)));
    const grassW = Math.max(2, Math.floor(grassH * aspect));
    const groundedBottom = horizon + lineH / 2;
    const drawStartY = Math.floor(groundedBottom - grassH);
    const drawStartX = Math.floor(proj.screenX - grassW / 2);
    const fogD = (theme && theme.fogDist) || 16;
    const fade = Math.max(0, Math.min(1, 1 - (proj.dist - fogD * 0.35) / (fogD * 0.65)));
    if (fade <= 0.02) return;
    blitBillboard(canvas, drawStartX, drawStartY, grassW, grassH, proj.dist, fade, g.flip);
  }

  // Shared billboard blitter. The classic raycaster path blits one 1px column
  // per drawImage so per-column wall clipping works — but with hundreds of
  // trees that's tens of thousands of drawImage calls a frame and tanks the
  // frame rate. When no wall in the sprite's column span is nearer than the
  // sprite (the common open case), we draw the whole thing in ONE drawImage;
  // only genuinely wall-clipped sprites fall back to the per-column path.
  function blitBillboard(src, x0, y0, w, h, dist, alpha, flip) {
    if (w <= 0 || h <= 0) return;
    const sw = src.width, sh = src.height;
    if (!sw || !sh) return;
    const xStart = Math.max(0, x0);
    const xEnd = Math.min(W, x0 + w);
    if (xEnd <= xStart) return;

    let clipped = false;
    for (let x = xStart; x < xEnd; x++) {
      if (zBuffer[x] < dist) { clipped = true; break; }
    }

    const prevAlpha = ctx.globalAlpha;
    if (alpha !== 1) ctx.globalAlpha = alpha;

    if (!clipped) {
      if (flip) {
        ctx.save();
        ctx.translate(x0 + w, y0);
        ctx.scale(-1, 1);
        ctx.drawImage(src, 0, 0, sw, sh, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(src, 0, 0, sw, sh, x0, y0, w, h);
      }
    } else {
      for (let x = xStart; x < xEnd; x++) {
        let dstY1 = y0 + h;
        if (zBuffer[x] < dist) dstY1 = Math.min(dstY1, wallTopY[x]);
        if (dstY1 <= y0) continue;
        let u = (x - x0) / w;
        if (flip) u = 1 - u;
        const srcX = Math.min(sw - 1, Math.max(0, Math.floor(u * sw)));
        const dstH = dstY1 - y0;
        const srcH = Math.max(1, Math.floor((dstH / h) * sh));
        ctx.drawImage(src, srcX, 0, 1, srcH, x, y0, 1, dstH);
      }
    }

    if (alpha !== 1) ctx.globalAlpha = prevAlpha;
  }

  // Shrine prop billboards — jars, spirit poles, straw bundles, rubble and
  // stone cairns. Each is a shaped sprite (transparent background) anchored
  // with its base on the floor at the projected distance, so it reads as a
  // real object instead of a square tile. Per-type height factor mirrors the
  // old wallShapes heights; width follows the canvas aspect. Wall zBuffer
  // clipping still applies so a prop behind the hall is hidden correctly,
  // while prop-vs-sprite overlap is resolved by the far→near paint order
  // (giving free "see over the jar at its head" behaviour).
  const PROP_HEIGHT = { 3: 0.72, 5: 0.62, 6: 0.50, 7: 2.20, 8: 0.80 };
  function drawPropSprite(player, p, horizonOffset, theme) {
    const proj = projectSprite(player, p.x, p.y);
    if (!proj) return;
    const canvas = Environment.getPropCanvas(p.type);
    if (!canvas) return;
    const horizon = H / 2 + horizonOffset;
    const lineH = H / proj.dist;
    const aspect = canvas.width / canvas.height;
    const hf = PROP_HEIGHT[p.type] || 0.7;
    const propH = Math.max(2, Math.floor(lineH * hf * (p.scale || 1)));
    const propW = Math.max(2, Math.floor(propH * aspect));
    const groundedBottom = horizon + lineH / 2;
    const drawStartY = Math.floor(groundedBottom - propH);
    const drawStartX = Math.floor(proj.screenX - propW / 2);
    // Gentle distance fade so far props melt into the haze; near cover stays
    // solid (fade is 1 until half the fog distance).
    const fogD = (theme && theme.fogDist) || 16;
    const fade = Math.max(0, Math.min(1, 1 - (proj.dist - fogD * 0.5) / fogD));
    if (fade <= 0.02) return;
    blitBillboard(canvas, drawStartX, drawStartY, propW, propH, proj.dist, fade, p.flip);
  }

  // 오방기 sprite. Drawn taller than a tree (1.9× wall column) so the
  // pole reaches the eaves of the main hall in the background. Same
  // column-by-column blit with zBuffer clipping as the tree path; no
  // distance fade because the player should always see the flags
  // clearly when in the courtyard.
  function drawFlagSprite(player, f, horizonOffset, theme) {
    const proj = projectSprite(player, f.x, f.y);
    if (!proj) return;
    const canvas = Environment.getFlagCanvas();
    if (!canvas) return;
    const horizon = H / 2 + horizonOffset;
    const lineH = H / proj.dist;
    const aspect = canvas.width / canvas.height;
    const flagH = Math.floor(lineH * 1.9 * (f.scale || 1));
    const flagW = Math.floor(flagH * aspect);
    const groundedBottom = horizon + lineH / 2;
    const drawStartY = Math.floor(groundedBottom - flagH);
    const drawStartX = Math.floor(proj.screenX - flagW / 2);
    blitBillboard(canvas, drawStartX, drawStartY, flagW, flagH, proj.dist, 1, false);
  }

  // Tree billboards. Behave like pickups (column-by-column with zBuffer
  // clipping) but anchored such that the trunk base sits on the floor at
  // the projected distance — bottom of the sprite goes at horizon + lineH/2,
  // top at horizon + lineH/2 - treeH. Per-tile scale variance keeps them
  // from looking like a cloned forest.
  function drawTreeSprite(player, t, horizonOffset, theme) {
    const proj = projectSprite(player, t.x, t.y);
    if (!proj) return;
    const canvas = Environment.getTreeCanvas(t.variant);
    if (!canvas) return;

    const horizon = H / 2 + horizonOffset;
    const lineH = H / proj.dist;
    const aspect = canvas.width / canvas.height;
    // Trees tower over the ~2m (1× lineH) enemies: ~2.5× the wall column so a
    // 5–6m tree reads correctly against the shrine and the zombies feel small
    // by comparison rather than oversized.
    const treeH = Math.floor(lineH * 2.5 * (t.scale || 1));
    const treeW = Math.floor(treeH * aspect);
    // Drop the sprite by the art's transparent bottom padding so the opaque
    // trunk base sits on the floor instead of floating above it.
    const pad = Environment.getTreeBottomPad ? Environment.getTreeBottomPad(t.variant) : 0;
    const groundedBottom = horizon + lineH / 2 + pad * treeH;
    const drawStartY = Math.floor(groundedBottom - treeH);
    const drawStartX = Math.floor(proj.screenX - treeW / 2);

    // Forest fog: alpha falls off with distance so far trees melt into
    // the haze layer instead of stamping hard silhouettes.
    const fogD = (theme && theme.fogDist) || 22;
    const fade = Math.max(0, Math.min(1, 1 - (proj.dist - fogD * 0.3) / fogD));
    if (fade <= 0.02) return;
    blitBillboard(canvas, drawStartX, drawStartY, treeW, treeH, proj.dist, fade, false);
  }

  // ---------- Pickup sprites ----------
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
    blitBillboard(canvas, drawStartX, drawStartY, pickupW, pickupH, proj.dist, lifeFade, false);
  }

  // ---------- Baked assets (concrete tile, star field) ----------
  // Mulberry32 — same generator we use for wall textures, seeded per asset
  // so star positions / concrete cracks stay stable.
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

  // Build a 128×128 earth-floor tile. Dark damp brown base with mineral
  // grain, scattered pebbles, embedded straw fibres, and a few darker
  // wet patches — reads as forest soil rather than concrete when tinted
  // by each theme's concreteTint. Name kept as concreteTile so the
  // existing per-pixel floor sampler doesn't need to be rewired.
  function buildConcreteTile() {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const c = cv.getContext('2d');
    const r = rng(9911);
    // Base — damp ash-brown earth (mixed warm brown + cool stone-grey
    // so the floor reads as forest soil with mineral content rather
    // than pure mud).
    c.fillStyle = '#28221c';
    c.fillRect(0, 0, 128, 128);
    // Cool stone-grey blotches — break up the brown
    for (let i = 0; i < 14; i++) {
      const x = r() * 128, y = r() * 128;
      const w = 10 + r() * 24, h = 6 + r() * 18;
      c.fillStyle = `rgba(140,140,135,${(0.06 + r() * 0.10).toFixed(3)})`;
      c.beginPath();
      c.ellipse(x, y, w / 2, h / 2, r() * Math.PI, 0, Math.PI * 2);
      c.fill();
    }
    // Fine grain (lighter) — warm tone speckle
    for (let i = 0; i < 220; i++) {
      const x = r() * 128, y = r() * 128;
      c.fillStyle = `rgba(170,140,100,${(0.04 + r() * 0.10).toFixed(3)})`;
      c.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
    // Fine grain (cool) — grey speckle so the ash tone keeps reading
    for (let i = 0; i < 200; i++) {
      const x = r() * 128, y = r() * 128;
      c.fillStyle = `rgba(160,160,155,${(0.04 + r() * 0.10).toFixed(3)})`;
      c.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
    // Coarse mineral grain (darker)
    for (let i = 0; i < 480; i++) {
      const x = r() * 128, y = r() * 128;
      c.fillStyle = `rgba(0,0,0,${(0.15 + r() * 0.25).toFixed(3)})`;
      c.fillRect(Math.floor(x), Math.floor(y), 1, 1);
    }
    // Pebbles — small grey dots, leaning more neutral than before
    for (let i = 0; i < 28; i++) {
      const x = r() * 128, y = r() * 128;
      const sz = 1 + Math.floor(r() * 2);
      const shade = 90 + Math.floor(r() * 50);
      c.fillStyle = `rgb(${shade},${shade - 4},${shade - 12})`;
      c.beginPath();
      c.arc(x, y, sz, 0, Math.PI * 2);
      c.fill();
      // Tiny highlight
      c.fillStyle = 'rgba(255,255,255,0.20)';
      c.fillRect(Math.floor(x - sz / 2), Math.floor(y - sz / 2), 1, 1);
    }
    // Straw / leaf litter — short bright streaks
    for (let i = 0; i < 28; i++) {
      const x = Math.floor(r() * 128);
      const y = Math.floor(r() * 128);
      const len = 3 + Math.floor(r() * 5);
      const angle = r() * Math.PI * 2;
      c.save();
      c.translate(x, y);
      c.rotate(angle);
      c.fillStyle = `rgba(170,130,60,${(0.30 + r() * 0.25).toFixed(3)})`;
      c.fillRect(-len / 2, 0, len, 1);
      c.restore();
    }
    // Wet / muddy patches — irregular dark blobs
    for (let i = 0; i < 6; i++) {
      const x = r() * 128, y = r() * 128;
      const w = 12 + r() * 28, h = 8 + r() * 22;
      c.fillStyle = `rgba(0,0,0,${(0.18 + r() * 0.18).toFixed(3)})`;
      c.beginPath();
      c.ellipse(x, y, w / 2, h / 2, r() * Math.PI, 0, Math.PI * 2);
      c.fill();
    }
    // Scattered tiny moss specks (forest floor)
    for (let i = 0; i < 18; i++) {
      const x = Math.floor(r() * 128);
      const y = Math.floor(r() * 128);
      c.fillStyle = `rgba(60,90,40,${(0.30 + r() * 0.30).toFixed(3)})`;
      c.fillRect(x, y, 1 + Math.floor(r() * 2), 1);
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

  // Pre-sampled tree-line height profile. Each entry is "how many pixels
  // does the canopy rise above the horizon at this U coord". Built once
  // from layered sine waves + per-x noise so the silhouette stays stable
  // across frames (no twitching) but reads as a chaotic ridge of trees.
  // Long enough that any reasonable canvas width can sample it without
  // wrapping noticeably.
  let forestProfile = null;
  function buildForestProfile() {
    const LEN = 2048;
    const r = rng(31415);
    const a = new Float32Array(LEN + 1);
    for (let i = 0; i <= LEN; i++) {
      const t = i / LEN;
      // Three layered sines for a believable canopy ridge; a few sharper
      // spikes (Math.pow on a sine) drop in pointed conifer crowns.
      const base   = 22 + Math.sin(t * Math.PI * 4.3 + 1.1) * 6;
      const mid    = Math.sin(t * Math.PI * 11.0 + 2.7) * 4;
      const detail = Math.sin(t * Math.PI * 29.0 + 4.3) * 3;
      const conifer = Math.pow(Math.max(0, Math.sin(t * Math.PI * 47 + 0.7)), 6) * 14;
      const noise = (r() - 0.5) * 5;
      a[i] = Math.max(0, base + mid + detail + conifer + noise);
    }
    return a;
  }

  // Distant mountain ridge — smoother, much taller silhouette drawn
  // behind the forest tree-line. Two layered sines + per-x noise gives
  // believable peaks without spiky alpine pretension; the second
  // (smaller) sine adds secondary humps so it doesn't read as a single
  // hill. Heights in the 60–120 px range so the ridge actually pokes
  // well above the trees.
  let mountainProfile = null;
  function buildMountainProfile() {
    const LEN = 2048;
    const r = rng(57192);
    const a = new Float32Array(LEN + 1);
    for (let i = 0; i <= LEN; i++) {
      const t = i / LEN;
      const big   = 70 + Math.sin(t * Math.PI * 1.7 + 0.4) * 28;
      const mid   = Math.sin(t * Math.PI * 3.9 + 2.1) * 16;
      const small = Math.sin(t * Math.PI * 9.0 + 4.7) * 8;
      const noise = (r() - 0.5) * 6;
      a[i] = Math.max(0, big + mid + small + noise);
    }
    return a;
  }

  function ensureBakedAssets() {
    if (!concreteTile) {
      concreteTile = buildConcreteTile();
      // Cache pixel buffer so the per-pixel floor cast can sample without
      // hitting getImageData every frame.
      concreteTileData = concreteTile.getContext('2d')
        .getImageData(0, 0, concreteTile.width, concreteTile.height).data;
    }
    if (!starField) starField = buildStarField();
    if (!forestProfile) forestProfile = buildForestProfile();
    if (!mountainProfile) mountainProfile = buildMountainProfile();
  }

  // ---------- Sky pass ----------
  function drawSky(theme, player) {
    ensureBakedAssets();
    // Sky horizon rides the smoothed pitch so the gradient bottom stays
    // attached to where the floor's real horizon sits. mouse-Y noise during
    // yaw is dampened by the low-pass on player.smoothedPitch, so the
    // backdrop doesn't twitch on rotation.
    const pitch = (player && typeof player.smoothedPitch === 'number') ? player.smoothedPitch : 0;
    const horizon = H / 2 + pitch;
    const M = 64;
    const grad = ctx.createLinearGradient(0, -M, 0, horizon);
    grad.addColorStop(0, theme.skyTop);
    grad.addColorStop(0.6, theme.skyMid);
    grad.addColorStop(1, theme.skyBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(-M, -M, W + 2 * M, horizon + M);
    // Fill the lower half with the sky's bottom color too — the floor draws
    // over its real area; whatever band of canvas is left between H/2 and
    // the pitch-shifted real horizon stays a believable sky-bottom band.
    ctx.fillStyle = theme.skyBottom;
    ctx.fillRect(-M, horizon, W + 2 * M, H - horizon + M);

    const name = theme.name || 'sunset';
    // Moon + stars removed per design — keep only the storm's lightning band.
    if (name === 'storm') drawStormSky(horizon);
    // Forest silhouette sits in front of the celestial layer (so trees
    // occlude any star they overlap) but behind the walls + floor pass
    // (so any in-world wall taller than the horizon naturally hides the
    // corresponding chunk of forest).
    drawForestSilhouette(horizon, name, player);
  }

  // Distant mountain + forest stack — three layers from back to front so
  // the silhouette reads as deep landscape: faint misty mountains way
  // back, then a shorter forest row, then the tall conifer ridge in
  // front. Each layer scrolls at a different speed relative to player
  // yaw (parallax) — far mountains barely move, near trees scroll fully.
  function drawForestSilhouette(horizon, themeName, player) {
    if (!forestProfile || !mountainProfile) return;
    const fLen = forestProfile.length - 1;
    const mLen = mountainProfile.length - 1;
    const yaw = (player && typeof player.angle === 'number') ? player.angle : 0;
    const samplePerRadian = (fLen / (Math.PI * 2)) * 8;
    const scrollMountain = yaw * samplePerRadian * 0.18; // distant parallax
    const scrollFar      = yaw * samplePerRadian * 0.55;
    const scrollNear     = yaw * samplePerRadian;

    function sampleF(scroll, x) {
      let idx = ((x + scroll) % fLen + fLen) % fLen;
      return forestProfile[Math.floor(idx)];
    }
    function sampleM(scroll, x) {
      let idx = ((x + scroll) % mLen + mLen) % mLen;
      return mountainProfile[Math.floor(idx)];
    }

    ctx.save();
    // Layer 1 — back mountains. Painted with a vertical gradient so
    // peaks fade into the sky rather than cutting hard. Two slightly
    // offset passes give a sense of distant + middle range.
    function drawMountainPass(scroll, scale, topColor, baseColor) {
      const peakAlphaY = Math.max(0, horizon - 130);
      const grd = ctx.createLinearGradient(0, peakAlphaY, 0, horizon + 2);
      grd.addColorStop(0, topColor);
      grd.addColorStop(1, baseColor);
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(0, horizon + 1);
      for (let x = 0; x <= W; x++) {
        const h = sampleM(scroll, x) * scale;
        ctx.lineTo(x, horizon - h);
      }
      ctx.lineTo(W, horizon + 1);
      ctx.closePath();
      ctx.fill();
    }
    // Far range — palest, biggest, draws first
    drawMountainPass(scrollMountain, 1.0,
      themeName === 'storm' ? 'rgba(10,12,20,0.45)' : 'rgba(20,30,55,0.55)',
      themeName === 'storm' ? 'rgba(4,6,12,0.85)'   : 'rgba(8,14,30,0.85)');
    // Mid range — slightly darker, shifted sample
    drawMountainPass(scrollMountain + 540, 0.78,
      themeName === 'storm' ? 'rgba(4,6,12,0.65)'  : 'rgba(10,18,38,0.70)',
      themeName === 'storm' ? 'rgba(2,2,6,0.95)'   : 'rgba(4,8,18,0.95)');

    // Layer 2 — distant forest row (shorter trees, behind near row).
    ctx.fillStyle = themeName === 'storm' ? '#040508' : '#060a14';
    ctx.beginPath();
    ctx.moveTo(0, horizon + 1);
    for (let x = 0; x <= W; x++) {
      const h = sampleF(scrollFar, x) * 0.55;
      ctx.lineTo(x, horizon - h);
    }
    ctx.lineTo(W, horizon + 1);
    ctx.closePath();
    ctx.fill();
    // Layer 3 — near tree row (tall conifers, deepest black, in front).
    ctx.fillStyle = themeName === 'storm' ? '#010103' : '#020306';
    ctx.beginPath();
    ctx.moveTo(0, horizon + 1);
    for (let x = 0; x <= W; x++) {
      const h = sampleF(scrollNear, x);
      ctx.lineTo(x, horizon - h);
    }
    ctx.lineTo(W, horizon + 1);
    ctx.closePath();
    ctx.fill();
    // Ground mist right at the tree feet so the ridge melts into the
    // floor instead of cutting hard.
    const mist = ctx.createLinearGradient(0, horizon - 8, 0, horizon + 14);
    mist.addColorStop(0, 'rgba(20,30,55,0)');
    mist.addColorStop(0.5, 'rgba(20,30,55,0.55)');
    mist.addColorStop(1, 'rgba(20,30,55,0)');
    ctx.fillStyle = mist;
    ctx.fillRect(0, horizon - 8, W, 22);
    ctx.restore();
  }

  // Full moon — same position every frame so the player can use it as a
  // landmark while sprinting. Pulled up high enough that the player's
  // pitch range can't bring it under the horizon at any reasonable
  // playing angle. The 'storm' band suppresses it (the sky is supposed
  // to be pitch black with red bleed) — a faint disc through cloud is
  // drawn instead.
  function drawMoon(horizon, themeName) {
    const cx = Math.floor(W * 0.72);
    const cy = Math.floor(horizon * 0.32);
    const r = 22;
    if (themeName === 'storm') {
      ctx.fillStyle = 'rgba(180,180,200,0.18)';
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2); ctx.fill();
      return;
    }
    // Outer glow
    const glow = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 3);
    glow.addColorStop(0, 'rgba(220,225,240,0.30)');
    glow.addColorStop(1, 'rgba(220,225,240,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx - r * 3, cy - r * 3, r * 6, r * 6);
    // Disc
    ctx.fillStyle = '#e8eaf2';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    // Cratery shading — a slight grey blotch off-centre so the moon isn't
    // a flat disc.
    ctx.fillStyle = 'rgba(120,130,150,0.22)';
    ctx.beginPath(); ctx.arc(cx - r * 0.25, cy + r * 0.18, r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(120,130,150,0.18)';
    ctx.beginPath(); ctx.arc(cx + r * 0.32, cy - r * 0.30, r * 0.30, 0, Math.PI * 2); ctx.fill();
  }

  function drawStormSky(horizon) {
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

  // ---------- Floor pass ----------
  function drawFloor(player, theme, horizonOffset) {
    ensureBakedAssets();
    const horizon = H / 2 + horizonOffset;
    if (horizon >= H) return;
    const M = 64;

    // Base gradient still gets laid down first so any rows the per-pixel
    // cast skips (e.g., when horizon hits the bottom of screen) still have
    // a sensible color underneath.
    const grad = ctx.createLinearGradient(0, horizon, 0, H + M);
    grad.addColorStop(0, theme.floorFar);
    grad.addColorStop(1, theme.floorNear);
    ctx.fillStyle = grad;
    ctx.fillRect(-M, horizon, W + 2 * M, H - horizon + M);

    castFloor(player, theme, horizon);

    // Horizon haze band — sits on top so the texture transitions softly
    // into the sky color rather than ending in a hard line.
    const haze = theme.haze || '180,160,140';
    const hazeH = Math.min(60, (H - horizon) * 0.35);
    const hazeGrad = ctx.createLinearGradient(0, horizon, 0, horizon + hazeH);
    hazeGrad.addColorStop(0, `rgba(${haze},0.55)`);
    hazeGrad.addColorStop(1, `rgba(${haze},0)`);
    ctx.fillStyle = hazeGrad;
    ctx.fillRect(-M, horizon, W + 2 * M, hazeH);
  }

  // True per-pixel floor cast. For each screen row below the horizon, the
  // world distance for points on that row is constant; sample the concrete
  // tile in world coordinates (1 tile = 1 world unit) so the texture actually
  // recedes toward the vanishing point instead of being a screen-aligned
  // wallpaper. Camera rotation rotates the texture too — joint lines run
  // forward into the distance like real expansion joints, not vertically
  // down the screen.
  function castFloor(player, theme, horizon) {
    if (!concreteTileData) return;
    const TW = concreteTile.width;   // 128
    const TH = concreteTile.height;
    const horizonI = Math.floor(horizon);
    if (horizonI >= H) return;

    const startY = Math.max(horizonI + 1, 0);
    const rowsH = H - startY;
    if (rowsH <= 0) return;

    // Reuse the floor pixel buffer across frames. getImageData would force a
    // GPU→CPU readback every frame even though we overwrite every pixel
    // anyway, which was costing several ms per frame at full resolution.
    if (!floorBuf || floorBufW !== W || floorBufH !== rowsH) {
      floorBuf = ctx.createImageData(W, rowsH);
      floorBufW = W;
      floorBufH = rowsH;
    }
    const img = floorBuf;
    const data = img.data;

    const cosA = Math.cos(player.angle);
    const sinA = Math.sin(player.angle);
    const tanFov = Math.tan(FOV / 2);

    // Far-color fade target — blend toward this as distance grows so the
    // texture doesn't pop against the gradient underneath.
    const fr = parseInt(theme.floorFar.slice(1, 3), 16);
    const fg = parseInt(theme.floorFar.slice(3, 5), 16);
    const fb = parseInt(theme.floorFar.slice(5, 7), 16);

    // 1 tile == 1 world unit. Larger TILE_SCALE → smaller-looking tile on
    // the ground; tuned so cracks/joints are visible up close without the
    // tile boundary becoming obvious.
    const TILE_SCALE = 0.5;

    // Cache the camera-plane axes — they don't change across rows, only the
    // row distance scales them. Hoisting these out of the row loop avoids a
    // few thousand redundant multiplies per frame.
    const rayL_x = cosA + sinA * tanFov;
    const rayL_y = sinA - cosA * tanFov;
    const rayR_x = cosA - sinA * tanFov;
    const rayR_y = sinA + cosA * tanFov;
    const dxL = rayL_x;
    const dyL = rayL_y;
    const planeStepX = (rayR_x - rayL_x) / W;
    const planeStepY = (rayR_y - rayL_y) / W;

    // 2×2 block sampling: process every other pixel and copy the result to
    // the four neighbours. Cuts the inner-loop work by ~4× — the floor was
    // the per-frame bottleneck on mobile and the visual difference between
    // 1× and 2× sampling at this texture density is hard to notice.
    for (let y = startY; y < H; y += 2) {
      const rowY = y - horizonI;
      if (rowY <= 0) continue;
      const rowDist = (H * 0.5) / rowY;

      const worldXL = player.x + dxL * rowDist;
      const worldYL = player.y + dyL * rowDist;
      const stepX = planeStepX * rowDist;
      const stepY = planeStepY * rowDist;
      const fade = Math.min(1, 4.5 / rowDist);
      const oneMinusFade = 1 - fade;

      let wx = worldXL;
      let wy = worldYL;
      const rowBase     = (y     - startY) * W * 4;
      const nextRowBase = (y + 1 - startY) * W * 4;
      const writeNextRow = (y + 1) < H;

      for (let x = 0; x < W; x += 2) {
        // Tile in world units. World coord → texel.
        let u = (wx / TILE_SCALE) % 1; if (u < 0) u += 1;
        let v = (wy / TILE_SCALE) % 1; if (v < 0) v += 1;
        const tx = (u * TW) | 0;
        const ty = (v * TH) | 0;
        const tIdx = (ty * TW + tx) * 4;

        const tr = concreteTileData[tIdx];
        const tg = concreteTileData[tIdx + 1];
        const tb = concreteTileData[tIdx + 2];
        const r = (tr * fade + fr * oneMinusFade) | 0;
        const g = (tg * fade + fg * oneMinusFade) | 0;
        const b = (tb * fade + fb * oneMinusFade) | 0;

        // Splat the same color into the 2×2 block. Guards keep us inside
        // canvas bounds on odd dimensions.
        const idx = rowBase + x * 4;
        data[idx]     = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
        if (x + 1 < W) {
          data[idx + 4] = r; data[idx + 5] = g; data[idx + 6] = b; data[idx + 7] = 255;
        }
        if (writeNextRow) {
          const nIdx = nextRowBase + x * 4;
          data[nIdx]     = r; data[nIdx + 1] = g; data[nIdx + 2] = b; data[nIdx + 3] = 255;
          if (x + 1 < W) {
            data[nIdx + 4] = r; data[nIdx + 5] = g; data[nIdx + 6] = b; data[nIdx + 7] = 255;
          }
        }

        // Skip 2 columns per iteration since we wrote a 2-wide block.
        wx += stepX * 2;
        wy += stepY * 2;
      }
    }

    ctx.putImageData(img, 0, startY);
  }

  // ---------- Wall pass ----------
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
        // Floor, spawn gates AND the shaped shrine objects (drawn as billboard
        // props) all let the ray pass through — only buildings/perimeter walls
        // terminate it. Collision still uses the full grid via GameMap.isWall.
        if (!GameMap.isRenderWall(t)) continue;
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
        // Earthen wall (흙담 / 부적 토담) crowned with a small clay-tile coping
        // (담장 기와). Roughly one section in six has lost its cap and shows a
        // ragged mud crest instead, matching the half-collapsed setting.
        const seg = Math.floor(wallU * 3);
        const bn = Math.sin(seg * 91.17) * 43758.5453;
        const broken = (bn - Math.floor(bn)) < 0.18;
        if (broken) {
          const slot = Math.floor(wallU * 22);
          const n = Math.sin(slot * 12.9898) * 43758.5453;
          const noise = n - Math.floor(n);
          const h = Math.max(1, lineH * (0.02 + noise * 0.05));
          ctx.fillStyle = dark;
          ctx.fillRect(x, topY - h, 1, h);
        } else {
          const u = wallU * 6;                 // 6 coping tiles per map tile
          const tf = u - Math.floor(u);
          const bump = Math.sin(tf * Math.PI);  // convex tile crown
          const capH = Math.max(2, lineH * (0.045 + bump * 0.045));
          ctx.fillStyle = shadeColor('#3b3b42', lightFactor);
          ctx.fillRect(x, topY - capH, 1, capH);
          if (bump > 0.55) {
            ctx.fillStyle = shadeColor('#5c5c66', Math.min(1.5, lightFactor * 1.2));
            ctx.fillRect(x, topY - capH, 1, 1);
          }
          if (tf < 0.08 || tf > 0.92) {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(x, topY - capH, 1, capH);
          }
          ctx.fillStyle = 'rgba(0,0,0,0.4)';   // eave shadow under the cap
          ctx.fillRect(x, topY, 1, 1);
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
        // Hanok roof poking above the hall wall: a band of rounded ceramic
        // tiles topped by a heavy 용마루 ridge beam, with an eave shadow under
        // the body's top edge.
        const u = wallU * 5;                   // 5 ridge tiles per map tile
        const tf = u - Math.floor(u);
        const bump = Math.sin(tf * Math.PI);
        const tileH = Math.max(3, lineH * (0.06 + bump * 0.05));
        const sh = 28 + Math.floor(bump * 26);
        ctx.fillStyle = `rgb(${sh},${sh},${sh + 6})`;
        ctx.fillRect(x, topY - tileH, 1, tileH);
        if (tf < 0.07 || tf > 0.93) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(x, topY - tileH, 1, tileH);
        }
        if (bump > 0.6) {
          ctx.fillStyle = 'rgba(205,210,220,0.22)';
          ctx.fillRect(x, topY - tileH, 1, 1);
        }
        const ridgeH = Math.max(2, lineH * 0.028);
        ctx.fillStyle = shadeColor('#1b1b22', lightFactor);
        ctx.fillRect(x, topY - tileH - ridgeH, 1, ridgeH);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x, topY - tileH - ridgeH, 1, 1);
        ctx.fillStyle = 'rgba(0,0,0,0.45)';     // eave shadow
        ctx.fillRect(x, topY, 1, 2);
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

  // ---------- Sprites + helpers ----------
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
    if (xEnd <= xStart || h <= 0) return;

    // Fast path: if no wall in the span is nearer than the enemy, one drawImage.
    let clipped = false;
    for (let x = xStart; x < xEnd; x++) {
      if (zBuffer[x] < dist) { clipped = true; break; }
    }
    if (!clipped) {
      ctx.drawImage(tintBuf, 0, 0, sw, sh, x0, y0, w, h);
      return;
    }
    for (let x = xStart; x < xEnd; x++) {
      const u = (x - x0) / w;
      const srcX = Math.min(sw - 1, Math.max(0, Math.floor(u * sw)));
      let dstY1 = y0 + h;
      // Tall opaque wall in front: clip the sprite to the area above the
      // wall's top so the silhouette of a big enemy still pokes over.
      if (zBuffer[x] < dist) dstY1 = Math.min(dstY1, wallTopY[x]);
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
