// Player state and shooting
const Player = (() => {
  // Weapons selectable from the loadout. 1-4 keys map to indices into this
  // array; cycleWeapon walks it for the mobile swap button.
  const WEAPON_ORDER = ['pistol', 'shotgun', 'machinegun', 'sniper'];

  // ---------- Factory ----------
  function create() {
    const start = (typeof GameMap !== 'undefined' && GameMap.PLAYER_START) || { x: 12, y: 12 };
    return {
      x: start.x, y: start.y,
      angle: 0,
      pitch: 0,
      // Low-pass-filtered pitch the renderer uses for distant elements like
      // the skyline so quick mouse-Y jitter during yaw doesn't bounce the
      // horizon-anchored silhouette. Sustained looking-up/down still tracks.
      smoothedPitch: 0,
      hp: 100, maxHp: 100,
      stamina: 100, maxStamina: 100, exhausted: false,
      moveSpeed: 3.0,
      runSpeed: 5.0,
      radius: 0.25,
      // Weapons
      loadout: Weapons.buildLoadout(),
      currentWeapon: 'pistol',
      // Combat state
      shootCooldown: 0,
      reloading: false,
      reloadTimer: 0,
      // Upgrades / modifiers
      damageMult: 1.0,
      fireRateMult: 1.0,
      defenseMult: 1.0,
      moveSpeedMult: 1.0,
      pierce: 0,           // bonus pierce count
      explosive: false,
      autoHeal: false,
      autoHealTimer: 0,
      // Effects
      kickback: 0,
      bobPhase: 0,
      bobOffset: 0,
      muzzleFlash: 0,
      // Camera shake
      shake: 0,
      // Combo — count is now the raw streak length (1, 2, 3, ...), not a
      // bucket index. The score multiplier still caps at ×3 but the count
      // itself keeps climbing so 굿판 모드 can trigger at ≥5 and extend at
      // every multiple of 5.
      lastKillTime: -10,
      comboCount: 0,
      // 굿판 모드 — set by main.js each frame from game.gutpan.active.
      // When true, damage / fire rate / score gain bonus multipliers.
      gutpanActive: false,
      // Stats
      kills: 0,
      headshots: 0,
      bossKills: 0,
      maxComboReached: 0
    };
  }

  // ---------- 굿판 mode multipliers ----------
  // Centralised so player.shoot / damageEnemy and enemy.awardChainKill all
  // apply the same numbers. Tuned to the spec: damage ×1.5, fire interval
  // ×0.8 (= rate ×1.25), score ×2.0.
  const GUTPAN_DAMAGE_MULT = 1.5;
  const GUTPAN_FIRE_MULT = 1.25;
  const GUTPAN_SCORE_MULT = 2.0;

  function comboMultFor(count) {
    // Score multiplier caps at ×3 even as the raw streak keeps climbing.
    return [1, 1, 1.5, 2, 3][Math.min(count, 4)] || 3;
  }

  function getWeapon(p) { return p.loadout[p.currentWeapon]; }

  // ---------- Per-frame update ----------
  function update(p, dt, input) {
    // Movement — keys feed digital fwd/right; an optional analog `input.move`
    // (from a virtual joystick) overrides them when present.
    let dx = 0, dy = 0;
    let fwd = (input.keys['w'] ? 1 : 0) - (input.keys['s'] ? 1 : 0);
    let right = (input.keys['d'] ? 1 : 0) - (input.keys['a'] ? 1 : 0);
    if (input.move && (input.move.fwd !== 0 || input.move.right !== 0)) {
      fwd = input.move.fwd;
      right = input.move.right;
    }
    // Once stamina fully drains, lock sprint off until it recovers past a
    // threshold. Without the latch, a single frame of regen would
    // immediately re-enable sprinting and the player could run forever at
    // ~0 stamina.
    if (p.stamina <= 0) p.exhausted = true;
    else if (p.exhausted && p.stamina >= 30) p.exhausted = false;
    const running = !!input.keys['shift'] && !p.exhausted && Math.abs(fwd) > 0.1;

    let speed = (running ? p.runSpeed : p.moveSpeed) * p.moveSpeedMult;

    if (fwd !== 0 || right !== 0) {
      const cos = Math.cos(p.angle);
      const sin = Math.sin(p.angle);
      // Forward = (cos, sin); right = (-sin, cos) in y-down world
      dx = (cos * fwd - sin * right) * speed * dt;
      dy = (sin * fwd + cos * right) * speed * dt;
      const moved = GameMap.tryMove(p.x, p.y, dx, dy, p.radius);
      const dxMoved = moved.x - p.x;
      const dyMoved = moved.y - p.y;
      const stepDist = Math.sqrt(dxMoved * dxMoved + dyMoved * dyMoved);
      p.x = moved.x; p.y = moved.y;

      // Bob
      p.bobPhase += dt * (running ? 14 : 9);
      p.bobOffset = Math.sin(p.bobPhase) * (running ? 6 : 4);

      // Footstep trigger: fire a step roughly every ~0.55 world units when
      // walking (~0.40 when running) so the cadence matches the bob.
      // Tracked via an accumulator so framerate jitter doesn't drift it.
      p.footstepAccum = (p.footstepAccum || 0) + stepDist;
      const strideLen = running ? 0.40 : 0.55;
      if (p.footstepAccum >= strideLen) {
        p.footstepAccum -= strideLen;
        Audio.footstep();
      }

      // Stamina drain
      if (running) p.stamina = Math.max(0, p.stamina - 35 * dt);
    } else {
      p.bobOffset *= 0.85;
      p.footstepAccum = 0;
    }

    // Stamina regen
    if (!running) p.stamina = Math.min(p.maxStamina, p.stamina + 18 * dt);

    // Shoot cooldown / reload
    if (p.shootCooldown > 0) p.shootCooldown -= dt;
    if (p.reloading) {
      p.reloadTimer -= dt;
      if (p.reloadTimer <= 0) finishReload(p);
    }

    // Kickback decay
    p.kickback *= Math.exp(-dt * 8);
    p.muzzleFlash = Math.max(0, p.muzzleFlash - dt * 6);
    p.shake *= Math.exp(-dt * 6);
    // Smooth-follow the pitch so sub-pixel mouse-Y noise during a yaw
    // doesn't jitter the horizon-anchored skyline; sustained tilt still
    // converges in ~0.2s.
    const pitchLerp = Math.min(1, dt * 10);
    p.smoothedPitch += (p.pitch - p.smoothedPitch) * pitchLerp;

    // Auto heal
    if (p.autoHeal && p.hp < p.maxHp) {
      p.autoHealTimer -= dt;
      if (p.autoHealTimer <= 0) {
        p.hp = Math.min(p.maxHp, p.hp + 1);
        p.autoHealTimer = 3.0;
      }
    }

    // Combo timeout — 3 seconds per spec (was 2). Streak resets to zero so
    // the next kill starts a fresh count from 1.
    if (performance.now() / 1000 - p.lastKillTime > 3.0) {
      p.comboCount = 0;
    }
  }

  // ---------- Aim ----------
  function turn(p, deltaX, deltaY) {
    p.angle += deltaX * 0.0025;
    // Normalize
    if (p.angle > Math.PI * 2) p.angle -= Math.PI * 2;
    if (p.angle < 0) p.angle += Math.PI * 2;

    if (typeof deltaY === 'number' && deltaY !== 0) {
      const { H } = Raycaster.getDimensions();
      p.pitch -= deltaY * 1.0;
      const maxPitch = H * 0.3;
      if (p.pitch > maxPitch) p.pitch = maxPitch;
      if (p.pitch < -maxPitch) p.pitch = -maxPitch;
    }
  }

  // ---------- Shooting / hit resolution ----------
  function shoot(p, enemies, particles, scoreCallback) {
    if (p.reloading) return;
    if (p.shootCooldown > 0) return;
    const w = getWeapon(p);
    if (w.currentAmmo <= 0) {
      Audio.emptyClick();
      return;
    }

    w.currentAmmo -= 1;
    const fireBonus = p.gutpanActive ? GUTPAN_FIRE_MULT : 1;
    p.shootCooldown = w.fireRate / (p.fireRateMult * fireBonus);
    p.kickback = w.kickback;
    p.muzzleFlash = 1.0;
    p.shake = w.kickback * 0.4;
    Audio[w.sound]();

    const dmgBonus = p.gutpanActive ? GUTPAN_DAMAGE_MULT : 1;
    const damage = w.damage * p.damageMult * dmgBonus;
    const pierceCount = (w.pierce || 0) + p.pierce;

    for (let i = 0; i < w.pellets; i++) {
      const spread = (Math.random() - 0.5) * w.spread + (Math.random() - 0.5) * w.spread;
      const a = p.angle + spread;
      hitscan(p, a, w.maxRange, damage, pierceCount, p.explosive, enemies, particles, scoreCallback);
    }
  }

  function hitscan(p, angle, maxRange, damage, pierceCount, explosive, enemies, particles, scoreCallback) {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    // Find first opaque wall and its height factor via DDA-lite. The boss is
    // plinkable from anywhere on the map (no maxRange cap) and any portion
    // visibly poking above an intervening wall is fair game — the renderer
    // already draws that silhouette, so the hit detection has to match.
    const wall = raycastWall(p.x, p.y, dirX, dirY, Infinity);
    const wallDist = wall.dist;
    const wallH = wall.h;
    const rangeCap = Math.min(maxRange, wallDist);

    // Check enemies — sort by distance
    const { H } = Raycaster.getDimensions();
    const verticalOffset = p.bobOffset + p.pitch;
    const candidates = [];
    for (const e of enemies) {
      if (!e.alive) continue;
      const ex = e.x - p.x;
      const ey = e.y - p.y;
      // Project onto ray
      const proj = ex * dirX + ey * dirY;
      const cap = e.type.isBoss ? Infinity : rangeCap;
      if (proj < 0 || proj > cap) continue;
      // Perpendicular distance
      const perpX = ex - dirX * proj;
      const perpY = ey - dirY * proj;
      const perpDist = Math.sqrt(perpX * perpX + perpY * perpY);
      // Scale the hitbox (horizontally + vertically) by the sprite's render
      // scale so a 2.2× boss can actually be hit on the shoulders/head where
      // it visibly is, not on the unscaled cylinder under its feet.
      const spr = (typeof Sprites !== 'undefined') ? Sprites.get(e.type.id) : null;
      const scale = spr ? (spr.scale || 1) : 1;
      if (perpDist >= e.type.radius * scale) continue;
      // Visual body is bottom-anchored: spans 1/(2*scale) … 1 (in unit-screen
      // coords where 0 is the top of an unscaled body). hitFrac maps the
      // crosshair (which is offset from the world horizon by verticalOffset)
      // into 0..1 across the visible sprite — 0 = head top, 1 = feet.
      const hitFrac = 1 - 1 / (2 * scale) - (verticalOffset * proj) / (H * scale);
      if (e.type.isBoss) {
        // Boss is forgiving on vertical aim: any ray inside its cylinder
        // counts so long-range pitch error doesn't erase shots. But if a wall
        // sits between the player and the boss, only the portion above the
        // wall's top is hittable — matches what the renderer actually shows.
        if (proj > wallDist) {
          const wallTopFrac = 1 - 0.5 / scale - (wallH - 0.5) * proj / (scale * wallDist);
          if (wallTopFrac <= 0) continue;
          if (hitFrac >= wallTopFrac) continue;
        }
      } else if (hitFrac < 0 || hitFrac > 1) {
        continue;
      }
      const headshot = hitFrac < 0.3 && hitFrac >= 0;
      candidates.push({ e, proj, headshot });
    }
    candidates.sort((a, b) => a.proj - b.proj);

    let hits = 0;
    const maxHits = 1 + pierceCount;
    for (const c of candidates) {
      if (hits >= maxHits) break;
      const dmg = c.headshot ? damage * 2 : damage;
      damageEnemy(p, c.e, dmg, c.headshot, particles, enemies, scoreCallback);
      // Spawn impact particles at hit point
      const ix = p.x + dirX * c.proj;
      const iy = p.y + dirY * c.proj;
      spawnHitParticles(particles, ix, iy, c.e.type.bloodColor || [180, 30, 30]);
      hits++;
    }

    if (hits === 0 && wallDist < maxRange) {
      // Wall impact
      const ix = p.x + dirX * wallDist;
      const iy = p.y + dirY * wallDist;
      spawnImpactParticles(particles, ix, iy);
    }

    // Explosive: damage all enemies within radius around impact point
    if (explosive) {
      let impactX = p.x + dirX * Math.min(wallDist, maxRange);
      let impactY = p.y + dirY * Math.min(wallDist, maxRange);
      if (candidates.length > 0) {
        impactX = p.x + dirX * candidates[0].proj;
        impactY = p.y + dirY * candidates[0].proj;
      }
      const r = 1.5;
      for (const e of enemies) {
        if (!e.alive) continue;
        const dx = e.x - impactX, dy = e.y - impactY;
        const d2 = dx * dx + dy * dy;
        if (d2 < r * r) {
          const splash = damage * 0.6;
          damageEnemy(p, e, splash, false, particles, enemies, scoreCallback);
        }
      }
      spawnExplosion(particles, impactX, impactY);
      Audio.explosion();
    }
  }

  function damageEnemy(p, e, dmg, headshot, particles, enemies, scoreCallback) {
    e.hp -= dmg;
    e.hitFlash = 0.1;
    // Pick the hit sound by enemy class so heavy/armored targets feel
    // distinct from regular flesh hits. Headshots fall through to the same
    // sample so there's no synth "crack" layered on top of the impact.
    if (e.type.isBoss) Audio.hitBoss();
    else if (e.type.id === 'tank') Audio.hitArmor();
    else Audio.hitFlesh();
    spawnDamageNumber(particles, e.x, e.y, dmg, headshot);
    // Boss phase trigger: once the boss drops below half HP, enrage it
    // (faster + bigger summons). One-shot — the flag prevents the next
    // damage tick from re-firing the transition effects.
    if (e.type.isBoss && !e.phase2 && e.hp > 0 && e.hp <= e.maxHp * 0.5) {
      e.phase2 = true;
      Audio.bossEnrage();
      UI.flashEnrage();
    }
    if (e.hp <= 0 && e.alive) {
      e.alive = false;
      if (e.type.isBoss) Audio.bossDeath();
      else Audio.enemyDeath();
      // Score — combo now counts raw streak length (1, 2, ...) and only
      // resets after the 3s timeout. Score multiplier caps at ×3 via
      // comboMultFor; the unclamped count is what 굿판 모드 watches for ≥5.
      const t = performance.now() / 1000;
      if (t - p.lastKillTime < 3.0) {
        p.comboCount = p.comboCount + 1;
      } else {
        p.comboCount = 1;
      }
      p.lastKillTime = t;
      if (p.comboCount > p.maxComboReached) p.maxComboReached = p.comboCount;
      const comboMult = comboMultFor(p.comboCount);
      const headMult = headshot ? 2 : 1;
      const gutpanMult = p.gutpanActive ? GUTPAN_SCORE_MULT : 1;
      const score = Math.floor(e.type.score * comboMult * headMult * gutpanMult);
      scoreCallback(score, e);
      p.kills++;
      if (headshot) p.headshots++;
      if (e.type.isBoss) p.bossKills++;
      // Two-layer death burst (airborne spray + lingering ground stains).
      // Boss / headshot variants are handled inside the helper.
      spawnDeathBurst(
        particles,
        e.x, e.y,
        e.type.bloodColor || [180, 30, 30],
        headshot,
        !!e.type.isBoss
      );
      // Type-specific on-death side effects (bomber detonate, splitter spawn).
      if (enemies && Enemies.onKilled) {
        Enemies.onKilled(e, p, enemies, particles, scoreCallback);
      }
      // Drop pickup (handled by Pickups module — boss spawns multi-item burst).
      if (typeof Pickups !== 'undefined') Pickups.onEnemyKilled(e);
    }
  }

  function raycastWall(x, y, dx, dy, maxDist) {
    let mapX = Math.floor(x);
    let mapY = Math.floor(y);
    const deltaDistX = Math.abs(1 / (dx || 1e-9));
    const deltaDistY = Math.abs(1 / (dy || 1e-9));
    let stepX, stepY, sideDistX, sideDistY;
    if (dx < 0) { stepX = -1; sideDistX = (x - mapX) * deltaDistX; }
    else { stepX = 1; sideDistX = (mapX + 1.0 - x) * deltaDistX; }
    if (dy < 0) { stepY = -1; sideDistY = (y - mapY) * deltaDistY; }
    else { stepY = 1; sideDistY = (mapY + 1.0 - y) * deltaDistY; }

    let dist = 0;
    let safety = 100;
    while (safety-- > 0) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        dist = sideDistX - deltaDistX;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        dist = sideDistY - deltaDistY;
      }
      if (dist > maxDist) return { dist: maxDist, h: 0 };
      const t = GameMap.getTile(mapX, mapY);
      // Stop the bullet at any wall that isn't explicitly chest-high cover.
      // Previously this only checked types 1..4, which silently let bullets
      // (and sight) pass through comms towers / hazard panels / wrecks even
      // though they're full-height structures.
      if (t >= 1 && t <= 8) {
        const shape = GameMap.getShape(t);
        if (!shape.seeOver) return { dist, h: shape.heightFactor };
      }
    }
    return { dist: maxDist, h: 0 };
  }

  // ---------- Particle spawners ----------
  // Damage numbers float up out of the hit point, fading as they rise.
  // Headshots come out red+larger so the player gets a clear visual reward.
  // Spawned per damage instance — shotgun will produce 6 nearby numbers,
  // which is fine because the small random offsets fan them out as they rise.
  function spawnDamageNumber(particles, x, y, dmg, headshot) {
    const value = Math.max(1, Math.ceil(dmg));
    particles.push({
      x: x + (Math.random() - 0.5) * 0.15,
      y: y + (Math.random() - 0.5) * 0.15,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      zOffset: 0.55 + Math.random() * 0.10,
      vz: 1.4,
      noGravity: true,           // pure float, no arc
      text: String(value),
      headshot,
      color: headshot ? [255, 90, 70] : [255, 240, 220],
      size: 1,
      life: 0.85
    });
  }

  function spawnHitParticles(particles, x, y, color) {
    for (let i = 0; i < 6; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 0.5) * 4,
        zOffset: Math.random() * 0.2,
        vz: Math.random() * 2,
        size: 3 + Math.random() * 3,
        color,
        life: 1.0
      });
    }
  }

  function spawnImpactParticles(particles, x, y) {
    for (let i = 0; i < 5; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        zOffset: Math.random() * 0.3,
        vz: Math.random() * 1.5,
        size: 2 + Math.random() * 2,
        color: [200, 200, 180],
        life: 0.5
      });
    }
  }

  // Single-layer death burst — fast airborne droplets only. The previous
  // version also dropped lingering ground stains as a stand-in for corpses,
  // but they didn't read as bodies and just clutter the floor, so the layer
  // is gone. Headshots still add a higher-arc burst from the head area for
  // extra feedback.
  function spawnDeathBurst(particles, x, y, color, headshot, isBoss) {
    const baseScale = isBoss ? 2.4 : 1.0;
    const sprayCount = Math.floor(18 * baseScale);
    for (let i = 0; i < sprayCount; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 6 * baseScale,
        vy: (Math.random() - 0.5) * 6 * baseScale,
        zOffset: 0.15 + Math.random() * 0.55,
        vz: 1.4 + Math.random() * 3.4,
        size: 2 + Math.random() * 2.5,
        color,
        life: 1.0 + Math.random() * 0.5
      });
    }
    if (headshot) {
      for (let i = 0; i < 8; i++) {
        particles.push({
          x, y,
          vx: (Math.random() - 0.5) * 3.5,
          vy: (Math.random() - 0.5) * 3.5,
          zOffset: 0.65,
          vz: 3.5 + Math.random() * 2,
          size: 1.5 + Math.random() * 1.5,
          color,
          life: 1.3
        });
      }
    }
  }

  function spawnExplosion(particles, x, y) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        zOffset: 0.3,
        vz: 1 + Math.random() * 2,
        size: 5 + Math.random() * 5,
        color: [255, 150 + Math.random() * 100, 50],
        life: 1.2
      });
    }
  }

  // ---------- Reload ----------
  function startReload(p) {
    if (p.reloading) return;
    const w = getWeapon(p);
    if (w.currentAmmo >= w.magSize) return;
    if (!w.ammoInfinite && w.reserveAmmo <= 0) return;
    p.reloading = true;
    p.reloadTimer = w.reloadTime;
    Audio.reload();
  }

  function finishReload(p) {
    const w = getWeapon(p);
    const need = w.magSize - w.currentAmmo;
    if (w.ammoInfinite) {
      w.currentAmmo = w.magSize;
    } else {
      const give = Math.min(need, w.reserveAmmo);
      w.currentAmmo += give;
      w.reserveAmmo -= give;
    }
    p.reloading = false;
  }

  // ---------- Weapon switching ----------
  function switchWeapon(p, key) {
    const idx = parseInt(key) - 1;
    if (idx < 0 || idx >= WEAPON_ORDER.length) return;
    swapTo(p, WEAPON_ORDER[idx]);
  }

  // Cycle to the next unlocked weapon in WEAPON_ORDER. Used by the mobile
  // swap button — the desktop has 1-4 keys for direct selection.
  function cycleWeapon(p) {
    const cur = WEAPON_ORDER.indexOf(p.currentWeapon);
    for (let i = 1; i <= WEAPON_ORDER.length; i++) {
      const next = WEAPON_ORDER[(cur + i) % WEAPON_ORDER.length];
      if (p.loadout[next] && p.loadout[next].unlocked && next !== p.currentWeapon) {
        swapTo(p, next);
        return;
      }
    }
  }

  function swapTo(p, target) {
    if (!p.loadout[target] || !p.loadout[target].unlocked) return;
    if (p.currentWeapon === target) return;
    p.currentWeapon = target;
    p.reloading = false;
    p.reloadTimer = 0;
    p.shootCooldown = 0.2;
  }

  // ---------- Player damage ----------
  function takeDamage(p, dmg) {
    const actual = dmg * (1 / Math.max(0.5, p.defenseMult));
    p.hp = Math.max(0, p.hp - actual);
    Audio.playerHit();
    p.shake = Math.max(p.shake, 8);
  }

  return {
    create, update, turn, shoot, startReload, switchWeapon, cycleWeapon, takeDamage, getWeapon,
    spawnExplosion, spawnDeathBurst,
    // Exposed so UI and enemy.awardChainKill use the same multiplier table.
    comboMultFor,
    GUTPAN_DAMAGE_MULT, GUTPAN_FIRE_MULT, GUTPAN_SCORE_MULT
  };
})();
