// Player state and shooting
const Player = (() => {
  function create() {
    const start = (typeof GameMap !== 'undefined' && GameMap.PLAYER_START) || { x: 12, y: 12 };
    return {
      x: start.x, y: start.y,
      angle: 0,
      pitch: 0,
      hp: 100, maxHp: 100,
      stamina: 100, maxStamina: 100,
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
      // Combo
      lastKillTime: -10,
      comboCount: 0,
      // Stats
      kills: 0,
      headshots: 0,
      bossKills: 0,
      maxComboReached: 0
    };
  }

  function getWeapon(p) { return p.loadout[p.currentWeapon]; }

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
    const running = !!input.keys['shift'] && p.stamina > 0 && Math.abs(fwd) > 0.1;

    let speed = (running ? p.runSpeed : p.moveSpeed) * p.moveSpeedMult;

    if (fwd !== 0 || right !== 0) {
      const cos = Math.cos(p.angle);
      const sin = Math.sin(p.angle);
      // Forward = (cos, sin); right = (-sin, cos) in y-down world
      dx = (cos * fwd - sin * right) * speed * dt;
      dy = (sin * fwd + cos * right) * speed * dt;
      const moved = GameMap.tryMove(p.x, p.y, dx, dy, p.radius);
      p.x = moved.x; p.y = moved.y;

      // Bob
      p.bobPhase += dt * (running ? 14 : 9);
      p.bobOffset = Math.sin(p.bobPhase) * (running ? 6 : 4);

      // Stamina drain
      if (running) p.stamina = Math.max(0, p.stamina - 35 * dt);
    } else {
      p.bobOffset *= 0.85;
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

    // Auto heal
    if (p.autoHeal && p.hp < p.maxHp) {
      p.autoHealTimer -= dt;
      if (p.autoHealTimer <= 0) {
        p.hp = Math.min(p.maxHp, p.hp + 1);
        p.autoHealTimer = 3.0;
      }
    }

    // Combo timeout
    if (performance.now() / 1000 - p.lastKillTime > 2.0) {
      p.comboCount = 0;
    }
  }

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

  function shoot(p, enemies, particles, scoreCallback) {
    if (p.reloading) return;
    if (p.shootCooldown > 0) return;
    const w = getWeapon(p);
    if (w.currentAmmo <= 0) {
      Audio.emptyClick();
      return;
    }

    w.currentAmmo -= 1;
    p.shootCooldown = w.fireRate / p.fireRateMult;
    p.kickback = w.kickback;
    p.muzzleFlash = 1.0;
    p.shake = w.kickback * 0.4;
    Audio[w.sound]();

    const damage = w.damage * p.damageMult;
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

    // Find wall distance via DDA-lite
    const wallDist = raycastWall(p.x, p.y, dirX, dirY, maxRange);

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
      if (proj < 0 || proj > Math.min(maxRange, wallDist)) continue;
      // Perpendicular distance
      const perpX = ex - dirX * proj;
      const perpY = ey - dirY * proj;
      const perpDist = Math.sqrt(perpX * perpX + perpY * perpY);
      if (perpDist >= e.type.radius) continue;
      const hitFrac = 0.5 - (verticalOffset * proj) / H;
      if (hitFrac < 0 || hitFrac > 1) continue; // aim above/below the body
      const headshot = hitFrac < 0.3;
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
    }
  }

  function damageEnemy(p, e, dmg, headshot, particles, enemies, scoreCallback) {
    e.hp -= dmg;
    e.hitFlash = 0.1;
    Audio.hit();
    if (e.hp <= 0 && e.alive) {
      e.alive = false;
      Audio.enemyDeath();
      // Score
      const t = performance.now() / 1000;
      if (t - p.lastKillTime < 2.0) {
        p.comboCount = Math.min(3, p.comboCount + 1);
      } else {
        p.comboCount = 0;
      }
      p.lastKillTime = t;
      if (p.comboCount > p.maxComboReached) p.maxComboReached = p.comboCount;
      const comboMult = [1, 1.5, 2, 3][p.comboCount] || 1;
      const headMult = headshot ? 2 : 1;
      const score = Math.floor(e.type.score * comboMult * headMult);
      scoreCallback(score, e);
      p.kills++;
      if (headshot) p.headshots++;
      if (e.type.isBoss) p.bossKills++;
      // Death particles
      for (let i = 0; i < 14; i++) {
        spawnDeathParticle(particles, e.x, e.y, e.type.bloodColor || [180, 30, 30]);
      }
      // Type-specific on-death side effects (bomber detonate, splitter spawn).
      if (enemies && Enemies.onKilled) Enemies.onKilled(e, p, enemies, particles);
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
      if (dist > maxDist) return maxDist;
      const t = GameMap.getTile(mapX, mapY);
      if (t >= 1 && t <= 4) return dist;
    }
    return maxDist;
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

  function spawnDeathParticle(particles, x, y, color) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 5,
      vy: (Math.random() - 0.5) * 5,
      zOffset: Math.random() * 0.5,
      vz: 1 + Math.random() * 3,
      size: 4 + Math.random() * 4,
      color,
      life: 1.0
    });
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

  const WEAPON_ORDER = ['pistol', 'shotgun', 'machinegun', 'sniper'];

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

  function takeDamage(p, dmg) {
    const actual = dmg * (1 / Math.max(0.5, p.defenseMult));
    p.hp = Math.max(0, p.hp - actual);
    Audio.playerHit();
    p.shake = Math.max(p.shake, 8);
  }

  return {
    create, update, turn, shoot, startReload, switchWeapon, cycleWeapon, takeDamage, getWeapon,
    spawnExplosion
  };
})();
