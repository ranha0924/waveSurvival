// Wave Survival — co-op relay server.
//
// Design: this server is a *pure relay*. It does NOT simulate enemies, waves,
// or damage. Instead one client per room is the "host" (the first to join) and
// runs the existing in-browser simulation, broadcasting the authoritative world
// state through this relay. Guests send their own player state + hit reports.
// See docs/multiplayer-coop-design.md §3 for why this model was chosen (it lets
// us ship co-op without porting enemy.js to Node).
//
// Responsibilities:
//   - room membership (create / join by 4-char code)
//   - host election (first member; on host leave the room is closed)
//   - fan-out: relay every message from a member to the *other* members
//
// Wire format is line-delimited JSON over WebSocket. Each message has a short
// "t" (type) tag — see docs and js/multiplayer.js for the schema.

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8787;
const MAX_ROOM = 4;            // co-op cap
const TICK_TIMEOUT_MS = 30000; // drop a socket that goes silent this long

// roomCode -> { host: id, members: Map<id, ws>, seed }
const rooms = new Map();
let nextId = 1;

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

// Relay `obj` to every member of the room except `exceptId`.
function broadcast(room, obj, exceptId) {
  const data = JSON.stringify(obj);
  for (const [id, ws] of room.members) {
    if (id === exceptId) continue;
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function roster(room) {
  return [...room.members.keys()].map((id) => ({
    id,
    name: room.members.get(id)._name || '익명',
    host: id === room.host
  }));
}

function leaveRoom(ws) {
  const code = ws._room;
  if (!code) return;
  const room = rooms.get(code);
  if (!room) return;
  room.members.delete(ws._id);
  ws._room = null;

  if (room.members.size === 0) {
    rooms.delete(code);
    return;
  }
  // If the host left, the authoritative simulation is gone — close the room.
  if (ws._id === room.host) {
    broadcast(room, { t: 'host_left' });
    for (const [, member] of room.members) member._room = null;
    rooms.delete(code);
    return;
  }
  broadcast(room, { t: 'peer_leave', id: ws._id });
  broadcast(room, { t: 'roster', players: roster(room) });
}

const server = http.createServer((req, res) => {
  // Tiny health endpoint so hosting platforms (Render/Railway) get a 200.
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('wavesurvival-relay ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

// maxPayload caps a single frame so a client can't send a multi-MB message that
// we'd then fan out to the whole room (amplification DoS). Snapshots are a few
// KB at most; 64 KB is comfortable headroom.
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

// Per-socket flood guard. A normal client sends ~25 (guest) / ~65 (host) msgs a
// second; anything past this rolling-second cap is a flood, so we close the
// socket. Cheap to track and bounds the relay's fan-out work.
const MSG_PER_SEC = 200;

wss.on('connection', (ws) => {
  ws._id = 'p' + (nextId++);
  ws._room = null;
  ws._name = '익명';
  ws._alive = true;
  ws._msgCount = 0;
  ws._msgWindow = Date.now();
  ws.on('pong', () => { ws._alive = true; });

  send(ws, { t: 'hello', id: ws._id });

  ws.on('message', (raw) => {
    // Flood guard: count messages per rolling second, drop the socket past cap.
    const now = Date.now();
    if (now - ws._msgWindow >= 1000) { ws._msgWindow = now; ws._msgCount = 0; }
    if (++ws._msgCount > MSG_PER_SEC) { try { ws.close(1008, 'rate'); } catch (e) {} return; }

    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case 'join': {
        const code = String(msg.room || '').toUpperCase().slice(0, 6) || 'LOBBY';
        ws._name = String(msg.name || '익명').slice(0, 12) || '익명';
        let room = rooms.get(code);
        if (!room) {
          room = { host: ws._id, members: new Map(), seed: (msg.seed | 0) || 1 };
          rooms.set(code, room);
        }
        if (room.members.size >= MAX_ROOM) {
          send(ws, { t: 'room_full' });
          return;
        }
        room.members.set(ws._id, ws);
        ws._room = code;
        // Tell the joiner who they are, the room seed (set by the host), and
        // whether they are the host.
        send(ws, {
          t: 'welcome',
          id: ws._id,
          room: code,
          host: room.host,
          isHost: ws._id === room.host,
          seed: room.seed,
          players: roster(room)
        });
        // Notify existing members.
        broadcast(room, { t: 'peer_join', id: ws._id, name: ws._name }, ws._id);
        broadcast(room, { t: 'roster', players: roster(room) }, ws._id);
        break;
      }

      // Everything else is relayed to the rest of the room untouched. The
      // server stays dumb: 'pstate' (player movement), 'world' (host's
      // authoritative snapshot), 'hit' (guest damage report), 'ev' (one-shot
      // events) all flow through here.
      case 'world': {
        // The authoritative world snapshot may ONLY come from the room host —
        // otherwise any guest could broadcast a forged world to the others.
        const room = rooms.get(ws._room);
        if (!room || ws._id !== room.host) return;
        msg.from = ws._id;
        broadcast(room, msg, ws._id);
        break;
      }

      // Player state, hit reports, and one-shot events relay to the rest of the
      // room. `from` is stamped server-side so it can't be spoofed; the client
      // uses it to reject host-only events that don't originate from the host.
      case 'pstate':
      case 'hit':
      case 'ev': {
        const room = rooms.get(ws._room);
        if (!room) return;
        msg.from = ws._id;
        broadcast(room, msg, ws._id);
        break;
      }

      case 'ping':
        send(ws, { t: 'pong', ts: msg.ts });
        break;
    }
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => leaveRoom(ws));
});

// Heartbeat — terminate sockets that stop responding so dead tabs don't linger
// in a room and block its 4-player cap.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws._alive === false) { ws.terminate(); continue; }
    ws._alive = false;
    try { ws.ping(); } catch (e) {}
  }
}, TICK_TIMEOUT_MS);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`[wavesurvival-relay] listening on :${PORT}`);
});
