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

  // Stable per-player colour from the id so each ally reads as a distinct
  // figure without needing assigned slots.
  function colorFor(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
    const hue = h % 360;
    return { body: `hsl(${hue},55%,42%)`, head: `hsl(${hue},45%,68%)` };
  }

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
        setStatus(`방 ${msg.room} · ${state.role === 'host' ? '방장' : '참가'} · ${remotes.size + 1}명`);
        resolve(msg);
        if (hooks.startGame) hooks.startGame();
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
    setStatus('연결 종료');
  }

  function wireHandlers() {
    Net.on('peer_join', (m) => { addRemote(m.id, m.name); });
    Net.on('peer_leave', (m) => { remotes.delete(m.id); });
    Net.on('roster', (m) => {
      const ids = new Set((m.players || []).map((p) => p.id));
      for (const p of (m.players || [])) {
        if (p.id !== state.selfId && !remotes.has(p.id)) addRemote(p.id, p.name);
      }
      for (const id of [...remotes.keys()]) if (!ids.has(id)) remotes.delete(id);
      setStatus(`방 ${state.room} · ${state.role === 'host' ? '방장' : '참가'} · ${remotes.size + 1}명`);
    });
    Net.on('pstate', (m) => applyRemoteState(m));
    Net.on('world', (m) => { if (isGuest()) applyWorld(m); });
    Net.on('hit', (m) => { if (isHost() && hooks.applyGuestHit) hooks.applyGuestHit(m.id, m.dmg, m.head); });
    // One-shot events. Currently: 'hurt' — the host telling a specific guest it
    // took damage (enemies are host-authoritative, so guest HP loss originates
    // there). Only the addressed client applies it.
    Net.on('ev', (m) => {
      if (m.k === 'hurt' && m.to === state.selfId && game && game.player && game.player.hp > 0) {
        Player.takeDamage(game.player, m.dmg);
        if (typeof UI !== 'undefined' && UI.flashHit) UI.flashHit();
      }
    });
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
    const k = Math.min(1, dt * 14);   // smoothing toward network targets
    for (const r of remotes.values()) {
      if (r.tx != null) {
        r.x += (r.tx - r.x) * k;
        r.y += (r.ty - r.y) * k;
        r.angle = lerpAngle(r.angle, r.tangle, k);
      }
    }
    if (isGuest()) {
      for (const g of ghostEnemies.values()) {
        g.x += (g.tx - g.x) * k;
        g.y += (g.ty - g.y) * k;
        if (g.hitFlash > 0) g.hitFlash -= dt;
      }
      // Rebuild the array the renderer / local hitscan iterate over.
      game.enemies = [...ghostEnemies.values()];
    }
  }

  // Send our player state, and (host only) broadcast the world snapshot.
  function endFrame(dt) {
    if (!state.active || !game.player) return;
    pstateAccum += dt;
    if (pstateAccum >= 1 / SEND_PSTATE_HZ) {
      pstateAccum = 0;
      const p = game.player;
      Net.send({ t: 'pstate', x: round2(p.x), y: round2(p.y), a: round2(p.angle), hp: Math.round(p.hp) });
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
  function reportHit(enemy, dmg, headshot) {
    if (!isGuest() || enemy.netId == null) return;
    Net.send({ t: 'hit', id: enemy.netId, dmg: Math.round(dmg), head: !!headshot });
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
  }

  function getRemotePlayers() { return [...remotes.values()]; }

  // Host-only: the full set of living players for enemy targeting — the host's
  // own player plus every guest still alive. Guests are tagged isRemote so
  // enemy.damagePlayer routes their damage over the network. A guest whose HP
  // has hit 0 (downed / spectating) is excluded, so enemies stop chasing it.
  function getAllPlayers() {
    const list = [];
    if (game && game.player && game.player.hp > 0 && !game.player.downed) list.push(game.player);
    for (const r of remotes.values()) {
      if (r.hp > 0) list.push({ id: r.id, x: r.x, y: r.y, hp: r.hp, isRemote: true });
    }
    return list;
  }

  // Host → a specific guest: "you took dmg". Relayed as a targeted event; only
  // the addressed client applies it (see the 'ev' handler).
  function damageRemotePlayer(id, dmg) {
    Net.send({ t: 'ev', k: 'hurt', to: id, dmg: Math.round(dmg) });
  }

  return {
    init, joinRoom, leave, beginFrame, endFrame, reportHit, getRemotePlayers,
    getAllPlayers, damageRemotePlayer,
    isHost: () => state.role === 'host',
    isGuest: () => state.role === 'guest',
    get active() { return state.active; },
    get role() { return state.role; },
    getStatus: () => state.status,
    getLatency: () => Net.getLatency()
  };
})();
