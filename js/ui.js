// HUD updates, menus, minimap, upgrade selection
const UI = (() => {
  const $ = id => document.getElementById(id);

  let minimapCtx;
  let _hitFlashTimer = 0;

  function init() {
    minimapCtx = $('minimap').getContext('2d');
  }

  function showHud() { $('hud').classList.remove('hidden'); }
  function hideHud() { $('hud').classList.add('hidden'); }

  function updateHud(player, wave, scoreState) {
    // HP
    const hpPct = (player.hp / player.maxHp) * 100;
    $('hp-bar').style.width = hpPct + '%';
    $('hp-text').textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;

    // Stamina
    $('stamina-bar').style.width = (player.stamina / player.maxStamina * 100) + '%';

    // Wave / enemies
    $('wave-num').textContent = wave.number;
    $('enemies-left').textContent = wave.enemiesAlive;
    $('score').textContent = scoreState.score.toLocaleString();

    // Combo
    if (player.comboCount > 0) {
      const mults = [1, 1.5, 2, 3];
      $('combo-info').classList.remove('hidden');
      $('combo-mult').textContent = mults[player.comboCount] || 1;
    } else {
      $('combo-info').classList.add('hidden');
    }

    // Weapon / ammo
    const w = Player.getWeapon(player);
    $('weapon-name').textContent = w.name + (player.reloading ? ' (재장전 중...)' : '');
    if (w.ammoInfinite) {
      $('ammo-current').textContent = w.currentAmmo;
      $('ammo-max').textContent = '∞';
    } else {
      $('ammo-current').textContent = w.currentAmmo;
      $('ammo-max').textContent = w.magSize + ' (' + w.reserveAmmo + ')';
    }
  }

  function drawMinimap(player, enemies) {
    const c = minimapCtx;
    const size = 160;
    const tileSize = size / GameMap.W;
    c.clearRect(0, 0, size, size);
    c.fillStyle = 'rgba(0, 0, 0, 0.5)';
    c.fillRect(0, 0, size, size);

    // Walls
    for (let y = 0; y < GameMap.H; y++) {
      for (let x = 0; x < GameMap.W; x++) {
        const t = GameMap.getTile(x, y);
        if (t >= 1 && t <= 4) {
          const colors = GameMap.getWallColor(t);
          c.fillStyle = colors.light;
          c.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
        } else if (t === 9) {
          c.fillStyle = 'rgba(255, 80, 80, 0.5)';
          c.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
        }
      }
    }

    // Enemies
    for (const e of enemies) {
      if (!e.alive) continue;
      c.fillStyle = e.type.isBoss ? '#ff00ff' : '#ff4444';
      const sz = e.type.isBoss ? tileSize * 1.4 : tileSize * 0.9;
      c.fillRect(e.x * tileSize - sz/2, e.y * tileSize - sz/2, sz, sz);
    }

    // Player
    c.fillStyle = '#44ff44';
    c.beginPath();
    c.arc(player.x * tileSize, player.y * tileSize, tileSize * 0.6, 0, Math.PI * 2);
    c.fill();

    // View cone
    c.strokeStyle = 'rgba(80, 255, 80, 0.6)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(player.x * tileSize, player.y * tileSize);
    const fovHalf = Math.PI / 6;
    const len = 4 * tileSize;
    c.lineTo(
      player.x * tileSize + Math.cos(player.angle - fovHalf) * len,
      player.y * tileSize + Math.sin(player.angle - fovHalf) * len
    );
    c.moveTo(player.x * tileSize, player.y * tileSize);
    c.lineTo(
      player.x * tileSize + Math.cos(player.angle + fovHalf) * len,
      player.y * tileSize + Math.sin(player.angle + fovHalf) * len
    );
    c.stroke();
  }

  // Show banner like "WAVE 3"
  function showWaveBanner(text) {
    const b = $('wave-banner');
    b.textContent = text;
    b.classList.remove('hidden');
    // Restart animation
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = 'banner-fade 2.5s ease-out forwards';
    setTimeout(() => b.classList.add('hidden'), 2500);
  }

  function flashHit() {
    const flash = $('hit-flash');
    const vig = $('damage-vignette');
    flash.classList.add('active');
    vig.classList.add('active');
    setTimeout(() => flash.classList.remove('active'), 80);
    setTimeout(() => vig.classList.remove('active'), 200);
  }

  // Title / pause / gameover screens
  function showTitle() { $('title-screen').classList.remove('hidden'); }
  function hideTitle() { $('title-screen').classList.add('hidden'); }
  function showPause() { $('pause-screen').classList.remove('hidden'); }
  function hidePause() { $('pause-screen').classList.add('hidden'); }
  function showLockPrompt() { $('lock-prompt').classList.remove('hidden'); }
  function hideLockPrompt() { $('lock-prompt').classList.add('hidden'); }

  function showGameOver(stats) {
    $('final-wave').textContent = stats.wave;
    $('final-score').textContent = stats.score.toLocaleString();
    $('final-kills').textContent = stats.kills;
    $('gameover-screen').classList.remove('hidden');
  }
  function hideGameOver() { $('gameover-screen').classList.add('hidden'); }

  // Upgrade selection
  const upgrades = [
    // Attack
    { cat: 'attack', icon: '⚔', title: '데미지 +15%', desc: '모든 무기 데미지 증가', apply: (p) => p.damageMult *= 1.15 },
    { cat: 'attack', icon: '⚡', title: '발사속도 +10%', desc: '모든 무기 발사 속도 증가', apply: (p) => p.fireRateMult *= 1.10 },
    { cat: 'attack', icon: '🎯', title: '관통탄', desc: '총알이 적을 1명 더 관통', apply: (p) => p.pierce += 1 },
    { cat: 'attack', icon: '💥', title: '폭발탄', desc: '맞은 지점에 범위 피해', apply: (p) => p.explosive = true },
    // Defense
    { cat: 'defense', icon: '✚', title: '체력 +25 회복', desc: '체력을 25만큼 즉시 회복', apply: (p) => p.hp = Math.min(p.maxHp, p.hp + 25) },
    { cat: 'defense', icon: '❤', title: '최대체력 +20', desc: '최대 체력 증가 + 풀회복', apply: (p) => { p.maxHp += 20; p.hp = p.maxHp; } },
    { cat: 'defense', icon: '👟', title: '이동속도 +10%', desc: '이동/달리기 속도 증가', apply: (p) => p.moveSpeedMult *= 1.10 },
    { cat: 'defense', icon: '🛡', title: '방어력 +10%', desc: '받는 피해 감소', apply: (p) => p.defenseMult *= 1.10 },
    // Utility
    { cat: 'utility', icon: '🔫', title: '탄약 보급', desc: '모든 무기 탄약 풀로 채움', apply: (p) => {
      for (const k in p.loadout) {
        const w = p.loadout[k];
        w.currentAmmo = w.magSize;
        if (!w.ammoInfinite) w.reserveAmmo = Math.max(w.reserveAmmo, w.magSize * 4);
      }
    }},
    { cat: 'utility', icon: '♥', title: '자동 회복', desc: '3초마다 체력 1 회복', apply: (p) => { p.autoHeal = true; p.autoHealTimer = 3.0; } }
  ];

  function getWeaponUnlockUpgrades(player) {
    const out = [];
    const swap = (p, weapon) => {
      p.loadout[weapon].unlocked = true;
      p.currentWeapon = weapon;
      p.reloading = false;
      p.reloadTimer = 0;
      p.shootCooldown = 0.2;
    };
    if (!player.loadout.shotgun.unlocked) {
      out.push({ cat: 'utility', icon: '💣', title: '샷건 해금', desc: '근거리 광역 무기 (키 2)', apply: (p) => swap(p, 'shotgun') });
    }
    if (!player.loadout.machinegun.unlocked) {
      out.push({ cat: 'utility', icon: '🔥', title: '기관총 해금', desc: '연사력 높은 무기 (키 3)', apply: (p) => swap(p, 'machinegun') });
    }
    if (!player.loadout.sniper.unlocked) {
      out.push({ cat: 'utility', icon: '🎯', title: '저격총 해금', desc: '원거리 고데미지 (키 4)', apply: (p) => swap(p, 'sniper') });
    }
    return out;
  }

  function showUpgradeMenu(player, clearedWave, onSelect) {
    $('cleared-wave').textContent = clearedWave;
    const opts = $('upgrade-options');
    opts.innerHTML = '';

    // Build pool: standard + weapon unlocks
    const pool = [...upgrades, ...getWeaponUnlockUpgrades(player)];

    // Pick 3 random unique
    const picks = [];
    const usedIdx = new Set();
    while (picks.length < 3 && usedIdx.size < pool.length) {
      const idx = Math.floor(Math.random() * pool.length);
      if (usedIdx.has(idx)) continue;
      usedIdx.add(idx);
      picks.push(pool[idx]);
    }

    for (const u of picks) {
      const card = document.createElement('div');
      card.className = `upgrade-card ${u.cat}`;
      card.innerHTML = `
        <div class="icon">${u.icon}</div>
        <div class="title">${u.title}</div>
        <div class="desc">${u.desc}</div>
      `;
      card.addEventListener('click', () => {
        Audio.uiClick();
        u.apply(player);
        onSelect();
      });
      opts.appendChild(card);
    }

    $('upgrade-screen').classList.remove('hidden');
  }
  function hideUpgradeMenu() { $('upgrade-screen').classList.add('hidden'); }

  // Render the player's gun in 1st person (overlay on canvas)
  function renderGun(ctx, player) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const w = Player.getWeapon(player);
    const kick = player.kickback;
    const bob = player.bobOffset;

    // Position at bottom center
    const gunW = W * 0.32;
    const gunH = H * 0.30;
    const cx = W / 2 + Math.cos(player.bobPhase * 0.5) * 6 - 5;
    const cy = H - gunH * 0.6 + bob * 0.5 + kick * 1.2;

    ctx.save();
    ctx.translate(cx, cy);

    // Different shape per weapon
    if (w.id === 'pistol') {
      drawPistol(ctx, gunW, gunH, w.color);
    } else if (w.id === 'shotgun') {
      drawShotgun(ctx, gunW * 1.1, gunH, w.color);
    } else if (w.id === 'machinegun') {
      drawMachinegun(ctx, gunW * 1.15, gunH, w.color);
    } else {
      drawSniper(ctx, gunW * 1.3, gunH, w.color);
    }

    // Muzzle flash
    if (player.muzzleFlash > 0) {
      ctx.fillStyle = `rgba(255, 220, 100, ${player.muzzleFlash})`;
      ctx.beginPath();
      ctx.arc(0, -gunH * 0.45, 18 + Math.random() * 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 255, 200, ${player.muzzleFlash * 0.8})`;
      ctx.beginPath();
      ctx.arc(0, -gunH * 0.45, 8 + Math.random() * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPistol(ctx, w, h, color) {
    // Body
    ctx.fillStyle = '#222';
    ctx.fillRect(-w * 0.25, -h * 0.1, w * 0.5, h * 0.5);
    ctx.fillStyle = color;
    ctx.fillRect(-w * 0.22, -h * 0.07, w * 0.44, h * 0.44);
    // Barrel
    ctx.fillStyle = '#111';
    ctx.fillRect(-w * 0.07, -h * 0.5, w * 0.14, h * 0.45);
    ctx.fillStyle = '#333';
    ctx.fillRect(-w * 0.05, -h * 0.5, w * 0.1, h * 0.43);
    // Grip
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(-w * 0.18, h * 0.35, w * 0.36, h * 0.3);
  }

  function drawShotgun(ctx, w, h, color) {
    ctx.fillStyle = '#3a2a1a';
    ctx.fillRect(-w * 0.3, h * 0.0, w * 0.6, h * 0.4);
    ctx.fillStyle = color;
    ctx.fillRect(-w * 0.07, -h * 0.6, w * 0.14, h * 0.7);
    ctx.fillStyle = '#222';
    ctx.fillRect(-w * 0.1, -h * 0.6, w * 0.2, h * 0.1);
    // Pump
    ctx.fillStyle = '#5a3a1a';
    ctx.fillRect(-w * 0.13, -h * 0.15, w * 0.26, h * 0.18);
  }

  function drawMachinegun(ctx, w, h, color) {
    ctx.fillStyle = '#222';
    ctx.fillRect(-w * 0.3, -h * 0.1, w * 0.6, h * 0.5);
    ctx.fillStyle = color;
    ctx.fillRect(-w * 0.27, -h * 0.07, w * 0.54, h * 0.44);
    ctx.fillStyle = '#111';
    ctx.fillRect(-w * 0.06, -h * 0.65, w * 0.12, h * 0.6);
    // Magazine
    ctx.fillStyle = '#181818';
    ctx.fillRect(-w * 0.08, h * 0.4, w * 0.16, h * 0.3);
    // Stock
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(-w * 0.45, 0, w * 0.18, h * 0.35);
  }

  function drawSniper(ctx, w, h, color) {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(-w * 0.4, -h * 0.05, w * 0.8, h * 0.4);
    ctx.fillStyle = color;
    ctx.fillRect(-w * 0.05, -h * 0.7, w * 0.1, h * 0.7);
    // Scope
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(-w * 0.12, -h * 0.25, w * 0.24, h * 0.15);
    ctx.beginPath();
    ctx.fillStyle = '#000';
    ctx.arc(0, -h * 0.18, h * 0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(80,200,255,0.4)';
    ctx.beginPath();
    ctx.arc(0, -h * 0.18, h * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }

  return {
    init, showHud, hideHud, updateHud, drawMinimap,
    showWaveBanner, flashHit,
    showTitle, hideTitle, showPause, hidePause,
    showLockPrompt, hideLockPrompt,
    showGameOver, hideGameOver,
    showUpgradeMenu, hideUpgradeMenu,
    renderGun
  };
})();
