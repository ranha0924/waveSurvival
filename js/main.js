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
        // The actual game start (host pressed start in the lobby, or we got the
        // start signal as a guest / late joiner). Hide the lobby and play.
        startGame: coopStartGame,
        // Joined a room — show the waiting lobby (game waits for 2+ players).
        onLobby: (info) => coopShowLobby(info),
        onRoster: (info) => coopUpdateLobby(info),
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
        // Guest: host hit a boss wave — play the cutscene in sync.
        playCutscene: (round) => playBossCutscene(round),
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

  // ---------- Online ranking (tabbed: 전체 / 오늘 / 2·3·4인 협동) ----------
  // Boards load lazily on tab open and cache for the session so flipping tabs is
  // instant and we don't re-query Firestore each time. The cache is cleared on
  // a fresh run (refreshLeaderboard) so a just-submitted score shows up.
  const boardCache = {};
  let activeBoard = 'alltime';

  function fetchBoard(key) {
    if (key === 'alltime') return Leaderboard.topAllTime();
    if (key === 'daily') return Leaderboard.topDaily();
    if (key.startsWith('coop')) return Leaderboard.topCoop(parseInt(key.slice(4), 10));
    return Promise.resolve(null);
  }

  // Load + render the given board. Uses the cache unless `force`.
  function loadBoard(key, force) {
    if (typeof Leaderboard === 'undefined') return;
    if (!Leaderboard.configured()) { UI.setLeaderboardStatus('미설정'); UI.setBoard(null); return; }
    if (!force && key in boardCache) {
      UI.setBoard(boardCache[key]);
      UI.setLeaderboardStatus(boardCache[key] == null ? '오프라인' : '');
      return;
    }
    UI.setLeaderboardStatus('불러오는 중…');
    fetchBoard(key)
      .then((rows) => {
        boardCache[key] = rows;
        if (activeBoard === key) { UI.setBoard(rows); UI.setLeaderboardStatus(rows == null ? '오프라인' : ''); }
      })
      .catch(() => {
        boardCache[key] = null;
        if (activeBoard === key) { UI.setBoard(null); UI.setLeaderboardStatus('오프라인'); }
      });
  }

  // Invalidate the cache (a run just finished) and reload whatever's on screen.
  function refreshLeaderboard() {
    for (const k in boardCache) delete boardCache[k];
    loadBoard(activeBoard, true);
  }

  function resumeGame() {
    game.state = STATE.PLAYING;
    game.lastTime = performance.now();
    if (game.touchMode && !game.usingMouse) Mobile.showControls();
  }

  function setupUIButtons() {
    document.getElementById('start-btn').addEventListener('click', () => {
      Audio.resume();
      Audio.uiClick();
      captureNick();
      // The big "게임 시작" button is solo play. Drop any lingering co-op session
      // first, otherwise a stale MP.active from a previous room would make this
      // single-player run behave like co-op (e.g. the "wait for others" screen
      // after picking an upgrade).
      if (typeof MP !== 'undefined' && MP.active) MP.leave();
      startGame();
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
        // Load the selected board the first time the ranking screen is opened.
        if (isRanking) loadBoard(activeBoard);
      });
    });

    // Ranking board tabs (전체 / 오늘 / 2·3·4인 협동).
    document.querySelectorAll('#ranking-tabs .rank-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        Audio.uiClick();
        activeBoard = tab.dataset.board;
        document.querySelectorAll('#ranking-tabs .rank-tab').forEach((t) =>
          t.classList.toggle('active', t === tab));
        loadBoard(activeBoard);
      });
    });
    document.getElementById('restart-btn').addEventListener('click', () => {
      Audio.uiClick();
      UI.hideGameOver();
      // Co-op has no solo restart — "다시 도전" is relabelled "메뉴로" in
      // gameOver(); leave the room and return to the title/lobby instead.
      if (typeof MP !== 'undefined' && MP.active) {
        UI.hideHud();
        hideCoopWait();
        if (game.touchMode) Mobile.hideControls();
        MP.leave();
        UI.updateTitleRecords(Records.load(), Records.loadDaily());
        refreshLeaderboard();
        UI.showTitle();
        game.state = STATE.TITLE;
      } else {
        startGame();
      }
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
      hideCoopWait();
      if (game.touchMode) Mobile.hideControls();
      // Leaving to the menu drops out of the co-op room so teammates aren't left
      // waiting on us (e.g. at the next upgrade) and we don't linger in aggro.
      if (typeof MP !== 'undefined' && MP.active) MP.leave();
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

    openBtn.addEventListener('click', () => {
      Audio.uiClick();
      coopShowForm();              // always reopen on the join form
      overlay.classList.remove('hidden');
    });
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
      // On success we move to the waiting lobby (shown by the onLobby hook), NOT
      // straight into the game — co-op needs 2+ players.
      MP.joinRoom(url, room, game.nick).catch(() => { /* status shows the failure */ });
    });

    const startBtn = document.getElementById('coop-start');
    if (startBtn) startBtn.addEventListener('click', () => { Audio.uiClick(); MP.startCoopGame(); });
    const leaveBtn = document.getElementById('coop-leave');
    if (leaveBtn) leaveBtn.addEventListener('click', () => {
      Audio.uiClick();
      if (MP.active) MP.leave();
      coopShowForm();
    });
  }

  // Show the join form view of the co-op overlay (vs the waiting lobby view).
  function coopShowForm() {
    const form = document.getElementById('coop-form');
    const lobby = document.getElementById('coop-lobby');
    if (form) form.classList.remove('hidden');
    if (lobby) lobby.classList.add('hidden');
  }

  // Switch the co-op overlay to the waiting-lobby view after joining a room.
  function coopShowLobby(info) {
    const overlay = document.getElementById('coop-screen');
    const form = document.getElementById('coop-form');
    const lobby = document.getElementById('coop-lobby');
    if (overlay) overlay.classList.remove('hidden');
    if (form) form.classList.add('hidden');
    if (lobby) lobby.classList.remove('hidden');
    const code = document.getElementById('coop-lobby-code');
    if (code) code.textContent = (info && info.room) || '';
    coopUpdateLobby(info || { isHost: MP.isHost(), count: MP.getPlayerCount() });
  }

  // Refresh the lobby roster / count / start button as players come and go.
  function coopUpdateLobby(info) {
    const count = info ? info.count : MP.getPlayerCount();
    const countEl = document.getElementById('coop-lobby-count');
    if (countEl) countEl.textContent = `${count} / 4 명`;
    const listEl = document.getElementById('coop-lobby-list');
    if (listEl && info && info.players) {
      listEl.innerHTML = '';
      for (const p of info.players) {
        const li = document.createElement('li');
        li.textContent = (p.me ? '★ ' : '') + p.name + (p.id === undefined ? '' : '');
        listEl.appendChild(li);
      }
    }
    const startBtn = document.getElementById('coop-start');
    const waitEl = document.getElementById('coop-lobby-wait');
    const isHost = info ? info.isHost : MP.isHost();
    if (startBtn) {
      startBtn.classList.toggle('hidden', !isHost);
      startBtn.disabled = count < 2;
      startBtn.textContent = count < 2 ? '게임 시작 (2명 이상 필요)' : `게임 시작 (${count}명)`;
    }
    if (waitEl) waitEl.classList.toggle('hidden', isHost);
  }

  // Co-op game actually begins: hide the lobby overlay, then start.
  function coopStartGame() {
    const overlay = document.getElementById('coop-screen');
    if (overlay) overlay.classList.add('hidden');
    coopShowForm();   // reset for next time
    startGame();
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
      // A real mouse clicked. `mousedown` only fires for an actual mouse — pure
      // touch devices fire touchstart (preventDefault'd in mobile.js, which
      // suppresses synthetic mouse events) — so this also engages the mouse path
      // on a hybrid touchscreen+mouse laptop (touchMode on, but a mouse in use).
      // First mouse use on a touch-capable device → drop the on-screen touch UI;
      // it won't re-show (every showControls is gated on !usingMouse).
      if (game.touchMode && !game.usingMouse) Mobile.hideControls();
      game.usingMouse = true;
      if (game.state === STATE.PLAYING) {
        if (!game.pointerLocked) {
          requestPointerLock();
          return;
        }
        game.mouseDown = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) game.mouseDown = false;
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

    // Clicking the "클릭해서 게임 재개" prompt must (re)acquire pointer lock. The
    // prompt overlay sits above the canvas, so the canvas mousedown handler
    // never sees the click — handle it here. Co-op relies on this: the game
    // starts from a network 'welcome' event with no user gesture, so the initial
    // auto-lock is rejected and this click is what actually engages it.
    const lockPromptEl = document.getElementById('lock-prompt');
    if (lockPromptEl) {
      lockPromptEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || game.touchMode) return;
        if (game.state === STATE.PLAYING) requestPointerLock();
      });
    }

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
    // Pure-touch device with no mouse in use: pointer lock is meaningless, the
    // touch resume path gets us back into play. A hybrid touchscreen+mouse
    // device that has seen a real mouse click (usingMouse) falls through and
    // locks so the mouse can drive look/aim.
    if (game.touchMode && !game.usingMouse) {
      if (game.state === STATE.PAUSED) resumeGame();
      return;
    }
    game.canvas.requestPointerLock = game.canvas.requestPointerLock ||
                                     game.canvas.mozRequestPointerLock;
    if (game.canvas.requestPointerLock) {
      let p;
      try { p = game.canvas.requestPointerLock(); } catch (e) { p = null; }
      // Modern browsers return a Promise. A rejected lock (no user gesture — the
      // case for a co-op GUEST whose game starts from a network event, or a
      // context that disallows lock) does NOT reliably fire the legacy
      // 'pointerlockerror' event, so the prompt would never appear and the guest
      // would be stuck with a dead mouse. Catch the rejection and surface the
      // "click to play" prompt — clicking it re-requests the lock WITH a gesture.
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          if (game.state === STATE.PLAYING && typeof UI !== 'undefined' && UI.showLockPrompt) {
            UI.showLockPrompt();
          }
        });
      }
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
    // Lock in the co-op size at kickoff (2–4) so the run lands on the right
    // co-op board even if a teammate drops mid-game. 1 == solo.
    game.coopPlayers = (typeof MP !== 'undefined' && MP.active && MP.getPlayerCount)
      ? Math.max(2, Math.min(4, MP.getPlayerCount())) : 1;
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
    dismissBossCutscene();
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

    // In co-op only the host drives wave spawning; guests receive enemies and
    // wave/score state from the host's world snapshots.
    if (!(typeof MP !== 'undefined' && MP.active && MP.isGuest())) {
      startNextWave();
    }
    if (game.touchMode && !game.usingMouse) Mobile.showControls();
    requestPointerLock();
  }

  // Tear down any in-flight boss cutscene (DOM overlay + its setTimeout chain).
  // The cutscene runs ~6s; if the run ends or restarts mid-cutscene the handle
  // must be disposed or the overlay + dead timers leak onto the next screen.
  function dismissBossCutscene() {
    if (game.bossCin) { game.bossCin.dispose(); game.bossCin = null; }
  }

  // Play the 구미호 boss cutscene (pauses the round for ~6s). Shared by the host
  // (in startNextWave) and guests (via the co-op 'cutscene' event) so everyone
  // sees it together.
  function playBossCutscene(round) {
    game.cutsceneTimer = 6;
    dismissBossCutscene();
    Audio.gutpanLoopStart && Audio.gutpanLoopStart();
    game.bossCin = BossCutscene.playBossCutscene({
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
        game.bossCin = null;     // it removed itself; drop our handle
        if (!game.gutpan.active) Audio.gutpanLoopStop();
      }
    });
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
      playBossCutscene(round);
      // Co-op: the host stops broadcasting world during its own cutscene, so
      // tell guests to play the same cutscene (and pause) or they'd just stare
      // at a frozen world for 6s.
      if (typeof MP !== 'undefined' && MP.active && MP.isHost() && MP.broadcastCutscene) {
        MP.broadcastCutscene(round);
      }
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
    // Hold spawns at the global enemy cap so the field can't balloon into a
    // freeze; the queued enemy waits (timer not advanced) until something dies.
    if (Enemies.aliveCount && Enemies.aliveCount(game.enemies) >= Enemies.MAX_ALIVE) return;
    game.wave.spawnTimer -= dt;
    if (game.wave.spawnTimer > 0) return;

    const spawnPoints = GameMap.getSpawnPoints();
    // No spawn gates on this map → bail rather than crash on spawnPoints[0].
    if (!spawnPoints || spawnPoints.length === 0) return;
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
    game.enemies.push(e);
    game.wave.spawnTimer = game.wave.spawnInterval;
  }

  function pauseGame() {
    if (game.state !== STATE.PLAYING) return;
    // Co-op can't pause — the simulation is shared/host-authoritative, so one
    // client freezing would just desync (and a host pausing would stall every
    // guest). ESC / losing pointer lock just frees the cursor; the loop keeps
    // running and re-shows the "click to play" prompt so they can re-lock.
    if (typeof MP !== 'undefined' && MP.active) return;
    game.state = STATE.PAUSED;
    Audio.gutpanLoopStop && Audio.gutpanLoopStop();
    if (!game.touchMode) document.exitPointerLock();
    if (game.touchMode) Mobile.hideControls();
    // Drop held inputs so a key/button pressed at the moment of pausing (whose
    // keyup/touchend lands on the overlay, not the canvas) doesn't stay stuck
    // and auto-move / auto-fire the instant the run resumes.
    game.keys = {};
    game.mouseDown = false;
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
        // The run may have ended or been quit during the 800ms beat (co-op
        // team-wipe, quit-to-title). Don't pop the upgrade menu over a
        // game-over / title screen.
        if (game.state !== STATE.UPGRADE) return;
        UI.showUpgradeMenu(game.player, game.wave.number, () => {
          UI.hideUpgradeMenu();
          if (coopHost) {
            // Show the wait screen BEFORE notifying: if this pick was the last
            // one, notifyPicked() synchronously runs proceedNextWave →
            // coopHostStartNextWave, which hides the wait screen and starts the
            // wave. Showing it afterwards would leave a stale overlay covering
            // the resumed game (the "stuck on the wait screen" bug).
            showCoopWait();
            MP.notifyPicked();   // records host's pick; advances when all in
          } else {
            startNextWave();
            game.state = STATE.PLAYING;
            if (game.touchMode && !game.usingMouse) Mobile.showControls();
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
    if (game.state !== STATE.PLAYING) {
      // We're not in the active run (on the game-over / title screen, e.g. the
      // other player retried alone). Auto-skip the upgrade by reporting a pick
      // so the host's wait-for-all doesn't block on us.
      if (typeof MP !== 'undefined' && MP.active && MP.notifyPicked) MP.notifyPicked();
      return;
    }
    game.state = STATE.UPGRADE;
    if (!game.touchMode) document.exitPointerLock();
    if (game.touchMode) Mobile.hideControls();
    setTimeout(() => {
      UI.showUpgradeMenu(game.player, wave, () => {
        UI.hideUpgradeMenu();
        showCoopWait();      // frozen wait screen until the host signals wave_start
        MP.notifyPicked();   // → host
      });
    }, 400);
  }

  // Guest: host says the next wave is starting — close any open menu and play.
  function coopExitUpgrade() {
    UI.hideUpgradeMenu();
    hideCoopWait();
    game.state = STATE.PLAYING;
    if (game.touchMode && !game.usingMouse) Mobile.showControls();
    requestPointerLock();
  }

  // Host: everyone has picked (or timed out) — actually start the next wave.
  function coopHostStartNextWave() {
    UI.hideUpgradeMenu();
    hideCoopWait();
    startNextWave();
    game.state = STATE.PLAYING;
    if (game.touchMode && !game.usingMouse) Mobile.showControls();
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

  // Adaptive render resolution. The GC/allocation fixes removed most stutter,
  // so this stays conservative: it only steps down for genuinely low frame
  // rates and never below 0.85 (≈full-res look). Keeps the host close to the
  // guest's resolution instead of dropping it hard.
  const QUALITY_FLOOR = 0.85;
  let perfDtEMA = 1 / 60;
  let perfFrameCount = 0;
  let renderQuality = 1;

  function adaptQuality(dt) {
    perfDtEMA = perfDtEMA * 0.9 + dt * 0.1;
    if (++perfFrameCount < 60) return;     // re-evaluate ~every second
    perfFrameCount = 0;
    if (game.state !== STATE.PLAYING) return;   // don't resize-flash during menus
    if (typeof Raycaster === 'undefined' || !Raycaster.setQuality) return;
    const fps = 1 / perfDtEMA;
    if (fps < 38 && renderQuality > QUALITY_FLOOR) {
      renderQuality = Math.max(QUALITY_FLOOR, renderQuality - 0.05);
      Raycaster.setQuality(renderQuality);
    } else if (fps > 56 && renderQuality < 1) {
      renderQuality = Math.min(1, renderQuality + 0.05);
      Raycaster.setQuality(renderQuality);
    }
  }

  // Throttled per-phase error log (≤1/s each) so a recurring frame error is
  // visible in the console without spamming it.
  const _loopErrAt = {};
  function loopError(phase, err) {
    const t = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    if (!_loopErrAt[phase] || t - _loopErrAt[phase] > 1000) {
      _loopErrAt[phase] = t;
      if (typeof console !== 'undefined' && console.error) console.error('[loop:' + phase + ']', err);
    }
  }

  function loop(now) {
    // dt first, guarded against NaN / negative / huge tab-switch gaps so a bad
    // timestamp can't poison positions into NaN (which renders as a freeze).
    let dt = (now - (game.lastTime || now)) / 1000;
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > 0.05) dt = 0.05;
    game.lastTime = now;
    try { adaptQuality(dt); } catch (err) { loopError('adapt', err); }

    // Update and render are wrapped SEPARATELY: a thrown exception would
    // otherwise skip requestAnimationFrame and freeze the game forever. Keeping
    // render in its own try means a logic error never blanks the screen, and the
    // throttled log tells us which phase failed.
    try {
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

      // Update player input mapping. A downed (spectating) player can still walk
      // around freely and look — they just can't shoot until they respawn.
      mapKeysToInput();
      const move = game.touchMode ? Mobile.getMove() : null;
      Player.update(game.player, dt, { keys: game.keys, move });

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

      // Team wipe: only when EVERYONE is down does the run actually end. Either
      // side can detect it — the host knows every player's HP (allDowned), and a
      // downed guest ends locally the moment it sees no living ally to spectate.
      // Checking from both ends means a single missed/late HP snapshot on the
      // host can't strand the whole team "all dead but still playing". gameOver()
      // is idempotent via the GAMEOVER guard, and we broadcast so the other side
      // ends too.
      if (mpActive && game.state !== STATE.GAMEOVER) {
        const localDown = !game.player || game.player.hp <= 0 || game.player.downed;
        const wiped = MP.isHost() ? MP.allDowned() : (localDown && !MP.hasLivingAlly());
        if (wiped) {
          MP.broadcastGameOver();
          gameOver();
        }
      }

      if (!coopGuest) checkWaveComplete();

      // Broadcast our player state (host also emits the world snapshot).
      if (mpActive) MP.endFrame(dt);
    }
    } catch (err) { loopError('update', err); }

    try {
      render();
      if (game.state === STATE.PLAYING || game.state === STATE.UPGRADE || game.state === STATE.PAUSED) {
        UI.updateHud(game.player, game.wave, game.score);
        UI.drawMinimap(game.player, game.enemies);
      }
      // Keep the "click to play" prompt up whenever we're playing but the mouse
      // isn't captured. A co-op GUEST starts from a network event (no user
      // gesture), so the auto-lock is rejected and — unlike losing lock mid-game
      // — there's no event to surface the prompt; the guest would be left with a
      // dead mouse and no hint. This guarantees a clickable target to (re)lock.
      if (game.state === STATE.PLAYING && !game.pointerLocked &&
          (!game.touchMode || game.usingMouse) && UI.showLockPrompt) {
        UI.showLockPrompt();
      }
    } catch (err) { loopError('render', err); }

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
    Raycaster.render(game.player, game.enemies, game.particles, game.player.bobOffset + game.player.pitch, theme, game.projectiles);

    // Gun overlay
    UI.renderGun(ctx, game.player);

    ctx.restore();

    // 굿판 mode overlay layer — drawn OUTSIDE the shake transform so the
    // banner / talisman particles stay screen-locked even when the camera
    // is shaking from recoil.
    renderGutpan(ctx);
  }

  // ---------- 굿판 모드 render ----------
  // Three layers, in order: red multiply tint → falling talisman particles
  // → top-centre "굿판!" banner with ×1.5 / ×2.0 multiplier sub-text.
  // Everything reads game.gutpan.tintIntensity rather than the raw active
  // flag so the effect eases in/out instead of snap-cutting.
  function renderGutpan(ctx) {
    const g = game.gutpan;
    // Nothing to draw: tint faded out AND no falling talismans left. (The array
    // lives on `game`, not `game.gutpan` — the old `g.talismanParticles` check
    // was always undefined, so this early-out never fired.)
    if (g.tintIntensity <= 0.01 && game.talismanParticles.length === 0) return;

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

  // ---------- Game over ----------
  function gameOver() {
    game.state = STATE.GAMEOVER;
    game.cutsceneTimer = 0;
    dismissBossCutscene();       // don't leave a boss intro hanging over the result screen
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
    // the next time the player backs out to the menu. Co-op runs go to the
    // per-size co-op board (2/3/4인); solo runs to the all-time (+daily) board.
    if (typeof Leaderboard !== 'undefined') {
      const coopRun = (typeof MP !== 'undefined' && MP.active && game.coopPlayers >= 2);
      if (coopRun) {
        // One row per team: only the host submits, listing every member (host
        // first, then guests) so the run lands as a single entry with all the
        // names together. Guests skip the write but still refresh so the new
        // team row shows when they back out to the menu.
        if (MP.isHost()) {
          const members = [nick, ...MP.getRemotePlayers().map((r) => r.name)];
          Leaderboard.submitCoop(stats, members, game.coopPlayers)
            .then((ok) => { if (ok) refreshLeaderboard(); });
        } else {
          refreshLeaderboard();
        }
      } else {
        Leaderboard.submitRun(stats, nick, isDaily).then((ok) => { if (ok) refreshLeaderboard(); });
      }
    }

    // Co-op can't solo-restart, so the action button returns to the menu/lobby
    // instead of saying "다시 도전".
    const restartBtn = document.getElementById('restart-btn');
    if (restartBtn) {
      restartBtn.textContent = (typeof MP !== 'undefined' && MP.active) ? '메뉴로' : '다시 도전';
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
