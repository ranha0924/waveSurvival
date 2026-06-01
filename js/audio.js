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
      loadSample('machinegun', 'assets/audio/machinegun.mp3');
      loadSample('sniper',     'assets/audio/sniper.mp3');
      loadSample('footstep',   'assets/audio/footstep.wav');
      loadSample('hitFlesh',   'assets/audio/hit_flesh.ogg');
      // 굿판 mode trigger — reserved slot. Procedural gong fires until a
      // real sample lands at this path.
      loadSample('gutpan',     'assets/audio/gutpan.ogg');
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
  function playSample(name, volume = 1.0, rate = 1.0, lowpassHz = 0) {
    if (!enabled || !ctx || !samples[name]) return false;
    const src = ctx.createBufferSource();
    src.buffer = samples[name];
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    let node = src;
    if (lowpassHz > 0) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lowpassHz;
      filter.Q.value = 0.7;
      node.connect(filter);
      node = filter;
    }
    node.connect(gain);
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
  // Prefer the uploaded hit-impact sample (pitched down for weight) layered
  // with a sub-bass thump so the impact lands hard. Synth path is the
  // fallback while the sample is still loading.
  function hitFlesh() {
    if (!ctx) return;
    // Slight pitch jitter so back-to-back hits don't sound identical.
    const rate = 0.72 + Math.random() * 0.10;
    if (playSample('hitFlesh', 1.2, rate, 1600)) return;
    noise(0.05, 0.40, 700, 0.6);
    tone(140, 0.04, 'sine', 0.18);
  }

  // Tank hit — same hit-impact sample as flesh but kept a touch brighter
  // and less filtered so it still reads as a harder surface than the grunts.
  function hitArmor() {
    if (!ctx) return;
    const rate = 0.95 + Math.random() * 0.12;
    if (playSample('hitFlesh', 1.2, rate, 3500)) return;
    tone(900, 0.04, 'square', 0.22);
    tone(1500, 0.03, 'triangle', 0.14);
    noise(0.03, 0.18, 3500, 2);
  }

  // Boss hit — pitched-down sample with a tight low-pass so each round on
  // the boss feels beefier and heavier than a regular zombie hit.
  function hitBoss() {
    if (!ctx) return;
    const rate = 0.48 + Math.random() * 0.10;
    if (playSample('hitFlesh', 1.3, rate, 900)) return;
    noise(0.10, 0.55, 350, 0.5);
    tone(80, 0.08, 'sawtooth', 0.30);
    tone(45, 0.10, 'sine', 0.25);
  }

  // Headshot used to layer a synth "crack" on top of the hit sound; the
  // synth read as a mechanical sound on top of the wet impact sample, so
  // headshots now just play the regular hit sample (see player.damageEnemy).
  // Kept removed rather than no-op so callers fail loudly if it's re-added.

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

  // Boss phase-2 transition stinger. Long low rumble + rising-pitch tones
  // so it reads as "the thing got angrier" rather than a normal hit.
  function bossEnrage() {
    if (!ctx) return;
    noise(0.55, 0.65, 240, 0.3);
    tone(80, 0.45, 'sawtooth', 0.32);
    tone(50, 0.50, 'sine', 0.28);
    [110, 145, 185, 230, 285].forEach((f, i) => {
      setTimeout(() => tone(f, 0.16, 'sawtooth', 0.28), 220 + i * 55);
    });
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

  // Reload sound. The uploaded clip is ~2.4s, longer than every weapon's
  // reload time, so it used to keep playing after the reload finished (you
  // could fire mid-sound). Scale playback rate so the clip lasts exactly the
  // weapon's reload time — the sound now ends right as the reload completes.
  function reload(targetDuration) {
    const buf = samples['reload'];
    let rate = 1;
    if (buf && targetDuration && targetDuration > 0) {
      rate = Math.max(0.5, Math.min(3, buf.duration / targetDuration));
    }
    if (playSample('reload', 0.7, rate)) return;
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

  // 굿판 mode trigger SFX — single procedural sting meant to feel like a
  // 꽹과리 (small Korean brass gong) struck once on activation. Made of a
  // bright metallic transient (high square + sawtooth) over a quick
  // band-passed noise burst. Replaced by a real sample if assets land
  // later — call sites use `Audio.gutpanTrigger && Audio.gutpanTrigger()`
  // so a missing export is harmless.
  function gutpanTrigger() {
    if (playSample('gutpan', 0.7)) return;
    if (!ctx) return;
    // Metallic body
    tone(880, 0.18, 'square', 0.22, 0.001, 0.20);
    tone(1320, 0.22, 'sawtooth', 0.18, 0.001, 0.25);
    tone(1760, 0.12, 'triangle', 0.14, 0.001, 0.15);
    // Strike transient
    noise(0.08, 0.35, 3200, 1.5);
    // Tail — softer thud so the sting has weight under the bright top.
    setTimeout(() => tone(220, 0.18, 'sawtooth', 0.18, 0.002, 0.20), 30);
  }

  // ---------- 사물놀이 굿판 모드 루프 (procedural) ----------
  // 사물놀이 is four percussion voices; its identity is the 장단 (rhythmic
  // cycle), not melodic timbre — which is exactly why it synthesises cleanly
  // here where AI music models (trained on Western/melodic material) keep
  // mangling the inharmonic Korean gongs. A look-ahead scheduler places hits
  // on a fast 자진모리-style 12-step cycle and loops while 굿판 mode is
  // active. Routed through its own bus so the groove sits under the SFX.
  let samulGain = null;
  let samulActive = false;
  let samulTimer = null;
  let samulNextTime = 0;
  let samulStep = 0;
  const SAMUL_STEPS = 12;
  const SAMUL_STEP_DUR = 0.135;     // seconds per step → ~1.6s driving cycle

  function ensureSamulBus() {
    if (samulGain || !ctx) return;
    samulGain = ctx.createGain();
    samulGain.gain.value = 0.5;
    samulGain.connect(masterGain);
  }

  // Scheduled (time-stamped) tone with a pitch glide + exponential decay.
  function pTone(when, f0, f1, dur, type, vol, attack = 0.002, filterHz = 0) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, when);
    if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), when + dur);
    let node = osc;
    if (filterHz > 0) {
      const fl = ctx.createBiquadFilter();
      fl.type = 'lowpass'; fl.frequency.value = filterHz;
      node.connect(fl); node = fl;
    }
    node.connect(g); g.connect(samulGain);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vol, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    osc.start(when);
    osc.stop(when + dur + 0.03);
  }

  function pNoise(when, dur, vol, filterHz, q = 1, type = 'lowpass') {
    const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const fl = ctx.createBiquadFilter();
    fl.type = type; fl.frequency.value = filterHz; fl.Q.value = q;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(fl); fl.connect(g); g.connect(samulGain);
    src.start(when);
  }

  // 꽹과리 — small brass gong: bright, piercing, leads the rhythm. Built from
  // detuned inharmonic high partials + a short metallic noise transient.
  function sKkwaenggwari(when, vol) {
    const parts = [1664, 2393, 3261, 4129];
    parts.forEach((f, i) => {
      const det = 1 + (Math.random() * 0.012 - 0.006);
      pTone(when, f * det, f * 0.97, 0.13 - i * 0.018, i < 2 ? 'square' : 'triangle', vol * (0.55 - i * 0.10));
    });
    pNoise(when, 0.05, vol * 0.5, 4200, 2, 'bandpass');
  }
  // 징 — large gong: deep boom + long shimmer that marks each cycle.
  function sJing(when, vol) {
    const parts = [182, 287, 437, 615, 822];
    parts.forEach((f, i) => pTone(when, f, f * 0.995, 1.25 - i * 0.12, 'sine', vol * (0.42 - i * 0.06), 0.025));
    pNoise(when, 0.7, vol * 0.13, 1300, 3, 'bandpass');
  }
  // 장구 북편 — low palm strike "쿵".
  function sJangguLow(when, vol) {
    pTone(when, 168, 92, 0.17, 'sine', vol, 0.001);
    pNoise(when, 0.06, vol * 0.35, 600, 1);
  }
  // 장구 채편 — high stick strike "따/덕".
  function sJangguHigh(when, vol) {
    pNoise(when, 0.06, vol * 0.8, 2600, 1.2);
    pTone(when, 430, 250, 0.07, 'triangle', vol * 0.4, 0.001);
  }
  // 북 — barrel drum, deep "둥".
  function sBuk(when, vol) {
    pTone(when, 120, 66, 0.22, 'sine', vol, 0.001);
    pNoise(when, 0.09, vol * 0.45, 480, 1);
  }

  // Velocity tables per 12-step cycle (0 = silent). 꽹과리 drives the groove,
  // 징 marks the cycle, 장구/북 lay the 쿵-따 foundation.
  const PAT_KKW   = [1.0, 0,   0.5, 0.8, 0,   0.5, 1.0, 0,   0.5, 0.8, 0,   0.6];
  const PAT_JING  = [1.0, 0,   0,   0,   0,   0,   0.45,0,   0,   0,   0,   0  ];
  const PAT_JLOW  = [0.9, 0,   0,   0.85,0,   0,   0.9, 0,   0,   0.85,0,   0  ];
  const PAT_JHIGH = [0,   0.4, 0.7, 0,   0,   0.7, 0,   0.4, 0.7, 0,   0,   0.7];
  const PAT_BUK   = [0.9, 0,   0,   0.6, 0,   0,   0.9, 0,   0,   0.6, 0,   0  ];

  function samulScheduleStep(step, when) {
    if (PAT_KKW[step])   sKkwaenggwari(when, 0.16 * PAT_KKW[step]);
    if (PAT_JING[step])  sJing(when, 0.26 * PAT_JING[step]);
    if (PAT_JLOW[step])  sJangguLow(when, 0.26 * PAT_JLOW[step]);
    if (PAT_JHIGH[step]) sJangguHigh(when, 0.20 * PAT_JHIGH[step]);
    if (PAT_BUK[step])   sBuk(when, 0.30 * PAT_BUK[step]);
  }

  function samulScheduler() {
    if (!ctx || !samulActive) return;
    while (samulNextTime < ctx.currentTime + 0.12) {
      samulScheduleStep(samulStep, samulNextTime);
      samulNextTime += SAMUL_STEP_DUR;
      samulStep = (samulStep + 1) % SAMUL_STEPS;
    }
  }

  // Start/stop the 사물놀이 groove. Both are idempotent so callers can safely
  // call start every active frame and stop every inactive frame.
  function gutpanLoopStart() {
    if (!enabled || !ctx || samulActive) return;
    ensureSamulBus();
    samulActive = true;
    samulStep = 0;
    samulNextTime = ctx.currentTime + 0.06;
    samulTimer = setInterval(samulScheduler, 25);
    samulScheduler();
  }

  function gutpanLoopStop() {
    if (!samulActive) return;
    samulActive = false;
    if (samulTimer) { clearInterval(samulTimer); samulTimer = null; }
  }

  return {
    init, resume,
    shootPistol, shootShotgun, shootMachineGun, shootSniper,
    hit, hitFlesh, hitArmor, hitBoss,
    enemyDeath, bossDeath, bossEnrage, explosion,
    playerHit, reload, emptyClick, footstep,
    waveStart, waveClear, gameOver, pickup, uiClick,
    gutpanTrigger, gutpanLoopStart, gutpanLoopStop
  };
})();
