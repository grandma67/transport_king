/*
 * Transport King — procedural level generator.
 *
 * Pure logic (no DOM) so it can run in the browser and in Node tests.
 * Every level is generated from a seed derived from its number, so a level
 * always looks the same, and there is no last level.
 *
 * Guarantees for every generated level:
 *  - every car can eventually leave the lot (no deadlocked blocks);
 *  - passenger counts per colour exactly equal the seats of that colour;
 *  - the queue is built from a real solution that never needs more than
 *    `slots - 1` parking spots at once, so a careful player can always win.
 */
(function (root) {
  'use strict';

  const PALETTE = [
    { hex: '#ef4444', name: 'Red', glyph: '●' },
    { hex: '#3b82f6', name: 'Blue', glyph: '▲' },
    { hex: '#22c55e', name: 'Green', glyph: '■' },
    { hex: '#facc15', name: 'Yellow', glyph: '★' },
    { hex: '#a855f7', name: 'Purple', glyph: '◆' },
    { hex: '#f97316', name: 'Orange', glyph: '♥︎' },
    { hex: '#ec4899', name: 'Pink', glyph: '✚' },
    { hex: '#06b6d4', name: 'Cyan', glyph: '☾' },
  ];

  const THEME_COUNT = 6;
  const DIRS = { R: [1, 0], L: [-1, 0], U: [0, -1], D: [0, 1] };
  const OPPOSITE = { R: 'L', L: 'R', U: 'D', D: 'U' };
  const CAPACITY = { 2: 4, 3: 6 };

  // ---------- seeded randomness ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashInt(n) {
    let h = 2166136261 ^ n;
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---------- lot layouts ----------
  // A shape decides which grid cells may hold cars. Cells outside the shape
  // are open road: cars can drive through them but never park on them.
  function band(n, frac) {
    const k = Math.max(2, Math.round(n * frac));
    const s = Math.floor((n - k) / 2);
    return [s, s + k];
  }
  const SHAPES = {
    rect: () => true,
    diamond: (x, y, W, H) =>
      Math.abs(x + 0.5 - W / 2) / (W / 2) + Math.abs(y + 0.5 - H / 2) / (H / 2) <= 1.2,
    oval: (x, y, W, H) =>
      ((x + 0.5 - W / 2) / (W / 2)) ** 2 + ((y + 0.5 - H / 2) / (H / 2)) ** 2 <= 1.15,
    plus: (x, y, W, H) => {
      const bx = band(W, 0.5), by = band(H, 0.5);
      return (x >= bx[0] && x < bx[1]) || (y >= by[0] && y < by[1]);
    },
    donut: (x, y, W, H) => {
      const bx = band(W, 0.34), by = band(H, 0.3);
      return !(x >= bx[0] && x < bx[1] && y >= by[0] && y < by[1]);
    },
    hourglass: (x, y, W, H) => {
      const t = Math.abs(y + 0.5 - H / 2) / (H / 2);
      return Math.abs(x + 0.5 - W / 2) <= ((0.3 + 0.7 * t) * W) / 2 + 0.25;
    },
    stairs: (x, y, W, H) => Math.abs((x + 0.5) / W - (y + 0.5) / H) <= 0.45,
    arch: (x, y, W, H) => {
      const bx = band(W, 0.3);
      return !(y < H * 0.45 && x >= bx[0] && x < bx[1]);
    },
    aisles: (x) => x % 4 !== 3,
    islands: (x, y, W, H) => y !== Math.floor(H / 2),
    holes: (x, y, W, H, rng) => rng() > 0.14,
  };

  // ---------- difficulty curve ----------
  function params(n) {
    return {
      W: Math.min(9, 5 + Math.floor(n / 4)),
      H: Math.min(11, 6 + Math.floor(n / 3)),
      colors: Math.min(PALETTE.length, 2 + Math.ceil(n / 3)),
      density: Math.min(0.95, 0.62 + n * 0.02),
      longChance: Math.min(0.45, 0.2 + n * 0.015),
      slots: 5,
      // how many cars' passengers are mixed together in the queue at once
      window: n <= 2 ? 1 : n <= 8 ? 2 : n <= 30 ? 3 : 4,
      // how much of the queue the player can see
      visible: Math.max(5, 10 - Math.floor(n / 5)),
    };
  }

  // ---------- grid helpers ----------
  function carCells(car) {
    const cells = [];
    for (let i = 0; i < car.len; i++) {
      cells.push(car.horiz ? [car.x + i, car.y] : [car.x, car.y + i]);
    }
    return cells;
  }

  function buildOcc(cars, W, H) {
    const occ = new Int16Array(W * H).fill(-1);
    for (const c of cars) for (const [x, y] of carCells(c)) occ[y * W + x] = c.id;
    return occ;
  }

  /** First car in front of `car` ({blocker:-1} when the way out is clear). */
  function firstBlocker(car, W, H, occ) {
    const [dx, dy] = DIRS[car.dir];
    let fx = car.x, fy = car.y;
    if (car.dir === 'R') fx = car.x + car.len - 1;
    if (car.dir === 'D') fy = car.y + car.len - 1;
    let x = fx + dx, y = fy + dy, dist = 0;
    while (x >= 0 && x < W && y >= 0 && y < H) {
      const o = occ[y * W + x];
      if (o >= 0 && o !== car.id) return { blocker: o, dist };
      x += dx; y += dy; dist++;
    }
    return { blocker: -1, dist };
  }

  function reindex(cars) { cars.forEach((c, i) => { c.id = i; }); }

  /** Remove free cars repeatedly; whatever is left is deadlocked. */
  function stuckCars(cars, W, H) {
    reindex(cars);
    const occ = buildOcc(cars, W, H);
    let remaining = cars.slice();
    for (;;) {
      const free = remaining.filter((c) => firstBlocker(c, W, H, occ).blocker < 0);
      if (!free.length) return remaining;
      for (const c of free) for (const [x, y] of carCells(c)) occ[y * W + x] = -1;
      remaining = remaining.filter((c) => !free.includes(c));
    }
  }

  function makeSolvable(cars, W, H, rng) {
    const flipped = new Set();
    for (;;) {
      const stuck = stuckCars(cars, W, H);
      if (!stuck.length) return;
      const c = stuck[Math.floor(rng() * stuck.length)];
      if (!flipped.has(c)) { c.dir = OPPOSITE[c.dir]; flipped.add(c); }
      else cars.splice(cars.indexOf(c), 1);
    }
  }

  function fillCars(mask, W, H, p, rng) {
    const occ = new Int8Array(W * H);
    const cars = [];
    const fits = (x, y, len, horiz) => {
      for (let i = 0; i < len; i++) {
        const cx = horiz ? x + i : x, cy = horiz ? y : y + i;
        if (cx < 0 || cy < 0 || cx >= W || cy >= H) return false;
        if (!mask[cy * W + cx] || occ[cy * W + cx]) return false;
      }
      return true;
    };
    const cells = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) cells.push([x, y]);
    // two passes so that leftover gaps get a second chance
    for (let pass = 0; pass < 2; pass++) {
      for (const [x, y] of shuffle(cells.slice(), rng)) {
        if (occ[y * W + x] || rng() > p.density) continue;
        let placed = false;
        for (const horiz of shuffle([true, false], rng)) {
          for (const len of rng() < p.longChance ? [3, 2] : [2]) {
            for (const off of shuffle([...Array(len).keys()], rng)) {
              const sx = horiz ? x - off : x, sy = horiz ? y : y - off;
              if (!fits(sx, sy, len, horiz)) continue;
              const dir = horiz ? (rng() < 0.5 ? 'R' : 'L') : (rng() < 0.5 ? 'U' : 'D');
              cars.push({ x: sx, y: sy, len, horiz, dir });
              for (let i = 0; i < len; i++) occ[(horiz ? sy : sy + i) * W + (horiz ? sx + i : sx)] = 1;
              placed = true;
              break;
            }
            if (placed) break;
          }
          if (placed) break;
        }
      }
    }
    return cars;
  }

  /** A random valid order in which all cars can leave the lot. */
  function removalOrder(cars, W, H, rng) {
    const occ = buildOcc(cars, W, H);
    let remaining = cars.slice();
    const order = [];
    while (remaining.length) {
      const free = remaining.filter((c) => firstBlocker(c, W, H, occ).blocker < 0);
      const c = free[Math.floor(rng() * free.length)];
      for (const [x, y] of carCells(c)) occ[y * W + x] = -1;
      remaining = remaining.filter((r) => r !== c);
      order.push(c);
    }
    return order;
  }

  /**
   * Builds the passenger queue by playing the solution: `win` cars are
   * "boarding" at the same time and their passengers are interleaved in
   * short random runs. A passenger always goes to the earliest parked car of
   * its colour, which is exactly the rule the game uses.
   */
  function buildQueue(order, win, rng) {
    const active = [];
    let next = 0;
    const q = [];
    const refill = () => {
      while (active.length < win && next < order.length) {
        const c = order[next++];
        active.push({ color: c.color, rem: c.cap });
      }
    };
    refill();
    while (active.length) {
      const color = active[Math.floor(rng() * active.length)].color;
      const run = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < run; k++) {
        const t = active.find((e) => e.color === color);
        if (!t) break;
        q.push(color);
        if (--t.rem === 0) { active.splice(active.indexOf(t), 1); refill(); }
      }
    }
    return q;
  }

  function generateLevel(n) {
    n = Math.max(1, Math.floor(n));
    const p = params(n);
    const rng = mulberry32(hashInt(n));
    const { W, H } = p;
    const names = Object.keys(SHAPES);
    const shapeName = n === 1 ? 'rect' : names[Math.floor(rng() * names.length)];

    let best = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const mask = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mask.push(SHAPES[shapeName](x, y, W, H, rng));
      const cells = mask.filter(Boolean).length;
      const cars = fillCars(mask, W, H, p, rng);
      makeSolvable(cars, W, H, rng);
      if (!best || cars.length > best.cars.length) best = { mask, cars };
      if (cars.length >= Math.max(5, Math.floor(cells * 0.25))) break;
    }
    const { mask, cars } = best;
    reindex(cars);

    // balanced colour assignment
    const colors = shuffle([...PALETTE.keys()], rng).slice(0, p.colors);
    shuffle(cars.slice(), rng).forEach((c, i) => { c.color = colors[i % colors.length]; });
    for (const c of cars) c.cap = CAPACITY[c.len];

    const order = removalOrder(cars, W, H, rng);
    const queue = buildQueue(order, p.window, rng);

    return {
      level: n,
      W, H, mask,
      shape: shapeName,
      themeIndex: (n - 1) % THEME_COUNT,
      slots: p.slots,
      visible: p.visible,
      colors,
      cars: cars.map((c) => ({ id: c.id, x: c.x, y: c.y, len: c.len, horiz: c.horiz, dir: c.dir, color: c.color, cap: c.cap })),
      queue,
      solution: order.map((c) => c.id),
    };
  }

  const api = { PALETTE, THEME_COUNT, DIRS, SHAPES, params, generateLevel, firstBlocker, buildOcc, carCells };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TKLevels = api;
})(typeof window !== 'undefined' ? window : globalThis);
