// bossCutscene.js — Cinematic boss entrance overlay (DOM/CSS over Canvas)
// Usage: playBossCutscene({ image, name, subtitle, beginText, parts, onImpact, onEnd })

const BossCutscene = (() => {
  const TALISMAN_TEXTS = ['敕令', '逐鬼', '神將', '急急如律令', '天地神明', '鎭壓百鬼', '太上老君'];

  const DEFAULT_PARTS = [
    { x: 50, y: 88, scale: 2.4 },  // feet
    { x: 70, y: 55, scale: 2.0 },  // tail / hand
    { x: 42, y: 18, scale: 2.5 },  // eyes
  ];

  function el(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  function playBossCutscene(opts = {}) {
    const {
      image = 'assets/gumiho.webp',
      name = '구미호',
      subtitle = '천년묵은 요호',
      beginText = '굿이 시작된다',
      parts = DEFAULT_PARTS,
      onImpact,
      onEnd
    } = opts;

    const old = document.getElementById('boss-cin');
    if (old) old.remove();

    const root = el('div');
    root.id = 'boss-cin';
    root.className = 'bc';
    document.getElementById('game-container').appendChild(root);

    // Vignette
    el('div', 'bc-vignette', root);

    // Incense smoke
    const smokeL = el('div', 'bc-smoke bc-smoke-l', root);
    const smokeR = el('div', 'bc-smoke bc-smoke-r', root);
    for (let i = 0; i < 3; i++) {
      el('div', 'bc-smoke-wisp', smokeL);
      el('div', 'bc-smoke-wisp', smokeR);
    }

    // Letterbox bars
    el('div', 'bc-bar bc-bar-top', root);
    el('div', 'bc-bar bc-bar-bot', root);

    // Closeup viewport — shows cropped regions of the boss image
    const cuViewport = el('div', 'bc-cu-viewport', root);
    const cuImg = el('div', 'bc-cu-img', cuViewport);
    cuImg.style.backgroundImage = `url('${image}')`;

    // Talisman flash between cuts
    const cuTalisman = el('div', 'bc-cu-talisman', root);

    // Full body reveal container (hidden until impact)
    const bossWrap = el('div', 'bc-boss-wrap', root);
    const bossImg = el('img', 'bc-boss-img', bossWrap);
    bossImg.src = image;
    bossImg.alt = name;

    // Flash overlay
    const flash = el('div', 'bc-flash', root);

    // Name plate
    const namePlate = el('div', 'bc-nameplate', root);
    const nameEl = el('div', 'bc-name', namePlate);
    nameEl.textContent = name;
    const subEl = el('div', 'bc-subtitle', namePlate);
    subEl.textContent = subtitle;

    // HP bar
    const hpWrap = el('div', 'bc-hp-wrap', namePlate);
    el('div', 'bc-hp-bar', hpWrap);
    const hpLabel = el('div', 'bc-hp-label', hpWrap);
    hpLabel.textContent = name;

    // Begin text
    const beginEl = el('div', 'bc-begin', root);
    beginEl.textContent = beginText;

    let disposed = false;
    const timers = [];
    function at(ms, fn) { timers.push(setTimeout(() => { if (!disposed) fn(); }, ms)); }

    function dispose() {
      if (disposed) return;
      disposed = true;
      timers.forEach(clearTimeout);
      root.classList.add('bc-fadeout');
      setTimeout(() => root.remove(), 600);
    }

    // ── Phase 1: Static (0ms) — darken + vignette + smoke + letterbox ──
    requestAnimationFrame(() => root.classList.add('bc-phase1'));

    // ── Phase 2: Closeup cuts (800ms–) ──
    const cutDuration = 600;
    const gapDuration = 150;
    const cuStart = 800;

    parts.forEach((part, i) => {
      const cutStart = cuStart + i * (cutDuration + gapDuration);

      // Black gap / talisman flash between cuts
      if (i > 0) {
        at(cutStart - gapDuration, () => {
          cuViewport.classList.add('bc-cu-black');
          const txt = TALISMAN_TEXTS[i % TALISMAN_TEXTS.length];
          cuTalisman.textContent = txt;
          cuTalisman.classList.remove('bc-cu-talisman-show');
          void cuTalisman.offsetWidth;
          cuTalisman.classList.add('bc-cu-talisman-show');
        });
      }

      at(cutStart, () => {
        cuViewport.classList.remove('bc-cu-black');
        cuImg.style.backgroundPosition = `${part.x}% ${part.y}%`;
        cuImg.style.backgroundSize = `${part.scale * 100}%`;
        // Subtle drift animation
        cuImg.classList.remove('bc-cu-drift');
        void cuImg.offsetWidth;
        cuImg.classList.add('bc-cu-drift');
      });
    });

    const closeupEnd = cuStart + parts.length * (cutDuration + gapDuration);

    // Final black gap before impact
    at(closeupEnd - gapDuration, () => {
      cuViewport.classList.add('bc-cu-black');
    });

    // ── Phase 3: Impact — flash + shake + full body reveal ──
    at(closeupEnd + 100, () => {
      cuViewport.style.display = 'none';
      cuTalisman.style.display = 'none';
      root.classList.add('bc-phase3');
      flash.classList.add('bc-flash-fire');
      root.classList.add('bc-shake');
      setTimeout(() => root.classList.remove('bc-shake'), 400);
      if (onImpact) onImpact();
    });

    // ── Phase 4: Name reveal ──
    at(closeupEnd + 500, () => {
      root.classList.add('bc-phase4');
    });

    // ── Phase 5: Begin text ──
    at(closeupEnd + 1400, () => {
      root.classList.add('bc-phase5');
    });

    // ── Cleanup ──
    at(closeupEnd + 2200, () => {
      dispose();
      if (onEnd) onEnd();
    });

    return { dispose };
  }

  return { playBossCutscene };
})();
