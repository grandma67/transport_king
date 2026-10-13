// Plays generated levels with the game's rules to check that each one can be won.
// Run: node tests/levels.test.js [levelCount]
'use strict';
const assert = require('assert');
const TK = require('../js/levels.js');

const count = Number(process.argv[2]) || 500;
let totalCars = 0;
const shapes = {};

for (let n = 1; n <= count; n++) {
  const lv = TK.generateLevel(n);
  const again = TK.generateLevel(n);
  assert.deepStrictEqual(lv, again, `level ${n} is not deterministic`);
  assert.ok(lv.cars.length >= 3, `level ${n} has only ${lv.cars.length} cars`);
  shapes[lv.shape] = (shapes[lv.shape] || 0) + 1;
  totalCars += lv.cars.length;

  // passengers per colour == seats per colour
  const seats = {}, riders = {};
  for (const c of lv.cars) seats[c.color] = (seats[c.color] || 0) + c.cap;
  for (const col of lv.queue) riders[col] = (riders[col] || 0) + 1;
  assert.deepStrictEqual(riders, seats, `level ${n} passenger/seat mismatch`);

  // Bot: follow the solution order lazily, only taking a car when the front
  // passenger has no car to board. It must never need more than `slots` spots.
  const cars = lv.cars.map((c) => ({ ...c, gone: false }));
  const occ = TK.buildOcc(cars, lv.W, lv.H);
  const parked = [];
  let next = 0;
  for (const color of lv.queue) {
    let car = parked.find((c) => c.color === color);
    while (!car) {
      assert.ok(next < lv.solution.length, `level ${n}: ran out of cars`);
      const c = cars[lv.solution[next++]];
      assert.strictEqual(TK.firstBlocker(c, lv.W, lv.H, occ).blocker, -1, `level ${n}: car ${c.id} blocked`);
      assert.ok(parked.length < lv.slots, `level ${n}: parking overflow`);
      for (const [x, y] of TK.carCells(c)) occ[y * lv.W + x] = -1;
      c.filled = 0;
      parked.push(c);
      if (c.color === color) car = c;
    }
    if (++car.filled === car.cap) parked.splice(parked.indexOf(car), 1);
  }
  assert.strictEqual(parked.length, 0, `level ${n}: cars left in parking`);
}

console.log(`OK: ${count} levels solvable, avg ${(totalCars / count).toFixed(1)} cars/level`);
console.log('shapes:', shapes);
