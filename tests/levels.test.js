// Level generator: determinism, solvability, difficulty rules, vehicles.
// Run: node --test tests/   (LEVELS=1000 to check more levels)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const TK = require('../js/levels.js');

const COUNT = Number(process.env.LEVELS) || 300;
const levels = [];
for (let n = 1; n <= COUNT; n++) levels.push(TK.generateLevel(n));

/** Plays a level with the game's rules, following the stored solution lazily. */
function playSolution(lv) {
  const cars = lv.cars.map((c) => ({ ...c }));
  const occ = TK.buildOcc(cars, lv.W, lv.H);
  const parked = [];
  let next = 0, peak = 0;
  for (const color of lv.queue) {
    let car = parked.find((c) => c.color === color);
    while (!car) {
      if (next >= lv.solution.length) throw new Error('ran out of cars');
      const c = cars[lv.solution[next++]];
      if (TK.firstBlocker(c, lv.W, lv.H, occ).blocker !== -1) throw new Error(`car ${c.id} is blocked`);
      if (parked.length >= lv.slots) throw new Error('parking overflow');
      for (const [x, y] of TK.carCells(c)) occ[y * lv.W + x] = -1;
      c.filled = 0;
      parked.push(c);
      peak = Math.max(peak, parked.length);
      if (c.color === color) car = c;
    }
    if (++car.filled === car.cap) parked.splice(parked.indexOf(car), 1);
  }
  return { left: parked.length + cars.length - next, peak };
}

test('levels are deterministic', () => {
  for (const n of [1, 2, 17, 123, COUNT]) assert.deepEqual(TK.generateLevel(n), levels[n - 1]);
});

test('levels never end (any level number generates)', () => {
  for (const n of [10_000, 123_456, 9_999_999]) {
    const lv = TK.generateLevel(n);
    assert.equal(lv.level, n);
    assert.ok(lv.cars.length > 5);
  }
});

test('every level can be won within its parking spots', () => {
  for (const lv of levels) {
    const r = playSolution(lv);
    assert.equal(r.left, 0, `level ${lv.level} left cars behind`);
    assert.ok(r.peak <= lv.slots, `level ${lv.level} needed ${r.peak} spots`);
  }
});

test('the solver confirms every level can be won', () => {
  for (const lv of levels) assert.ok(TK.isBeatable(lv), `level ${lv.level}`);
});

test('a level the solver cannot win is rebuilt from the same random stream', () => {
  const first = TK.generateLevel(14, { beatable: () => true });
  let seen = 0;
  const rejectTwice = () => ++seen > 2;
  const lv = TK.generateLevel(14, { beatable: rejectTwice });
  assert.equal(lv.builds, 3);
  assert.notDeepEqual(lv.cars, first.cars, 'a different map');
  assert.deepEqual({ W: lv.W, H: lv.H, slots: lv.slots, shape: lv.shape }, { W: first.W, H: first.H, slots: first.slots, shape: first.shape },
    'same level settings');
  seen = 0;
  assert.deepEqual(TK.generateLevel(14, { beatable: rejectTwice }), lv, 'still deterministic');
  assert.throws(() => TK.generateLevel(14, { beatable: () => false }), /no beatable map/);
});

test('passengers of each colour exactly fill the seats of that colour', () => {
  for (const lv of levels) {
    const seats = {}, riders = {};
    for (const c of lv.cars) seats[c.color] = (seats[c.color] || 0) + c.cap;
    for (const col of lv.queue) riders[col] = (riders[col] || 0) + 1;
    assert.deepEqual(riders, seats, `level ${lv.level}`);
  }
});

test('seeded settings stay in range', () => {
  for (const lv of levels) {
    const at = `level ${lv.level}`;
    assert.ok(lv.W >= 6 && lv.W <= 10, at);
    assert.ok(lv.H >= 8 && lv.H <= 14, at);
    assert.ok(lv.slots >= 1 && lv.slots <= 6, at);
    assert.ok(lv.window >= 1 && lv.window <= lv.slots, at);
    assert.ok(lv.visible >= 4 && lv.visible <= 9, at);
    assert.ok(lv.capacity >= 2 && lv.capacity <= 4, at);
    assert.equal(lv.mask.length, lv.W * lv.H, at);
  }
  // the seed really varies them
  for (const key of ['W', 'H', 'slots', 'visible', 'capacity']) {
    assert.ok(new Set(levels.map((l) => l[key])).size >= 3, `${key} barely varies`);
  }
  assert.deepEqual([...new Set(levels.map((l) => l.slots))].sort(), [1, 2, 3, 4, 5, 6]);
});

test('colours outnumber parking spots, so levels are never trivial', () => {
  for (const lv of levels) {
    const used = new Set(lv.cars.map((c) => c.color)).size;
    const want = Math.min(TK.PALETTE.length, lv.slots + (lv.level < 4 ? 1 : 2));
    assert.ok(lv.colors.length >= Math.max(3, want), `level ${lv.level}: ${lv.colors.length} colours for ${lv.slots} spots`);
    assert.equal(used, lv.colors.length, `level ${lv.level} has unused colours`);
  }
});

test('vehicles fit the lot, never overlap, and match their type', () => {
  for (const lv of levels) {
    const seen = new Set();
    for (const c of lv.cars) {
      const spec = TK.VEHICLES[c.type];
      assert.ok(spec, `unknown type ${c.type}`);
      assert.equal(c.len, spec.len);
      assert.equal(c.wid, spec.wid);
      assert.equal(c.cap, Math.round(lv.capacity * spec.seats));
      assert.ok(c.horiz ? 'LR'.includes(c.dir) : 'UD'.includes(c.dir), 'cars drive along their length');
      for (const [x, y] of TK.carCells(c)) {
        assert.ok(x >= 0 && y >= 0 && x < lv.W && y < lv.H, 'inside grid');
        assert.ok(lv.mask[y * lv.W + x], 'on a parking tile');
        assert.ok(!seen.has(y * lv.W + x), `level ${lv.level}: overlapping vehicles`);
        seen.add(y * lv.W + x);
      }
    }
  }
});

test('big vehicles appear in later levels', () => {
  const types = {};
  for (const lv of levels) for (const c of lv.cars) types[c.type] = (types[c.type] || 0) + 1;
  for (const t of Object.keys(TK.VEHICLES)) assert.ok(types[t] > 0, `no ${t} generated`);
  // intro levels stay simple
  for (const lv of levels.slice(0, 2)) assert.ok(lv.cars.every((c) => c.type === 'car' || c.type === 'van'));
});

test('mazes are hard: long chains of blocking cars after the intro', () => {
  const later = levels.filter((l) => l.level > 10);
  const avg = later.reduce((s, l) => s + l.depth, 0) / later.length;
  assert.ok(avg >= 10, `average blocking depth only ${avg.toFixed(1)}`);
  for (const lv of later) {
    const occ = TK.buildOcc(lv.cars, lv.W, lv.H);
    const free = lv.cars.filter((c) => TK.firstBlocker(c, lv.W, lv.H, occ).blocker < 0).length;
    assert.ok(free / lv.cars.length < 0.5, `level ${lv.level}: ${free}/${lv.cars.length} cars free at start`);
  }
});

test('the hidden part of the line is mixed from several vehicles', () => {
  const mixed = levels.filter((l) => l.window > 1).length;
  assert.ok(mixed > levels.length / 2);
});

test('firstBlocker: single lane', () => {
  const W = 6, H = 3;
  const cars = [
    { id: 0, x: 0, y: 1, len: 2, wid: 1, horiz: true, dir: 'R' },
    { id: 1, x: 4, y: 0, len: 2, wid: 1, horiz: false, dir: 'D' },
    { id: 2, x: 2, y: 0, len: 2, wid: 1, horiz: true, dir: 'L' },
  ];
  const occ = TK.buildOcc(cars, W, H);
  assert.deepEqual(TK.firstBlocker(cars[0], W, H, occ), { blocker: 1, dist: 2 });
  assert.equal(TK.firstBlocker(cars[1], W, H, occ).blocker, -1); // drives down into an empty row
  assert.equal(TK.firstBlocker(cars[2], W, H, occ).blocker, -1);
  cars[1].dir = 'U'; // nothing above it either
  assert.equal(TK.firstBlocker(cars[1], W, H, occ).blocker, -1);
  cars[2].dir = 'R'; // now car 1 is in the way
  assert.deepEqual(TK.firstBlocker(cars[2], W, H, occ), { blocker: 1, dist: 0 });
});

test('firstBlocker: a wide bus is blocked by anything in either lane', () => {
  const W = 6, H = 4;
  const bus = { id: 0, x: 0, y: 1, len: 3, wid: 2, horiz: true, dir: 'R' };
  const lower = { id: 1, x: 5, y: 2, len: 2, wid: 1, horiz: false, dir: 'D' };
  const occ = TK.buildOcc([bus, lower], W, H);
  assert.deepEqual(TK.firstBlocker(bus, W, H, occ), { blocker: 1, dist: 2 });
  for (const [x, y] of TK.carCells(lower)) occ[y * W + x] = -1;
  assert.equal(TK.firstBlocker(bus, W, H, occ).blocker, -1);
  assert.equal(TK.carCells(bus).length, 6);
});
