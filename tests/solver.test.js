// Auto solver: finds real solutions, proves dead ends, and stops on time.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const TK = require('../js/levels.js');
const { createSearch, solve } = require('../js/solver.js');

const COUNT = Number(process.env.LEVELS) || 300;

const fresh = (lv) => ({ W: lv.W, H: lv.H, slots: lv.slots, queue: lv.queue, head: 0, cars: lv.cars,
  grid: lv.cars.map((c) => c.id), parked: [] });

/** Plays taps by the game's rules; returns true if the board is cleared. */
function replay(board, moves) {
  const { W, H, cars, queue } = board;
  const grid = new Set(board.grid);
  const occ = TK.buildOcc([...grid].map((id) => cars[id]), W, H);
  const parked = board.parked.map((p) => ({ ...p }));
  let head = board.head;
  const settle = () => {
    for (let p; head < queue.length &&
      (p = parked.find((c) => cars[c.id].color === queue[head] && c.filled < cars[c.id].cap)); head++) {
      if (++p.filled === cars[p.id].cap) parked.splice(parked.indexOf(p), 1);
    }
  };
  settle();
  for (const id of moves) {
    assert.ok(grid.has(id), `car ${id} is not in the lot`);
    assert.equal(TK.firstBlocker(cars[id], W, H, occ).blocker, -1, `car ${id} is blocked`);
    assert.ok(parked.length < board.slots, 'no free spot');
    grid.delete(id);
    for (const [x, y] of TK.carCells(cars[id])) occ[y * W + x] = -1;
    parked.push({ id, filled: 0 });
    settle();
  }
  return head === queue.length && grid.size === 0 && parked.length === 0;
}

test('solves every level from the start, quickly', () => {
  for (let n = 1; n <= COUNT; n++) {
    const board = fresh(TK.generateLevel(n));
    const t0 = Date.now();
    const r = createSearch(board).run(10000);
    assert.equal(r?.status, 'solved', `level ${n}`);
    assert.ok(Date.now() - t0 < 2000, `level ${n} took ${Date.now() - t0}ms`);
    assert.ok(replay(board, r.moves), `level ${n}: the moves do not clear the board`);
  }
});

test('solves from the middle of a game, counting cars already parked', () => {
  const lv = TK.generateLevel(9);
  const board = fresh(lv);
  // park the first two cars of the stored solution
  const [a, b] = lv.solution;
  board.grid = board.grid.filter((id) => id !== a && id !== b);
  board.parked = [{ id: a, filled: 0 }, { id: b, filled: 0 }];
  const r = createSearch(board).run(10000);
  assert.equal(r.status, 'solved');
  assert.ok(!r.moves.includes(a) && !r.moves.includes(b));
  assert.ok(replay(board, r.moves));
});

test('reports a board with no way out as unsolvable', () => {
  // one spot, taken by a red car; the front passenger is blue
  const cars = [
    { id: 0, x: 0, y: 0, len: 2, wid: 1, horiz: true, dir: 'L', color: 0, cap: 2 },
    { id: 1, x: 0, y: 1, len: 2, wid: 1, horiz: true, dir: 'L', color: 1, cap: 2 },
  ];
  const board = { W: 2, H: 2, slots: 1, queue: [1, 1, 0, 0], head: 0, cars, grid: [1], parked: [{ id: 0, filled: 0 }] };
  assert.deepEqual(createSearch(board).run(1000), { status: 'unsolvable' });
});

test('an already cleared board needs no moves', () => {
  const board = { W: 1, H: 1, slots: 1, queue: [], head: 0, cars: [], grid: [], parked: [] };
  assert.deepEqual(createSearch(board).run(10), { status: 'solved', moves: [] });
});

test('stops at the time limit', async () => {
  // 40 free cars and a stray passenger at the end of the line nobody can carry:
  // every order fails only at the very end, far too many to try them all
  const cars = [];
  for (let y = 0; y < 40; y++) cars.push({ id: y, x: 0, y, len: 2, wid: 1, horiz: true, dir: 'L', color: y % 8, cap: 2 });
  const queue = cars.flatMap((c) => [c.color, c.color]).concat(9);
  const board = { W: 2, H: 40, slots: 6, queue, head: 0, cars, grid: cars.map((c) => c.id), parked: [] };
  const t0 = Date.now();
  const r = await solve(board, { timeLimit: 300 });
  const took = Date.now() - t0;
  assert.equal(r.status, 'timeout');
  assert.ok(took >= 300 && took < 800, `took ${took}ms`);
});

test('can be cancelled', async () => {
  const ctl = new AbortController();
  ctl.abort();
  assert.deepEqual(await solve(fresh(TK.generateLevel(20)), { signal: ctl.signal }), { status: 'cancelled' });
});
