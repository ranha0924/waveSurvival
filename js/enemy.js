// Enemy types, spawn logic, AI
const Enemies = (() => {
  const types = {
    grunt: {
      id: 'grunt', name: '졸개',
      hp: 30, speed: 1.6, damage: 10, score: 100,
      attackRange: 0.7, attackCooldown: 1.0,
      ranged: false, radius: 0.35,
      color: '#7a3344', headColor: '#552233',
      eyeColor: '#ff3333', bloodColor: [180, 30, 30]
    },
    rusher: {
      id: 'rusher', name: '돌진형',
      hp: 20, speed: 3.4, damage: 20, score: 150,
      attackRange: 0.7, attackCooldown: 0.8,
      ranged: false, radius: 0.3,
      color: '#cc4422', headColor: '#992211',
      eyeColor: '#ffaa00', bloodColor: [200, 60, 20]
    },
    tank: {
      id: 'tank', name: '탱커',
      hp: 100, speed: 0.9, damage: 15, score: 300,
      attackRange: 0.9, attackCooldown: 1.5,
      ranged: false, radius: 0.45,
      color: '#445544', headColor: '#223322',
      eyeColor: '#88ff88', bloodColor: [80, 140, 80]
    },
    ranger: {
      id: 'ranger', name: '원거리',
      hp: 40, speed: 1.3, damage: 12, score: 200,
      attackRange: 6.0, attackCooldown: 2.0,
      preferredDist: 4.5,
      ranged: true, radius: 0.35,
      color: '#3344aa', headColor: '#222266',
      eyeColor: '#66ccff', bloodColor: [60, 80, 200],
      projectileSpeed: 7.0
    },
    boss: {
      id: 'boss', name: '보스',
      hp: 350, speed: 1.1, damage: 25, score: 1000,
      attackRange: 1.2, attackCooldown: 1.6,
      ranged: false, radius: 0.6,
      color: '#440044', headColor: '#220022',
      eyeColor: '#ff00ff', bloodColor: [180, 40, 200],
      isBoss: true,
      summonCooldown: 6.0
    }
  };

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

  function update(e, dt, player, projectiles, particles, enemies) {
    if (!e.alive) return;
    e.attackTimer -= dt;
    e.hitFlash = Math.max(0, e.hitFlash - dt);

    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const hasLOS = GameMap.hasLineOfSight(e.x, e.y, player.x, player.y, 25);

    if (hasLOS) e.seenPlayer = true;

    let moveX = 0, moveY = 0;
    if (e.seenPlayer && dist > 0.001) {
      if (e.type.ranged) {
        // Ranged: maintain preferred distance
        const target = e.type.preferredDist;
        if (Math.abs(dist - target) > 0.4) {
          const dir = dist > target ? 1 : -1;
          moveX = (dx / dist) * dir;
          moveY = (dy / dist) * dir;
        }
        // Attack
        if (hasLOS && dist < e.type.attackRange && e.attackTimer <= 0) {
          fireProjectile(e, player, projectiles);
          e.attackTimer = e.type.attackCooldown;
        }
      } else {
        // Melee: chase
        if (dist > e.type.attackRange) {
          moveX = dx / dist;
          moveY = dy / dist;
        }
        if (dist < e.type.attackRange && e.attackTimer <= 0) {
          // Attack player
          if (hasLOS) {
            Player.takeDamage(player, e.type.damage * e.damageMult);
            UI.flashHit();
            e.attackTimer = e.type.attackCooldown;
          }
        }
      }

      // Boss summon
      if (e.type.isBoss) {
        e.summonTimer -= dt;
        if (e.summonTimer <= 0 && enemies) {
          summonAdds(e, enemies);
          e.summonTimer = e.type.summonCooldown;
        }
      }
    } else {
      // Wander
      e.wanderTimer -= dt;
      if (e.wanderTimer <= 0) {
        e.wanderAngle = Math.random() * Math.PI * 2;
        e.wanderTimer = 1 + Math.random() * 2;
      }
      moveX = Math.cos(e.wanderAngle) * 0.4;
      moveY = Math.sin(e.wanderAngle) * 0.4;
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

    const speed = e.type.speed;
    const dxs = moveX * speed * dt;
    const dys = moveY * speed * dt;
    const moved = GameMap.tryMove(e.x, e.y, dxs, dys, e.type.radius);
    e.x = moved.x; e.y = moved.y;

    // Stuck detection: if barely moved towards target
    const movedDist = Math.sqrt((e.x - e.lastX) ** 2 + (e.y - e.lastY) ** 2);
    if (movedDist < 0.02 && e.seenPlayer) {
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
        Player.spawnImpactParticles ? null : null;
        // simple impact
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
        Player.takeDamage(player, p.damage);
        UI.flashHit();
        projectiles.splice(i, 1);
        continue;
      }
      if (p.life <= 0) projectiles.splice(i, 1);
    }
  }

  function summonAdds(boss, enemies) {
    const count = 2;
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

  // Wave composition logic
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

    // Wave 6+: mix all enemy types, scaling
    const total = Math.min(20, 8 + Math.floor((waveNum - 5) * 1.5));
    const isBossWave = waveNum % 5 === 0;

    if (isBossWave) {
      const bossScale = 1 + (waveNum - 5) / 10;
      out.push({ type: 'boss', scale: bossScale });
    }

    const remaining = total - (isBossWave ? 1 : 0);
    for (let i = 0; i < remaining; i++) {
      const r = Math.random();
      let t;
      if (r < 0.40) t = 'grunt';
      else if (r < 0.65) t = 'rusher';
      else if (r < 0.85) t = 'tank';
      else t = 'ranger';
      out.push({ type: t, scale });
    }
    return out;
  }

  return { types, create, update, updateProjectiles, buildWave };
})();
