// Thin WebSocket transport for co-op. Owns the socket, JSON (de)serialisation,
// a tiny event-handler registry, and latency probing. Knows nothing about game
// rules — multiplayer.js drives it. Kept separate so the same socket plumbing
// could later back a different sync model (delta snapshots, binary frames)
// without touching gameplay code.
const Net = (() => {
  let ws = null;
  let url = '';
  let connected = false;
  const handlers = {};        // type -> [fn]
  let pingTimer = null;
  let latency = 0;            // smoothed round-trip ms

  function on(type, fn) {
    (handlers[type] || (handlers[type] = [])).push(fn);
  }

  function emit(type, msg) {
    const list = handlers[type];
    if (list) for (const fn of list) fn(msg);
  }

  function connect(serverUrl) {
    return new Promise((resolve, reject) => {
      url = serverUrl;
      try {
        ws = new WebSocket(serverUrl);
      } catch (e) {
        reject(e);
        return;
      }
      ws.onopen = () => {
        connected = true;
        startPing();
        emit('open');
        resolve();
      };
      ws.onclose = () => {
        connected = false;
        stopPing();
        emit('close');
      };
      ws.onerror = (e) => {
        emit('error', e);
        if (!connected) reject(e);
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (!msg || typeof msg.t !== 'string') return;
        if (msg.t === 'pong') {
          const rtt = performance.now() - msg.ts;
          latency = latency ? latency * 0.8 + rtt * 0.2 : rtt;
          return;
        }
        emit(msg.t, msg);
      };
    });
  }

  function send(obj) {
    if (ws && connected && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => send({ t: 'ping', ts: performance.now() }), 2000);
  }
  function stopPing() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  }

  function close() {
    stopPing();
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    connected = false;
  }

  return {
    connect, send, on, close,
    isConnected: () => connected,
    getLatency: () => Math.round(latency)
  };
})();
