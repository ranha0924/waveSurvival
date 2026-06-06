// Main entry: state machine, input, game loop, wave manager
(() => {
  // ---------- State enum ----------
  const STATE = {
    TITLE: 'title',
    PLAYING: 'playing',
    PAUSED: 'paused',
    UPGRADE: 'upgrade',
    GAMEOVER: 'gameover',
    WAVE_INTERMISSION: 'wave_intermission'
  };

  // The four persistent best stats, in one table — drives sanitize / save /
  // bump logic so every site that touches records is consistent. `flag` is
  // the short name used in UI's "broken" map.
  const BEST_FIELDS = [
    { key: 'bestWave',  stat: 'wave',  flag: 'wave'  },
    { key: 'bestScore', stat: 'score', flag: 'score' },
    { key: 'bestKills', stat: 'kills', flag: 'kills' },
    { key: 'bestCombo', stat: 'combo', flag: 'combo' }
  ];
  const BEST_KEYS = BEST_FIELDS.map(f => f.key);

  // ---------- Records (localStorage persistence) ----------
  // Persistent best records keyed in localStorage. Each "best" stat is paired
  // with the nickname that set it, so the title screen can show who holds it.
  // Daily records use a separate slot that auto-resets when the date changes,
  // so the daily-seed leaderboard is fresh each day.
  const Records = {
    KEY:       'wavesurvival_records_v1',
    DAILY_KEY: 'wavesurvival_daily_v1',
    NICK_KEY:  'wavesurvival_nick_v1',
    empty() {
      const r = { totalRuns: 0 };
      for (const k of BEST_KEYS) r[k] = { value: 0, name: '' };
      return r;
    },
    emptyDaily() {
      return { date: Random.todayString(), records: Records.empty() };
    },
    // Coerce an arbitrary parsed payload back into the canonical record
    // shape. Guards against (a) older schema versions that stored bare
    // numbers, (b) external tampering with localStorage, (c) partial writes.
    // Without this the game-over screen crashes when reading prev.bestX.value.
    sanitize(raw) {
      const out = Records.empty();
      if (!raw || typeof raw !== 'object') return out;
      for (const k of BEST_KEYS) {
        const v = raw[k];
        if (v && typeof v === 'object' && typeof v.value === 'number' && isFinite(v.value)) {
          out[k] = {
            value: Math.max(0, v.value),
            name: typeof v.name === 'string' ? v.name : ''
          };
        }
      }
      if (typeof raw.totalRuns === 'number' && isFinite(raw.totalRuns)) {
        out.totalRuns = Math.max(0, raw.totalRuns | 0);
      }
      return out;
    },
    load() {
      try {
        const raw = localStorage.getItem(Records.KEY);
        if (!raw) return Records.empty();
        return Records.sanitize(JSON.parse(raw));
      } catch (e) { return Records.empty(); }
    },
    // Re-read storage just before writing and take max(field) so a stale or
    // empty in-memory snapshot never regresses a higher value already saved.
    // Without this, any transient load failure (parse error, schema mismatch,
    // storage access blip) followed by a save would clobber the real bests
    // with the current run's stats — the "high score resets after a day"
    // failure mode some players hit.
    save(r) {
      try {
        const onDisk = Records.load();
        const merged = Records.empty();
        for (const k of BEST_KEYS) {
          const a = (r && r[k]) || merged[k];
          const b = onDisk[k];
          merged[k] = (a.value >= b.value) ? a : b;
        }
        merged.totalRuns = Math.max(
          (r && typeof r.totalRuns === 'number') ? r.totalRuns : 0,
          onDisk.totalRuns || 0
        );
        localStorage.setItem(Records.KEY, JSON.stringify(merged));
      } catch (e) {}
    },
    loadDaily() {
      try {
        const raw = localStorage.getItem(Records.DAILY_KEY);
        if (!raw) return Records.emptyDaily();
        const d = JSON.parse(raw);
        // Auto-reset when the calendar day rolls over.
        if (!d || d.date !== Random.todayString()) return Records.emptyDaily();
        return { date: d.date, records: Records.sanitize(d.records) };
      } catch (e) { return Records.emptyDaily(); }
    },
    saveDaily(d) {
      try {
        const onDisk = Records.loadDaily();
        const sameDay = d && onDisk && d.date === onDisk.date;
        const base = sameDay ? onDisk.records : Records.empty();
        const merged = Records.empty();
        for (const k of BEST_KEYS) {
          const a = (d && d.records && d.records[k]) || merged[k];
          const b = base[k];
          merged[k] = (a.value >= b.value) ? a : b;
        }
        const out = { date: (d && d.date) || Random.todayString(), records: merged };
        localStorage.setItem(Records.DAILY_KEY, JSON.stringify(out));
      } catch (e) {}
    },
    loadNick() {
      try { return localStorage.getItem(Records.NICK_KEY) || ''; } catch (e) { return ''; }
    },
    saveNick(n) {
      try { localStorage.setItem(Records.NICK_KEY, n); } catch (e) {}
    },
    sanitizeNick(n) {
      const s = String(n || '').trim().slice(0, 12);
      return s || '익명';
    }
  };

  // Snapshot of the current run's bumpable stats. Single shape used by both
  // persistRunBests (mid-run save) and gameOver so they bump records the
  // same way.
  function currentStats() {
    return {
      wave:  game.wave.number,
      score: game.score.score,
      kills: game.player ? game.player.kills : 0,
      combo: game.player ? game.player.maxComboReached : 0
    };
  }

  // Apply `stats` into `records`, bumping each tracked field if the live
  // value exceeds what's stored. Returns a {wave, score, kills, combo}
  // flag-map of which fields actually changed so callers can decide whether
  // to save and which "new record" banners to fire.
  function bumpRecords(records, stats, nick) {
    const broken = { wave: false, score: false, kills: false, combo: false };
    for (const f of BEST_FIELDS) {
      if (stats[f.stat] > records[f.key].value) {
        records[f.key] = { value: stats[f.stat], name: nick };
        broken[f.flag] = true;
      }
    }
    return broken;
  }
  const anyBroken = (b) => b.wave || b.score || b.kills || b.combo;

  // ---------- 굿판 mode constants ----------
  // Streak threshold to first fire 굿판 mode, and the streak step at which
  // it extends thereafter (5, 10, 15, ...). 5 was picked to land roughly
  // every other wave's worth of clean play — high enough to feel earned,
  // low enough that mid-streak extensions are common.
  const GUTPAN_TRIGGER_COMBO = 5;
  const GUTPAN_EXTEND_STEP = 5;
  const GUTPAN_BASE_DURATION = 5.0;   // seconds on first trigger
  const GUTPAN_EXTENSION = 3.0;       // seconds added at each ×5 milestone
  // Cap so a 60+ streak can't accumulate a minute-long 굿판 — extensions
  // beyond this are silently ignored.
  const GUTPAN_MAX_DURATION = 15.0;

  // ---------- Game state ----------
  const game = {
    state: STATE.TITLE,
    player: null,
    enemies: [],
    projectiles: [],
    particles: [],
    wave: { number: 0, enemiesAlive: 0, queue: [], spawnTimer: 0, spawnInterval: 0.6 },
    score: { score: 0 },
    lastTime: 0,
    pointerLocked: false,
    canvas: null,
    ctx: null,
    keys: {},
    mouseDown: false,
    // Snapshot of records taken at run start. HUD compares against this so the
    // BEST display stays stable mid-run; live records are saved at game-over.
    runBest: null,
    // One-shot triggers per run for the "신기록" banner.
    recordFired: { score: false, wave: false },
    nick: '',
    // 'free' (자유 굿판, random seed) or 'daily' (오늘의 굿판, today's seed).
    mode: 'free',
    // 굿판 모드 — fired when player.comboCount crosses a multiple of 5.
    // `lastTriggerCombo` remembers the last streak value we already awarded
    // so a single kill doesn't re-fire while the count stays at 5/10/...
    // talismanParticles is its own pool so combat blood/impacts can't slow
    // it down (and so it lives in screen space rather than world space).
    gutpan: {
      active: false,
      timer: 0,
      lastTriggerCombo: 0,
      bannerPulse: 0,           // 0..1, fades over first ~0.8s of activation
      tintIntensity: 0          // smoothed 0..1 used by the screen-tint shader
    },
    talismanParticles: []
  };

  // Monotonic id source for enemies, used by co-op to track them across the
  // host's world snapshots.
  let nextNetId = 1;

  // ---------- Init / UI wiring ----------
  function init() {
    Audio.init();
    UI.init();
    // Trigger an early font fetch so the first 굿판 banner already has the
    // brush face cached. The CSS @font-face directive only loads on first
    // *use*, so without this the headline pops in mid-effect.
    if (document.fonts && document.fonts.load) {
      document.fonts.load('900 100px "Noto Serif KR"');
      document.fonts.load('100px "Black Han Sans"');
    }

    game.canvas = document.getElementById('game-canvas');
    game.ctx = game.canvas.getContext('2d');
    Raycaster.init(game.canvas);
    Environment.init();
    if (typeof Pickups !== 'undefined') Pickups.init();

    setupInput();
    setupUIButtons();

    // Co-op wiring. MP stays dormant (MP.active === false) until the player
    // hosts / joins a room from the lobby, so single-player is unaffected.
    if (typeof MP !== 'undefined') {
      MP.init(game, {
        startGame,
        // Host applies a guest's reported hit authoritatively. The enemy + team
        // score are mutated via the host's player (`game.player`), but combo /
        // 굿판 attribution uses a transient carrying THAT guest's combo+굿판 so
        // the host's own streak isn't polluted. On a kill, tell the guest so it
        // can advance its own combo locally.
        applyGuestHit: (netId, dmg, headshot, combo, gut, fromId) => {
          const e = game.enemies.find((en) => en.netId === netId && en.alive);
          if (!e) return;
          const wasAlive = e.alive;
          const attacker = {
            comboCount: combo | 0,
            lastKillTime: performance.now() / 1000,   // recent → registerKill continues the streak
            comboTimeoutBonus: 0,
            maxComboReached: combo | 0,
            gutpanActive: !!gut,
            soulSiphon: false,
            hp: 0, maxHp: 0, kills: 0, headshots: 0, bossKills: 0
          };
          Player.damageEnemy(game.player, e, dmg, headshot, game.particles, game.enemies, onScore, attacker);
          if (wasAlive && !e.alive && fromId) MP.creditGuestKill(fromId, headshot, !!e.type.isBoss);
        },
        // Guest: a wave cleared — pause into our own upgrade menu.
        enterUpgrade: (wave) => coopEnterUpgrade(wave),
        // Guest: intermission over — resume play.
        exitUpgrade: () => coopExitUpgrade(),
        // Host: all players have picked (or timed out) — start the next wave.
        hostStartNextWave: () => coopHostStartNextWave(),
        // Whole team wiped — end the run on every client.
        gameOverFromNet: () => { if (game.state !== STATE.GAMEOVER) gameOver(); }
      });
      setupCoopButtons();
    }

    game.touchMode = Mobile.init({
      onShoot: (down) => { game.mouseDown = down; },
      onRun:   (down) => { game.keys['shift'] = down; },
      onReload: () => { if (game.state === STATE.PLAYING) Player.startReload(game.player); },
      onSwap:   () => { if (game.state === STATE.PLAYING) Player.cycleWeapon(game.player); },
      onPause:  () => {
        if (game.state === STATE.PLAYING) pauseGame();
        else if (game.state === STATE.PAUSED) { UI.hidePause(); resumeGame(); }
      },
      onTurn: (dx, dy) => {
        if (game.state === STATE.PLAYING) Player.turn(game.player, dx, dy);
      }
    });

    game.nick = Records.loadNick();
    UI.setNickInput(game.nick);
    UI.updateTitleRecords(Records.load(), Records.loadDaily());
    UI.showTitle();
    requestAnimationFrame(loop);
    // Defer the online leaderboard — loading the Firebase SDK + running the
    // Firestore reads is a few hundred KB of network that must NOT compete
    // with first paint / asset load. Kick it once the browser is idle.
    deferIdle(refreshLeaderboard);
  }

  // Run `fn` when the main thread is idle (after first paint), falling back to
  // a short timeout where requestIdleCallback isn't available (Safari).
  function deferIdle(fn) {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => fn(), { timeout: 2500 });
    } else {
      setTimeout(fn, 400);
    }
  }

  // Pull the shared Firestore leaderboard and paint it onto the title screen.
  // Safe to call when the board is unconfigured/offline — it just shows the
  // appropriate status and the local records keep covering personal bests.
  function refreshLeaderboard() {
    if (typeof Leaderboard === 'undefined') return;
    if (!Leaderboard.configured()) {
      UI.setLeaderboardStatus('미설정');
      UI.setLeaderboard(null, null);
      return;
    }
    UI.setLeaderboardStatus('불러오는 중…');
    Promise.all([Leaderboard.topAllTime(), Leaderboard.topDaily()])
      .then(([allTime, daily]) => {
        UI.setLeaderboard(allTime, daily);
        UI.setLeaderboardStatus(allTime == null ? '오프라인' : '');
      })
      .catch(() => {
        UI.setLeaderboard(null, null);
        UI.setLeaderboardStatus('오프라인');
      });
  }

  function resumeGame() {
    game.state = STATE.PLAYING;
    game.lastTime = performance.now();
    if (game.touchMode) Mobile.showControls();
  }

  function setupUIButtons() {
    document.getElementById('start-btn').addEventListener('click', () => {
      Audio.resume();
      Audio.uiClick();
      captureNick();
      startGame();
    });
    document.getElementById('preview-cutscene-btn').addEventListener('click', () => {
      Audio.resume();
      Audio.uiClick();
      BossCutscene.playBossCutscene({
        image: 'assets/gumiho.webp',
        name: '구미호',
        subtitle: '1회차 — 천년묵은 요호',
        beginText: '굿이 시작된다',
        parts: [
          { x: 50, y: 90, scale: 2.4 },
          { x: 72, y: 55, scale: 2.0 },
          { x: 45, y: 15, scale: 2.5 },
        ],
        onImpact() { Audio.bossEnrage && Audio.bossEnrage(); },
        onEnd() {}
      });
    });
    // Mode toggle — 자유 굿판 (random seed) vs 오늘의 굿판 (today's fixed seed).
    const modeDescEl = document.getElementById('mode-desc');
    const MODE_DESC = {
      free:  '매판 랜덤 — 자유롭게 연습하고 개인 기록에 도전',
      daily: '전 유저 동일 시드 — 일일 글로벌 랭킹에 등재'
    };
    document.querySelectorAll('#mode-select .mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        Audio.uiClick();
        game.mode = btn.dataset.mode === 'daily' ? 'daily' : 'free';
        document.querySelectorAll('#mode-select .mode-btn').forEach((b) =>
          b.classList.toggle('active', b === btn));
        if (modeDescEl) modeDescEl.textContent = MODE_DESC[game.mode];
      });
    });

    document.querySelectorAll('#title-screen [data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        Audio.uiClick();
        const view = btn.dataset.view;
        const isRanking = view === 'ranking';
        document.querySelectorAll('#title-screen .title-view').forEach((v) =>
          v.classList.toggle('active', v.classList.contains('view-' + view)));
        const ts = document.getElementById('title-screen');
        if (ts) ts.classList.toggle('ranking-active', isRanking);
      });
    });
    document.getElementById('restart-btn').addEventListener('click', () => {
      Audio.uiClick();
      UI.hideGameOver();
      startGame();
    });
    document.getElementById('resume-btn').addEventListener('click', () => {
      Audio.uiClick();
      UI.hidePause();
      if (game.touchMode) resumeGame();
      else requestPointerLock();
    });
    document.getElementById('quit-btn').addEventListener('click', () => {
      Audio.uiClick();
      UI.hidePause();
      UI.hideHud();
      if (game.touchMode) Mobile.hideControls();
      UI.updateTitleRecords(Records.load(), Records.loadDaily());
      refreshLeaderboard();
      UI.showTitle();
      game.state = STATE.TITLE;
    });
  }

  function captureNick() {
    const raw = UI.getNickInput();
    game.nick = Records.sanitizeNick(raw);
    Records.saveNick(game.nick);
    UI.setNickInput(game.nick);
  }

  // ---------- Co-op lobby ----------
  // Wire the 협동 overlay: connect to a relay server, join a room by code, and
  // hand off to startGame() once the server confirms our host/guest role. The
  // first player into a room becomes the host (authoritative simulation); the
  // rest join as guests.
  function setupCoopButtons() {
    const openBtn = document.getElementById('coop-btn');
    const overlay = document.getElementById('coop-screen');
    if (!openBtn || !overlay) return;
    const closeBtn = document.getElementById('coop-close');
    const joinBtn = document.getElementById('coop-join');
    const urlInput = document.getElementById('coop-url');
    const roomInput = document.getElementById('coop-room');

    // Resolve the relay URL. IMPORTANT: we do NOT default to the page's own
    // host — a static host (Vercel / GitHub Pages) does not run the WebSocket
    // relay, so `wss://<page-host>:8787` always fails. Precedence:
    //   1. last URL the player successfully entered (localStorage)
    //   2. a URL hardcoded in index.html via window.COOP_RELAY_URL
    //   3. localhost for local dev
    const RELAY_LS_KEY = 'wavesurvival_relay_url';
    let savedUrl = '';
    try { savedUrl = localStorage.getItem(RELAY_LS_KEY) || ''; } catch (e) {}
    const fallbackUrl = (typeof window !== 'undefined' && window.COOP_RELAY_URL) || 'ws://localhost:8787';
    if (urlInput) {
      urlInput.placeholder = 'wss://your-relay.onrender.com';
      if (!urlInput.value) urlInput.value = savedUrl || fallbackUrl;
    }

    openBtn.addEventListener('click', () => { Audio.uiClick(); overlay.classList.remove('hidden'); });
    if (closeBtn) closeBtn.addEventListener('click', () => { Audio.uiClick(); overlay.classList.add('hidden'); });

    joinBtn.addEventListener('click', () => {
      Audio.resume();
      Audio.uiClick();
      captureNick();
      let url = (urlInput.value || fallbackUrl).trim();
      // An https page can't open an insecure ws:// socket (mixed content) —
      // auto-upgrade so a pasted ws:// URL isn't silently blocked.
      if (location.protocol === 'https:' && url.startsWith('ws://')) {
        url = 'wss://' + url.slice('ws://'.length);
      }
      // Remember it so the player only pastes their relay URL once.
      try { localStorage.setItem(RELAY_LS_KEY, url); } catch (e) {}
      const room = ((roomInput.value || 'LOBBY').trim().toUpperCase()) || 'LOBBY';
      game.mode = 'free';   // co-op runs on the free (non-daily) ruleset
      MP.joinRoom(url, room, game.nick)
        .then(() => { overlay.classList.add('hidden'); })
        .catch(() => { /* MP.setStatus already surfaced the failure */ });
    });
  }

  // ---------- Input ----------
  // Map physical key codes to canonical names used by the game.
  // Uses e.code (layout / IME independent) so Korean IME, Dvorak, etc. work.
  function codeToName(code) {
    if (code.startsWith('Key')) return code.slice(3).toLowerCase();   // KeyW -> 'w'
    if (code.startsWith('Digit')) return code.slice(5);               // Digit1 -> '1'
    if (code === 'ShiftLeft' || code === 'ShiftRight') return 'shift';
    if (code === 'ControlLeft' || code === 'ControlRight') return 'control';
    if (code === 'Escape') return 'escape';
    if (code === 'Space') return 'space';
    if (code === 'ArrowUp') return 'arrowup';
    if (code === 'ArrowDown') return 'arrowdown';
    if (code === 'ArrowLeft') return 'arrowleft';
    if (code === 'ArrowRight') return 'arrowright';
    return null;
  }

  function setupInput() {
    window.addEventListener('keydown', (e) => {
      const k = codeToName(e.code);
      if (!k) return;
      // Ignore auto-repeat for one-shot actions
      const isRepeat = e.repeat;
      game.keys[k] = true;

      if (game.state === STATE.PLAYING && !isRepeat) {
        if (k === 'r') Player.startReload(game.player);
        if (k >= '1' && k <= '4') Player.switchWeapon(game.player, k);
        if (k === 'escape') pauseGame();
      } else if (game.state === STATE.PAUSED && !isRepeat) {
        if (k === 'escape') {
          UI.hidePause();
          requestPointerLock();
        }
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = codeToName(e.code);
      if (!k) return;
      game.keys[k] = false;
    });
    // Clear keys when window loses focus to avoid stuck-key state
    window.addEventListener('blur', () => { game.keys = {}; game.mouseDown = false; });

    document.addEventListener('mousemove', (e) => {
      if (game.state === STATE.PLAYING && game.pointerLocked) {
        Player.turn(game.player, e.movementX, e.movementY);
      }
    });

    game.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (game.touchMode) return; // touch input owns the canvas on mobile
      if (game.state === STATE.PLAYING) {
        if (!game.pointerLocked) {
          requestPointerLock();
          return;
        }
        game.mouseDown = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 && !game.touchMode) game.mouseDown = false;
    });

    document.addEventListener('pointerlockchange', () => {
      game.pointerLocked = document.pointerLockElement === game.canvas;
      if (game.pointerLocked) {
        UI.hideLockPrompt();
      } else if (game.state === STATE.PLAYING && !game.touchMode) {
        pauseGame();
      }
    });
    document.addEventListener('pointerlockerror', () => {
      if (game.state === STATE.PLAYING && !game.touchMode) UI.showLockPrompt();
    });

    // Save any new bests when the page is about to close or backgrounded so
    // long runs don't lose progress if the player navigates away without
    // dying first.
    window.addEventListener('pagehide', persistRunBests);
    window.addEventListener('beforeunload', persistRunBests);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) persistRunBests();
    });
  }

  function requestPointerLock() {
    if (game.touchMode) {
      if (game.state === STATE.PAUSED) resumeGame();
      return;
    }
    game.canvas.requestPointerLock = game.canvas.requestPointerLock ||
                                     game.canvas.mozRequestPointerLock;
    if (game.canvas.requestPointerLock) {
      game.canvas.requestPointerLock();
    }
    if (game.state === STATE.PAUSED) {
      game.state = STATE.PLAYING;
      game.lastTime = performance.now();
    }
  }

  // ---------- Run lifecycle ----------
  // Persist any all-time / daily bests the current run has earned. Called
  // after every wave clear and on tab-hide / unload so a refresh, crash,
  // or AFK timeout during a long run doesn't discard a new record.
  // totalRuns is left alone — that's gameOver's job (a run isn't "complete"
  // until the player dies).
  function persistRunBests() {
    if (!game.player) return;
    const stats = currentStats();
    const nick = game.nick || '익명';

    const allTime = Records.load();
    if (anyBroken(bumpRecords(allTime, stats, nick))) Records.save(allTime);

    // Only 오늘의 굿판 runs count toward the daily board (fair same-seed compare).
    if (game.mode === 'daily') {
      const daily = Records.loadDaily();
      if (anyBroken(bumpRecords(daily.records, stats, nick))) Records.saveDaily(daily);
    }
  }

  function startGame() {
    game.player = Player.create();
    game.enemies = [];
    game.projectiles = [];
    game.particles = [];
    if (typeof Pickups !== 'undefined') Pickups.clear();
    game.score = { score: 0 };
    game.wave = { number: 0, enemiesAlive: 0, queue: [], spawnTimer: 0, spawnInterval: 0.6 };
    // 굿판 — reset every run so a leftover timer from a previous run can't
    // bleed into the new one.
    Audio.gutpanLoopStop && Audio.gutpanLoopStop();
    game.gutpan.active = false;
    game.gutpan.timer = 0;
    game.gutpan.lastTriggerCombo = 0;
    game.gutpan.bannerPulse = 0;
    game.gutpan.tintIntensity = 0;
    game.talismanParticles.length = 0;
    game.cutsceneTimer = 0;
    UI.hideBossCutscene && UI.hideBossCutscene();
    // Clear any stale input state from previous run / menu interaction
    game.keys = {};
    game.mouseDown = false;
    game.lastTime = performance.now();

    // Snapshot best records at run start so HUD/banners compare against a
    // stable baseline. Mid-run updates are persisted by persistRunBests()
    // (wave clear / tab hide / unload) — game-over also re-saves with the
    // final stats and bumps totalRuns.
    game.runBest = Records.load();
    game.recordFired = { score: false, wave: false };
    UI.setHudBest(game.runBest);

    // Seed by mode: 오늘의 굿판 uses today's fixed seed (same for everyone,
    // identical on every retry today); 자유 굿판 rolls a fresh random seed each
    // run for free experimentation.
    if (game.mode === 'daily') Random.seedToday();
    else Random.seed((Math.random() * 0x7fffffff) | 0);

    UI.hideTitle();
    UI.hideGameOver();
    UI.hidePause();
    UI.hideUpgradeMenu();
    hideCoopWait();
    UI.showHud();
    game.state = STATE.PLAYING;

    Environment.init();

    // Fresh enemy id sequence each run (host side).
    nextNetId = 1;
    // In co-op only the host drives wave spawning; guests receive enemies and
    // wave/score state from the host's world snapshots.
    if (!(typeof MP !== 'undefined' && MP.active && MP.isGuest())) {
      startNextWave();
    }
    if (game.touchMode) Mobile.showControls();
    requestPointerLock();
  }

  function startNextWave() {
    // Co-op: revive the local player if it went down last wave (host path;
    // guests revive in MP.applyWorld when the wave number advances).
    if (game.player && game.player.downed) {
      game.player.hp = game.player.maxHp;
      game.player.downed = false;
    }
    game.wave.number += 1;
    const composition = Enemies.buildWave(game.wave.number);
    game.wave.queue = composition;
    game.wave.enemiesAlive = composition.length;
    game.wave.spawnTimer = 0;
    game.wave.spawnInterval = Math.max(0.2, 0.7 - game.wave.number * 0.02);

    if (game.wave.number % 5 === 0) {
      const round = game.wave.number / 5;
      game.cutsceneTimer = 6;
      Audio.gutpanLoopStart && Audio.gutpanLoopStart();
      BossCutscene.playBossCutscene({
        image: 'assets/gumiho.webp',
        name: '구미호',
        subtitle: `${round}회차 — 천년묵은 요호`,
        beginText: '굿이 시작된다',
        parts: [
          { x: 50, y: 90, scale: 2.4 },
          { x: 72, y: 55, scale: 2.0 },
          { x: 45, y: 15, scale: 2.5 },
        ],
        onImpact() { Audio.bossEnrage && Audio.bossEnrage(); },
        onEnd() {
          game.cutsceneTimer = 0;
          if (!game.gutpan.active) Audio.gutpanLoopStop();
        }
      });
    } else {
      UI.showWaveBanner(`WAVE ${game.wave.number}`);
      Audio.waveStart();
    }

    // Wave-record banner fires once per run when the player reaches a wave
    // higher than their previous best. Skipped on a first-ever run (no prior
    // record to beat) so a brand-new player doesn't get a "신기록" banner
    // for clearing wave 1.
    const prevBestWave = game.runBest ? game.runBest.bestWave.value : 0;
    if (!game.recordFired.wave && game.wave.number > prevBestWave && prevBestWave > 0) {
      game.recordFired.wave = true;
      setTimeout(() => UI.showRecordBanner('🏆 BEST WAVE 갱신!', `WAVE ${game.wave.number}`), 1200);
      Audio.waveClear();
    }
  }

  // Find a position near (px, py) where a circle of `radius` fits.
  // Tries the original point first, then nudges along 8 directions up to 1.5 tiles.
  function findValidSpawn(px, py, radius) {
    if (GameMap.canMove(px, py, radius)) return { x: px, y: py };
    const dirs = [
      [1, 0], [0, 1], [-1, 0], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1]
    ];
    for (let step = 0.25; step <= 1.5; step += 0.25) {
      for (const [dx, dy] of dirs) {
        const nx = px + dx * step;
        const ny = py + dy * step;
        if (GameMap.canMove(nx, ny, radius)) return { x: nx, y: ny };
      }
    }
    return { x: px, y: py };
  }

  function spawnFromQueue(dt) {
    if (game.wave.queue.length === 0) return;
    game.wave.spawnTimer -= dt;
    if (game.wave.spawnTimer > 0) return;

    const spawnPoints = GameMap.getSpawnPoints();
    const next = game.wave.queue.shift();
    const radius = (Enemies.types[next.type] && Enemies.types[next.type].radius) || 0.4;

    // Pick spawn point farthest-ish from player among random subset.
    // Seeded so the daily run picks the same gates in the same order.
    let bestPt = spawnPoints[0];
    let bestScore = -1;
    for (let i = 0; i < 4; i++) {
      const pt = spawnPoints[Random.int(spawnPoints.length)];
      const dx = pt.x - game.player.x, dy = pt.y - game.player.y;
      const d = dx * dx + dy * dy;
      if (d > bestScore) { bestScore = d; bestPt = pt; }
    }

    // Ensure the chosen point can actually fit this enemy's body
    const pos = findValidSpawn(bestPt.x, bestPt.y, radius);
    const e = Enemies.create(next.type, pos.x, pos.y, next.scale || 1);
    // Stable id so co-op guests can track / report hits against this enemy
    // across world snapshots.
    e.netId = nextNetId++;
    game.enemies.push(e);
    game.wave.spawnTimer = game.wave.spawnInterval;
  }

  function pauseGame() {
    if (game.state !== STATE.PLAYING) return;
    game.state = STATE.PAUSED;
    Audio.gutpanLoopStop && Audio.gutpanLoopStop();
    if (!game.touchMode) document.exitPointerLock();
    if (game.touchMode) Mobile.hideControls();
    UI.showPause();
  }

  function onScore(amount, enemy) {
    game.score.score += amount;
    // Score-record banner fires once when score crosses previous best.
    const prevBestScore = game.runBest ? game.runBest.bestScore.value : 0;
    if (!game.recordFired.score && prevBestScore > 0 && game.score.score > prevBestScore) {
      game.recordFired.score = true;
      UI.showRecordBanner('🔥 NEW RECORD 🔥', `${game.score.score.toLocaleString()}점`);
      Audio.waveClear();
    }
  }

  function checkWaveComplete() {
    const aliveCount = game.enemies.filter(e => e.alive).length;
    game.wave.enemiesAlive = aliveCount + game.wave.queue.length;
    if (aliveCount === 0 && game.wave.queue.length === 0 && game.state === STATE.PLAYING) {
      // Wave clear
      const bonus = game.wave.number * 500;
      game.score.score += bonus;
      Audio.waveClear();
      // Cleanup dead enemies
      game.enemies = game.enemies.filter(e => e.alive);

      // Persist any new bests now so a mid-run refresh / crash doesn't
      // throw away the wave/score/kills the player just earned.
      persistRunBests();

      game.state = STATE.UPGRADE;
      if (!game.touchMode) document.exitPointerLock();
      if (game.touchMode) Mobile.hideControls();

      const coopHost = (typeof MP !== 'undefined' && MP.active && MP.isHost());
      // Co-op: tell guests to open their own menus and start tracking picks.
      // The host doesn't start the next wave on its own pick — it waits until
      // every player has chosen (MP.markPicked → coopHostStartNextWave).
      if (coopHost) MP.beginUpgradeSync(game.wave.number);

      setTimeout(() => {
        UI.showUpgradeMenu(game.player, game.wave.number, () => {
          UI.hideUpgradeMenu();
          if (coopHost) {
            MP.notifyPicked();   // records host's pick; advances when all in
            showCoopWait();      // freeze on a clean wait screen until everyone picks
          } else {
            startNextWave();
            game.state = STATE.PLAYING;
            if (game.touchMode) Mobile.showControls();
            requestPointerLock();
          }
        });
      }, 800);
    }
  }

  // ---------- Co-op intermission helpers ----------
  // The "다른 무당을 기다리는 중" wait screen, shown after a player picks their
  // card while others are still choosing. The game is already frozen (STATE
  // stays UPGRADE), this just makes the wait explicit instead of a blank scene.
  function showCoopWait() {
    const el = document.getElementById('coop-wait');
    if (el) el.classList.remove('hidden');
  }
  function hideCoopWait() {
    const el = document.getElementById('coop-wait');
    if (el) el.classList.add('hidden');
  }

  // Guest: the host cleared a wave — pause into our own upgrade menu. Each
  // player picks independently (own build); we tell the host when done and wait
  // for the host's wave_start to resume.
  function coopEnterUpgrade(wave) {
    if (game.state !== STATE.PLAYING) return;
    game.state = STATE.UPGRADE;
    if (!game.touchMode) document.exitPointerLock();
    if (game.touchMode) Mobile.hideControls();
    setTimeout(() => {
      UI.showUpgradeMenu(game.player, wave, () => {
        UI.hideUpgradeMenu();
        MP.notifyPicked();   // → host
        showCoopWait();      // frozen wait screen until the host signals wave_start
      });
    }, 400);
  }

  // Guest: host says the next wave is starting — close any open menu and play.
  function coopExitUpgrade() {
    UI.hideUpgradeMenu();
    hideCoopWait();
    game.state = STATE.PLAYING;
    if (game.touchMode) Mobile.showControls();
    requestPointerLock();
  }

  // Host: everyone has picked (or timed out) — actually start the next wave.
  function coopHostStartNextWave() {
    UI.hideUpgradeMenu();
    hideCoopWait();
    startNextWave();
    game.state = STATE.PLAYING;
    if (game.touchMode) Mobile.showControls();
    requestPointerLock();
  }

  // ---------- 굿판 모드 ----------
  // Preload talisman sprites for the on-screen falling-paper effect.
  // Drawn in screen space (not raycast world space) so they always read
  // regardless of camera angle. Missing files just leave the slot null
  // and renderTalismans falls back to a flat colored rect with the
  // hanja drawn in. The asset names are reserved so the player can drop
  // 1..3 files in and have them picked up without a code change.
  const TALISMAN_SRCS = [
    { src: 'assets/talisman_01.webp', char: '長壽' },
    { src: 'assets/talisman_02.webp', char: '護身' },
    { src: 'assets/talisman_03.webp', char: '氣福' }
  ];
  const TALISMAN_IMAGES = TALISMAN_SRCS.map((entry) => {
    const img = new Image();
    const slot = { img, loaded: false, char: entry.char };
    img.onload = () => { slot.loaded = true; };
    img.onerror = () => { /* leave loaded=false; renderer uses fallback */ };
    img.src = entry.src;
    return slot;
  });

  // 저승사자's thrown sickle (낫). Rendered spinning on each ranged projectile;
  // falls back to the old glowing dot until the image loads.
  const sickleImg = new Image();
  let sickleLoaded = false;
  sickleImg.onload = () => { sickleLoaded = true; };
  sickleImg.src = 'assets/sickle.png';

  // Drive the active flag + remaining timer from the player's current streak,
  // and spawn falling-talisman particles while active. Called from the main
  // loop with dt seconds. Mirrors active flag onto game.player so
  // player.shoot / damageEnemy can read it without knowing about game state.
  function updateGutpan(dt) {
    const g = game.gutpan;
    const p = game.player;

    // Trigger / extension. We check every multiple of 5 the streak has
    // reached since the last award, so a single big chain (e.g. an
    // explosion crossing from 4 → 8) still triggers correctly.
    // Card bonuses: 사물놀이 lowers the trigger threshold; 무당의 흥 adds
    // to the initial duration. Extensions use the same step (every +5).
    const trigCombo = Math.max(2, GUTPAN_TRIGGER_COMBO - (p ? p.gutpanThresholdReduction || 0 : 0));
    const baseDur = GUTPAN_BASE_DURATION + (p ? p.gutpanDurationBonus || 0 : 0);
    const c = p ? p.comboCount : 0;
    if (c >= trigCombo) {
      // Walk every milestone we've passed since the last awarded one.
      let next = g.lastTriggerCombo + GUTPAN_EXTEND_STEP;
      if (g.lastTriggerCombo === 0) next = trigCombo;
      while (next <= c) {
        if (!g.active) {
          g.active = true;
          g.timer = baseDur;
          g.bannerPulse = 1;
          Audio.gutpanTrigger && Audio.gutpanTrigger();
        } else {
          g.timer = Math.min(GUTPAN_MAX_DURATION, g.timer + GUTPAN_EXTENSION);
          g.bannerPulse = Math.max(g.bannerPulse, 0.7);
        }
        g.lastTriggerCombo = next;
        next += GUTPAN_EXTEND_STEP;
      }
    } else if (c === 0) {
      // Streak fully dropped — reset milestone tracker so the next streak
      // re-triggers from the (possibly card-lowered) threshold again.
      g.lastTriggerCombo = 0;
    }

    // Timer decay.
    if (g.active) {
      g.timer -= dt;
      if (g.timer <= 0) {
        g.active = false;
        g.timer = 0;
      }
    }
    g.bannerPulse = Math.max(0, g.bannerPulse - dt * 1.5);

    // Smooth tint envelope — ramps up fast on activation, eases out as the
    // timer drains so the screen doesn't snap-cut back to normal.
    const target = g.active ? Math.min(1, g.timer / 0.6) : 0;
    g.tintIntensity += (target - g.tintIntensity) * Math.min(1, dt * 8);

    // Mirror onto the player so shoot/damageEnemy can branch on it.
    if (p) p.gutpanActive = g.active;

    // Drive the 사물놀이 groove with the mode (both calls are idempotent).
    if (g.active) Audio.gutpanLoopStart && Audio.gutpanLoopStart();
    else Audio.gutpanLoopStop && Audio.gutpanLoopStop();

    // Spawn falling talismans at the screen edges while active. Density
    // scales with intensity so the effect fades out alongside the tint.
    if (g.active) {
      const spawnPerSec = 22;
      // Stochastic spawn — expected spawns per frame = spawnPerSec * dt.
      const expected = spawnPerSec * dt;
      let toSpawn = Math.floor(expected);
      if (Math.random() < (expected - toSpawn)) toSpawn += 1;
      for (let i = 0; i < toSpawn; i++) spawnTalisman();
    }

    // Update existing talisman particles regardless of active flag so the
    // ones already on screen finish their fall after the timer expires.
    updateTalismans(dt);
  }

  // Spawn a single talisman particle at a random horizontal position,
  // starting above the top of the canvas with a small initial sideways
  // drift. Coordinates are screen-space pixels.
  function spawnTalisman() {
    if (!game.canvas) return;
    const W = game.canvas.width;
    const H = game.canvas.height;
    const fromLeftEdge = Math.random() < 0.5;
    const edgeBand = W * 0.28;
    const x = fromLeftEdge
      ? Math.random() * edgeBand
      : W - Math.random() * edgeBand;
    game.talismanParticles.push({
      x,
      y: -60 - Math.random() * 80,
      vx: (fromLeftEdge ? 1 : -1) * (10 + Math.random() * 40),
      vy: 110 + Math.random() * 160,
      rot: (Math.random() - 0.5) * 0.6,   // mostly upright with slight tilt
      vrot: (Math.random() - 0.5) * 2.2,
      scale: 0.7 + Math.random() * 0.5,    // ~0.7–1.2× — readable but not screen-eating
      life: 1.0,
      // Decay so the particle fades before it leaves the screen even on
      // very tall canvases.
      maxLife: 2.8 + Math.random() * 1.2,
      imgIdx: Math.floor(Math.random() * TALISMAN_IMAGES.length)
    });
    // Hard cap so a very long 굿판 can't grow the pool unboundedly.
    if (game.talismanParticles.length > 120) game.talismanParticles.shift();
  }

  function updateTalismans(dt) {
    const arr = game.talismanParticles;
    const H = game.canvas ? game.canvas.height : 600;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += dt * 60;          // gentle gravity
      p.vx *= Math.exp(-dt * 0.5);
      p.rot += p.vrot * dt;
      p.life -= dt / p.maxLife;
      if (p.life <= 0 || p.y > H + 60) arr.splice(i, 1);
    }
  }

  // ---------- Game loop + rendering ----------
  // Hard cap on live particles. In co-op the host spawns death bursts for both
  // its own AND every guest's kills, so a 4-player machine-gun wave could pile
  // up enough particles to drag the host's frame rate; drop the oldest past the
  // cap. 500 is well above what a normal burst needs.
  const MAX_PARTICLES = 500;

  function updateParticles(dt) {
    for (let i = game.particles.length - 1; i >= 0; i--) {
      const p = game.particles[i];
      p.life -= dt * 1.2;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-dt * 3);
      p.vy *= Math.exp(-dt * 3);
      p.zOffset += p.vz * dt;
      // Damage-number floats use noGravity so they rise steadily instead of
      // arcing back down like blood/impact debris.
      if (!p.noGravity) p.vz -= dt * 6;
      if (p.life <= 0) game.particles.splice(i, 1);
    }
    if (game.particles.length > MAX_PARTICLES) {
      game.particles.splice(0, game.particles.length - MAX_PARTICLES);
    }
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - (game.lastTime || now)) / 1000);
    game.lastTime = now;

    if (game.state === STATE.PLAYING && game.cutsceneTimer > 0) {
      game.cutsceneTimer -= dt;
      if (game.cutsceneTimer <= 0) game.cutsceneTimer = 0;
    } else if (game.state === STATE.PLAYING) {
      const mpActive = (typeof MP !== 'undefined' && MP.active);
      // In co-op a guest renders the host's authoritative enemies/waves rather
      // than simulating them. The host runs the full sim as in single-player.
      const coopGuest = mpActive && MP.isGuest();

      // Apply inbound network state first: ease remote players toward their
      // latest position, and (guest) rebuild game.enemies from the host snapshot.
      if (mpActive) MP.beginFrame(dt);

      // Auto-shoot if held + auto weapons. A downed (spectating) player can't
      // fire until it respawns.
      const inputReady = game.pointerLocked || game.touchMode;
      if (game.mouseDown && inputReady && !game.player.downed) {
        Player.shoot(game.player, game.enemies, game.particles, onScore);
      }

      // Update player input mapping
      mapKeysToInput();
      const move = game.touchMode ? Mobile.getMove() : null;
      if (mpActive && game.player.downed) {
        // Spectator: ride a living teammate's camera instead of free-looking
        // from our own corpse, so a downed player watches the action.
        const mate = MP.getSpectateTarget();
        if (mate) {
          game.player.x = mate.x;
          game.player.y = mate.y;
          game.player.angle = mate.angle;
          game.player.pitch = 0;
          game.player.bobOffset = 0;
          game.spectateName = mate.name;
        }
        // (skip Player.update — no self-movement while spectating)
      } else {
        game.spectateName = null;
        Player.update(game.player, dt, { keys: game.keys, move });
      }

      // Enemy AI / projectiles — host-authoritative, skipped on guests.
      if (!coopGuest) {
        for (const e of game.enemies) {
          Enemies.update(e, dt, game.player, game.projectiles, game.particles, game.enemies);
        }
        Enemies.updateProjectiles(game.projectiles, dt, game.player, game.particles);
      }

      updateParticles(dt);
      if (typeof Pickups !== 'undefined') Pickups.update(dt, game.player, game.particles);
      Environment.update(dt, game.wave.number, game.particles);

      // 굿판 모드 — combo-driven trigger + timer + visual driver.
      updateGutpan(dt);

      // Wave spawning + completion are the host's job; guests follow snapshots.
      if (!coopGuest) spawnFromQueue(dt);

      // Death check. In co-op NOBODY game-overs alone: any dead player (host or
      // guest) goes "downed" and spectates — still rendered to allies, ignored
      // by enemies (HP 0) — until the next wave revives them. The host keeps
      // simulating even while downed, so a surviving guest keeps the run going.
      if (game.player.hp <= 0) {
        if (mpActive) {
          if (!game.player.downed) {
            game.player.downed = true;
            game.player.downedAtWave = game.wave.number;
            if (UI.showWaveBanner) UI.showWaveBanner('쓰러짐 — 다음 웨이브에 부활');
          }
        } else {
          gameOver();
        }
      }

      // Team wipe: only when EVERYONE is down does the run actually end. The
      // host detects it (it knows every player's HP) and ends the run for all.
      if (mpActive && MP.isHost() && MP.allDowned() && game.state !== STATE.GAMEOVER) {
        MP.broadcastGameOver();
        gameOver();
      }

      if (!coopGuest) checkWaveComplete();

      // Broadcast our player state (host also emits the world snapshot).
      if (mpActive) MP.endFrame(dt);
    }

    // Render
    render();

    if (game.state === STATE.PLAYING || game.state === STATE.UPGRADE || game.state === STATE.PAUSED) {
      UI.updateHud(game.player, game.wave, game.score);
      UI.drawMinimap(game.player, game.enemies);
    }

    requestAnimationFrame(loop);
  }

  function mapKeysToInput() {
    // Map arrow keys / direction aliases too
    if (game.keys['arrowup']) game.keys['w'] = true;
    if (game.keys['arrowdown']) game.keys['s'] = true;
    if (game.keys['arrowleft']) game.keys['a'] = true;
    if (game.keys['arrowright']) game.keys['d'] = true;
  }

  function render() {
    if (!game.player) {
      // Background only
      const ctx = game.ctx;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, game.canvas.width, game.canvas.height);
      return;
    }

    // Camera shake — round to integer pixels so the canvas translate stays
    // pixel-aligned. Otherwise sub-pixel offsets each frame cause edge anti-
    // aliasing along walls and the horizon, which reads as flicker or partial
    // transparency on low structures during shooting.
    const ctx = game.ctx;
    const shakeX = Math.round((Math.random() - 0.5) * game.player.shake);
    const shakeY = Math.round((Math.random() - 0.5) * game.player.shake);
    ctx.save();
    ctx.translate(shakeX, shakeY);

    const theme = Environment.themeForWave(game.wave.number || 1);
    Raycaster.render(game.player, game.enemies, game.particles, game.player.bobOffset + game.player.pitch, theme);

    // Draw projectiles as glowing dots (simple)
    drawProjectiles();

    // Gun overlay
    UI.renderGun(ctx, game.player);

    ctx.restore();

    // 굿판 mode overlay layer — drawn OUTSIDE the shake transform so the
    // banner / talisman particles stay screen-locked even when the camera
    // is shaking from recoil.
    renderGutpan(ctx);

    // Spectator label — we're downed and riding a teammate's camera.
    if (game.spectateName) {
      const W = game.canvas.width;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = '700 20px "Noto Serif KR", sans-serif';
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = 'rgba(255, 90, 90, 0.95)';
      ctx.fillText('● 관전 중', W / 2, 14);
      ctx.font = '500 14px "Noto Serif KR", sans-serif';
      ctx.fillStyle = 'rgba(240, 230, 210, 0.9)';
      ctx.fillText(`${game.spectateName} 시점 · 다음 웨이브에 부활`, W / 2, 40);
      ctx.restore();
    }
  }

  // ---------- 굿판 모드 render ----------
  // Three layers, in order: red multiply tint → falling talisman particles
  // → top-centre "굿판!" banner with ×1.5 / ×2.0 multiplier sub-text.
  // Everything reads game.gutpan.tintIntensity rather than the raw active
  // flag so the effect eases in/out instead of snap-cutting.
  function renderGutpan(ctx) {
    const g = game.gutpan;
    if (g.tintIntensity <= 0.01 && g.talismanParticles && g.talismanParticles.length === 0
        && game.talismanParticles.length === 0) return;

    const W = game.canvas.width;
    const H = game.canvas.height;
    const intensity = g.tintIntensity;

    // Tint — warm red 'multiply' pass biases everything toward 부적 colours,
    // and a soft outer vignette pulls the eye to the centre of the screen.
    if (intensity > 0.01) {
      ctx.save();
      ctx.globalAlpha = 0.32 * intensity;
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#ff5533';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      // Vignette — radial dark to focus attention.
      ctx.save();
      const grad = ctx.createRadialGradient(W / 2, H / 2, W * 0.25, W / 2, H / 2, W * 0.7);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(40, 0, 0, ${0.55 * intensity})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // Falling talisman particles.
    renderTalismans(ctx);

    // Top-centre banner.
    if (intensity > 0.02) {
      renderGutpanBanner(ctx, W, H, intensity);
    }
  }

  function renderTalismans(ctx) {
    const arr = game.talismanParticles;
    if (arr.length === 0) return;
    ctx.save();
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    for (const p of arr) {
      const slot = TALISMAN_IMAGES[p.imgIdx % TALISMAN_IMAGES.length];
      const alpha = Math.min(1, p.life * 1.4);
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (slot && slot.loaded) {
        // Anchor height at 84px (× particle scale) and derive width from the
        // sprite's native aspect ratio so the talismans don't get squashed
        // when the source image isn't exactly 2:3. Asset cleanup already
        // tight-cropped each sprite so the bbox is the visible body.
        const h = 84 * p.scale;
        const w = h * (slot.img.width / slot.img.height);
        ctx.drawImage(slot.img, -w / 2, -h / 2, w, h);
      } else {
        // Fallback — yellow rect with the hanja drawn so the effect still
        // reads even before image assets are committed. Same base size as
        // the sprite path so the layout doesn't jump when images load in.
        const w = 48 * p.scale;
        const h = 72 * p.scale;
        ctx.fillStyle = '#f3d67b';
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.fillStyle = '#202020';
        ctx.fillRect(-w / 2 - 2, -h / 2 - 10, 3, 12);
        ctx.fillStyle = '#b71c1c';
        ctx.font = `900 ${Math.floor(26 * p.scale)}px 'Noto Serif KR', 'Gowun Batang', serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = slot ? slot.char : '符';
        // Hanja is two characters → draw vertically so it reads as a tag.
        if (label.length > 1) {
          ctx.fillText(label[0], 0, -h * 0.20);
          ctx.fillText(label[1], 0,  h * 0.20);
        } else {
          ctx.fillText(label, 0, 0);
        }
      }
      // Reset transform for next particle.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = prevSmooth;
    ctx.restore();
  }

  function renderGutpanBanner(ctx, W, H, intensity) {
    const g = game.gutpan;
    const pulse = g.bannerPulse;
    // Banner scale = 1 base + bump on activation pulse.
    const scale = 1 + pulse * 0.4;
    const cx = W / 2;
    const cy = Math.max(70, H * 0.13);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Glow halo behind the text. Drop shadow doubled up by drawing the
    // headline twice — once as a thick dark stroke (back layer), once as
    // the warm fill — so the strokes stand out against bright walls.
    ctx.shadowColor = 'rgba(255, 80, 30, 0.95)';
    ctx.shadowBlur = 32;
    ctx.font = '900 110px "Noto Serif KR", "Gowun Batang", serif';
    ctx.lineWidth = 7;
    ctx.strokeStyle = `rgba(40, 0, 0, ${0.95 * intensity})`;
    ctx.strokeText('굿판!', 0, 0);
    ctx.fillStyle = `rgba(255, 230, 90, ${intensity})`;
    ctx.fillText('굿판!', 0, 0);

    // Sub-text — multipliers + remaining time. Same Myeongjo face as the
    // headline so the two lines feel like one unit; sized small so it reads
    // as supporting info, not a second banner.
    ctx.shadowBlur = 6;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.fillStyle = `rgba(255, 240, 200, ${0.95 * intensity})`;
    ctx.font = '900 16px "Noto Serif KR", "Gowun Batang", serif';
    const remain = Math.max(0, g.timer).toFixed(1);
    ctx.fillText(`데미지 ×1.5 · 점수 ×2.0 · ${remain}s`, 0, 82);

    ctx.restore();
  }

  function drawProjectiles() {
    const { W, H } = Raycaster.getDimensions();
    const ctx = game.ctx;
    const cosA = Math.cos(-game.player.angle);
    const sinA = Math.sin(-game.player.angle);
    const FOV = Math.PI / 3;

    const spin = performance.now() * 0.018;   // shared fast tumble
    for (const p of game.projectiles) {
      const dx = p.x - game.player.x;
      const dy = p.y - game.player.y;
      const tx = dx * cosA - dy * sinA;
      const ty = dx * sinA + dy * cosA;
      if (tx <= 0.05) continue;
      const screenX = (W / 2) * (1 + ty / (tx * Math.tan(FOV / 2)));
      const screenY = H / 2 + game.player.bobOffset + game.player.pitch;

      if (sickleLoaded && sickleImg.width) {
        // Spinning sickle billboard, sized by distance, with a stable per-shot
        // phase so they don't all rotate in lockstep.
        const sz = Math.max(10, 64 / tx);
        const phase = (p.x * 13.1 + p.y * 7.7) % (Math.PI * 2);
        ctx.save();
        ctx.translate(screenX, screenY);
        ctx.rotate(spin + phase);
        const prev = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sickleImg, -sz / 2, -sz / 2, sz, sz);
        ctx.imageSmoothingEnabled = prev;
        ctx.restore();
      } else {
        const sz = Math.max(3, 12 / tx);
        ctx.fillStyle = 'rgba(120, 200, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(screenX, screenY, sz, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.beginPath();
        ctx.arc(screenX, screenY, sz * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ---------- Game over ----------
  function gameOver() {
    game.state = STATE.GAMEOVER;
    if (!game.touchMode) document.exitPointerLock();
    if (game.touchMode) Mobile.hideControls();
    Audio.gutpanLoopStop && Audio.gutpanLoopStop();
    Audio.gameOver();
    UI.hideUpgradeMenu();
    hideCoopWait();
    UI.hideHud();

    const nick = game.nick || '익명';
    const stats = currentStats();
    // Extra non-bumpable stats shown on the result screen only.
    const resultStats = {
      ...stats,
      maxCombo:  stats.combo,
      headshots: game.player.headshots,
      bossKills: game.player.bossKills
    };

    // Compare against the snapshot taken at run start, then merge into the
    // persisted records (each best is independent — you can break one without
    // breaking the others). Daily uses an independent leaderboard for the
    // day's seed; we don't surface its broken flags in the UI.
    const prev = game.runBest || Records.empty();
    const updated = Records.load();
    const broken = bumpRecords(updated, stats, nick);
    updated.totalRuns = (updated.totalRuns || 0) + 1;
    Records.save(updated);

    // 오늘의 굿판 runs land on the daily board (local + online); 자유 굿판 runs
    // only count toward the all-time / personal records.
    const isDaily = game.mode === 'daily';
    if (isDaily) {
      const daily = Records.loadDaily();
      bumpRecords(daily.records, stats, nick);
      Records.saveDaily(daily);
    }

    // Push the run to the shared online board (no-op when unconfigured /
    // offline), then refresh the cached title-screen ranking so it's current
    // the next time the player backs out to the menu.
    if (typeof Leaderboard !== 'undefined') {
      Leaderboard.submitRun(stats, nick, isDaily).then((ok) => { if (ok) refreshLeaderboard(); });
    }

    UI.showGameOver(resultStats, prev, broken, game.nick);
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
