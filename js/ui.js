// HUD updates, menus, minimap, upgrade selection
const UI = (() => {
  const $ = id => document.getElementById(id);

  // ---------- State ----------
  let minimapCtx;
  // setTimeout handle for the auto-hide on the mid-run "신기록" banner. Kept
  // module-scoped so a second record breaking before the first banner fades
  // doesn't leave a stale timeout that hides the new one early.
  let _recordBannerTimer = 0;

  // ---------- Init / HUD show ----------
  function init() {
    minimapCtx = $('minimap').getContext('2d');
  }

  function showHud() { $('hud').classList.remove('hidden'); }
  function hideHud() { $('hud').classList.add('hidden'); }

  function updateHud(player, wave, scoreState) {
    // HP
    $('hp-text').textContent = Math.ceil(player.hp);

    // Stamina — bar dims red while exhausted so the player sees why sprint
    // won't kick in until it refills.
    const stBar = $('stamina-bar');
    stBar.style.width = (player.stamina / player.maxStamina * 100) + '%';
    stBar.classList.toggle('exhausted', !!player.exhausted);

    // Wave / enemies
    $('wave-num').textContent = wave.number;
    $('enemies-left').textContent = wave.enemiesAlive;
    $('score').textContent = scoreState.score.toLocaleString();

    // Highlight when current value passes the snapshot best for the run.
    const wb = $('wave-best');
    if (wb && wb.dataset.value) {
      const bv = +wb.dataset.value;
      $('wave-num').classList.toggle('beat-best', bv > 0 && wave.number > bv);
    }
    const sb = $('score-best');
    if (sb && sb.dataset.value) {
      const bv = +sb.dataset.value;
      $('score').classList.toggle('beat-best', bv > 0 && scoreState.score > bv);
    }

    // Combo — comboCount is now the raw streak length; mult is capped by
    // Player.comboMultFor. Show both: large streak count, smaller multiplier.
    if (player.comboCount > 0) {
      $('combo-info').classList.remove('hidden');
      $('combo-mult').textContent = player.comboCount;
      const mult = Player.comboMultFor(player.comboCount);
      const sub = document.getElementById('combo-sub');
      if (sub) {
        if (player.gutpanActive) {
          sub.textContent = `굿판 ×${(mult * Player.GUTPAN_SCORE_MULT).toFixed(1)}`;
          sub.classList.add('gutpan');
        } else {
          sub.textContent = mult >= 1.5 ? `점수 ×${mult}` : '';
          sub.classList.remove('gutpan');
        }
      }
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

  // ---------- Minimap ----------
  function drawMinimap(player, enemies) {
    const c = minimapCtx;
    const size = 200;
    // Scale so the whole map fits even at 42+ tiles.
    const tileSize = size / Math.max(GameMap.W, GameMap.H);
    c.clearRect(0, 0, size, size);
    c.fillStyle = 'rgba(0, 0, 0, 0.55)';
    c.fillRect(0, 0, size, size);

    // Walls — gray for structures, color-tagged for special types.
    for (let y = 0; y < GameMap.H; y++) {
      for (let x = 0; x < GameMap.W; x++) {
        const t = GameMap.getTile(x, y);
        if (t >= 1 && t <= 8) {
          // Use a muted gray for most structures so the eye reads them as a single "buildings" layer.
          c.fillStyle = (t === 7) ? '#888899'        // comms tower
                      : (t === 8) ? '#d4b020'        // hazard
                      : (t === 5) ? '#a08a55'        // sandbag (slight tint)
                      : '#666666';
          c.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
        } else if (t === 9) {
          // Spawn gates as orange diamonds.
          const cx = x * tileSize + tileSize / 2;
          const cy = y * tileSize + tileSize / 2;
          const r = tileSize * 0.7;
          c.fillStyle = '#ff9933';
          c.beginPath();
          c.moveTo(cx, cy - r);
          c.lineTo(cx + r, cy);
          c.lineTo(cx, cy + r);
          c.lineTo(cx - r, cy);
          c.closePath();
          c.fill();
        }
      }
    }

    // Enemies — red dots, boss = magenta.
    for (const e of enemies) {
      if (!e.alive) continue;
      c.fillStyle = e.type.isBoss ? '#ff44ff' : '#ff4444';
      const r = e.type.isBoss ? tileSize * 0.9 : tileSize * 0.55;
      c.beginPath();
      c.arc(e.x * tileSize, e.y * tileSize, r, 0, Math.PI * 2);
      c.fill();
    }

    // Player — green triangle pointed in facing direction.
    const px = player.x * tileSize;
    const py = player.y * tileSize;
    const triR = Math.max(4, tileSize * 1.0);
    c.fillStyle = '#44ff44';
    c.beginPath();
    c.moveTo(
      px + Math.cos(player.angle) * triR,
      py + Math.sin(player.angle) * triR
    );
    c.lineTo(
      px + Math.cos(player.angle + 2.5) * triR * 0.6,
      py + Math.sin(player.angle + 2.5) * triR * 0.6
    );
    c.lineTo(
      px + Math.cos(player.angle - 2.5) * triR * 0.6,
      py + Math.sin(player.angle - 2.5) * triR * 0.6
    );
    c.closePath();
    c.fill();
  }

  // ---------- Banners (wave start, new record) ----------
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

  // "신기록!" banner — bigger and more celebratory than the wave banner.
  // Shown when the player breaks their previous best mid-run.
  function showRecordBanner(title, subtitle) {
    const wrap = $('record-banner');
    if (!wrap) return;
    $('record-banner-title').textContent = title;
    $('record-banner-sub').textContent = subtitle || '';
    wrap.classList.remove('hidden');
    wrap.style.animation = 'none';
    void wrap.offsetWidth;
    wrap.style.animation = 'record-banner-fade 3.0s ease-out forwards';
    clearTimeout(_recordBannerTimer);
    _recordBannerTimer = setTimeout(() => wrap.classList.add('hidden'), 3000);
  }

  // ---------- Title-screen records + nickname ----------
  // Renders both the all-time records and the daily-seed records (which
  // auto-reset every day).
  function updateTitleRecords(records, daily) {
    const wrap = $('best-records');
    if (wrap) {
      const fmt = (rec) => rec && rec.value > 0
        ? `${rec.value.toLocaleString()}<span class="by"> by ${escapeHtml(rec.name || '익명')}</span>`
        : '<span class="empty">기록 없음</span>';
      $('best-wave-title').innerHTML  = fmt(records.bestWave);
      $('best-score-title').innerHTML = fmt(records.bestScore);
      $('best-kills-title').innerHTML = fmt(records.bestKills);
      $('best-combo-title').innerHTML = fmt(records.bestCombo);
    }
    const dailyWrap = $('daily-records');
    if (dailyWrap && daily) {
      const dr = daily.records || {};
      const fmtDaily = (rec) => rec && rec.value > 0
        ? rec.value.toLocaleString()
        : '<span class="empty">—</span>';
      $('daily-date').textContent = daily.date || '';
      $('daily-wave').innerHTML  = fmtDaily(dr.bestWave);
      $('daily-score').innerHTML = fmtDaily(dr.bestScore);
    }
  }
  function getNickInput() {
    const el = $('nick-input');
    return el ? el.value : '';
  }
  function setNickInput(v) {
    const el = $('nick-input');
    if (el) el.value = v || '';
  }

  // ---------- HUD record markers ----------
  // BEST tags: small text next to wave/score showing the snapshot to beat.
  function setHudBest(records) {
    const wb = $('wave-best');
    const sb = $('score-best');
    if (wb) {
      const v = records.bestWave.value;
      wb.dataset.value = v;
      wb.textContent = v > 0 ? `BEST ${v}` : '';
    }
    if (sb) {
      const v = records.bestScore.value;
      sb.dataset.value = v;
      sb.textContent = v > 0 ? `BEST ${v.toLocaleString()}` : '';
    }
    $('wave-num') && $('wave-num').classList.remove('beat-best');
    $('score') && $('score').classList.remove('beat-best');
  }

  // ---------- Hit / enrage screen effects ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function flashHit() {
    const flash = $('hit-flash');
    const vig = $('damage-vignette');
    flash.classList.add('active');
    vig.classList.add('active');
    setTimeout(() => flash.classList.remove('active'), 80);
    setTimeout(() => vig.classList.remove('active'), 200);
  }

  // Boss phase-2 enrage screen flash. Heavier and longer than flashHit so
  // the player can't miss that something just shifted, but uses the same
  // vignette element so we don't add a new DOM node just for this.
  function flashEnrage() {
    const vig = $('damage-vignette');
    if (!vig) return;
    vig.classList.add('enrage');
    setTimeout(() => vig.classList.remove('enrage'), 1500);
  }

  // ---------- Overlay screens (title / pause / lock-prompt / gameover) ----------
  function showTitle() { $('title-screen').classList.remove('hidden'); }
  function hideTitle() { $('title-screen').classList.add('hidden'); }
  function showPause() { $('pause-screen').classList.remove('hidden'); }
  function hidePause() { $('pause-screen').classList.add('hidden'); }
  function showLockPrompt() { $('lock-prompt').classList.remove('hidden'); }
  function hideLockPrompt() { $('lock-prompt').classList.add('hidden'); }

  // showGameOver(stats, prevRecords, broken, nick)
  //   stats:    { wave, score, kills, headshots, bossKills, maxCombo }
  //   prevRecords: snapshot taken at run start (so the comparison reflects
  //                what THIS player had to beat, not what they just set).
  //   broken:   { wave, score, kills, combo } — booleans for what this run beat.
  //   nick:     player's nickname for the "NEW RECORD by X" line.
  function showGameOver(stats, prevRecords, broken, nick) {
    broken = broken || {};
    const anyNew = broken.wave || broken.score || broken.kills || broken.combo;

    $('final-wave').textContent  = stats.wave;
    $('final-score').textContent = stats.score.toLocaleString();
    $('final-kills').textContent = stats.kills;
    $('final-headshots').textContent = stats.headshots || 0;
    $('final-boss').textContent  = stats.bossKills || 0;
    // maxCombo is now the raw streak length, not a bucket index.
    $('final-combo').textContent = `${stats.maxCombo || 0} 연속`;

    // NEW RECORD header.
    const hdr = $('new-record-header');
    if (anyNew) {
      hdr.classList.remove('hidden');
      $('new-record-by').textContent = nick || '익명';
    } else {
      hdr.classList.add('hidden');
    }

    // Per-stat comparison rows show prev → new with deltas, and a NEW pill
    // when this run beat that specific record.
    const rows = [
      { id: 'cmp-wave',  prev: prevRecords.bestWave.value,  cur: stats.wave,     broke: broken.wave,  fmt: (n) => n },
      { id: 'cmp-score', prev: prevRecords.bestScore.value, cur: stats.score,    broke: broken.score, fmt: (n) => n.toLocaleString() },
      { id: 'cmp-kills', prev: prevRecords.bestKills.value, cur: stats.kills,    broke: broken.kills, fmt: (n) => n },
      { id: 'cmp-combo', prev: prevRecords.bestCombo.value, cur: stats.maxCombo, broke: broken.combo, fmt: (n) => `${n} 연속` }
    ];
    for (const r of rows) {
      const el = $(r.id);
      if (!el) continue;
      const cur = r.fmt(r.cur);
      const prev = r.prev > 0 ? r.fmt(r.prev) : '—';
      const pill = r.broke ? `<span class="new-pill">NEW</span>` : '';
      const diffStr = (typeof r.cur === 'number' && typeof r.prev === 'number' && r.prev > 0 && r.cur > r.prev)
        ? `<span class="diff">+${r.fmt(r.cur - r.prev)}</span>` : '';
      const need = (!r.broke && typeof r.cur === 'number' && typeof r.prev === 'number' && r.prev > r.cur)
        ? `<span class="need">−${r.fmt(r.prev - r.cur)} 부족</span>` : '';
      el.innerHTML = `<span class="cur">${cur}</span> <span class="prev">/ BEST ${prev}</span> ${diffStr}${need}${pill}`;
      el.classList.toggle('broke', !!r.broke);
    }

    $('gameover-screen').classList.remove('hidden');
  }
  function hideGameOver() { $('gameover-screen').classList.add('hidden'); }

  // ---------- Upgrade selection ----------
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
    // Seeded so the daily run gets the same upgrade card pool at each wave.
    while (picks.length < 3 && usedIdx.size < pool.length) {
      const idx = Random.int(pool.length);
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

  // ---------- First-person gun overlay ----------
  // First-person gun sprites — one per weapon. Sniper falls back to the M4.
  const GUN_SPRITES = {
    pistol:     { src: 'assets/pistol.png',   muzzle: { x: 0.21, y: 0.06 } },
    shotgun:    { src: 'assets/shotgun.png',  muzzle: { x: 0.23, y: 0.05 } },
    machinegun: { src: 'assets/gun.png',      muzzle: { x: 0.20, y: 0.10 } },
    sniper:     { src: 'assets/sniper.png',   muzzle: { x: 0.19, y: 0.05 } }
  };
  for (const w in GUN_SPRITES) {
    const def = GUN_SPRITES[w];
    def.img = new Image();
    def.loaded = false;
    def.img.onload = () => { def.loaded = true; };
    def.img.src = def.src;
  }
  const GUN_HEIGHT_FRAC = 0.55;

  // Render the player's gun in 1st person + muzzle flash + tracer to crosshair
  function renderGun(ctx, player) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const kick = player.kickback;
    const bob = player.bobOffset;

    const def = GUN_SPRITES[player.currentWeapon] || GUN_SPRITES.pistol;
    if (!def.loaded) return;
    const img = def.img;

    const aspect = img.width / img.height;
    const drawnH = H * GUN_HEIGHT_FRAC;
    const drawnW = drawnH * aspect;

    // Anchor bottom-right with sway / bob / kickback offset
    const swayX = Math.cos(player.bobPhase * 0.5) * 6;
    const swayY = Math.sin(player.bobPhase) * 3;
    const drawX = W - drawnW + swayX;
    const drawY = H - drawnH + bob * 0.6 + kick * 1.4 + swayY;

    // Preserve pixel-art crispness
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, drawX, drawY, drawnW, drawnH);
    ctx.imageSmoothingEnabled = prevSmoothing;

    // Muzzle position on screen
    const muzzleX = drawX + def.muzzle.x * drawnW;
    const muzzleY = drawY + def.muzzle.y * drawnH;

    // Crosshair target (screen center) — bullets always go here
    const cx = W / 2;
    const cy = H / 2;

    // Muzzle flash + tracer line from muzzle to crosshair
    if (player.muzzleFlash > 0) {
      const fl = player.muzzleFlash;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // Tracer line: muzzle → screen-center crosshair
      const grad = ctx.createLinearGradient(muzzleX, muzzleY, cx, cy);
      grad.addColorStop(0, `rgba(255, 240, 160, ${fl})`);
      grad.addColorStop(1, `rgba(255, 255, 220, 0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(muzzleX, muzzleY);
      ctx.lineTo(cx, cy);
      ctx.stroke();

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(255, 255, 240, ${fl})`;
      ctx.beginPath();
      ctx.moveTo(muzzleX, muzzleY);
      ctx.lineTo(cx, cy);
      ctx.stroke();

      // Muzzle flash burst
      const flashR = 30 + Math.random() * 14;
      ctx.fillStyle = `rgba(255, 200, 80, ${fl * 0.9})`;
      ctx.beginPath();
      ctx.arc(muzzleX, muzzleY, flashR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 240, 180, ${fl})`;
      ctx.beginPath();
      ctx.arc(muzzleX, muzzleY, flashR * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 255, 240, ${fl})`;
      ctx.beginPath();
      ctx.arc(muzzleX, muzzleY, flashR * 0.22, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  return {
    init, showHud, hideHud, updateHud, drawMinimap,
    showWaveBanner, flashHit, flashEnrage,
    showTitle, hideTitle, showPause, hidePause,
    showLockPrompt, hideLockPrompt,
    showGameOver, hideGameOver,
    showUpgradeMenu, hideUpgradeMenu,
    renderGun,
    showRecordBanner, updateTitleRecords, setHudBest,
    getNickInput, setNickInput
  };
})();
