// Web Audio API based sound effects
const Audio = (() => {
  let ctx = null;
  let masterGain = null;
  let enabled = true;
  // Decoded sample cache (AudioBuffers keyed by name). Loaded lazily once the
  // AudioContext exists; functions below prefer a sample when ready and fall
  // back to the procedural synth so the game still has SFX before files
  // finish downloading / on environments where the load fails.
  const samples = {};

  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.4;
      masterGain.connect(ctx.destination);
      // Kick off sample preloads. Each one resolves independently — a slow or
      // failing load just leaves that slot empty and we keep using the synth.
      loadSample('reload',     'assets/audio/reload.mp3');
      loadSample('pistol',     'assets/audio/pistol.wav');
      loadSample('shotgun',    'assets/audio/shotgun.wav');
      loadSample('machinegun', 'assets/audio/machinegun.wav');
      loadSample('sniper',     'assets/audio/sniper.mp3');
      loadSample('footstep',   'assets/audio/footstep.wav');
    } catch (e) {
      enabled = false;
    }
  }

  function loadSample(name, url) {
    if (!ctx) return;
    fetch(url)
      .then((r) => r.ok ? r.arrayBuffer() : Promise.reject(r.status))
      .then((buf) => new Promise((resolve, reject) => {
        // Support both promise-style and callback-style decodeAudioData
        ctx.decodeAudioData(buf, resolve, reject);
      }))
      .then((decoded) => { samples[name] = decoded; })
      .catch(() => { /* leave slot empty; synth fallback handles it */ });
  }

  // Play a decoded sample. Returns true on success so callers can skip the
  // synth fallback. `volume` is in the same 0..1 range as tone()/noise().
  // `rate` lets footsteps vary slightly so consecutive plays don't sound
  // mechanically identical.
  function playSample(name, volume = 1.0, rate = 1.0) {
    if (!enabled || !ctx || !samples[name]) return false;
    const src = ctx.createBufferSource();
    src.buffer = samples[name];
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(masterGain);
    src.start();
    return true;
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

  // Weapon-specific shoot sounds. Each prefers the uploaded sample and falls
  // back to the original procedural synth if the file slot is empty.
  function shootPistol() {
    if (playSample('pistol', 0.55)) return;
    if (!ctx) return;
    noise(0.08, 0.5, 1800, 1);
    tone(180, 0.05, 'square', 0.2);
  }

  function shootShotgun() {
    if (playSample('shotgun', 0.65)) return;
    if (!ctx) return;
    noise(0.18, 0.6, 1200, 0.8);
    tone(80, 0.12, 'sawtooth', 0.3);
  }

  function shootMachineGun() {
    if (playSample('machinegun', 0.45)) return;
    if (!ctx) return;
    noise(0.05, 0.35, 2400, 1.2);
    tone(220, 0.03, 'square', 0.15);
  }

  function shootSniper() {
    if (playSample('sniper', 0.7)) return;
    if (!ctx) return;
    noise(0.25, 0.7, 800, 0.5);
    tone(60, 0.2, 'sawtooth', 0.4);
  }

  // Single footstep. Pitch is randomized slightly so the loop the player
  // hears while walking doesn't feel mechanical. Triggered from player.js
  // on each stride threshold.
  function footstep() {
    const rate = 0.92 + Math.random() * 0.16;
    if (playSample('footstep', 0.45, rate)) return;
    if (!ctx) return;
    // Fallback: short low thump
    noise(0.05, 0.25, 350, 0.5);
  }

  function hit() {
    if (!ctx) return;
    tone(400, 0.04, 'square', 0.2);
    tone(200, 0.05, 'sawtooth', 0.15);
  }

  // Wet meat impact — short, dampened low thud + body resonance.
  // Default for grunt / rusher / ranger / bomber / splitter / splitterChild.
  function hitFlesh() {
    if (!ctx) return;
    noise(0.05, 0.40, 700, 0.6);
    tone(140, 0.04, 'sine', 0.18);
  }

  // Metallic / armored hit — for tank. Bright clang on top of a brief noise
  // sizzle so it cuts through over the dull flesh hits.
  function hitArmor() {
    if (!ctx) return;
    tone(900, 0.04, 'square', 0.22);
    tone(1500, 0.03, 'triangle', 0.14);
    noise(0.03, 0.18, 3500, 2);
  }

  // Boss hit — deeper and beefier than a flesh hit, with a sub-bass thump
  // so the player feels each round landing on a heavy target.
  function hitBoss() {
    if (!ctx) return;
    noise(0.10, 0.55, 350, 0.5);
    tone(80, 0.08, 'sawtooth', 0.30);
    tone(45, 0.10, 'sine', 0.25);
  }

  // Headshot crack — sharp high-frequency snap with a quick descending
  // skull-pop tail. Fires regardless of enemy type so head shots always
  // sound the most satisfying.
  function headshot() {
    if (!ctx) return;
    noise(0.04, 0.65, 4500, 1.8);
    tone(1800, 0.03, 'square', 0.28);
    setTimeout(() => tone(950, 0.04, 'triangle', 0.18), 18);
  }

  function enemyDeath() {
    if (!ctx) return;
    tone(300, 0.15, 'sawtooth', 0.25, 0.005, 0.1);
    tone(150, 0.2, 'square', 0.2, 0.005, 0.1);
    setTimeout(() => tone(80, 0.15, 'sawtooth', 0.2), 100);
  }

  // Boss death — dramatic descending wail layered over an initial impact
  // and a final low boom. Roughly one second total; fires once per kill.
  function bossDeath() {
    if (!ctx) return;
    noise(0.25, 0.60, 500, 0.4);
    tone(70, 0.30, 'sawtooth', 0.35);
    [380, 310, 240, 180, 130, 90].forEach((f, i) => {
      setTimeout(() => tone(f, 0.22, 'sawtooth', 0.28), i * 75);
    });
    setTimeout(() => {
      noise(0.35, 0.50, 250, 0.35);
      tone(45, 0.30, 'sine', 0.40);
    }, 480);
  }

  // Generic explosion — for bomber detonation and explosive-upgrade splash.
  // Replaces the previous "reuse the shotgun sound" hack which sounded like
  // a far-off gunshot rather than a kaboom.
  function explosion() {
    if (!ctx) return;
    noise(0.22, 0.70, 700, 0.45);
    tone(60, 0.16, 'sawtooth', 0.40);
    tone(120, 0.10, 'square', 0.22);
    setTimeout(() => noise(0.12, 0.40, 400, 0.30), 70);
  }

  function playerHit() {
    if (!ctx) return;
    tone(120, 0.15, 'sawtooth', 0.4);
    noise(0.1, 0.3, 600, 1);
  }

  function reload() {
    if (playSample('reload', 0.7)) return;
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
    hit, hitFlesh, hitArmor, hitBoss, headshot,
    enemyDeath, bossDeath, explosion,
    playerHit, reload, emptyClick, footstep,
    waveStart, waveClear, gameOver, pickup, uiClick
  };
})();
