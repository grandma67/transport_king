// Saved progress: valid data only, old keys migrated, and nothing outside this
// game's own namespace is ever touched (other games share the origin).
// The real IndexedDB path is covered by the end-to-end tests in Chrome.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'storage.js'), 'utf8');

function load(entries = {}) {
  const storage = new Map(Object.entries(entries));
  const win = {
    setTimeout,
    localStorage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
      clear: () => assert.fail('must never clear the shared localStorage'),
    },
  };
  win.window = win;
  vm.runInNewContext(src, win);
  return { S: win.TKStore, storage };
}
const OTHER = { 'other-game.level': '42', 'theme': 'dark' };

test('a new player starts on level 1 with sound and music on', async () => {
  const { S, storage } = load();
  await S.ready;
  assert.deepEqual([S.get('level'), S.get('max'), S.get('muted'), S.get('music')], [1, 1, false, true]);
  assert.equal(storage.size, 0, 'nothing is written until something changes');
});

test('progress and preferences are saved and restored', async () => {
  const a = load(OTHER);
  a.S.set({ max: 7, level: 5, muted: true, music: false });
  const b = load(Object.fromEntries(a.storage));
  await b.S.ready;
  assert.deepEqual([b.S.get('level'), b.S.get('max'), b.S.get('muted'), b.S.get('music')], [5, 7, true, false]);
});

test('only this game\'s own keys are written, and other games\' keys are left alone', () => {
  const { S, storage } = load(OTHER);
  S.set({ max: 3, level: 2 });
  S.set({ muted: true });
  assert.deepEqual([...storage.keys()].filter((k) => !(k in OTHER)), ['transport-king.save']);
  for (const [k, v] of Object.entries(OTHER)) assert.equal(storage.get(k), v);
  assert.ok(S.DB_NAME === 'transport-king' && S.LS_KEY.startsWith('transport-king.'));
});

test('old saves (transport-king.level/max/muted) are migrated and their keys removed', () => {
  const { S, storage } = load({ ...OTHER, 'transport-king.level': '4', 'transport-king.max': '6', 'transport-king.muted': '1' });
  assert.deepEqual([S.get('level'), S.get('max'), S.get('muted')], [4, 6, true]);
  assert.deepEqual([...storage.keys()].sort(), [...Object.keys(OTHER), 'transport-king.save'].sort());
});

test('broken or tampered data falls back to safe values', () => {
  for (const bad of ['{not json', '"x"', 'null', JSON.stringify({ level: -3, max: 'lots', muted: 'yes', music: 0 })]) {
    const { S } = load({ 'transport-king.save': bad });
    assert.deepEqual([S.get('level'), S.get('max'), S.get('muted'), S.get('music')], [1, 1, false, true], bad);
  }
  const { S } = load({ 'transport-king.save': JSON.stringify({ level: 9, max: 4 }) });
  assert.equal(S.get('level'), 4, 'level can\'t be past the unlocked levels');
});

test('works when storage is blocked entirely', async () => {
  const win = { setTimeout };
  Object.defineProperty(win, 'localStorage', { get() { throw new Error('SecurityError'); } });
  win.window = win;
  vm.runInNewContext(src, win);
  await win.TKStore.ready;
  win.TKStore.set({ level: 1, max: 2 });
  assert.equal(win.TKStore.get('max'), 2, 'kept in memory for this session');
});

test('storage.js loads first and is precached for offline play', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const at = (f) => html.indexOf(`js/${f}.js`);
  assert.ok(at('storage') > 0 && at('storage') < at('sound') && at('sound') < at('game'));
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /'\.\/js\/storage\.js'/);
});
