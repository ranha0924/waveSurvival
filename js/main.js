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
    mouseDown: false
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

    UI.showTitle();
    requestAnimationFrame(loop);
  }

  function setupUIButtons() {
    document.getElementById('start-btn').addEventListener('click', () => {
      Audio.resume();
      Audio.uiClick();
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
      requestPointerLock();
    });
    document.getElementById('quit-btn').addEventListener('click', () => {
      Audio.uiClick();
      UI.hidePause();
      UI.hideHud();
      UI.showTitle();
      game.state = STATE.TITLE;
    });
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
      if (game.state === STATE.PLAYING) {
        if (!game.pointerLocked) {
          requestPointerLock();
          return;
        }
        game.mouseDown = true;
      } else if (game.state === STATE.PAUSED && !document.getElementById('pause-screen').classList.contains('hidden')) {
        // ignore clicks when pause shown
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) game.mouseDown = false;
    });

    document.addEventListener('pointerlockchange', () => {
      game.pointerLocked = document.pointerLockElement === game.canvas;
      if (game.pointerLocked) {
        UI.hideLockPrompt();
      } else if (game.state === STATE.PLAYING) {
        // Auto-pause when pointer lock lost
        pauseGame();
      }
    });
    // If pointer-lock request errors (browser denies it), show prompt
    document.addEventListener('pointerlockerror', () => {
      if (game.state === STATE.PLAYING) UI.showLockPrompt();
    });
  }

  function requestPointerLock() {
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

    UI.hideTitle();
    UI.hideGameOver();
    UI.hidePause();
    UI.hideUpgradeMenu();
    UI.showHud();
    game.state = STATE.PLAYING;

    Environment.init();

    startNextWave();
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

    // Pick spawn point farthest-ish from player among random subset
    let bestPt = spawnPoints[0];
    let bestScore = -1;
    for (let i = 0; i < 4; i++) {
      const pt = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
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
    document.exitPointerLock();
    UI.showPause();
  }

  function onScore(amount, enemy) {
    game.score.score += amount;
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
      document.exitPointerLock();
      setTimeout(() => {
        UI.showUpgradeMenu(game.player, game.wave.number, () => {
          UI.hideUpgradeMenu();
          startNextWave();
          game.state = STATE.PLAYING;
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
      if (game.mouseDown && game.pointerLocked) {
        Player.shoot(game.player, game.enemies, game.particles, onScore);
      }

      // Update player input mapping
      mapKeysToInput();
      Player.update(game.player, dt, { keys: game.keys });

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
    document.exitPointerLock();
    Audio.gameOver();
    UI.hideHud();
    UI.showGameOver({
      wave: game.wave.number,
      score: game.score.score,
      kills: game.player.kills
    });
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
