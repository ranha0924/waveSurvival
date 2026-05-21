// Weapon definitions and shoot logic
const Weapons = (() => {
  const defs = {
    pistol: {
      id: 'pistol',
      name: '부적총',
      damage: 15,
      fireRate: 0.35,        // seconds between shots
      magSize: 12,
      reloadTime: 1.0,
      spread: 0.015,
      pellets: 1,
      maxRange: 25,
      ammoInfinite: true,    // pistol has infinite reserves
      reserveAmmo: Infinity,
      currentAmmo: 12,
      sound: 'shootPistol',
      kickback: 8,
      color: '#888899',
      unlocked: true
    },
    shotgun: {
      id: 'shotgun',
      name: '소금총',
      damage: 14,            // per pellet
      fireRate: 0.85,
      magSize: 6,
      reloadTime: 1.6,
      spread: 0.18,
      pellets: 6,
      maxRange: 12,
      ammoInfinite: false,
      reserveAmmo: 24,
      currentAmmo: 6,
      sound: 'shootShotgun',
      kickback: 18,
      color: '#aa6633',
      unlocked: false
    },
    // Fast / light shotgun — narrow spread, low damage per pellet, quick
    // rhythm. The 방울 (shaman bell) is the matching motif; mechanically
    // this is the swarm-clearing counterpart to the heavier 소금총.
    machinegun: {
      id: 'machinegun',
      name: '방울총',
      damage: 4,             // per pellet
      fireRate: 0.25,
      magSize: 12,
      reloadTime: 1.5,
      spread: 0.08,
      pellets: 5,
      maxRange: 16,
      ammoInfinite: false,
      reserveAmmo: 60,
      currentAmmo: 12,
      sound: 'shootMachineGun',
      kickback: 7,
      color: '#445566',
      unlocked: false
    },
    sniper: {
      id: 'sniper',
      name: '복숭아 활',
      damage: 80,
      fireRate: 1.2,
      magSize: 5,
      reloadTime: 2.0,
      spread: 0.002,
      pellets: 1,
      maxRange: 40,
      ammoInfinite: false,
      reserveAmmo: 15,
      currentAmmo: 5,
      sound: 'shootSniper',
      kickback: 25,
      color: '#222',
      unlocked: false,
      pierce: 1
    }
  };

  function buildLoadout() {
    // Returns fresh weapons object for a new game
    const loadout = {};
    for (const k in defs) {
      const w = { ...defs[k] };
      w.currentAmmo = w.magSize;
      w.reserveAmmo = w.ammoInfinite ? Infinity : defs[k].reserveAmmo;
      w.unlocked = defs[k].unlocked;
      loadout[k] = w;
    }
    return loadout;
  }

  return { defs, buildLoadout };
})();
