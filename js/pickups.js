// Drop-pickups: healing items + ammo crates that enemies drop on death.
//
// Each type owns a 32×32 procedurally-baked canvas drawn with fillRect-style
// pixel art (no external assets). The raycaster picks the canvas up by the
// pickup's type id and renders it as a small billboard sitting on the floor,
// bobbing slightly. Player.update calls Pickups.update each frame which
// handles life decay, the bob phase, and proximity-based auto-collection.
//
// Pickup is rejected (item stays on the floor) when the player can't use it
// — e.g., full HP for heal items or maxed reserve for ammo. The item lingers
// until its life timer expires (~45s) or the player comes back for it.
const Pickups = (() => {
  const types = {
    bandage:     { name: '붕대',       effect: 'heal', amount: 30 },
    medkit:      { name: '구급상자',   effect: 'heal', amount: 50 },
    ammo_mg:     { name: '기관총 탄약', effect: 'ammo', weapon: 'machinegun', amount: 30 },
    ammo_sg:     { name: '샷건 탄약',   effect: 'ammo', weapon: 'shotgun',    amount: 12 },
    ammo_sniper: { name: '저격총 탄약', effect: 'ammo', weapon: 'sniper',     amount: 5  }
  };

  const canvases = {};
  let list = [];
  const MAX_ON_FLOOR = 25;
  const DEFAULT_LIFE = 45.0;
  const PICKUP_RADIUS_SQ = 0.36;   // 0.6 world units

  function newCanvas(w, h) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    return cv;
  }

  // Pixel-art rolled bandage with a red cross stamp on the wrap. The
  // bandage is a pill-shaped roll viewed from the side.
  function buildBandage() {
    const cv = newCanvas(32, 32);
    const c = cv.getContext('2d');
    const px = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    // Roll body — vertical gradient bands give a hint of cylindrical shape
    px(4, 11, 24, 10, '#dccfa7');
    px(4, 11, 24,  1, '#fff5d4');   // top highlight
    px(4, 12, 24,  1, '#f0e0b8');
    px(4, 19, 24,  1, '#8a724a');
    px(4, 20, 24,  1, '#6e5634');   // bottom shadow
    px(4, 11,  1, 10, '#a89070');
    px(27,11,  1, 10, '#82684a');
    // Stripe seams along the roll
    for (let i = 0; i < 5; i++) {
      px(7 + i * 4, 13, 1, 6, '#b89868');
      px(7 + i * 4, 13, 1, 1, '#d6b87c');
    }
    // Red cross stamp
    px(15, 13, 2, 6, '#c8201a');
    px(13, 15, 6, 2, '#c8201a');
    px(15, 13, 2, 1, '#ff5050');
    px(13, 15, 1, 2, '#ff5050');
    return cv;
  }

  // Pixel-art first-aid box: cream body, oversized red cross on the front,
  // a top carrying handle and a small latch in the middle.
  function buildMedkit() {
    const cv = newCanvas(32, 32);
    const c = cv.getContext('2d');
    const px = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    // Handle
    px(13, 5, 6, 1, '#9c8666');
    px(12, 6, 8, 2, '#c4a87a');
    px(12, 6, 8, 1, '#dec48e');
    // Box body
    px(4, 8, 24, 19, '#f0e8d0');
    px(4, 8, 24,  1, '#fff8e0');
    px(4, 9, 24,  1, '#e8dec0');
    px(4, 26, 24, 1, '#806c50');
    px(4,  8,  1, 19, '#c6b48c');
    px(27, 8,  1, 19, '#a08c66');
    // Hinge dots top
    px(7,  9, 1, 1, '#604838');
    px(24, 9, 1, 1, '#604838');
    // Latch
    px(14, 18, 4, 3, '#3a2e22');
    px(14, 18, 4, 1, '#6a5a40');
    px(15, 19, 2, 1, '#dec48e');   // latch button highlight
    // Red cross
    px(13, 11, 6, 11, '#cc1818');
    px(10, 14, 12, 5, '#cc1818');
    px(13, 11, 6,  1, '#ff5040');  // cross top highlight
    px(10, 14, 1,  5, '#ff5040');  // cross left highlight
    return cv;
  }

  // Pixel-art MG ammo box: olive-green crate with rifle rounds peeking out
  // along the top edge. A pale stripe across the front holds an MG marking.
  function buildAmmoMG() {
    const cv = newCanvas(32, 32);
    const c = cv.getContext('2d');
    const px = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    // Bullets across the top of the crate
    for (let i = 0; i < 6; i++) {
      const bx = 4 + i * 4;
      // Brass casing
      px(bx,     9, 3, 5, '#c89230');
      px(bx,     9, 1, 5, '#e8b450');
      px(bx + 2, 9, 1, 5, '#8a6418');
      // Copper-jacket tip
      px(bx,     6, 3, 3, '#a87830');
      px(bx,     6, 3, 1, '#d4a050');
      px(bx + 2, 7, 1, 2, '#705018');
      // Tip cone
      px(bx + 1, 5, 1, 1, '#b88840');
    }
    // Crate body
    px(2, 14, 28, 12, '#3a4528');
    px(2, 14, 28,  1, '#5c7038');
    px(2, 25, 28,  1, '#1c2010');
    px(2, 14,  1, 12, '#5c7038');
    px(29,14,  1, 12, '#1c2010');
    // Reinforcement straps
    px(2, 17, 28, 1, '#2a3018');
    px(2, 23, 28, 1, '#2a3018');
    // Label stripe
    px(6, 18, 20, 5, '#8aa260');
    px(6, 18, 20, 1, '#a8c078');
    px(6, 22, 20, 1, '#5a7038');
    // "MG" lettering on the stripe
    px(10, 19, 1, 3, '#1c2010');   // M left
    px(13, 19, 1, 3, '#1c2010');   // M right
    px(11, 19, 1, 1, '#1c2010');
    px(12, 20, 1, 1, '#1c2010');
    px(16, 19, 3, 1, '#1c2010');   // G top
    px(16, 19, 1, 3, '#1c2010');   // G left
    px(16, 21, 3, 1, '#1c2010');   // G bottom
    px(18, 20, 1, 2, '#1c2010');   // G mid
    return cv;
  }

  // Pixel-art shotgun shell pack: a low crate with four red shells standing
  // on their brass bases, mouths crimped at the top.
  function buildAmmoSG() {
    const cv = newCanvas(32, 32);
    const c = cv.getContext('2d');
    const px = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    // Shells
    for (let i = 0; i < 4; i++) {
      const bx = 5 + i * 6;
      // Crimp top
      px(bx + 1, 6, 3, 1, '#902010');
      px(bx,     7, 5, 1, '#a82010');
      // Red shell body
      px(bx, 8, 5, 7, '#c83020');
      px(bx, 8, 1, 7, '#e85040');   // left highlight
      px(bx + 4, 8, 1, 7, '#902010'); // right shadow
      px(bx, 8, 5, 1, '#e85040');
      px(bx, 14, 5, 1, '#902010');
      // Brass base
      px(bx, 15, 5, 4, '#c89230');
      px(bx, 15, 5, 1, '#e8b450');
      px(bx, 18, 5, 1, '#8a6418');
      // Primer dot
      px(bx + 2, 17, 1, 1, '#5a4010');
    }
    // Crate base
    px(3, 19, 26, 7, '#6c4a32');
    px(3, 19, 26, 1, '#9a7050');
    px(3, 25, 26, 1, '#3a2818');
    px(3, 19,  1, 7, '#9a7050');
    px(28,19,  1, 7, '#3a2818');
    // Strap line
    px(3, 22, 26, 1, '#3a2818');
    return cv;
  }

  // Pixel-art sniper cartridge clip: 5 long brass cartridges with darker
  // pointed tips, locked into a steel stripper-clip base.
  function buildAmmoSniper() {
    const cv = newCanvas(32, 32);
    const c = cv.getContext('2d');
    const px = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    // Five cartridges
    for (let i = 0; i < 5; i++) {
      const bx = 7 + i * 4;
      // Pointed tip
      px(bx + 1, 3, 1, 1, '#3a3a3a');
      px(bx,     4, 3, 2, '#454545');
      px(bx,     4, 1, 2, '#5a5a5a');
      // Brass body (long)
      px(bx, 6, 3, 14, '#c89230');
      px(bx, 6, 1, 14, '#e8b450');
      px(bx + 2, 6, 1, 14, '#8a6418');
      // Bottleneck
      px(bx, 7, 3, 1, '#a87826');
      // Rim flange at bottom
      px(bx - 1, 20, 5, 2, '#a87820');
      px(bx - 1, 20, 5, 1, '#d4a050');
      px(bx - 1, 21, 5, 1, '#604c10');
    }
    // Stripper clip base
    px(5, 22, 22, 5, '#3a3a3a');
    px(5, 22, 22, 1, '#5a5a5a');
    px(5, 26, 22, 1, '#1a1a1a');
    px(5, 22,  1, 5, '#5a5a5a');
    px(26,22,  1, 5, '#1a1a1a');
    // Rivet dots on the clip
    px(8,  24, 1, 1, '#909090');
    px(15, 24, 1, 1, '#909090');
    px(22, 24, 1, 1, '#909090');
    return cv;
  }

  function init() {
    canvases.bandage     = buildBandage();
    canvases.medkit      = buildMedkit();
    canvases.ammo_mg     = buildAmmoMG();
    canvases.ammo_sg     = buildAmmoSG();
    canvases.ammo_sniper = buildAmmoSniper();
  }

  function clear() { list = []; }

  function spawn(typeId, x, y) {
    if (!types[typeId]) return;
    list.push({
      x, y,
      typeId,
      life: DEFAULT_LIFE,
      bobPhase: Math.random() * Math.PI * 2
    });
    while (list.length > MAX_ON_FLOOR) list.shift();
  }

  // Drop tables. Ranger biases toward sniper ammo, tank toward medkits +
  // heavier ammo, boss is handled by onEnemyKilled directly with a guaranteed
  // multi-drop burst.
  function rollDrop(enemyTypeId) {
    const r = Math.random();
    if (enemyTypeId === 'tank') {
      if (r < 0.25) return 'medkit';
      if (r < 0.40) return 'ammo_mg';
      if (r < 0.52) return 'ammo_sg';
      if (r < 0.60) return 'ammo_sniper';
      return null;
    }
    if (enemyTypeId === 'ranger') {
      if (r < 0.10) return 'bandage';
      if (r < 0.18) return 'ammo_sniper';
      if (r < 0.24) return 'ammo_mg';
      if (r < 0.28) return 'ammo_sg';
      return null;
    }
    // grunt / rusher / bomber / splitter / splitterChild
    if (r < 0.12) return 'bandage';
    if (r < 0.17) return 'ammo_mg';
    if (r < 0.20) return 'ammo_sg';
    if (r < 0.22) return 'ammo_sniper';
    return null;
  }

  function onEnemyKilled(e) {
    if (!e || !e.type) return;
    if (e.type.isBoss) {
      // Boss drops a guaranteed burst around the body.
      spawn('medkit',      e.x + 0.30, e.y + 0.05);
      spawn('ammo_mg',     e.x - 0.30, e.y + 0.05);
      spawn('ammo_sg',     e.x + 0.05, e.y + 0.30);
      spawn('ammo_sniper', e.x + 0.05, e.y - 0.30);
      return;
    }
    const t = rollDrop(e.type.id);
    if (t) spawn(t, e.x, e.y);
  }

  // Try to apply the pickup's effect to the player. Returns true on success
  // (item should be consumed). When the player can't benefit (full HP / full
  // ammo / weapon not unlocked), returns false so the item stays on the floor.
  function tryApply(pickup, player, particles) {
    const def = types[pickup.typeId];
    if (!def) return false;

    if (def.effect === 'heal') {
      if (player.hp >= player.maxHp) return false;
      const before = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + def.amount);
      flashPickupText(particles, pickup.x, pickup.y, `+${Math.round(player.hp - before)} HP`, [110, 230, 110]);
      Audio.pickup();
      return true;
    }
    if (def.effect === 'ammo') {
      const w = player.loadout && player.loadout[def.weapon];
      if (!w || w.ammoInfinite) return false;
      const cap = w.magSize * 5;
      if (w.reserveAmmo >= cap) return false;
      const before = w.reserveAmmo;
      w.reserveAmmo = Math.min(cap, w.reserveAmmo + def.amount);
      flashPickupText(particles, pickup.x, pickup.y, `+${w.reserveAmmo - before} ${def.weapon === 'machinegun' ? 'MG' : def.weapon === 'shotgun' ? 'SG' : 'SR'}`, [230, 200, 90]);
      Audio.pickup();
      return true;
    }
    return false;
  }

  // Re-use the damage-number particle path: a noGravity text particle that
  // floats up briefly so the player sees what they just absorbed.
  function flashPickupText(particles, x, y, text, color) {
    if (!particles) return;
    particles.push({
      x, y,
      vx: 0, vy: 0,
      zOffset: 0.6,
      vz: 1.4,
      noGravity: true,
      text,
      color,
      size: 1,
      life: 1.0
    });
  }

  function update(dt, player, particles) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      p.bobPhase += dt * 3.0;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      if (!player) continue;
      const dx = p.x - player.x, dy = p.y - player.y;
      if (dx * dx + dy * dy < PICKUP_RADIUS_SQ) {
        if (tryApply(p, player, particles)) list.splice(i, 1);
      }
    }
  }

  function getList() { return list; }
  function getCanvas(typeId) { return canvases[typeId]; }

  return { init, clear, spawn, onEnemyKilled, update, getList, getCanvas, types };
})();
