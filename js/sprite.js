// Generic enemy sprite registry. Each enemy type id can be associated with
// either a built-in pixel-art canvas (synchronous) or an image URL that loads
// asynchronously. The raycaster looks sprites up by type id at draw time and
// falls back to its procedural rectangle silhouette when none is registered.
const Sprites = (() => {
  const cache = new Map();

  function register(typeId, source, opts) {
    const scale = (opts && opts.scale) || 1;
    if (typeof source === 'function') {
      const cv = source();
      cache.set(typeId, { canvas: cv, w: cv.width, h: cv.height, ready: true, scale });
      return;
    }
    // String → treat as image URL. Loads asynchronously; until ready, get()
    // returns null and the renderer keeps using the rectangle fallback.
    const entry = { canvas: null, w: 0, h: 0, ready: false, scale };
    cache.set(typeId, entry);
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const c = cv.getContext('2d');
      c.imageSmoothingEnabled = false;
      c.drawImage(img, 0, 0);
      entry.canvas = cv;
      entry.w = img.width;
      entry.h = img.height;
      entry.ready = true;
    };
    img.onerror = () => { /* leave entry.ready false → fallback rendering */ };
    img.src = source;
  }

  function get(typeId) {
    const e = cache.get(typeId);
    return e && e.ready ? e : null;
  }

  // Pixel-art shambler. Pale greenish skin, ragged brown shirt, torn jeans,
  // arms outstretched. 32×48 internal resolution, scaled up at draw time with
  // smoothing disabled for crisp pixels.
  function buildZombie() {
    const W = 32, H = 48;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');

    const SKIN      = '#a3a589';
    const SKIN_SH   = '#6f7158';
    const SHIRT     = '#8a5b4a';
    const SHIRT_SH  = '#583828';
    const PANTS     = '#5d6a7c';
    const PANTS_SH  = '#3a4658';
    const HAIR      = '#3a2615';
    const MOUTH     = '#260808';
    const EYE       = '#e8e4c8';
    const FOOT      = '#7a6a55';
    const BLOOD     = '#4a1a18';

    const px = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };

    // Head
    px(11, 3, 10, 10, SKIN);
    px(10, 5, 1, 6, SKIN);
    px(21, 5, 1, 6, SKIN);
    // Cheek shadow
    px(11, 11, 10, 2, SKIN_SH);
    // Hair on top
    px(11, 2, 10, 3, HAIR);
    px(12, 1, 8, 1, HAIR);
    px(10, 4, 1, 1, HAIR);
    px(21, 4, 1, 1, HAIR);
    // Eye sockets
    px(13, 7, 2, 2, SKIN_SH);
    px(17, 7, 2, 2, SKIN_SH);
    // Pale eyes
    px(13, 7, 2, 1, EYE);
    px(17, 7, 2, 1, EYE);
    // Snarling mouth
    px(13, 11, 6, 2, MOUTH);
    px(13, 11, 1, 1, EYE);
    px(15, 11, 1, 1, EYE);
    px(17, 11, 1, 1, EYE);

    // Neck
    px(14, 13, 4, 2, SKIN_SH);

    // Torso — ragged shirt
    px(10, 15, 12, 13, SHIRT);
    // Collar V
    px(15, 15, 2, 3, SKIN_SH);
    // Shirt rips
    px(20, 22, 2, 3, SHIRT_SH);
    px(11, 24, 2, 2, SHIRT_SH);
    // Bloodstain
    px(17, 19, 3, 2, BLOOD);

    // Shoulders
    px(8, 16, 3, 3, SHIRT);
    px(21, 16, 3, 3, SHIRT);

    // Outstretched arms
    px(5, 17, 4, 3, SKIN);
    px(23, 17, 4, 3, SKIN);
    px(2, 18, 4, 3, SKIN);
    px(26, 18, 4, 3, SKIN);
    // Wrists shadow
    px(2, 20, 4, 1, SKIN_SH);
    px(26, 20, 4, 1, SKIN_SH);
    // Hands / clawed fingers
    px(0, 18, 2, 4, SKIN);
    px(30, 18, 2, 4, SKIN);
    px(0, 21, 1, 2, SKIN_SH);
    px(31, 21, 1, 2, SKIN_SH);

    // Hip / belt line
    px(11, 28, 10, 1, SHIRT_SH);

    // Legs in torn jeans
    px(11, 29, 4, 15, PANTS);
    px(17, 29, 4, 15, PANTS);
    // Inner shadow
    px(15, 29, 2, 15, PANTS_SH);
    // Knee patches
    px(11, 36, 4, 2, PANTS_SH);
    px(17, 36, 4, 2, PANTS_SH);
    // Tear at shin
    px(18, 41, 2, 2, SKIN);

    // Feet
    px(10, 44, 5, 3, FOOT);
    px(17, 44, 5, 3, FOOT);
    px(10, 46, 5, 1, SKIN_SH);
    px(17, 46, 5, 1, SKIN_SH);

    return cv;
  }

  return { register, get, buildZombie };
})();

// Default registrations. Add more lines like:
//   Sprites.register('boss', 'assets/boss.png', { scale: 2 });
// and the renderer will pick them up automatically. While an asset streams
// in, the renderer falls back to its procedural rectangle silhouette.
Sprites.register('grunt',  'assets/zombie.png');
Sprites.register('rusher', 'assets/rusher.png');
Sprites.register('tank',   'assets/tank.png', { scale: 1.5 });
