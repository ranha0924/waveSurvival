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
    bandage:     { name: '산삼(山蔘)',  effect: 'heal', amount: 30 },
    medkit:      { name: '한약 한 첩',  effect: 'heal', amount: 50 },
    ammo_mg:     { name: '방울 다발',   effect: 'ammo', weapon: 'machinegun', amount: 30 },
    ammo_sg:     { name: '소금 한 줌',  effect: 'ammo', weapon: 'shotgun',    amount: 12 },
    ammo_sniper: { name: '복숭아 화살', effect: 'ammo', weapon: 'sniper',     amount: 5  }
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

  // Pixel-art 산삼 (wild ginseng): a forked "man-shaped" pale root with green
  // palmate leaves and a small cluster of red berries on top — the classic
  // mountain-ginseng silhouette.
  function buildGinseng() {
    const cv = newCanvas(32, 32);
    const c = cv.getContext('2d');
    const px = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    // Red berry cluster on top
    px(14, 2, 2, 2, '#d42424');
    px(16, 3, 2, 2, '#d42424');
    px(15, 4, 2, 2, '#b01c1c');
    px(14, 2, 1, 1, '#ff7a7a');
    px(16, 3, 1, 1, '#ff7a7a');
    // Stem
    px(15, 5, 2, 9, '#5a7a30');
    // Palmate leaves fanning left and right
    px(14, 5, 4, 2, '#5aa043');
    px(7, 8, 7, 2, '#4c9038');  px(6, 10, 7, 2, '#3f7d30');  px(8, 12, 6, 2, '#3a7029');
    px(18, 8, 7, 2, '#4c9038'); px(19, 10, 7, 2, '#3f7d30'); px(18, 12, 6, 2, '#3a7029');
    px(7, 8, 7, 1, '#74bf57');  px(18, 8, 7, 1, '#74bf57');  // leaf highlights
    // Root body (man-shaped torso)
    px(13, 14, 6, 7, '#e9d6a6');
    px(13, 14, 1, 7, '#f2e6c2');   // left highlight
    px(18, 15, 1, 6, '#cbb682');   // right shade
    // Arms splaying out
    px(10, 16, 3, 2, '#e4cf9e'); px(9, 17, 2, 2, '#dcc592');
    px(19, 16, 3, 2, '#e4cf9e'); px(21, 17, 2, 2, '#dcc592');
    // Forked legs
    px(13, 21, 2, 5, '#e9d6a6'); px(11, 24, 2, 4, '#e0cb96');
    px(17, 21, 2, 5, '#e9d6a6'); px(19, 24, 2, 4, '#e0cb96');
    px(15, 21, 1, 5, '#cbb682');
    // Whisker roots
    px(10, 27, 1, 2, '#d8c48e'); px(21, 27, 1, 2, '#d8c48e'); px(15, 26, 2, 3, '#e0cb96');
    return cv;
  }

  // Pixel-art herbal-medicine packet (한약 한 첩): a folded kraft-paper bundle
  // tied with a twine cross, with a couple of dried roots/herbs poking out the
  // top. Warm hanji-paper tones instead of the old red-cross first-aid box.
  function buildMedkit() {
    const cv = newCanvas(32, 32);
    const c = cv.getContext('2d');
    const px = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    // Dried herbs / roots peeking out of the top of the wrap
    px(11, 3, 1, 5, '#6f8a3a');   // herb stalk left
    px(10, 2, 1, 2, '#85a64a');   // leaf
    px(12, 4, 1, 2, '#5c7430');
    px(19, 4, 1, 4, '#7a5a32');   // root right
    px(20, 3, 1, 2, '#9a7642');
    px(18, 5, 1, 2, '#6a4c28');
    px(15, 4, 1, 4, '#8a6a3a');   // root middle
    px(16, 5, 1, 3, '#a8814c');
    // Folded paper packet body (kraft / hanji paper)
    px(6, 8, 20, 19, '#d8b888');
    px(6, 8, 20,  1, '#ecd0a2');   // top highlight
    px(6, 9, 20,  1, '#e0c596');
    px(6, 26, 20, 1, '#9a7c50');   // bottom shadow
    px(6,  8,  1, 19, '#e4c896');  // left highlight
    px(25, 8,  1, 19, '#b0905c');  // right shadow
    // Fold creases down the packet
    px(12, 8, 1, 19, '#c0a070');
    px(13, 8, 1, 19, '#e0c596');
    px(19, 8, 1, 19, '#c0a070');
    px(20, 8, 1, 19, '#e0c596');
    // Bottom fold flap
    px(6, 22, 20, 1, '#b8966a');
    px(6, 23, 20, 1, '#e0c596');
    // Twine tie — vertical strand
    px(15, 8, 2, 19, '#9c3a2a');
    px(15, 8, 1, 19, '#c45a44');   // twine highlight
    // Twine tie — horizontal strand
    px(6, 16, 20, 2, '#9c3a2a');
    px(6, 16, 20, 1, '#c45a44');
    // Knot in the centre
    px(14, 15, 4, 4, '#7a2c1e');
    px(15, 16, 2, 2, '#c45a44');
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
    canvases.bandage     = buildGinseng();
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

  // Drop tables. Only healing items drop now — ammo no longer drops.
  // Boss is handled by onEnemyKilled directly with a guaranteed drop.
  function rollDrop(enemyTypeId) {
    const r = Math.random();
    if (enemyTypeId === 'tank') {
      if (r < 0.25) return 'medkit';
      return null;
    }
    if (enemyTypeId === 'ranger') {
      if (r < 0.10) return 'bandage';
      return null;
    }
    // grunt / rusher / bomber / splitter / splitterChild
    if (r < 0.12) return 'bandage';
    return null;
  }

  function onEnemyKilled(e) {
    if (!e || !e.type) return;
    if (e.type.isBoss) {
      // Boss drops a guaranteed medkit around the body.
      spawn('medkit', e.x + 0.30, e.y + 0.05);
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
