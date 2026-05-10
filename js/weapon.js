// Weapon definitions and shoot logic
const Weapons = (() => {
  const defs = {
    pistol: {
      id: 'pistol',
      name: '권총',
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
      name: '샷건',
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
    machinegun: {
      id: 'machinegun',
      name: '기관총',
      damage: 10,
      fireRate: 0.08,
      magSize: 30,
      reloadTime: 1.8,
      spread: 0.05,
      pellets: 1,
      maxRange: 22,
      ammoInfinite: false,
      reserveAmmo: 90,
      currentAmmo: 30,
      sound: 'shootMachineGun',
      kickback: 5,
      color: '#445566',
      unlocked: false
    },
    sniper: {
      id: 'sniper',
      name: '저격총',
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

  function clone(def) {
    return JSON.parse(JSON.stringify({
      ...def,
      reserveAmmo: def.ammoInfinite ? null : def.reserveAmmo
    }));
  }

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
