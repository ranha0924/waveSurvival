// bossCutscene.js — Cinematic boss entrance overlay (DOM/CSS over Canvas)
// Usage: playBossCutscene({ image, name, subtitle, beginText, parts, onImpact, onEnd })
//
// Direction references real AAA boss intros:
//  · Sekiro    — calligraphy brush-wipe reveal of the boss name
//  · Elden Ring — rising embers + ornate, end-capped boss HP bar
//  · Persona 5 / anime — radial speed-line burst on the impact frame
//  · Hollow Knight — flourish lines extending from the title + epithet
//  · Dark Souls — silhouette that ignites into a full-colour reveal

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

    // Vignette + ink-wash backdrop
    el('div', 'bc-vignette', root);
    el('div', 'bc-ink', root);

    // Rising embers (Elden Ring) — sparks drifting up through the dark
    const embers = el('div', 'bc-embers', root);
    for (let i = 0; i < 14; i++) {
      const e = el('div', 'bc-ember', embers);
      e.style.left = (Math.random() * 100) + '%';
      e.style.setProperty('--d', (3 + Math.random() * 3).toFixed(2) + 's');
      e.style.setProperty('--dl', (-Math.random() * 4).toFixed(2) + 's');
      e.style.setProperty('--sx', (Math.random() * 40 - 20).toFixed(0) + 'px');
      e.style.setProperty('--sz', (0.5 + Math.random() * 1.2).toFixed(2));
    }

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
    el('div', 'bc-cu-scan', cuViewport); // scanline/film grain over the cut

    // Talisman flash between cuts
    const cuTalisman = el('div', 'bc-cu-talisman', root);

    // Radial speed lines (anime / Persona impact burst)
    el('div', 'bc-speedlines', root);

    // Full body reveal container (hidden until impact)
    const bossWrap = el('div', 'bc-boss-wrap', root);
    const bossGlow = el('div', 'bc-boss-glow', bossWrap);
    const bossImg = el('img', 'bc-boss-img', bossWrap);
    bossImg.src = image;
    bossImg.alt = name;

    // Red ink brush stroke that swipes across at the reveal
    el('div', 'bc-brush', root);

    // Flash overlay
    const flash = el('div', 'bc-flash', root);

    // Name plate (Sekiro-style brush reveal + Hollow Knight flourishes)
    const namePlate = el('div', 'bc-nameplate', root);
    const flourish = el('div', 'bc-flourish', namePlate);
    el('span', 'bc-flourish-line bc-flourish-l', flourish);
    el('span', 'bc-flourish-dot', flourish);
    el('span', 'bc-flourish-line bc-flourish-r', flourish);

    const nameRow = el('div', 'bc-name-row', namePlate);
    const nameEl = el('div', 'bc-name', nameRow);
    nameEl.textContent = name;
    const subEl = el('div', 'bc-subtitle', namePlate);
    subEl.textContent = subtitle;

    // HP bar with ornate end-caps (Elden Ring)
    const hpWrap = el('div', 'bc-hp-wrap', namePlate);
    el('div', 'bc-hp-cap bc-hp-cap-l', hpWrap);
    el('div', 'bc-hp-cap bc-hp-cap-r', hpWrap);
    const hpTrack = el('div', 'bc-hp-track', hpWrap);
    el('div', 'bc-hp-bar', hpTrack);
    const hpLabel = el('div', 'bc-hp-label', hpTrack);
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

    // ── Phase 1: Static (0ms) — darken + vignette + embers + smoke + letterbox ──
    requestAnimationFrame(() => root.classList.add('bc-phase1'));

    // ── Phase 2: Closeup cuts ── (tension build, anime-style hard cuts)
    const cutDuration = 520;
    const gapDuration = 130;
    const cuStart = 600;

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

    // ── Phase 3: Impact — flash + shake + speed lines + silhouette punch-in ──
    at(closeupEnd + 100, () => {
      cuViewport.style.display = 'none';
      cuTalisman.style.display = 'none';
      root.classList.add('bc-phase3');     // silhouette + speed lines + brush
      flash.classList.add('bc-flash-fire');
      root.classList.add('bc-shake');
      setTimeout(() => root.classList.remove('bc-shake'), 420);
      if (onImpact) onImpact();
    });

    // ── Phase 3b: Ignite — silhouette burns into full colour ──
    at(closeupEnd + 520, () => {
      root.classList.add('bc-lit');
    });

    // ── Phase 4: Name reveal — brush-wipe + flourishes + HP fill ──
    at(closeupEnd + 720, () => {
      root.classList.add('bc-phase4');
    });

    // ── Phase 5: Begin text stinger ──
    at(closeupEnd + 1700, () => {
      root.classList.add('bc-phase5');
    });

    // ── Cleanup ──
    at(closeupEnd + 2500, () => {
      dispose();
      if (onEnd) onEnd();
    });

    return { dispose };
  }

  return { playBossCutscene };
})();
