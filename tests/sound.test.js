// Sound effects: every theme can play every sound, mute works, and the Web Audio
// calls are valid (e.g. exponential ramps never target 0, which throws in browsers).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'sound.js'), 'utf8');
const storeSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'storage.js'), 'utf8');

/** A strict fake of the Web Audio API that records what gets scheduled. */
function fakeAudio() {
  const log = { sources: [], gains: [], contexts: 0, resumed: 0 };
  const param = (value = 0) => ({
    value,
    setValueAtTime(v, t) { assert.ok(Number.isFinite(v) && Number.isFinite(t) && t >= 0, 'setValueAtTime'); this.value = v; },
    exponentialRampToValueAtTime(v, t) {
      assert.ok(v > 0, `exponential ramp to ${v} would throw in a browser`);
      assert.ok(Number.isFinite(t) && t >= 0);
      this.value = v;
    },
    linearRampToValueAtTime(v, t) { assert.ok(Number.isFinite(v) && Number.isFinite(t)); this.value = v; },
    cancelScheduledValues(t) { assert.ok(Number.isFinite(t) && t >= 0); },
  });
  const node = (extra = {}) => ({ connect(dest) { assert.ok(dest, 'connect target'); this.out = dest; }, ...extra });
  const source = (kind, extra) => {
    const s = node({
      kind,
      start(t) { assert.ok(t >= 0); this.startAt = t; },
      stop(t) { assert.ok(t >= (this.startAt ?? 0), 'stop before start'); this.stopAt = t; },
      ...extra,
    });
    log.sources.push(s);
    return s;
  };
  class AudioContext {
    constructor() { log.contexts++; log.ctx = this; this.currentTime = 1; this.sampleRate = 8000; this.state = 'suspended'; this.destination = { dest: true }; }
    resume() { log.resumed++; this.state = 'running'; return Promise.resolve(); }
    createOscillator() { return source('osc', { type: 'sine', frequency: param(440) }); }
    createBufferSource() { return source('noise', { buffer: null, loop: false }); }
    createGain() { const g = node({ gain: param(1) }); log.gains.push(g); return g; }
    createBiquadFilter() { return node({ type: 'lowpass', frequency: param(350), Q: param(1) }); }
    createDynamicsCompressor() { return node(); }
    createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
  }
  return { AudioContext, log };
}

function load({ stored = null, audio = true, dom = false, withStore = true } = {}) {
  const fake = fakeAudio();
  const storage = new Map(stored == null ? [] : [['transport-king.save', JSON.stringify(stored)]]);
  const timers = new Map();
  let timerId = 0;
  const win = {
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    setTimeout, // storage.js gives IndexedDB a deadline; there is none here
    setInterval: (fn) => (timers.set(++timerId, fn), timerId),
    clearInterval: (id) => timers.delete(id),
  };
  if (audio) win.AudioContext = fake.AudioContext;
  const listeners = new Map();
  if (dom) {
    win.navigator = { audioSession: { type: 'auto' } };
    win.document = {
      addEventListener: (ev, fn) => listeners.set(ev, fn),
      removeEventListener: (ev, fn) => { if (listeners.get(ev) === fn) listeners.delete(ev); },
    };
  }
  win.window = win;
  vm.createContext(win);
  if (withStore) vm.runInContext(storeSrc, win);
  vm.runInContext(src, win);
  /** Runs the music scheduler as if `sec` seconds of audio time passed. */
  const advance = (sec) => {
    for (let t = 0; t < sec; t += 0.1) {
      if (fake.log.ctx) fake.log.ctx.currentTime += 0.1;
      for (const fn of [...timers.values()]) fn();
    }
  };
  return { S: win.TKSound, log: fake.log, storage, win, listeners, timers, advance };
}

test('every theme has its own select, drive and board sounds', () => {
  const { S } = load();
  assert.deepEqual([...S.THEMES].sort(), ['candy', 'city', 'harbor', 'pets', 'school', 'space']);
  const game = fs.readFileSync(path.join(__dirname, '..', 'js', 'game.js'), 'utf8');
  const used = [...game.matchAll(/sound: '([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(used.sort(), [...S.THEMES].sort(), 'every game theme maps to a sound bank');
});

test('all sounds play in all themes with valid Web Audio calls', () => {
  const { S, log } = load();
  for (const t of S.THEMES) {
    assert.equal(S.setTheme(t), t);
    for (const name of S.SOUNDS) {
      const before = log.sources.length;
      assert.equal(S.play(name, { dur: 0.9, seat: 3 }), true, `${t}/${name}`);
      const made = log.sources.slice(before);
      assert.ok(made.length > 0, `${t}/${name} scheduled nothing`);
      for (const s of made) {
        assert.ok(s.startAt >= 1 && s.stopAt > s.startAt, `${t}/${name} source not started and stopped`);
        assert.ok(s.stopAt - s.startAt < 4, `${t}/${name} plays too long`);
      }
    }
  }
  // volume gains feed other nodes; vibrato depth gains feed a frequency (in Hz) and may exceed 1
  for (const g of log.gains.filter((g) => g.out && g.out.connect)) assert.ok(g.gain.value <= 1, 'gain above 1 would clip');
  assert.equal(log.contexts, 1, 'one shared AudioContext');
});

test('themes sound different from each other', () => {
  const { S, log } = load();
  const signature = (t, name) => {
    S.setTheme(t);
    const before = log.sources.length;
    S.play(name, { dur: 1, seat: 0 });
    return JSON.stringify(log.sources.slice(before).map((s) => [s.kind, s.type, s.frequency && Math.round(s.frequency.value)]));
  };
  for (const name of ['select', 'drive', 'board']) {
    const sigs = new Set(S.THEMES.map((t) => signature(t, name)));
    assert.equal(sigs.size, S.THEMES.length, `${name} is not unique per theme`);
  }
});

test('boarding climbs in pitch as seats fill', () => {
  const { S, log } = load();
  S.setTheme('city');
  const pitch = (seat) => {
    const before = log.sources.length;
    S.play('board', { seat });
    return log.sources[before].frequency.value;
  };
  const first = pitch(0), later = pitch(5);
  assert.ok(later > first);
});

test('drive sound lasts as long as the drive', () => {
  const { S, log } = load();
  S.setTheme('space');
  for (const dur of [0.5, 1.5]) {
    const before = log.sources.length;
    S.play('drive', { dur });
    const longest = Math.max(...log.sources.slice(before).map((s) => s.stopAt - s.startAt));
    assert.ok(Math.abs(longest - dur) < 0.1, `drive of ${dur}s lasted ${longest}s`);
  }
});

const saved = (storage) => JSON.parse(storage.get('transport-king.save'));

test('mute stops all sound and is saved in this game\'s own storage', () => {
  const { S, log, storage } = load();
  assert.equal(S.muted, false);
  assert.equal(S.toggle(), true);
  assert.equal(saved(storage).muted, true);
  const before = log.sources.length;
  assert.equal(S.play('select'), false);
  assert.equal(log.sources.length, before);
  assert.equal(S.history.at(-1).played, false);
  S.toggle();
  assert.equal(saved(storage).muted, false);
  assert.equal(S.play('select'), true);
  assert.deepEqual([...storage.keys()], ['transport-king.save']);

  const again = load({ stored: { muted: true } });
  assert.equal(again.S.muted, true);
  assert.equal(again.S.play('win'), false);
  assert.equal(again.log.contexts, 0, 'no AudioContext is created while muted');
});

test('unknown themes and sounds are harmless', () => {
  const { S } = load();
  assert.equal(S.setTheme('nope'), 'city');
  assert.equal(S.play('does-not-exist'), false);
});

test('without Web Audio support the game still runs silently', () => {
  const { S } = load({ audio: false });
  assert.equal(S.play('select'), false);
  assert.equal(S.history.length, 1);
});

test('sound.js is loaded by the page and precached for offline play', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.indexOf('js/sound.js') > 0 && html.indexOf('js/sound.js') < html.indexOf('js/game.js'), 'sound.js loads before game.js');
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /'\.\/js\/sound\.js'/);
});

test('audio unlocks on a real gesture (touchend, not touch pointerdown) and plays through the iOS silent switch', () => {
  const { log, win, listeners } = load({ dom: true });
  assert.equal(win.navigator.audioSession.type, 'playback');
  assert.ok(!listeners.has('pointerdown'), 'touch pointerdown is not a user activation');
  for (const ev of ['touchend', 'pointerup', 'click']) assert.ok(listeners.has(ev), ev);
  listeners.get('touchend')();
  assert.equal(log.contexts, 1);
  assert.ok(log.resumed >= 1, 'context resumed inside the gesture');
  assert.ok(log.sources.some((s) => s.kind === 'noise' && s.out && s.out.dest), 'silent buffer played to unlock iOS');
  assert.deepEqual([...listeners.keys()], ['visibilitychange'], 'gesture listeners removed once audio is running');
});

test('muted players do not unlock audio on tap', () => {
  const { log, listeners } = load({ dom: true, stored: { muted: true } });
  listeners.get('click')();
  assert.equal(log.contexts, 0);
  assert.ok(listeners.size > 0, 'still waiting to unlock after unmuting');
});

test('background music starts after a tap, loops in time and can be turned off and on', async () => {
  const { S, log, listeners, timers, advance, storage } = load({ dom: true });
  await new Promise((r) => setImmediate(r));
  assert.equal(S.music, true, 'music is on by default');
  assert.equal(S.musicPlaying, false, 'no music before the first gesture');
  listeners.get('click')();
  assert.equal(S.musicPlaying, true);
  const before = log.sources.length;
  advance(4);
  const notes = log.sources.slice(before).filter((s) => s.kind === 'osc');
  // City Rush: 112 bpm eighth notes (~15 in 4s) plus a bass note every half bar
  assert.ok(notes.length >= 15 && notes.length <= 24, `${notes.length} notes in 4s`);
  for (const n of notes) assert.ok(n.stopAt - n.startAt < 1.5, 'music notes end');
  assert.equal(S.history.length, 0, 'music is not a sound effect');

  assert.equal(S.toggleMusic(), false);
  assert.equal(S.musicPlaying, false);
  assert.equal(timers.size, 0, 'scheduler stopped');
  assert.equal(saved(storage).music, false, 'choice is saved');
  const after = log.sources.length;
  advance(1);
  assert.equal(log.sources.length, after, 'silence after turning music off');

  S.toggleMusic();
  assert.equal(S.musicPlaying, true);
  S.setMuted(true);
  assert.equal(S.musicPlaying, false, 'the sound button mutes music too');
  S.setMuted(false);
  assert.equal(S.musicPlaying, true);
});

test('every theme has its own music', () => {
  const { S, log, listeners, advance } = load({ dom: true });
  listeners.get('click')();
  const tunes = new Set();
  for (const t of S.THEMES) {
    S.setTheme(t);
    S.toggleMusic(); S.toggleMusic(); // restart the loop on this theme
    const before = log.sources.length;
    advance(2);
    tunes.add(log.sources.slice(before).filter((s) => s.kind === 'osc').map((s) => Math.round(s.frequency.value)).join(','));
  }
  assert.equal(tunes.size, S.THEMES.length);
});

test('music stays off with the music preference saved as off', () => {
  const { S, listeners } = load({ dom: true, stored: { music: false } });
  listeners.get('click')();
  assert.equal(S.music, false);
  assert.equal(S.musicPlaying, false);
});

test('sound.js still works without storage.js', () => {
  const { S } = load({ withStore: false });
  assert.equal(S.toggle(), true);
  assert.equal(S.play('select'), false);
});
