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
        ? rec.value.toLocaleString()
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
  // ---------- Online leaderboard (Firestore) ----------
  // Each list takes either an array of {name, score, wave} rows, [] for an
  // empty board, or null when the board is offline/disabled.
  function renderOnlineList(el, rows) {
    if (!el) return;
    if (rows == null) { el.innerHTML = '<li class="ol-empty">오프라인</li>'; return; }
    if (rows.length === 0) { el.innerHTML = '<li class="ol-empty">아직 기록 없음</li>'; return; }
    el.innerHTML = rows.map((r, i) =>
      '<li>' +
        `<span class="ol-rank">${i + 1}</span>` +
        `<span class="ol-name">${escapeHtml(r.name || '익명')}</span>` +
        `<span class="ol-score">${Number(r.score || 0).toLocaleString()}</span>` +
        `<span class="ol-wave">W${Number(r.wave || 0)}</span>` +
      '</li>'
    ).join('');
  }
  function setLeaderboard(allTime, daily) {
    renderOnlineList($('online-alltime'), allTime);
    renderOnlineList($('online-daily'), daily);
  }
  function setLeaderboardStatus(text) {
    const el = $('online-status');
    if (el) el.textContent = text || '';
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
  // ---------- Upgrade card pool ----------
  // Categories drive the card border colour; titles use 무속 vocabulary
  // (신기, 살, 굿판 연…) so even brand-new cards read as in-world items
  // rather than generic stat upgrades. Card effects mutate player fields
  // that player.shoot / damageEnemy and main.updateGutpan read live, so
  // adding a new card is just: write the apply() and surface the field.
  const upgrades = [
    // ── 공격 ──
    { cat: 'attack', icon: '⚔', title: '신기(神氣) 강화', desc: '모든 무기 데미지 +15%',
      apply: (p) => { p.damageMult *= 1.15; } },
    { cat: 'attack', icon: '⚡', title: '박수의 손놀림', desc: '모든 무기 발사 속도 +10%',
      apply: (p) => { p.fireRateMult *= 1.10; } },
    { cat: 'attack', icon: '🎯', title: '정수리 일격', desc: '헤드샷 데미지 ×3 (기본 ×2)',
      apply: (p) => { p.headshotMult *= 1.5; } },
    { cat: 'attack', icon: '🔥', title: '살(煞) 명중', desc: '20% 확률로 치명타 ×1.5',
      apply: (p) => { p.critChance = Math.min(1, p.critChance + 0.20); } },
    { cat: 'attack', icon: '🏹', title: '천도부(薦度符)', desc: '공격이 적을 1명 더 관통',
      apply: (p) => { p.pierce += 1; } },

    // ── 방어 ──
    { cat: 'defense', icon: '✚', title: '영약 한 모금', desc: '체력 +25 즉시 회복',
      apply: (p) => { p.hp = Math.min(p.maxHp, p.hp + 25); } },
    { cat: 'defense', icon: '❤', title: '명(命) 확장', desc: '최대 체력 +20 · 풀회복',
      apply: (p) => { p.maxHp += 20; p.hp = p.maxHp; } },
    { cat: 'defense', icon: '🛡', title: '부적 갑주', desc: '받는 피해 -10%',
      apply: (p) => { p.defenseMult *= 1.10; } },
    { cat: 'defense', icon: '👟', title: '신령한 발걸음', desc: '이동·달리기 속도 +10%',
      apply: (p) => { p.moveSpeedMult *= 1.10; } },

    // ── 굿판 / 콤보 ──
    { cat: 'gutpan', icon: '🥁', title: '굿판 연(連)', desc: '콤보 유지 시간 +1초',
      apply: (p) => { p.comboTimeoutBonus += 1.0; } },
    { cat: 'gutpan', icon: '🎶', title: '무당의 흥', desc: '굿판 모드 지속 +2초',
      apply: (p) => { p.gutpanDurationBonus += 2.0; } },
    { cat: 'gutpan', icon: '🪘', title: '사물놀이', desc: '굿판 발동 임계 콤보 -1',
      apply: (p) => { p.gutpanThresholdReduction += 1; } },

    // ── 특수 ──
    { cat: 'utility', icon: '💥', title: '부적 폭(爆)', desc: '명중 지점에 범위 피해',
      apply: (p) => { p.explosive = true; } },
    { cat: 'utility', icon: '👻', title: '분신부(分身符)', desc: '50% 확률로 추가 1발',
      apply: (p) => { p.doubleShot = true; } },
    { cat: 'utility', icon: '🕸', title: '한(恨) 서림', desc: '명중 시 적 1초 둔화',
      apply: (p) => { p.slowOnHit = true; } },
    { cat: 'utility', icon: '🌀', title: '혼(魂) 흡수', desc: '처치 시 체력 +5 (보스 +25)',
      apply: (p) => { p.soulSiphon = true; } },
    { cat: 'utility', icon: '♥', title: '회생부(回生符)', desc: '3초마다 체력 +1',
      apply: (p) => { p.autoHeal = true; p.autoHealTimer = 3.0; } },
    { cat: 'utility', icon: '📜', title: '부적 다발', desc: '모든 무기 탄약 풀충전',
      apply: (p) => {
        for (const k in p.loadout) {
          const w = p.loadout[k];
          w.currentAmmo = w.magSize;
          if (!w.ammoInfinite) w.reserveAmmo = Math.max(w.reserveAmmo, w.magSize * 4);
        }
      }}
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
      out.push({ cat: 'attack', icon: '🧂', title: '소금총 해금', desc: '묵직한 산탄 한 방 결정타 (키 2)', apply: (p) => swap(p, 'shotgun') });
    }
    if (!player.loadout.machinegun.unlocked) {
      out.push({ cat: 'attack', icon: '🔔', title: '방울총 해금', desc: '빠른 산탄 잡몹 정리 (키 3)', apply: (p) => swap(p, 'machinegun') });
    }
    if (!player.loadout.sniper.unlocked) {
      out.push({ cat: 'attack', icon: '🍑', title: '복숭아 활 해금', desc: '정밀 저격 한 방 (키 4)', apply: (p) => swap(p, 'sniper') });
    }
    return out;
  }

  function showUpgradeMenu(player, clearedWave, onSelect) {
    $('cleared-wave').textContent = clearedWave;
    const opts = $('upgrade-options');
    opts.innerHTML = '';

    // Build pool: standard + weapon unlocks. Boolean toggle cards (분신부,
    // 부적 폭, 한 서림, 혼 흡수, 회생부) become dead picks once owned, so we
    // strip them from the pool when the player already has them. Repeatable
    // cards (stat bumps) stay in.
    const ownedToggles = new Set();
    if (player.explosive) ownedToggles.add('부적 폭(爆)');
    if (player.doubleShot) ownedToggles.add('분신부(分身符)');
    if (player.slowOnHit) ownedToggles.add('한(恨) 서림');
    if (player.soulSiphon) ownedToggles.add('혼(魂) 흡수');
    if (player.autoHeal) ownedToggles.add('회생부(回生符)');
    const filtered = upgrades.filter((u) => !ownedToggles.has(u.title));
    const pool = [...filtered, ...getWeaponUnlockUpgrades(player)];

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
  // First-person gun sprites — one per weapon. The 복숭아활 has a second
  // "release" frame (string loosed, arrow gone) shown briefly on each shot.
  const GUN_SPRITES = {
    pistol:     { src: 'assets/pistol.webp',   muzzle: { x: 0.28, y: 0.16 } },
    shotgun:    { src: 'assets/shotgun.webp',  muzzle: { x: 0.34, y: 0.13 } },
    machinegun: { src: 'assets/gun.webp',      muzzle: { x: 0.28, y: 0.06 } },
    sniper:     { src: 'assets/sniper.webp', fireSrc: 'assets/sniper_fire.webp', scale: 1.28, muzzle: { x: 0.30, y: 0.42 } }
  };
  for (const w in GUN_SPRITES) {
    const def = GUN_SPRITES[w];
    def.img = new Image();
    def.loaded = false;
    def.img.onload = () => { def.loaded = true; };
    def.img.src = def.src;
    if (def.fireSrc) {
      def.fireImg = new Image();
      def.fireLoaded = false;
      def.fireImg.onload = () => { def.fireLoaded = true; };
      def.fireImg.src = def.fireSrc;
    }
  }
  const GUN_HEIGHT_FRAC = 0.55;

  // ---------- 부적 발사체 (talisman projectile) ----------
  // The 부적총 is hitscan for damage, but a paper talisman visibly flies from
  // the muzzle toward the crosshair on each shot for "한 발이 의식" weight.
  // Purely cosmetic + screen-space, so it stays self-contained in the HUD.
  const talismanImg = new Image();
  let talismanLoaded = false;
  talismanImg.onload = () => { talismanLoaded = true; };
  talismanImg.src = 'assets/talisman_shot.png';

  const flyingTalismans = [];
  const TALISMAN_DUR = 300; // ms muzzle → vanishing point

  // Called from Player.shoot when the 부적총 fires a shot. One talisman flies
  // straight from the muzzle to the crosshair, tumbling + fluttering like a
  // bill spat out of a money gun (rather than a stiff upright card).
  function fireTalisman() {
    flyingTalismans.push({
      born: (typeof performance !== 'undefined' ? performance.now() : Date.now()),
      sx: null, sy: null,          // spawn muzzle pos, captured on first draw
      lean: (Math.random() - 0.5) * 0.16,       // tiny fixed tilt off horizontal
      ox: 0, oy: 0,
      scl: 1
    });
  }

  // Draw + advance the flying talismans. Called from renderGun once the muzzle
  // screen position for this frame is known.
  function renderTalismans(ctx, muzzleX, muzzleY, cx, cy, drawnW) {
    if (flyingTalismans.length === 0) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;

    for (let i = flyingTalismans.length - 1; i >= 0; i--) {
      const t = flyingTalismans[i];
      if (t.sx === null) { t.sx = muzzleX; t.sy = muzzleY; }
      const prog = (now - t.born) / TALISMAN_DUR;
      if (prog >= 1) { flyingTalismans.splice(i, 1); continue; }
      if (prog < 0) continue;        // staggered ones not yet launched

      // Each talisman flies toward a scattered point near the crosshair so the
      // burst fans out, then shrinks into the distance.
      const tx = cx + t.ox * drawnW;
      const ty = cy + t.oy * drawnW;
      const e = 1 - (1 - prog) * (1 - prog);
      const px = t.sx + (tx - t.sx) * e;
      const py = t.sy + (ty - t.sy) * e;

      // The muzzle is a horizontal slit, so the bill leaves as a flat "ㅡ":
      // the art is already landscape — keep it horizontal, squash the height a
      // little for a laid-flat look, and shrink it as it recedes to the
      // crosshair so it reads as a banknote spat straight out the barrel.
      const billW = drawnW * t.scl * (0.16 * (1 - e) + 0.018);
      const foreshort = 0.80 - 0.18 * prog;
      const rot = t.lean;
      const alpha = prog < 0.85 ? 1 : (1 - prog) / 0.15;

      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(px, py);
      ctx.rotate(rot);
      if (talismanLoaded && talismanImg.width) {
        const ar = talismanImg.width / talismanImg.height;   // landscape (>1)
        const w = billW;
        const h = (billW / ar) * foreshort;
        ctx.drawImage(talismanImg, -w / 2, -h / 2, w, h);
      } else {
        // Fallback: a flat horizontal yellow bill with red border bands.
        const w = billW;
        const h = (billW / 2.1) * foreshort;
        const band = Math.max(1, h * 0.14);
        ctx.fillStyle = '#f4c430';
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = '#c0202a';
        ctx.fillRect(-w / 2, -h / 2, w, band);
        ctx.fillRect(-w / 2, h / 2 - band, w, band);
      }
      ctx.restore();
    }

    ctx.imageSmoothingEnabled = prevSmoothing;
  }

  // Render the player's gun in 1st person + muzzle flash + tracer to crosshair
  function renderGun(ctx, player) {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const kick = player.kickback;
    const bob = player.bobOffset;

    const def = GUN_SPRITES[player.currentWeapon] || GUN_SPRITES.pistol;
    if (!def.loaded) return;
    // Swap to the release frame for the first moment after a shot (used by the
    // 복숭아활: string loosed + arrow gone). Both frames share the same canvas
    // crop so the bow doesn't jump.
    const firing = def.fireImg && def.fireLoaded && player.muzzleFlash > 0.5;
    const img = firing ? def.fireImg : def.img;

    const aspect = img.width / img.height;
    // Optional per-weapon size multiplier (e.g. the 복숭아활 reads bigger).
    const drawnH = H * GUN_HEIGHT_FRAC * (def.scale || 1);
    const drawnW = drawnH * aspect;

    // Anchor toward the lower-right, but pulled left a bit so the weapon sits
    // more centred in view rather than hugging the right edge.
    const swayX = Math.cos(player.bobPhase * 0.5) * 6;
    const swayY = Math.sin(player.bobPhase) * 3;
    const drawX = W - drawnW + swayX - W * 0.12;
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

    // 부적 발사체 — paper talismans flying from muzzle toward the crosshair
    renderTalismans(ctx, muzzleX, muzzleY, cx, cy, drawnW);

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
    renderGun, fireTalisman,
    showRecordBanner, updateTitleRecords, setHudBest,
    setLeaderboard, setLeaderboardStatus,
    getNickInput, setNickInput
  };
})();
