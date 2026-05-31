// Online leaderboard backed by Cloud Firestore — shares records across every
// device/player. The Firebase *modular* SDK is loaded lazily from the CDN the
// first time the board is touched, so the rest of the game (plain global
// <script> modules, no build step) keeps working unchanged.
//
// Everything degrades gracefully: if the config below is still the
// placeholder, or the network / Firebase is unreachable, the online board
// just reports "offline" and the localStorage records keep serving as the
// per-device personal best.
//
// Data model (chosen so NO composite indexes are ever required):
//   leaderboard/{auto}              → { name, wave, score, kills, combo, day, ts }
//   daily/{YYYY-MM-DD}/runs/{auto}  → { name, wave, score, kills, combo, ts }
// Both are queried with a single `orderBy('score','desc')`, which Firestore
// indexes automatically.
const Leaderboard = (() => {
  // ====================================================================
  // ▼▼▼  PASTE YOUR FIREBASE CONFIG HERE  ▼▼▼
  // Firebase Console → 프로젝트 설정(⚙️) → 일반 → 내 앱 → "SDK 설정 및 구성" → 구성
  // apiKey 는 클라이언트에 공개돼도 되는 식별자입니다 (보안은 Firestore 규칙으로 처리).
  // ====================================================================
  const firebaseConfig = {
    apiKey:            "PASTE_API_KEY",
    authDomain:        "PASTE_PROJECT.firebaseapp.com",
    projectId:         "PASTE_PROJECT_ID",
    storageBucket:     "PASTE_PROJECT.appspot.com",
    messagingSenderId: "PASTE_SENDER_ID",
    appId:             "PASTE_APP_ID"
  };
  // ====================================================================

  const SDK = 'https://www.gstatic.com/firebasejs/10.12.5';
  const ALLTIME = 'leaderboard';
  const TOP_N = 10;

  let fs = null;            // firestore module namespace (set after lazy import)
  let db = null;
  let initPromise = null;

  function configured() {
    return !!firebaseConfig.apiKey && firebaseConfig.apiKey.indexOf('PASTE') !== 0;
  }

  // Lazy one-time init. Returns true once Firestore is ready, false if the
  // board is disabled (no config) or initialisation failed.
  function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (!configured()) {
        console.info('[Leaderboard] Firebase 미설정 — 온라인 랭킹 비활성화 (로컬 기록만 사용).');
        return false;
      }
      try {
        const appMod = await import(`${SDK}/firebase-app.js`);
        fs = await import(`${SDK}/firebase-firestore.js`);
        const app = appMod.initializeApp(firebaseConfig);
        db = fs.getFirestore(app);
        return true;
      } catch (e) {
        console.warn('[Leaderboard] 초기화 실패 — 온라인 랭킹 비활성화', e);
        db = null;
        return false;
      }
    })();
    return initPromise;
  }

  function today() {
    return (typeof Random !== 'undefined' && Random.todayString)
      ? Random.todayString()
      : new Date().toISOString().slice(0, 10);
  }

  // Coerce a run into the stored shape, clamping to sane bounds so a corrupt
  // in-memory stat can't poison the shared board.
  function clean(stats, nick) {
    const num = (v) => (typeof v === 'number' && isFinite(v)) ? Math.max(0, Math.floor(v)) : 0;
    return {
      name: (String(nick || '익명').trim().slice(0, 12)) || '익명',
      wave: num(stats.wave),
      score: num(stats.score),
      kills: num(stats.kills),
      combo: num(stats.combo)
    };
  }

  // Write the finished run to both the all-time board and today's board.
  // Fire-and-forget from the caller's perspective; resolves true on success.
  async function submitRun(stats, nick) {
    const ok = await init();
    if (!ok || !db) return false;
    try {
      const day = today();
      const row = clean(stats, nick);
      if (row.score <= 0 && row.wave <= 0) return false;   // skip empty runs
      const base = { ...row, ts: fs.serverTimestamp() };
      await Promise.all([
        fs.addDoc(fs.collection(db, ALLTIME), { ...base, day }),
        fs.addDoc(fs.collection(db, 'daily', day, 'runs'), base)
      ]);
      return true;
    } catch (e) {
      console.warn('[Leaderboard] 기록 전송 실패', e);
      return false;
    }
  }

  async function queryTop(collRef) {
    const q = fs.query(collRef, fs.orderBy('score', 'desc'), fs.limit(TOP_N));
    const snap = await fs.getDocs(q);
    const rows = [];
    snap.forEach((d) => rows.push(d.data()));
    return rows;
  }

  // Returns an array of rows, [] when empty, or null when the board is
  // disabled/unreachable so the UI can show an "offline" state.
  async function topAllTime() {
    const ok = await init();
    if (!ok || !db) return null;
    try { return await queryTop(fs.collection(db, ALLTIME)); }
    catch (e) { console.warn('[Leaderboard] 전체 랭킹 조회 실패', e); return null; }
  }

  async function topDaily() {
    const ok = await init();
    if (!ok || !db) return null;
    try { return await queryTop(fs.collection(db, 'daily', today(), 'runs')); }
    catch (e) { console.warn('[Leaderboard] 오늘 랭킹 조회 실패', e); return null; }
  }

  return { init, configured, submitRun, topAllTime, topDaily, today };
})();
