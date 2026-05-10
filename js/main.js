// Main entry: state machine, input, game loop, wave manager
(() => {
  // Game states
  const STATE = {
    TITLE: 'title',
    PLAYING: 'playing',
    PAUSED: 'paused',
    UPGRADE: 'upgrade',
    GAMEOVER: 'gameover',
    WAVE_INTERMISSION: 'wave_intermission'
  };

  // Persistent best records keyed in localStorage. Each "best" stat is paired
  // with the nickname that set it, so the title screen can show who holds it.
  // Daily records use a separate slot that auto-resets when the date changes,
  // so the daily-seed leaderboard is fresh each day.
  const Records = {
    KEY:       'wavesurvival_records_v1',
    DAILY_KEY: 'wavesurvival_daily_v1',
    NICK_KEY:  'wavesurvival_nick_v1',
    empty() {
      return {
        bestWave:  { value: 0, name: '' },
        bestScore: { value: 0, name: '' },
        bestKills: { value: 0, name: '' },
        bestCombo: { value: 0, name: '' },
        totalRuns: 0
      };
    },
    emptyDaily() {
      return { date: Random.todayString(), records: Records.empty() };
    },
    load() {
      try {
        const raw = localStorage.getItem(Records.KEY);
        if (!raw) return Records.empty();
        return Object.assign(Records.empty(), JSON.parse(raw));
      } catch (e) { return Records.empty(); }
    },
    save(r) {
      try { localStorage.setItem(Records.KEY, JSON.stringify(r)); } catch (e) {}
    },
    loadDaily() {
      try {
        const raw = localStorage.getItem(Records.DAILY_KEY);
        if (!raw) return Records.emptyDaily();
        const d = JSON.parse(raw);
        // Auto-reset when the calendar day rolls over.
        if (d.date !== Random.todayString()) return Records.emptyDaily();
        d.records = Object.assign(Records.empty(), d.records || {});
        return d;
      } catch (e) { return Records.emptyDaily(); }
    },
    saveDaily(d) {
      try { localStorage.setItem(Records.DAILY_KEY, JSON.stringify(d)); } catch (e) {}
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
    nick: ''
  };

  function init() {
    Audio.init();
    UI.init();

    game.canvas = document.getElementById('game-canvas');
    game.ctx = game.canvas.getContext('2d');
    Raycaster.init(game.canvas);
    Environment.init();

    setupInput();
    setupUIButtons();

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

  function startGame() {
    game.player = Player.create();
    game.enemies = [];
    game.projectiles = [];
    game.particles = [];
    game.score = { score: 0 };
    game.wave = { number: 0, enemiesAlive: 0, queue: [], spawnTimer: 0, spawnInterval: 0.6 };
    // Clear any stale input state from previous run / menu interaction
    game.keys = {};
    game.mouseDown = false;
    game.lastTime = performance.now();

    // Snapshot best records at run start so HUD/banners compare against a
    // stable baseline. We persist updated records only on game-over.
    game.runBest = Records.load();
    game.recordFired = { score: false, wave: false };
    UI.setHudBest(game.runBest);

    // Reseed every run so the daily challenge is identical regardless of
    // how many times you retry today.
    Random.seedToday();

    UI.hideTitle();
    UI.hideGameOver();
    UI.hidePause();
    UI.hideUpgradeMenu();
    UI.showHud();
    game.state = STATE.PLAYING;

    Environment.init();

    startNextWave();
    if (game.touchMode) Mobile.showControls();
    requestPointerLock();
  }

  function startNextWave() {
    game.wave.number += 1;
    const composition = Enemies.buildWave(game.wave.number);
    game.wave.queue = composition;
    game.wave.enemiesAlive = composition.length;
    game.wave.spawnTimer = 0;
    game.wave.spawnInterval = Math.max(0.2, 0.7 - game.wave.number * 0.02);

    UI.showWaveBanner(`WAVE ${game.wave.number}`);
    Audio.waveStart();

    // Wave-record banner fires once when the player reaches a wave higher
    // than their previous best (or any wave > 0 if there's no record yet).
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
    game.enemies.push(e);
    game.wave.spawnTimer = game.wave.spawnInterval;
  }

  function pauseGame() {
    if (game.state !== STATE.PLAYING) return;
    game.state = STATE.PAUSED;
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

      game.state = STATE.UPGRADE;
      if (!game.touchMode) document.exitPointerLock();
      if (game.touchMode) Mobile.hideControls();
      setTimeout(() => {
        UI.showUpgradeMenu(game.player, game.wave.number, () => {
          UI.hideUpgradeMenu();
          startNextWave();
          game.state = STATE.PLAYING;
          if (game.touchMode) Mobile.showControls();
          requestPointerLock();
        });
      }, 800);
    }
  }

  function updateParticles(dt) {
    for (let i = game.particles.length - 1; i >= 0; i--) {
      const p = game.particles[i];
      p.life -= dt * 1.2;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.exp(-dt * 3);
      p.vy *= Math.exp(-dt * 3);
      p.zOffset += p.vz * dt;
      p.vz -= dt * 6;
      if (p.life <= 0) game.particles.splice(i, 1);
    }
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - (game.lastTime || now)) / 1000);
    game.lastTime = now;

    if (game.state === STATE.PLAYING) {
      // Auto-shoot if held + auto weapons
      const inputReady = game.pointerLocked || game.touchMode;
      if (game.mouseDown && inputReady) {
        Player.shoot(game.player, game.enemies, game.particles, onScore);
      }

      // Update player input mapping
      mapKeysToInput();
      const move = game.touchMode ? Mobile.getMove() : null;
      Player.update(game.player, dt, { keys: game.keys, move });

      // Update enemies
      for (const e of game.enemies) {
        Enemies.update(e, dt, game.player, game.projectiles, game.particles, game.enemies);
      }

      Enemies.updateProjectiles(game.projectiles, dt, game.player, game.particles);
      updateParticles(dt);
      Environment.update(dt, game.wave.number, game.particles);

      // Spawn next enemy from queue
      spawnFromQueue(dt);

      // Death check
      if (game.player.hp <= 0) {
        gameOver();
      }

      checkWaveComplete();
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
  }

  function drawProjectiles() {
    const { W, H } = Raycaster.getDimensions();
    const ctx = game.ctx;
    const cosA = Math.cos(-game.player.angle);
    const sinA = Math.sin(-game.player.angle);
    const FOV = Math.PI / 3;

    for (const p of game.projectiles) {
      const dx = p.x - game.player.x;
      const dy = p.y - game.player.y;
      const tx = dx * cosA - dy * sinA;
      const ty = dx * sinA + dy * cosA;
      if (tx <= 0.05) continue;
      const screenX = (W / 2) * (1 + ty / (tx * Math.tan(FOV / 2)));
      const sz = Math.max(3, 12 / tx);
      const screenY = H / 2 + game.player.bobOffset + game.player.pitch;
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

  function gameOver() {
    game.state = STATE.GAMEOVER;
    if (!game.touchMode) document.exitPointerLock();
    if (game.touchMode) Mobile.hideControls();
    Audio.gameOver();
    UI.hideHud();

    const stats = {
      wave:      game.wave.number,
      score:     game.score.score,
      kills:     game.player.kills,
      headshots: game.player.headshots,
      bossKills: game.player.bossKills,
      maxCombo:  game.player.maxComboReached
    };

    // Compare against the snapshot taken at run start, then merge into the
    // persisted records (each best is independent — you can break one without
    // breaking the others).
    const prev = game.runBest || Records.empty();
    const updated = Records.load();
    const broken = { wave: false, score: false, kills: false, combo: false };

    function bumpInto(target, field, value, statName, brokenOut) {
      if (value > target[field].value) {
        target[field] = { value, name: game.nick || '익명' };
        if (brokenOut) brokenOut[statName] = true;
      }
    }
    bumpInto(updated, 'bestWave',  stats.wave,     'wave',  broken);
    bumpInto(updated, 'bestScore', stats.score,    'score', broken);
    bumpInto(updated, 'bestKills', stats.kills,    'kills', broken);
    bumpInto(updated, 'bestCombo', stats.maxCombo, 'combo', broken);
    updated.totalRuns = (updated.totalRuns || 0) + 1;
    Records.save(updated);

    // Daily records — independent leaderboard for the day's seed.
    const daily = Records.loadDaily();
    bumpInto(daily.records, 'bestWave',  stats.wave,     null, null);
    bumpInto(daily.records, 'bestScore', stats.score,    null, null);
    bumpInto(daily.records, 'bestKills', stats.kills,    null, null);
    bumpInto(daily.records, 'bestCombo', stats.maxCombo, null, null);
    Records.saveDaily(daily);

    UI.showGameOver(stats, prev, broken, game.nick);
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
