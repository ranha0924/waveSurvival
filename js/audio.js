// Web Audio API based sound effects
const Audio = (() => {
  let ctx = null;
  let masterGain = null;
  let enabled = true;

  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.4;
      masterGain.connect(ctx.destination);
    } catch (e) {
      enabled = false;
    }
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function tone(freq, duration, type = 'sine', volume = 0.3, attack = 0.005, release = 0.05) {
    if (!enabled || !ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(masterGain);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + attack);
    gain.gain.linearRampToValueAtTime(0, now + duration + release);
    osc.start(now);
    osc.stop(now + duration + release + 0.02);
  }

  function noise(duration, volume = 0.3, filterFreq = 2000, filterQ = 1) {
    if (!enabled || !ctx) return;
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = filterQ;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    src.start();
  }

  // Weapon-specific shoot sounds
  function shootPistol() {
    if (!ctx) return;
    noise(0.08, 0.5, 1800, 1);
    tone(180, 0.05, 'square', 0.2);
  }

  function shootShotgun() {
    if (!ctx) return;
    noise(0.18, 0.6, 1200, 0.8);
    tone(80, 0.12, 'sawtooth', 0.3);
  }

  function shootMachineGun() {
    if (!ctx) return;
    noise(0.05, 0.35, 2400, 1.2);
    tone(220, 0.03, 'square', 0.15);
  }

  function shootSniper() {
    if (!ctx) return;
    noise(0.25, 0.7, 800, 0.5);
    tone(60, 0.2, 'sawtooth', 0.4);
  }

  function hit() {
    if (!ctx) return;
    tone(400, 0.04, 'square', 0.2);
    tone(200, 0.05, 'sawtooth', 0.15);
  }

  function enemyDeath() {
    if (!ctx) return;
    tone(300, 0.15, 'sawtooth', 0.25, 0.005, 0.1);
    tone(150, 0.2, 'square', 0.2, 0.005, 0.1);
    setTimeout(() => tone(80, 0.15, 'sawtooth', 0.2), 100);
  }

  function playerHit() {
    if (!ctx) return;
    tone(120, 0.15, 'sawtooth', 0.4);
    noise(0.1, 0.3, 600, 1);
  }

  function reload() {
    if (!ctx) return;
    tone(800, 0.04, 'square', 0.15);
    setTimeout(() => tone(600, 0.06, 'square', 0.15), 80);
    setTimeout(() => tone(1000, 0.05, 'square', 0.15), 200);
  }

  function emptyClick() {
    if (!ctx) return;
    tone(2000, 0.02, 'square', 0.1);
  }

  function waveStart() {
    if (!ctx) return;
    tone(440, 0.12, 'square', 0.25);
    setTimeout(() => tone(660, 0.18, 'square', 0.25), 140);
  }

  function waveClear() {
    if (!ctx) return;
    [523, 659, 784, 1047].forEach((f, i) => {
      setTimeout(() => tone(f, 0.18, 'triangle', 0.3), i * 100);
    });
  }

  function gameOver() {
    if (!ctx) return;
    [400, 350, 300, 250, 200].forEach((f, i) => {
      setTimeout(() => tone(f, 0.3, 'sawtooth', 0.3), i * 200);
    });
  }

  function pickup() {
    if (!ctx) return;
    tone(880, 0.08, 'triangle', 0.3);
    setTimeout(() => tone(1320, 0.1, 'triangle', 0.3), 50);
  }

  function uiClick() {
    if (!ctx) return;
    tone(660, 0.05, 'square', 0.15);
  }

  return {
    init, resume,
    shootPistol, shootShotgun, shootMachineGun, shootSniper,
    hit, enemyDeath, playerHit, reload, emptyClick,
    waveStart, waveClear, gameOver, pickup, uiClick
  };
})();
