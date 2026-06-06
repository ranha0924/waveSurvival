// Co-op multiplayer coordinator (host-authority over a dumb relay).
//
// Model (see docs/multiplayer-coop-design.md):
//   - The first player in a room is the HOST. The host runs the existing
//     single-player simulation (enemy AI, waves, spawns) unchanged and
//     broadcasts an authoritative world snapshot (~20Hz).
//   - GUESTS do not simulate enemies. They render the host's snapshot, move
//     their own player locally, and report hits to the host, which applies the
//     damage so enemy HP / death stays authoritative.
//   - Every client broadcasts its own player state (~25Hz) so each sees the
//     others as billboards.
//
// This module owns all of that. main.js calls MP.init() once, then MP.beginFrame
// / MP.endFrame each tick while playing. raycaster.js calls MP.getRemotePlayers()
// to draw the other players. Everything is gated behind MP.active so the
// single-player path is byte-for-byte unchanged when offline.
const MP = (() => {
  const SEND_PSTATE_HZ = 25;
  const SEND_WORLD_HZ = 20;
  // Extra world-units a guest allows beyond an attack's range when validating
  // incoming damage, to cover its own slightly-stale view of the attacker. Big
  // enough not to reject legit close hits, small enough to drop "far" ones.
  const HURT_LAG_MARGIN = 1.5;

  let game = null;            // reference to main.js game object
  let hooks = {};            // { startGame, applyGuestHit, onScore }

  const state = {
    active: false,
    role: null,              // 'host' | 'guest'
    selfId: null,
    room: '',
    seed: 1,
    status: ''
  };

  // Remote players keyed by id. Each holds the network target (tx,ty,tangle)
  // and a render position (x,y,angle) eased toward it so 20Hz updates look
  // smooth at 60fps.
  const remotes = new Map();
  // Guest-side enemy mirror keyed by netId, eased toward snapshot targets.
  const ghostEnemies = new Map();

  let pstateAccum = 0;
  let worldAccum = 0;

  // True once the co-op run has actually begun (host pressed start, or we got
  // the start signal). Used to gate the waiting lobby and to drop late joiners
  // straight into a game already in progress.
  let gameStarted = false;

  // Upgrade-sync (host): which players have chosen a card this intermission,
  // and a fallback timer so a slow / AFK player can't stall the run forever.
  const pickedSet = new Set();
  let upgradeWave = 0;
  let upgradeTimer = null;
  const UPGRADE_TIMEOUT_MS = 30000;

  // Stable per-player colour from the id so each ally reads as a distinct
  // figure without needing assigned slots.
  function colorFor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
    const hue = h % 360;
    return { body: `hsl(${hue},55%,42%)`, head: `hsl(${hue},45%,68%)` };
  }

  // Role predicates — used throughout the module (and re-exported). Defined as
  // real functions, not just object properties, so internal callers can use them.
  function isHost() { return state.role === 'host'; }
  function isGuest() { return state.role === 'guest'; }

  // ---------- Lifecycle ----------
  function init(gameRef, hookFns) {
    game = gameRef;
    hooks = hookFns || {};
  }

  // Connect, join a room, and once the server confirms our role start the
  // co-op game. Returns a promise that resolves on welcome (or rejects on a
  // connection / room error).
  function joinRoom(url, room, name) {
    return new Promise((resolve, reject) => {
      setStatus('연결 중…');
      wireHandlers();
      Net.connect(url)
        .then(() => {
          Net.send({ t: 'join', room, name, seed: (Math.random() * 0x7fffffff) | 0 });
        })
        .catch((e) => { setStatus('연결 실패'); reject(e); });

      // Resolve when welcome arrives (set up once).
      const onWelcome = (msg) => {
        state.active = true;
        state.selfId = msg.id;
        state.room = msg.room;
        state.seed = msg.seed | 0;
        state.role = msg.isHost ? 'host' : 'guest';
        remotes.clear();
        ghostEnemies.clear();
        for (const p of (msg.players || [])) {
          if (p.id !== state.selfId) addRemote(p.id, p.name);
        }
        gameStarted = false;
        setStatus(`방 ${msg.room} · ${state.role === 'host' ? '방장' : '참가'} · ${remotes.size + 1}명`);
        resolve(msg);
        // Don't start the game on join — co-op needs at least 2 players. Show a
        // waiting lobby; the host starts it (or a late joiner drops into a game
        // already in progress, handled in peer_join).
        if (hooks.onLobby) hooks.onLobby({ room: msg.room, isHost: isHost(), count: remotes.size + 1 });
      };
      Net.on('welcome', onWelcome);
      Net.on('room_full', () => { setStatus('방이 가득 찼습니다'); reject(new Error('room_full')); });
    });
  }

  function leave() {
    Net.close();
    state.active = false;
    state.role = null;
    remotes.clear();
    ghostEnemies.clear();
    pickedSet.clear();
    gameStarted = false;
    if (upgradeTimer) { clearTimeout(upgradeTimer); upgradeTimer = null; }
    setStatus('연결 종료');
  }

  function wireHandlers() {
    Net.on('peer_join', (m) => {
      addRemote(m.id, m.name);
      // No mid-game drop-in: if we're the host and already playing, tell the
      // newcomer the game is in progress (they wait in the lobby) instead of
      // pulling them into the running session.
      if (isHost() && gameStarted) Net.send({ t: 'ev', k: 'in_progress', to: m.id });
      refreshLobby();
    });
    Net.on('peer_leave', (m) => { remotes.delete(m.id); refreshLobby(); });
    Net.on('roster', (m) => {
      const ids = new Set((m.players || []).map((p) => p.id));
      for (const p of (m.players || [])) {
        if (p.id !== state.selfId && !remotes.has(p.id)) addRemote(p.id, p.name);
      }
      for (const id of [...remotes.keys()]) if (!ids.has(id)) remotes.delete(id);
      setStatus(`방 ${state.room} · ${state.role === 'host' ? '방장' : '참가'} · ${remotes.size + 1}명`);
      refreshLobby();
    });
    Net.on('pstate', (m) => applyRemoteState(m));
    Net.on('world', (m) => { if (isGuest()) applyWorld(m); });
    Net.on('hit', (m) => {
      if (isHost() && hooks.applyGuestHit) hooks.applyGuestHit(m.id, m.dmg, m.head, m.combo, m.gut, m.from);
    });
    // One-shot events, dispatched by `k`:
    //   hurt       host → a guest: you took damage (M2)
    //   kill       host → a guest: your reported hit killed an enemy — bump
    //              your local combo so your personal 굿판 advances (M3)
    //   wave_clear host → all guests: open your own upgrade menu (M3)
    //   picked     a guest → host: I chose my upgrade
    //   wave_start host → all guests: leave upgrade, next wave is starting
    //   gameover   host → all: whole team is down (true wipe)
    Net.on('ev', (m) => onEvent(m));
    Net.on('host_left', () => { setStatus('방장이 나갔습니다 — 세션 종료'); leave(); });
    Net.on('close', () => { if (state.active) setStatus('연결이 끊어졌습니다'); });
  }

  function addRemote(id, name) {
    if (id === state.selfId) return;
    remotes.set(id, {
      id, name: name || '익명', color: colorFor(id),
      x: game && game.player ? game.player.x : 21,
      y: game && game.player ? game.player.y : 27,
      angle: 0, hp: 100,
      tx: null, ty: null, tangle: 0
    });
  }

  // ---------- Per-frame ----------
  // Apply incoming network state and smooth render positions. Called at the
  // top of the playing tick before local simulation.
  function beginFrame(dt) {
    if (!state.active) return;
    // Frame-rate-INDEPENDENT smoothing (exponential time constant). The old
    // dt*k form snapped almost instantly on low-FPS clients, which read as
    // enemies "teleporting forward" when a snapshot landed. A fixed ~90ms time
    // constant eases the same way at any frame rate.
    const kPlayers = 1 - Math.exp(-dt / 0.10);
    const kEnemies = 1 - Math.exp(-dt / 0.09);
    for (const r of remotes.values()) {
      if (r.tx != null) {
        r.x += (r.tx - r.x) * kPlayers;
        r.y += (r.ty - r.y) * kPlayers;
        r.angle = lerpAngle(r.angle, r.tangle, kPlayers);
      }
    }
    if (isGuest()) {
      for (const g of ghostEnemies.values()) {
        g.x += (g.tx - g.x) * kEnemies;
        g.y += (g.ty - g.y) * kEnemies;
        if (g.hitFlash > 0) g.hitFlash -= dt;
      }
      // Refill the array the renderer / local hitscan iterate over, reusing it
      // (no per-frame array allocation).
      game.enemies.length = 0;
      for (const g of ghostEnemies.values()) game.enemies.push(g);
    }
  }

  // Send our player state, and (host only) broadcast the world snapshot.
  function endFrame(dt) {
    if (!state.active || !game.player) return;
    pstateAccum += dt;
    if (pstateAccum >= 1 / SEND_PSTATE_HZ) {
      pstateAccum = 0;
      const p = game.player;
      // Report HP 0 while downed so the host treats us as out-of-aggro even if a
      // heal locally lifted our HP — getAllPlayers filters on hp>0.
      const hp = p.downed ? 0 : Math.round(p.hp);
      Net.send({ t: 'pstate', x: round2(p.x), y: round2(p.y), a: round2(p.angle), hp });
    }
    if (isHost()) {
      worldAccum += dt;
      if (worldAccum >= 1 / SEND_WORLD_HZ) {
        worldAccum = 0;
        Net.send(buildWorld());
      }
    }
  }

  // ---------- Host: build authoritative snapshot ----------
  function buildWorld() {
    const enemies = [];
    for (const e of game.enemies) {
      if (!e.alive) continue;
      enemies.push({
        id: e.netId,
        t: e.type.id,
        s: e.scale || 1,
        x: round2(e.x), y: round2(e.y),
        hp: Math.round(e.hp), mhp: Math.round(e.maxHp),
        hop: e.hopOffset ? round2(e.hopOffset) : 0,
        fl: e.hitFlash > 0 ? 1 : 0
      });
    }
    const proj = [];
    for (const pr of game.projectiles) proj.push({ x: round2(pr.x), y: round2(pr.y) });
    return {
      t: 'world',
      enemies,
      proj,
      wave: game.wave.number,
      alive: game.wave.enemiesAlive,
      score: game.score.score
    };
  }

  // ---------- Guest: apply snapshot ----------
  function applyWorld(m) {
    const seen = new Set();
    for (const ne of m.enemies) {
      seen.add(ne.id);
      let g = ghostEnemies.get(ne.id);
      const type = (typeof Enemies !== 'undefined' && Enemies.types[ne.t]) || null;
      if (!g) {
        g = {
          netId: ne.id, type, scale: ne.s,
          x: ne.x, y: ne.y, tx: ne.x, ty: ne.y,
          hp: ne.hp, maxHp: ne.mhp, alive: true,
          hopOffset: ne.hop, hitFlash: 0, stunTimer: 0
        };
        ghostEnemies.set(ne.id, g);
      }
      g.tx = ne.x; g.ty = ne.y;
      g.hp = ne.hp; g.maxHp = ne.mhp;
      g.hopOffset = ne.hop;
      g.type = type;
      if (ne.fl) g.hitFlash = 0.1;
    }
    // Anything the host no longer reports is dead / despawned.
    for (const id of [...ghostEnemies.keys()]) if (!seen.has(id)) ghostEnemies.delete(id);

    game.projectiles = (m.proj || []).map((p) => ({ x: p.x, y: p.y }));

    // Revive a downed guest when the host advances to a new wave. We compare
    // against the wave the player went down on (set in main.js), so a guest
    // that dies mid-wave spectates until the host clears it, then respawns.
    if (game.player && game.player.downed && m.wave > (game.player.downedAtWave || 0)) {
      game.player.hp = game.player.maxHp;
      game.player.downed = false;
      if (typeof UI !== 'undefined' && UI.showWaveBanner) UI.showWaveBanner('부활!');
    }

    game.wave.number = m.wave;
    game.wave.enemiesAlive = m.alive;
    game.score.score = m.score;
  }

  function applyRemoteState(m) {
    const r = remotes.get(m.from);
    if (!r) { addRemote(m.from, '익명'); return; }
    r.tx = m.x; r.ty = m.y; r.tangle = m.a; r.hp = m.hp;
    if (r.x == null) { r.x = m.x; r.y = m.y; r.angle = m.a; }
  }

  // ---------- Guest → host hit report ----------
  // Called from Player.damageEnemy when this client is a guest, instead of
  // mutating the (authoritative) enemy locally.
  function reportHit(enemy, dmg, headshot, combo, gut) {
    if (!isGuest() || enemy.netId == null) return;
    // combo / gut ride along so the host scores a resulting kill with OUR combo
    // and 굿판 multiplier (team score is host-authoritative, attribution isn't).
    Net.send({
      t: 'hit', id: enemy.netId, dmg: Math.round(dmg), head: !!headshot,
      combo: combo | 0, gut: gut ? 1 : 0
    });
  }

  // ---------- Helpers ----------
  function round2(n) { return Math.round(n * 100) / 100; }
  function lerpAngle(a, b, k) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
  }
  function setStatus(s) {
    state.status = s;
    const el = document.getElementById('mp-status');
    if (el) el.textContent = s;
    const el2 = document.getElementById('mp-status2');   // lobby status line
    if (el2) el2.textContent = s;
  }

  // ---------- Event dispatch (one-shot 'ev' messages) ----------
  function onEvent(m) {
    switch (m.k) {
      case 'hurt':
        if (m.to === state.selfId && game && game.player && game.player.hp > 0) {
          // Reject hits that are far from us on our own (authoritative-for-self)
          // position — the attack source was current on the host but our
          // position there is lagged, so an enemy we've run away from shouldn't
          // land. Margin covers our own slightly-stale view of the enemy.
          if (m.sx != null) {
            const dx = game.player.x - m.sx, dy = game.player.y - m.sy;
            const maxD = (m.r || 1) + HURT_LAG_MARGIN;
            if (dx * dx + dy * dy > maxD * maxD) break;   // too far → ignore
          }
          Player.takeDamage(game.player, m.dmg);
          if (typeof UI !== 'undefined' && UI.flashHit) UI.flashHit();
        }
        break;

      case 'kill':
        // Host told us our reported hit killed an enemy. Credit our own combo
        // locally so our personal 굿판 advances; the team score was already
        // added on the host. Boss / headshot flags refine combo + soul-siphon.
        if (m.to === state.selfId && game && game.player) {
          Player.registerKill(game.player, !!m.head, !!m.boss);
          if (game.player.soulSiphon) {
            game.player.hp = Math.min(game.player.maxHp, game.player.hp + (m.boss ? 25 : 5));
          }
        }
        break;

      case 'wave_clear':
        // Guests: open your own upgrade menu for this wave.
        if (isGuest() && hooks.enterUpgrade) hooks.enterUpgrade(m.wave);
        break;

      case 'picked':
        // Host: a guest chose its card.
        if (isHost() && m.from) markPicked(m.from);
        break;

      case 'wave_start':
        // Guests: intermission over, resume play.
        if (isGuest() && hooks.exitUpgrade) hooks.exitUpgrade(m.wave);
        break;

      case 'cutscene':
        // Guests: play the boss cutscene the host just started.
        if (isGuest() && hooks.playCutscene) hooks.playCutscene(m.round);
        break;

      case 'start_game':
        // Host pressed start (broadcast to the lobby). Begin once.
        if (m.to && m.to !== state.selfId) break;
        if (!gameStarted) {
          gameStarted = true;
          if (hooks.startGame) hooks.startGame();
        }
        break;

      case 'in_progress':
        // We joined a room whose game is already running — no mid-game drop-in.
        // Stay in the lobby with a clear notice; leave and retry after it ends.
        if (m.to === state.selfId) setStatus('게임이 진행 중입니다 — 끝난 뒤 다시 시도하세요');
        break;

      case 'gameover':
        // Whole team wiped — everyone ends together.
        if (hooks.gameOverFromNet) hooks.gameOverFromNet();
        break;
    }
  }

  // ---------- Lobby / start ----------
  function getPlayerCount() { return remotes.size + 1; }

  function refreshLobby() {
    if (hooks.onRoster) {
      hooks.onRoster({
        isHost: isHost(),
        count: getPlayerCount(),
        started: gameStarted,
        players: [{ id: state.selfId, name: '나', me: true },
                  ...[...remotes.values()].map((r) => ({ id: r.id, name: r.name }))]
      });
    }
  }

  // Host presses start in the lobby (only enabled at 2+). Tell everyone to begin
  // and start locally.
  function startCoopGame() {
    if (!isHost() || gameStarted) return;
    if (getPlayerCount() < 2) return;   // enforce the 2-player minimum
    gameStarted = true;
    Net.send({ t: 'ev', k: 'start_game' });
    if (hooks.startGame) hooks.startGame();
  }

  // ---------- Co-op upgrade sync (host-authoritative pacing) ----------
  // Host: a wave cleared. Tell guests to open their menus and start tracking
  // who has picked (the host counts once it picks via notifyPicked).
  function beginUpgradeSync(wave) {
    if (!isHost()) return;
    upgradeWave = wave;
    pickedSet.clear();
    Net.send({ t: 'ev', k: 'wave_clear', wave });
    if (upgradeTimer) clearTimeout(upgradeTimer);
    upgradeTimer = setTimeout(() => proceedNextWave(true), UPGRADE_TIMEOUT_MS);
  }

  // Called when the LOCAL player finishes picking. Host records itself and
  // checks for completion; a guest tells the host.
  function notifyPicked() {
    if (isHost()) markPicked(state.selfId);
    else Net.send({ t: 'ev', k: 'picked', wave: upgradeWave });
  }

  function markPicked(id) {
    if (!isHost()) return;
    pickedSet.add(id);
    // Everyone connected (host + current guests) chosen? Go. Disconnected /
    // late-joined players are covered by the timeout.
    const needed = new Set([state.selfId, ...remotes.keys()]);
    let all = true;
    for (const id2 of needed) if (!pickedSet.has(id2)) { all = false; break; }
    if (all) proceedNextWave(false);
  }

  function proceedNextWave() {
    if (!isHost()) return;
    if (upgradeTimer) { clearTimeout(upgradeTimer); upgradeTimer = null; }
    pickedSet.clear();
    Net.send({ t: 'ev', k: 'wave_start', wave: upgradeWave + 1 });
    if (hooks.hostStartNextWave) hooks.hostStartNextWave();
  }

  // ---------- Team-wipe ----------
  // True only when the host is down AND every connected guest is down too, so a
  // lone surviving guest keeps the run alive.
  function allDowned() {
    if (!isHost()) return false;
    const hostDown = !game || !game.player || game.player.hp <= 0 || game.player.downed;
    if (!hostDown) return false;
    for (const r of remotes.values()) if (r.hp > 0) return false;
    return true;
  }

  // Does ANY teammate still have HP? Both host and guests broadcast HP 0 the
  // moment they go down (see endFrame), so this reads true while at least one
  // ally is up and false once the whole rest of the team is down. Lets a downed
  // client detect a team-wipe on its own — the run no longer hinges solely on
  // the host's per-snapshot HP view, which could miss the wipe if a downed
  // player's last HP report lagged.
  function hasLivingAlly() {
    for (const r of remotes.values()) if (r.hp > 0) return true;
    return false;
  }

  function broadcastGameOver() {
    Net.send({ t: 'ev', k: 'gameover' });
  }

  function getRemotePlayers() { return [...remotes.values()]; }

  // A living teammate to spectate while downed (first one with HP). Returns the
  // eased render position so the spectator camera is smooth.
  function getSpectateTarget() {
    for (const r of remotes.values()) if (r.hp > 0) return r;
    return null;
  }

  // Host-only: the full set of living players for enemy targeting — the host's
  // own player plus every guest still alive. Guests are tagged isRemote so
  // enemy.damagePlayer routes their damage over the network. A guest whose HP
  // has hit 0 (downed / spectating) is excluded, so enemies stop chasing it.
  //
  // Called per-enemy every frame on the host, so the result array and the guest
  // proxy objects are pooled (no per-call allocation). The returned array is
  // reused — callers must consume it before the next getAllPlayers() call (they
  // all iterate it synchronously, so that holds).
  const _allPlayers = [];
  const _proxyPool = [];
  function getAllPlayers() {
    _allPlayers.length = 0;
    if (game && game.player && game.player.hp > 0 && !game.player.downed) _allPlayers.push(game.player);
    let i = 0;
    for (const r of remotes.values()) {
      if (r.hp <= 0) continue;
      let p = _proxyPool[i];
      if (!p) { p = { id: 0, x: 0, y: 0, hp: 0, isRemote: true }; _proxyPool[i] = p; }
      p.id = r.id; p.x = r.x; p.y = r.y; p.hp = r.hp;
      _allPlayers.push(p);
      i++;
    }
    return _allPlayers;
  }

  // Host → a specific guest: "you took dmg from an attack at (sx,sy) with the
  // given range". The guest validates against its OWN current position before
  // applying, rejecting hits that are far away on its screen — the host only
  // knows the guest's lagged position, so this stops "an enemy across the map
  // hit me" false positives. Only the addressed client applies it.
  function damageRemotePlayer(id, dmg, sx, sy, range) {
    const m = { t: 'ev', k: 'hurt', to: id, dmg: Math.round(dmg) };
    if (sx != null) { m.sx = round2(sx); m.sy = round2(sy); m.r = round2(range || 1); }
    Net.send(m);
  }

  // Host → a specific guest: "your reported hit just killed an enemy" so the
  // guest can advance its own combo / 굿판 (team score was credited on the host).
  function creditGuestKill(id, headshot, isBoss) {
    Net.send({ t: 'ev', k: 'kill', to: id, head: !!headshot, boss: !!isBoss });
  }

  // Host → all: a boss wave started; guests play the cutscene in sync.
  function broadcastCutscene(round) {
    Net.send({ t: 'ev', k: 'cutscene', round });
  }

  return {
    init, joinRoom, leave, beginFrame, endFrame, reportHit, getRemotePlayers,
    getSpectateTarget, getAllPlayers, damageRemotePlayer, creditGuestKill,
    broadcastCutscene, beginUpgradeSync, notifyPicked, allDowned, hasLivingAlly, broadcastGameOver,
    startCoopGame, getPlayerCount,
    isHost, isGuest,
    get active() { return state.active; },
    get role() { return state.role; },
    getStatus: () => state.status,
    getLatency: () => Net.getLatency()
  };
})();
