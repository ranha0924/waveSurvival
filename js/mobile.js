// Touch-screen controls: virtual joystick (move), look-drag, action buttons.
// Active only on touch-capable devices. Calls back into game systems via the
// init({ ... }) callbacks so this module owns no game state.
const Mobile = (() => {
  let active = false;
  const move = { fwd: 0, right: 0, magnitude: 0 };
  let cb = null;

  let containerEl, joyEl, thumbEl;
  const joy = { centerX: 0, centerY: 0, radius: 70, touchId: null };
  const lookTouches = {};

  function detect() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  }

  function init(callbacks) {
    if (!detect()) return false;
    cb = callbacks;
    containerEl = document.getElementById('mobile-controls');
    joyEl = document.getElementById('joystick');
    thumbEl = document.getElementById('joystick-thumb');
    if (!containerEl || !joyEl || !thumbEl) return false;
    active = true;

    bindButton('btn-fire',   () => cb.onShoot(true),  () => cb.onShoot(false));
    bindButton('btn-run',    () => cb.onRun(true),    () => cb.onRun(false));
    bindButton('btn-reload', () => cb.onReload(),     null);
    bindButton('btn-pause',  () => cb.onPause(),      null);

    joyEl.addEventListener('touchstart', joyStart, { passive: false });
    joyEl.addEventListener('touchmove',  joyMove,  { passive: false });
    joyEl.addEventListener('touchend',   joyEnd);
    joyEl.addEventListener('touchcancel', joyEnd);

    const canvas = document.getElementById('game-canvas');
    canvas.addEventListener('touchstart', lookStart, { passive: false });
    canvas.addEventListener('touchmove',  lookMove,  { passive: false });
    canvas.addEventListener('touchend',   lookEnd);
    canvas.addEventListener('touchcancel', lookEnd);

    return true;
  }

  function bindButton(id, downCb, upCb) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('pressed');
      if (downCb) downCb();
    }, { passive: false });
    const release = (e) => {
      if (e) e.stopPropagation();
      el.classList.remove('pressed');
      if (upCb) upCb();
    };
    el.addEventListener('touchend', release);
    el.addEventListener('touchcancel', release);
  }

  function joyStart(e) {
    e.preventDefault();
    e.stopPropagation();
    if (joy.touchId !== null) return;
    const t = e.changedTouches[0];
    joy.touchId = t.identifier;
    const rect = joyEl.getBoundingClientRect();
    joy.centerX = rect.left + rect.width / 2;
    joy.centerY = rect.top + rect.height / 2;
    joy.radius = rect.width / 2;
    updateJoy(t.clientX, t.clientY);
  }

  function joyMove(e) {
    e.preventDefault();
    e.stopPropagation();
    for (const t of e.changedTouches) {
      if (t.identifier === joy.touchId) updateJoy(t.clientX, t.clientY);
    }
  }

  function joyEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.touchId) {
        joy.touchId = null;
        move.fwd = 0; move.right = 0; move.magnitude = 0;
        thumbEl.style.transform = 'translate(0,0)';
      }
    }
  }

  function updateJoy(x, y) {
    let dx = x - joy.centerX;
    let dy = y - joy.centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > joy.radius) {
      dx = (dx / dist) * joy.radius;
      dy = (dy / dist) * joy.radius;
    }
    thumbEl.style.transform = `translate(${dx}px, ${dy}px)`;

    const fwd = -dy / joy.radius;
    const right = dx / joy.radius;
    const mag = Math.sqrt(fwd * fwd + right * right);
    const dead = 0.18;
    if (mag < dead) {
      move.fwd = 0; move.right = 0; move.magnitude = 0;
    } else {
      const adj = Math.min(1, (mag - dead) / (1 - dead));
      move.fwd = (fwd / mag) * adj;
      move.right = (right / mag) * adj;
      move.magnitude = adj;
    }
  }

  function lookStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      lookTouches[t.identifier] = { x: t.clientX, y: t.clientY };
    }
  }
  function lookMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const lt = lookTouches[t.identifier];
      if (!lt) continue;
      const dx = t.clientX - lt.x;
      const dy = t.clientY - lt.y;
      lt.x = t.clientX; lt.y = t.clientY;
      if (cb && cb.onTurn) cb.onTurn(dx, dy);
    }
  }
  function lookEnd(e) {
    for (const t of e.changedTouches) delete lookTouches[t.identifier];
  }

  function showControls() { if (active && containerEl) containerEl.classList.remove('hidden'); }
  function hideControls() {
    if (!active || !containerEl) return;
    containerEl.classList.add('hidden');
    move.fwd = 0; move.right = 0; move.magnitude = 0;
    if (thumbEl) thumbEl.style.transform = 'translate(0,0)';
    joy.touchId = null;
  }

  return { init, isActive: () => active, getMove: () => move, showControls, hideControls };
})();
