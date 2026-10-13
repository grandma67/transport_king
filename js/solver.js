/*
 * Transport King — auto solver.
 *
 * Pure logic (no DOM) so it can run in the browser and in Node tests.
 * Searches for an order of taps that clears the board from its current state.
 *
 * The model plays by the game's rules, assuming the board settles between
 * taps: after each tap the line boards greedily (the front passenger takes the
 * earliest-parked vehicle of their colour), full vehicles leave, and the next
 * tap needs a free spot. It is a depth-first search with a memo of dead
 * states, run in small time slices so the page stays responsive.
 */
(function (root) {
  'use strict';

  const TK = root.TKLevels || (typeof require === 'function' ? require('./levels.js') : null);

  /**
   * board: { W, H, slots, queue, head, cars: [{id,x,y,len,wid,horiz,dir,color,cap}],
   *          grid: [ids still in the lot], parked: [{id, filled}] in parking order }
   */
  function createSearch(board) {
    const { W, H, slots, queue } = board;
    const cars = board.cars;
    const inGrid = new Uint8Array(cars.length);
    for (const id of board.grid) inGrid[id] = 1;
    const start = settle({
      inGrid,
      occ: TK.buildOcc(board.grid.map((id) => cars[id]), W, H),
      parked: board.parked.map((p) => ({ id: p.id, filled: p.filled })),
      head: board.head,
      left: board.grid.length,
    });

    const dead = new Set();
    const stack = [];
    let result = null; // { status: 'solved', moves } | { status: 'unsolvable' }
    let explored = 0;

    if (isWin(start)) result = { status: 'solved', moves: [] };
    else stack.push(frame(start, -1));

    function isWin(s) { return s.head >= queue.length && s.left === 0 && s.parked.length === 0; }

    // The front passengers board until the front one has no vehicle to go to.
    function settle(s) {
      while (s.head < queue.length) {
        const p = s.parked.find((c) => cars[c.id].color === queue[s.head] && c.filled < cars[c.id].cap);
        if (!p) break;
        s.head++;
        if (++p.filled === cars[p.id].cap) s.parked.splice(s.parked.indexOf(p), 1);
      }
      return s;
    }

    function key(s) {
      let k = '';
      for (let i = 0; i < s.inGrid.length; i += 16) {
        let w = 0;
        for (let j = 0; j < 16 && i + j < s.inGrid.length; j++) if (s.inGrid[i + j]) w |= 1 << j;
        k += String.fromCharCode(w);
      }
      for (const p of s.parked) k += ',' + p.id + ':' + p.filled;
      return k;
    }

    function tap(s, id) {
      const inGrid = s.inGrid.slice();
      inGrid[id] = 0;
      const occ = s.occ.slice();
      for (const [x, y] of TK.carCells(cars[id])) occ[y * W + x] = -1;
      return settle({
        inGrid, occ,
        parked: s.parked.map((p) => ({ id: p.id, filled: p.filled })).concat({ id, filled: 0 }),
        head: s.head,
        left: s.left - 1,
      });
    }

    /** Free vehicles, the ones the line needs soonest first. */
    function moves(s) {
      if (s.parked.length >= slots) return [];
      const free = [], blocks = new Map();
      for (let id = 0; id < cars.length; id++) {
        if (!s.inGrid[id]) continue;
        const b = TK.firstBlocker(cars[id], W, H, s.occ).blocker;
        if (b < 0) free.push(id);
        else blocks.set(b, (blocks.get(b) || 0) + 1);
      }
      // seats already parked for each colour serve the next passengers of that colour first
      const spare = new Map();
      for (const p of s.parked) {
        const c = cars[p.id].color;
        spare.set(c, (spare.get(c) || 0) + cars[p.id].cap - p.filled);
      }
      const need = new Map();
      const needAt = (color) => {
        if (need.has(color)) return need.get(color);
        let skip = spare.get(color) || 0, at = queue.length;
        for (let i = s.head; i < queue.length; i++) {
          if (queue[i] === color && skip-- === 0) { at = i; break; }
        }
        need.set(color, at);
        return at;
      };
      return free
        .map((id) => ({ id, at: needAt(cars[id].color), opens: blocks.get(id) || 0 }))
        .sort((a, b) => a.at - b.at || b.opens - a.opens)
        .map((m) => m.id);
    }

    function frame(s, move) { return { s, move, list: moves(s), i: 0 }; }

    /** Searches for up to `ms` milliseconds. Returns the result, or null if not finished yet. */
    function run(ms) {
      const deadline = Date.now() + ms;
      while (!result) {
        if ((++explored & 63) === 0 && Date.now() > deadline) return null;
        const f = stack[stack.length - 1];
        if (!f) { result = { status: 'unsolvable' }; break; }
        if (f.i >= f.list.length) {
          dead.add(key(f.s));
          stack.pop();
          continue;
        }
        const next = tap(f.s, f.list[f.i++]);
        if (isWin(next)) {
          result = { status: 'solved', moves: stack.slice(1).map((g) => g.move).concat(f.list[f.i - 1]) };
          break;
        }
        if (dead.has(key(next))) continue;
        stack.push(frame(next, f.list[f.i - 1]));
      }
      return result;
    }

    return { run, get explored() { return explored; } };
  }

  /**
   * Solves in time slices, yielding to the page between them.
   * Resolves to { status: 'solved', moves } | { status: 'unsolvable' } | { status: 'timeout' } | { status: 'cancelled' }.
   */
  function solve(board, { timeLimit = 10000, slice = 12, signal } = {}) {
    const search = createSearch(board);
    const t0 = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (signal && signal.aborted) return resolve({ status: 'cancelled' });
        const left = timeLimit - (Date.now() - t0);
        if (left <= 0) return resolve({ status: 'timeout' });
        const r = search.run(Math.min(slice, left));
        if (r) return resolve(r);
        setTimeout(tick, 0);
      };
      tick();
    });
  }

  const api = { createSearch, solve };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TKSolver = api;
})(typeof window !== 'undefined' ? window : globalThis);
