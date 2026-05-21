// Enemy types, spawn logic, AI
const Enemies = (() => {
  // ---------- Type catalog ----------
  const types = {
    grunt: {
      id: 'grunt', name: '처녀귀신',
      hp: 30, speed: 1.6, damage: 10, score: 100,
      attackRange: 0.7, attackCooldown: 1.0,
      ranged: false, radius: 0.35,
      color: '#7a3344', headColor: '#552233',
      eyeColor: '#ff3333', bloodColor: [180, 30, 30]
    },
    rusher: {
      id: 'rusher', name: '몽달귀신',
      hp: 20, speed: 3.4, damage: 20, score: 150,
      attackRange: 0.7, attackCooldown: 0.8,
      ranged: false, radius: 0.3,
      color: '#cc4422', headColor: '#992211',
      eyeColor: '#ffaa00', bloodColor: [200, 60, 20]
    },
    tank: {
      id: 'tank', name: '도깨비',
      hp: 100, speed: 0.9, damage: 15, score: 300,
      attackRange: 0.9, attackCooldown: 1.5,
      ranged: false, radius: 0.45,
      color: '#445544', headColor: '#223322',
      eyeColor: '#88ff88', bloodColor: [80, 140, 80]
    },
    ranger: {
      id: 'ranger', name: '저승사자',
      hp: 40, speed: 1.3, damage: 12, score: 200,
      attackRange: 6.0, attackCooldown: 2.0,
      preferredDist: 4.5,
      ranged: true, radius: 0.35,
      color: '#3344aa', headColor: '#222266',
      eyeColor: '#66ccff', bloodColor: [60, 80, 200],
      projectileSpeed: 7.0
    },
    boss: {
      id: 'boss', name: '구미호',
      hp: 350, speed: 1.1, damage: 25, score: 1000,
      attackRange: 1.4, attackCooldown: 1.6,
      ranged: false, radius: 0.45,
      color: '#440044', headColor: '#220022',
      eyeColor: '#ff00ff', bloodColor: [180, 40, 200],
      isBoss: true,
      summonCooldown: 6.0
    },
    // Suicide bomber. Low HP, fast, explodes on death OR when it gets too
    // close to the player. Damages player + nearby enemies (chain potential).
    bomber: {
      id: 'bomber', name: '객귀',
      hp: 25, speed: 2.6, damage: 35, score: 220,
      attackRange: 0.6, attackCooldown: 0.5,
      ranged: false, radius: 0.32,
      color: '#cc6611', headColor: '#882200',
      eyeColor: '#ffee44', bloodColor: [255, 180, 60],
      explodeRadius: 1.8,
      explodeOnContact: true
    },
    // Splitter. Medium stats; on death spawns 2 smaller, faster children
    // that do not split again (capped at one generation).
    splitter: {
      id: 'splitter', name: '도깨비불',
      hp: 50, speed: 1.7, damage: 12, score: 250,
      attackRange: 0.7, attackCooldown: 1.0,
      ranged: false, radius: 0.4,
      color: '#7733aa', headColor: '#441166',
      eyeColor: '#dd66ff', bloodColor: [180, 60, 220],
      splitsInto: 'splitterChild',
      splitCount: 2
    },
    splitterChild: {
      id: 'splitterChild', name: '작은 도깨비불',
      hp: 14, speed: 2.6, damage: 7, score: 80,
      attackRange: 0.55, attackCooldown: 0.9,
      ranged: false, radius: 0.22,
      color: '#9955cc', headColor: '#552288',
      eyeColor: '#ee99ff', bloodColor: [180, 60, 220]
    }
  };

  // Apply damage to the player and flash the screen vignette. Every site
  // that hits the player wants both, so this keeps the two from drifting
  // apart (e.g. silent damage with no feedback).
  function damagePlayer(player, dmg) {
    Player.takeDamage(player, dmg);
    UI.flashHit();
  }

  // ---------- Factory ----------
  function create(type, x, y, scale = 1) {
    const def = types[type];
    return {
      x, y,
      type: def,
      hp: def.hp * scale,
      maxHp: def.hp * scale,
      damageMult: scale,
      alive: true,
      attackTimer: 0,
      summonTimer: def.summonCooldown || 0,
      hitFlash: 0,
      seenPlayer: false,
      stuckTimer: 0,
      lastX: x, lastY: y,
      // For wandering when no LoS
      wanderAngle: Math.random() * Math.PI * 2,
      wanderTimer: 0
    };
  }

  // ---------- AI update ----------
  function update(e, dt, player, projectiles, particles, enemies) {
    if (!e.alive) return;
    e.attackTimer -= dt;
    e.hitFlash = Math.max(0, e.hitFlash - dt);

    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const hasLOS = GameMap.hasLineOfSight(e.x, e.y, player.x, player.y, 25);

    if (hasLOS) e.seenPlayer = true;

    // Bomber: detonate when in melee range. No score awarded (the player
    // didn't earn the kill — they ate the explosion). Returns early so the
    // rest of the AI doesn't run on a corpse.
    if (e.type.explodeOnContact && dist < e.type.attackRange + 0.4 && hasLOS) {
      detonateBomber(e, player, enemies, particles);
      return;
    }

    let moveX = 0, moveY = 0;
    if (dist > 0.001) {
      if (e.type.ranged) {
        // Ranged: maintain preferred distance from player
        const target = e.type.preferredDist;
        if (Math.abs(dist - target) > 0.4) {
          const dir = dist > target ? 1 : -1;
          moveX = (dx / dist) * dir;
          moveY = (dy / dist) * dir;
        }
        // Attack only when LoS and in range
        if (hasLOS && dist < e.type.attackRange && e.attackTimer <= 0) {
          fireProjectile(e, player, projectiles);
          e.attackTimer = e.type.attackCooldown;
        }
      } else {
        // Melee: ALWAYS chase player. Walls handled by tryMove sliding.
        if (dist > e.type.attackRange * 0.85) {
          moveX = dx / dist;
          moveY = dy / dist;
        }
        // Attack only with LoS so they don't hit you through walls
        if (dist < e.type.attackRange && hasLOS && e.attackTimer <= 0) {
          damagePlayer(player, e.type.damage * e.damageMult);
          e.attackTimer = e.type.attackCooldown;
        }
      }

      // Boss summon — phase 2 cuts the cooldown so the player gets buried
      // in adds after the boss drops to half HP.
      if (e.type.isBoss) {
        e.summonTimer -= dt;
        if (e.summonTimer <= 0 && enemies) {
          summonAdds(e, enemies);
          e.summonTimer = e.phase2 ? 2.5 : e.type.summonCooldown;
        }
      }
    }

    // Avoid overlap with other enemies
    for (const other of enemies) {
      if (other === e || !other.alive) continue;
      const ox = e.x - other.x;
      const oy = e.y - other.y;
      const od = Math.sqrt(ox * ox + oy * oy);
      const minD = e.type.radius + other.type.radius;
      if (od < minD && od > 0.001) {
        const push = (minD - od) / minD;
        moveX += (ox / od) * push * 1.5;
        moveY += (oy / od) * push * 1.5;
      }
    }

    // 한(恨) 서림 — card-set slow tick. While slowTimer > 0 the enemy moves
    // at 50% speed; the timer decays in real time so the slow auto-clears
    // a second after the last hit.
    if (e.slowTimer && e.slowTimer > 0) e.slowTimer -= dt;
    const slowed = e.slowTimer && e.slowTimer > 0;
    const speed = e.type.speed * (slowed ? 0.5 : 1);
    const dxs = moveX * speed * dt;
    const dys = moveY * speed * dt;
    const moved = GameMap.tryMove(e.x, e.y, dxs, dys, e.type.radius);
    e.x = moved.x; e.y = moved.y;

    // Stuck detection: if barely moved towards target, sidestep
    const movedDist = Math.sqrt((e.x - e.lastX) ** 2 + (e.y - e.lastY) ** 2);
    if (movedDist < 0.02 && (moveX !== 0 || moveY !== 0)) {
      e.stuckTimer += dt;
      if (e.stuckTimer > 0.5) {
        // Try sidestep
        e.wanderAngle = Math.atan2(dy, dx) + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
        const sx = Math.cos(e.wanderAngle) * speed * dt * 2;
        const sy = Math.sin(e.wanderAngle) * speed * dt * 2;
        const m2 = GameMap.tryMove(e.x, e.y, sx, sy, e.type.radius);
        e.x = m2.x; e.y = m2.y;
        e.stuckTimer = 0;
      }
    } else {
      e.stuckTimer = 0;
    }
    e.lastX = e.x; e.lastY = e.y;
  }

  // ---------- Projectiles (ranged enemy bullets) ----------
  function fireProjectile(e, player, projectiles) {
    const dx = player.x - e.x, dy = player.y - e.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.001) return;
    projectiles.push({
      x: e.x, y: e.y,
      vx: (dx / d) * e.type.projectileSpeed,
      vy: (dy / d) * e.type.projectileSpeed,
      damage: e.type.damage * e.damageMult,
      life: 3.0,
      radius: 0.15
    });
  }

  function updateProjectiles(projectiles, dt, player, particles) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.life -= dt;
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      // Wall collision
      if (GameMap.isWall(nx, ny)) {
        for (let j = 0; j < 4; j++) {
          particles.push({
            x: p.x, y: p.y,
            vx: (Math.random() - 0.5) * 3,
            vy: (Math.random() - 0.5) * 3,
            zOffset: 0.3,
            vz: 1,
            size: 3,
            color: [120, 180, 255],
            life: 0.4
          });
        }
        projectiles.splice(i, 1);
        continue;
      }
      p.x = nx; p.y = ny;
      // Player hit
      const dx = player.x - p.x, dy = player.y - p.y;
      if (dx * dx + dy * dy < 0.16) {
        damagePlayer(player, p.damage);
        projectiles.splice(i, 1);
        continue;
      }
      if (p.life <= 0) projectiles.splice(i, 1);
    }
  }

  // ---------- Boss adds + chain kill bookkeeping ----------
  function summonAdds(boss, enemies) {
    const count = boss.phase2 ? 4 : 2;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.2;
      const x = boss.x + Math.cos(a) * r;
      const y = boss.y + Math.sin(a) * r;
      if (GameMap.canMove(x, y, 0.35)) {
        enemies.push(create('grunt', x, y, 0.8));
      }
    }
  }

  // Combo + score bookkeeping for indirect (chain / splash) kills, mirroring
  // the logic in player.damageEnemy so the player gets proper credit when an
  // explosive shot or bomber chain finishes off an enemy.
  function awardChainKill(player, victim, scoreCallback) {
    if (!scoreCallback) return;
    const t = performance.now() / 1000;
    if (t - player.lastKillTime < (3.0 + (player.comboTimeoutBonus || 0))) {
      player.comboCount = player.comboCount + 1;
    } else {
      player.comboCount = 1;
    }
    player.lastKillTime = t;
    if (player.comboCount > player.maxComboReached) {
      player.maxComboReached = player.comboCount;
    }
    const comboMult = Player.comboMultFor(player.comboCount);
    const gutpanMult = player.gutpanActive ? Player.GUTPAN_SCORE_MULT : 1;
    scoreCallback(Math.floor(victim.type.score * comboMult * gutpanMult), victim);
    player.kills++;
    if (victim.type.isBoss) player.bossKills++;
  }

  // ---------- Bomber detonation + splitter ----------
  // Bomber explosion. Damages player + nearby enemies; spawns visual burst.
  // Used both for "killed by bullet" (scoreCallback present → chain kills are
  // credited to the player) and "got too close" (no callback → bomber walked
  // into the player and the player doesn't earn the kill).
  function detonateBomber(e, player, enemies, particles, scoreCallback) {
    if (!e.alive) return;
    e.alive = false;
    Player.spawnExplosion(particles, e.x, e.y);
    Player.spawnDeathBurst(particles, e.x, e.y, e.type.bloodColor || [255, 180, 60], false, false);
    Audio.explosion();
    const r = e.type.explodeRadius;
    const r2 = r * r;
    const dmg = e.type.damage * e.damageMult;
    const dx = player.x - e.x, dy = player.y - e.y;
    if (dx * dx + dy * dy < r2) {
      damagePlayer(player, dmg);
    }
    // Chain damage other enemies. We deal raw HP only — secondary deaths
    // don't trigger their own onDeath effects, otherwise a tight clump of
    // bombers would cascade across the map.
    for (const o of enemies) {
      if (o === e || !o.alive) continue;
      const ox = o.x - e.x, oy = o.y - e.y;
      if (ox * ox + oy * oy < r2) {
        o.hp -= dmg * 0.7;
        o.hitFlash = 0.1;
        if (o.hp <= 0) {
          o.alive = false;
          Audio.enemyDeath();
          Player.spawnDeathBurst(particles, o.x, o.y, o.type.bloodColor || [180, 30, 30], false, !!o.type.isBoss);
          awardChainKill(player, o, scoreCallback);
          if (typeof Pickups !== 'undefined') Pickups.onEnemyKilled(o);
        }
      }
    }
  }

  // Splitter death: spawn `splitCount` smaller children around the corpse.
  // Each child gets 24 candidate positions (3 rings × 8 angles); valid means
  // walkable AND not inside the player's hitbox (otherwise children deal
  // unavoidable melee damage on the next frame). Falls back to parent's tile
  // if every candidate fails so the split mechanic never silently no-ops.
  function spawnSplitChildren(parent, enemies, player) {
    const childType = parent.type.splitsInto;
    if (!childType || !types[childType]) return;
    const count = parent.type.splitCount || 2;
    const childRadius = types[childType].radius;
    const playerSafeDist = (player ? player.radius : 0.25) + childRadius + 0.1;
    const psd2 = playerSafeDist * playerSafeDist;

    function isValid(x, y) {
      if (!GameMap.canMove(x, y, childRadius)) return false;
      if (player) {
        const pdx = x - player.x, pdy = y - player.y;
        if (pdx * pdx + pdy * pdy < psd2) return false;
      }
      return true;
    }

    const ringDistances = [
      parent.type.radius + childRadius + 0.05,
      parent.type.radius + childRadius - 0.05,
      childRadius + 0.05
    ];

    for (let i = 0; i < count; i++) {
      const baseAngle = (i / count) * Math.PI * 2;
      let placed = false;
      for (const r of ringDistances) {
        for (let j = 0; j < 8 && !placed; j++) {
          const a = baseAngle + (j / 8) * Math.PI * 2 + Math.random() * 0.2;
          const x = parent.x + Math.cos(a) * r;
          const y = parent.y + Math.sin(a) * r;
          if (isValid(x, y)) {
            const child = create(childType, x, y, parent.damageMult);
            child.isChild = true;
            enemies.push(child);
            placed = true;
          }
        }
        if (placed) break;
      }
      // Last-resort: spawn on the parent's tile. Enemy collision separation
      // (in update()) will push it out on the next frame. Better than the
      // splitter giving the player full score with no follow-up threat.
      if (!placed) {
        const child = create(childType, parent.x, parent.y, parent.damageMult);
        child.isChild = true;
        enemies.push(child);
      }
    }
  }

  // ---------- On-killed dispatch (player.damageEnemy hook) ----------
  // Called from player.js after a bullet kill resolves. Lets enemy types
  // run their own death side-effects (split, explode) without coupling
  // player.js to specific type ids. scoreCallback is forwarded so chain
  // kills from a player-triggered detonation count toward score/kills/combo.
  function onKilled(e, player, enemies, particles, scoreCallback) {
    if (e.type.explodeOnContact) {
      // Bullet-killed bomber still detonates. alive is already false; reset
      // so detonateBomber's guard passes, then immediately set false again.
      e.alive = true;
      detonateBomber(e, player, enemies, particles, scoreCallback);
    } else if (e.type.splitsInto) {
      spawnSplitChildren(e, enemies, player);
    }
  }

  // ---------- Wave composition ----------
  function buildWave(waveNum) {
    // Returns array of {type, scale}
    const out = [];
    const scale = Math.pow(1.10, Math.max(0, waveNum - 1)); // hp scale
    if (waveNum === 1) return Array(3).fill(0).map(() => ({ type: 'grunt', scale }));
    if (waveNum === 2) return Array(5).fill(0).map(() => ({ type: 'grunt', scale }));
    if (waveNum === 3) return Array(8).fill(0).map(() => ({ type: 'grunt', scale }));
    if (waveNum === 4) {
      return [
        ...Array(6).fill(0).map(() => ({ type: 'grunt', scale })),
        ...Array(3).fill(0).map(() => ({ type: 'rusher', scale }))
      ];
    }
    if (waveNum === 5) {
      return [
        { type: 'boss', scale: 1.0 },
        ...Array(4).fill(0).map(() => ({ type: 'grunt', scale }))
      ];
    }

    // Wave 6+: mix all enemy types, scaling. Uses Random (seeded) so daily
    // runs face the same composition order — that's the whole point of the
    // daily-seed challenge.
    const total = Math.min(20, 8 + Math.floor((waveNum - 5) * 1.5));
    const isBossWave = waveNum % 5 === 0;

    if (isBossWave) {
      const bossScale = 1 + (waveNum - 5) / 10;
      out.push({ type: 'boss', scale: bossScale });
    }

    const remaining = total - (isBossWave ? 1 : 0);
    for (let i = 0; i < remaining; i++) {
      const r = Random.next();
      let t;
      if (r < 0.30) t = 'grunt';
      else if (r < 0.50) t = 'rusher';
      else if (r < 0.65) t = 'tank';
      else if (r < 0.78) t = 'ranger';
      else if (r < 0.90) t = 'bomber';
      else t = 'splitter';
      out.push({ type: t, scale });
    }
    return out;
  }

  return { types, create, update, updateProjectiles, buildWave, onKilled };
})();
