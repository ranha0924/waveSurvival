// bossCutscene.js — Cinematic boss entrance overlay (DOM/CSS over Canvas)
// Usage: playBossCutscene({ image, name, subtitle, beginText, onImpact, onEnd })
// Total duration ≈ 5.2s

const BossCutscene = (() => {
  const TALISMAN_TEXTS = ['敕令', '逐鬼', '神將', '急急如律令', '天地神明', '鎭壓百鬼', '太上老君'];

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
      onImpact,
      onEnd
    } = opts;

    // Remove any leftover cutscene
    const old = document.getElementById('boss-cin');
    if (old) old.remove();

    // Root overlay
    const root = el('div');
    root.id = 'boss-cin';
    root.className = 'bc';
    document.getElementById('game-container').appendChild(root);

    // Vignette layer
    el('div', 'bc-vignette', root);

    // Incense smoke (left + right)
    const smokeL = el('div', 'bc-smoke bc-smoke-l', root);
    const smokeR = el('div', 'bc-smoke bc-smoke-r', root);
    for (let i = 0; i < 3; i++) {
      el('div', 'bc-smoke-wisp', smokeL);
      el('div', 'bc-smoke-wisp', smokeR);
    }

    // Letterbox bars
    el('div', 'bc-bar bc-bar-top', root);
    el('div', 'bc-bar bc-bar-bot', root);

    // Boss image container
    const bossWrap = el('div', 'bc-boss-wrap', root);
    const bossImg = el('img', 'bc-boss-img', bossWrap);
    bossImg.src = image;
    bossImg.alt = name;

    // Talisman container
    const talismanLayer = el('div', 'bc-talisman-layer', root);

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
    const hpBar = el('div', 'bc-hp-bar', hpWrap);
    const hpLabel = el('div', 'bc-hp-label', hpWrap);
    hpLabel.textContent = name;

    // Begin text
    const beginEl = el('div', 'bc-begin', root);
    beginEl.textContent = beginText;

    // --- Animation timeline ---
    let disposed = false;

    function dispose() {
      if (disposed) return;
      disposed = true;
      root.classList.add('bc-fadeout');
      setTimeout(() => root.remove(), 600);
    }

    // Phase 1: Static — darken + vignette + smoke + letterbox (0ms)
    requestAnimationFrame(() => {
      root.classList.add('bc-phase1');
    });

    // Spawn talismans at ~800ms
    setTimeout(() => {
      if (disposed) return;
      spawnTalismans(talismanLayer);
    }, 800);

    // Phase 2: Boss reveal (1000ms)
    setTimeout(() => {
      if (disposed) return;
      root.classList.add('bc-phase2');
    }, 1000);

    // Phase 3: Impact (3800ms)
    setTimeout(() => {
      if (disposed) return;
      root.classList.add('bc-phase3');
      flash.classList.add('bc-flash-fire');
      if (onImpact) onImpact();
      // Screen shake
      root.classList.add('bc-shake');
      setTimeout(() => root.classList.remove('bc-shake'), 400);
    }, 3800);

    // Phase 4: Name reveal (4200ms)
    setTimeout(() => {
      if (disposed) return;
      root.classList.add('bc-phase4');
    }, 4200);

    // Phase 5: Begin text + fade out (5000ms)
    setTimeout(() => {
      if (disposed) return;
      root.classList.add('bc-phase5');
    }, 5000);

    // Final cleanup + onEnd (5800ms)
    setTimeout(() => {
      dispose();
      if (onEnd) onEnd();
    }, 5800);

    return { dispose };
  }

  function spawnTalismans(layer) {
    const count = 8;
    for (let i = 0; i < count; i++) {
      const t = el('div', 'bc-talisman', layer);
      // Random starting position around edges
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const dist = 60 + Math.random() * 30; // vw from center
      const startX = Math.cos(angle) * dist;
      const startY = Math.sin(angle) * dist;
      t.style.setProperty('--tx', `${startX}vmin`);
      t.style.setProperty('--ty', `${startY}vmin`);
      t.style.setProperty('--rot', `${Math.random() * 360}deg`);
      t.style.setProperty('--delay', `${i * 0.12}s`);
      // Talisman content — vertical text
      const txt = TALISMAN_TEXTS[i % TALISMAN_TEXTS.length];
      t.textContent = txt;
    }
  }

  return { playBossCutscene };
})();
