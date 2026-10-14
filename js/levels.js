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
 *    `slots` parking spots at once, so a careful player can always win.
 *  - the solver (solver.js) confirms it can be won; if not, the map is
 *    built again from the same random stream.
 *
 * Map size, spots (1-6), colours, seats per vehicle and how much of the line
 * is visible are all rolled from the level seed. Several mazes are built per
 * level and the one with the deepest chains of blocking cars is kept.
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
    { hex: '#92400e', name: 'Brown', glyph: '✦' },
    { hex: '#e2e8f0', name: 'White', glyph: '▼' },
  ];

  // Vehicle sizes in cells (len along the driving direction, wid across it).
  // Seats are a multiple of the level's base seat count.
  const VEHICLES = {
    car: { len: 2, wid: 1, seats: 1 },
    van: { len: 3, wid: 1, seats: 1.5 },
    bus: { len: 4, wid: 1, seats: 2 },
    bigbus: { len: 3, wid: 2, seats: 3 },
  };

  const THEME_COUNT = 6;
  const DIRS = { R: [1, 0], L: [-1, 0], U: [0, -1], D: [0, 1] };
  const OPPOSITE = { R: 'L', L: 'R', U: 'D', D: 'U' };

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

  // ---------- difficulty ----------
  const randInt = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));

  /** Level settings, rolled from the level's seed. Ranges widen over the first ~16 levels. */
  function params(n, rng) {
    const grow = Math.min(1, (n - 1) / 15);
    const W = randInt(rng, 6 + Math.round(grow), 7 + Math.round(grow * 3));          // 6..10
    const H = randInt(rng, Math.max(W + 1, 8 + Math.round(grow * 2)), 10 + Math.round(grow * 4)); // ..14
    const slots = randInt(rng, Math.max(1, 4 - Math.floor(n / 4)), 6);                // 1..6
    return {
      W, H, slots,
      // how many cars' passengers are mixed together in the line; window == slots means no spare spot
      window: Math.max(1, slots - randInt(rng, 0, n < 6 ? 2 : 1)),
      // seats in a small car; bigger vehicles carry more (see VEHICLES)
      capacity: randInt(rng, 2, n < 4 ? 3 : 4),
      // Always more colours than spots (2+ more after the intro levels), otherwise
      // you can park one car of every colour and the line never gets stuck.
      colors: Math.max(3, Math.min(PALETTE.length, slots + randInt(rng, n < 4 ? 1 : 2, n < 4 ? 2 : 4))),
      density: 0.82 + rng() * 0.13,
      vanChance: 0.2 + rng() * 0.15,
      busChance: n < 3 ? 0 : 0.05 + rng() * 0.1,
      bigChance: n < 5 ? 0 : 0.04 + rng() * 0.08,
      visible: randInt(rng, 4, 9),
      // maze candidates generated per level; the hardest one is kept
      candidates: 4 + Math.round(grow * 6),
      harden: n > 3, // the first levels stay gentle
    };
  }

  /** Peel free cars off in rounds; more rounds = longer chains of blockers. */
  function analyze(cars, W, H) {
    reindex(cars);
    const occ = buildOcc(cars, W, H);
    let remaining = cars.slice(), rounds = 0, initialFree = 0;
    for (;;) {
      const free = remaining.filter((c) => firstBlocker(c, W, H, occ).blocker < 0);
      if (!free.length) break;
      if (!rounds) initialFree = free.length;
      rounds++;
      for (const c of free) for (const [x, y] of carCells(c)) occ[y * W + x] = -1;
      remaining = remaining.filter((c) => !free.includes(c));
    }
    return { rounds, initialFree, stuck: remaining.length };
  }
  const hardness = (a) => a.rounds * 4 - a.initialFree * 3;

  /** Hill-climb car directions towards deeper blocking chains, never breaking solvability. */
  function harden(cars, W, H, rng, steps) {
    let cur = analyze(cars, W, H);
    for (let i = steps; i > 0; i--) {
      const c = cars[Math.floor(rng() * cars.length)];
      c.dir = OPPOSITE[c.dir];
      const a = analyze(cars, W, H);
      if (a.stuck === 0 && hardness(a) >= hardness(cur)) cur = a;
      else c.dir = OPPOSITE[c.dir];
    }
    return cur;
  }

  // ---------- grid helpers ----------
  function carCells(car) {
    const cells = [];
    const wid = car.wid || 1;
    for (let i = 0; i < car.len; i++) {
      for (let j = 0; j < wid; j++) cells.push(car.horiz ? [car.x + i, car.y + j] : [car.x + j, car.y + i]);
    }
    return cells;
  }

  function buildOcc(cars, W, H) {
    const occ = new Int16Array(W * H).fill(-1);
    for (const c of cars) for (const [x, y] of carCells(c)) occ[y * W + x] = c.id;
    return occ;
  }

  /**
   * Nearest car in front of `car` ({blocker:-1} when the way out is clear).
   * A wide vehicle needs every one of its lanes to be clear.
   */
  function firstBlocker(car, W, H, occ) {
    const [dx, dy] = DIRS[car.dir];
    let best = { blocker: -1, dist: Infinity };
    for (let j = 0; j < (car.wid || 1); j++) {
      let x = car.horiz ? car.x : car.x + j, y = car.horiz ? car.y + j : car.y;
      if (car.dir === 'R') x = car.x + car.len - 1;
      if (car.dir === 'D') y = car.y + car.len - 1;
      x += dx; y += dy;
      for (let dist = 0; x >= 0 && x < W && y >= 0 && y < H && dist < best.dist; dist++, x += dx, y += dy) {
        const o = occ[y * W + x];
        if (o >= 0 && o !== car.id) { best = { blocker: o, dist }; break; }
      }
    }
    if (best.blocker < 0) best.dist = car.horiz ? W : H;
    return best;
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
    const fits = (car) => carCells(car).every(([cx, cy]) =>
      cx >= 0 && cy >= 0 && cx < W && cy < H && mask[cy * W + cx] && !occ[cy * W + cx]);
    // which vehicle sizes to try at a cell, biggest first
    const pickTypes = () => {
      const r = rng();
      if (r < p.bigChance) return ['bigbus', 'car'];
      if (r < p.bigChance + p.busChance) return ['bus', 'van', 'car'];
      if (r < p.bigChance + p.busChance + p.vanChance) return ['van', 'car'];
      return ['car'];
    };
    const cells = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) cells.push([x, y]);
    // two passes so that leftover gaps get a second chance
    for (let pass = 0; pass < 2; pass++) {
      for (const [x, y] of shuffle(cells.slice(), rng)) {
        if (occ[y * W + x] || rng() > p.density) continue;
        let placed = false;
        for (const horiz of shuffle([true, false], rng)) {
          for (const type of pickTypes()) {
            const { len, wid } = VEHICLES[type];
            const offsets = [];
            for (let i = 0; i < len; i++) for (let j = 0; j < wid; j++) offsets.push([i, j]);
            for (const [i, j] of shuffle(offsets, rng)) {
              const car = { type, len, wid, horiz, x: horiz ? x - i : x - j, y: horiz ? y - j : y - i };
              if (!fits(car)) continue;
              car.dir = horiz ? (rng() < 0.5 ? 'R' : 'L') : (rng() < 0.5 ? 'U' : 'D');
              cars.push(car);
              for (const [cx, cy] of carCells(car)) occ[cy * W + cx] = 1;
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

  // How hard the solver may work to prove a level can be won. A step budget,
  // not a time limit, so a level comes out the same on every device.
  const SOLVE_STEPS = 200000;
  const MAX_BUILDS = 50;

  /** True if the solver finds a way to clear the level from its start. */
  function isBeatable(lv) {
    const solver = root.TKSolver || (typeof require === 'function' ? require('./solver.js') : null);
    if (!solver) throw new Error('TKSolver is not loaded');
    const board = { W: lv.W, H: lv.H, slots: lv.slots, queue: lv.queue, head: 0, cars: lv.cars,
      grid: lv.cars.map((c) => c.id), parked: [] };
    const r = solver.createSearch(board).run(Infinity, SOLVE_STEPS);
    return !!r && r.status === 'solved';
  }

  /**
   * Level n, built from its seed. Every level is checked with the solver; if it
   * cannot be won, the map is built again from the same random stream until one
   * can, so the result is still the same level n everywhere.
   * `beatable` is replaceable for tests.
   */
  function generateLevel(n, { beatable = isBeatable } = {}) {
    n = Math.max(1, Math.floor(n));
    const rng = mulberry32(hashInt(n));
    const p = params(n, rng);
    const names = Object.keys(SHAPES);
    const shapeName = n === 1 ? 'rect' : names[Math.floor(rng() * names.length)];
    let lv;
    for (let builds = 1; builds <= MAX_BUILDS; builds++) {
      lv = buildLevel(n, p, shapeName, rng);
      lv.builds = builds;
      if (beatable(lv)) return lv;
    }
    throw new Error(`level ${n}: no beatable map in ${MAX_BUILDS} builds`);
  }

  function buildLevel(n, p, shapeName, rng) {
    const { W, H } = p;
    // Build several solvable mazes and keep the one with the deepest blocking chains.
    let best = null;
    for (let attempt = 0, built = 0; attempt < 40 && built < p.candidates; attempt++) {
      const mask = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mask.push(SHAPES[shapeName](x, y, W, H, rng));
      const cells = mask.filter(Boolean).length;
      const cars = fillCars(mask, W, H, p, rng);
      makeSolvable(cars, W, H, rng);
      if (cars.length < Math.max(6, Math.floor(cells * 0.3))) continue;
      built++;
      const score = hardness(harden(cars, W, H, rng, p.harden ? cars.length * 5 : 0)) + cars.length * 0.5;
      if (!best || score > best.score) best = { mask, cars: cars.map((c) => ({ ...c })), score };
    }
    if (!best) {
      const mask = new Array(W * H).fill(true);
      const cars = fillCars(mask, W, H, p, rng);
      makeSolvable(cars, W, H, rng);
      best = { mask, cars };
    }
    const { mask, cars } = best;
    const stats = analyze(cars, W, H); // also reindexes

    // balanced colour assignment
    const colors = shuffle([...PALETTE.keys()], rng).slice(0, p.colors);
    shuffle(cars.slice(), rng).forEach((c, i) => { c.color = colors[i % colors.length]; });
    for (const c of cars) c.cap = Math.round(p.capacity * VEHICLES[c.type].seats);

    const order = removalOrder(cars, W, H, rng);
    const queue = buildQueue(order, p.window, rng);

    return {
      level: n,
      W, H, mask,
      shape: shapeName,
      themeIndex: (n - 1) % THEME_COUNT,
      slots: p.slots,
      window: p.window,
      visible: p.visible,
      capacity: p.capacity,
      depth: stats.rounds,
      colors,
      cars: cars.map((c) => ({ id: c.id, type: c.type, x: c.x, y: c.y, len: c.len, wid: c.wid, horiz: c.horiz, dir: c.dir, color: c.color, cap: c.cap })),
      queue,
      solution: order.map((c) => c.id),
    };
  }


  const api = { PALETTE, VEHICLES, THEME_COUNT, DIRS, SHAPES, params, generateLevel, isBeatable, firstBlocker, buildOcc, carCells };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TKLevels = api;
})(typeof window !== 'undefined' ? window : globalThis);
