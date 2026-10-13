/*
 * Transport King — sound effects.
 *
 * Every sound is synthesised with the Web Audio API (no audio files), so the
 * game stays tiny and works offline. Each theme has its own bank:
 *   select  vehicle tapped and free to go     drive  vehicle driving to its spot
 *   board   passenger gets in (pitch climbs as seats fill)
 * Shared sounds: bump (blocked), nospot, full, win, lose.
 * Each theme also has a soft background music loop, toggled separately.
 * Preferences are saved through TKStore (storage.js) when it is loaded.
 */
(function (root) {
  'use strict';

  const AC = root.AudioContext || root.webkitAudioContext;
  const memory = { muted: false, music: true };
  const store = root.TKStore || { get: (k) => memory[k], set: (c) => Object.assign(memory, c), ready: Promise.resolve() };

  let ctx = null, master = null, noiseBuf = null;
  let theme = 'city';
  let unlocked = false; // audio has started inside a user gesture
  const isMuted = () => !!store.get('muted');
  const musicOn = () => !!store.get('music');
  const history = []; // recent sounds, for tests and debugging

  function ensure() {
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => { /* needs a user gesture */ });
    return ctx;
  }

  function noiseBuffer() {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  // ---------- building blocks ----------
  function envelope(t, dur, vol, attack, dest) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(dest || master);
    return g;
  }

  /** One oscillator: optional pitch glide, vibrato and low-pass filter. */
  function tone({ type = 'sine', f, to, at = 0, dur = 0.15, vol = 0.2, attack = 0.006, vib = 0, rate = 6, filter, out: dest }) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    if (vib) {
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = rate;
      depth.gain.value = vib;
      lfo.connect(depth);
      depth.connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    let out = o;
    if (filter) {
      const fl = ctx.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.value = filter;
      o.connect(fl);
      out = fl;
    }
    out.connect(envelope(t, dur, vol, attack, dest));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Filtered white noise: engines, whooshes, water. */
  function noise({ at = 0, dur = 0.3, vol = 0.15, type = 'bandpass', f = 1000, to, q = 1, attack = 0.02 }) {
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    src.loop = true;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t);
    if (to) fl.frequency.exponentialRampToValueAtTime(to, t + dur);
    src.connect(fl);
    fl.connect(envelope(t, dur, vol, attack));
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  // Major pentatonic: seats filling up always sound pleasant together.
  const PENTA = [0, 2, 4, 7, 9];
  const note = (base, step) => base * Math.pow(2, (PENTA[step % 5] + 12 * Math.floor(step / 5)) / 12);
  const seat = (o) => Math.max(0, Math.min(14, o.seat || 0));
  const driveLen = (o) => Math.max(0.3, Math.min(2.5, o.dur || 0.8));

  // ---------- theme banks ----------
  const BANKS = {
    // City Rush: car horn, engine rev, a soft pop per passenger
    city: {
      select() {
        for (const at of [0, 0.14]) {
          tone({ type: 'square', f: 440, at, dur: 0.1, vol: 0.07, filter: 1800 });
          tone({ type: 'square', f: 554, at, dur: 0.1, vol: 0.07, filter: 1800 });
        }
      },
      drive(o) {
        const d = driveLen(o);
        tone({ type: 'sawtooth', f: 55, to: 120, dur: d, vol: 0.1, attack: 0.05, filter: 420 });
        noise({ type: 'lowpass', f: 300, to: 700, dur: d, vol: 0.05 });
      },
      board(o) { tone({ f: note(660, seat(o)), to: note(660, seat(o)) * 1.5, dur: 0.09, vol: 0.14 }); },
    },
    // Space Port: laser blip, rocket whoosh, sci-fi bloop
    space: {
      select() {
        tone({ type: 'square', f: 1500, to: 300, dur: 0.16, vol: 0.06, filter: 3000 });
        tone({ type: 'sine', f: 900, to: 1800, at: 0.05, dur: 0.12, vol: 0.08 });
      },
      drive(o) {
        const d = driveLen(o);
        noise({ f: 300, to: 3200, q: 0.8, dur: d, vol: 0.16, attack: 0.08 });
        tone({ type: 'sine', f: 160, to: 900, dur: d, vol: 0.07, attack: 0.08 });
      },
      board(o) {
        const f = note(520, seat(o));
        tone({ type: 'triangle', f, to: f * 2, dur: 0.12, vol: 0.12 });
        tone({ type: 'sine', f: f * 3, at: 0.03, dur: 0.06, vol: 0.04 });
      },
    },
    // Harbor Hop: fog horn, splashing water, penguin squeak
    harbor: {
      select() {
        tone({ type: 'sawtooth', f: 110, dur: 0.38, vol: 0.12, attack: 0.04, filter: 600 });
        tone({ type: 'sawtooth', f: 165, dur: 0.38, vol: 0.08, attack: 0.04, filter: 600 });
      },
      drive(o) {
        const d = driveLen(o);
        noise({ type: 'lowpass', f: 1200, to: 400, q: 0.7, dur: d, vol: 0.14, attack: 0.06 });
        for (let i = 0; i < 4; i++) {
          const f = 380 + ((i * 197) % 500);
          tone({ type: 'sine', f, to: f * 1.8, at: (d * i) / 4, dur: 0.06, vol: 0.06 });
        }
      },
      board(o) {
        const f = note(880, seat(o));
        tone({ type: 'sine', f, to: f * 1.35, dur: 0.06, vol: 0.12 });
        tone({ type: 'sine', f: f * 1.2, to: f * 1.6, at: 0.07, dur: 0.05, vol: 0.09 });
      },
    },
    // Pet Express: little truck honk, putt-putt engine, a meow
    pets: {
      select() {
        tone({ type: 'square', f: 330, dur: 0.09, vol: 0.08, filter: 1500 });
        tone({ type: 'square', f: 392, at: 0.1, dur: 0.12, vol: 0.08, filter: 1500 });
      },
      drive(o) {
        const d = driveLen(o);
        tone({ type: 'square', f: 38, to: 70, dur: d, vol: 0.08, attack: 0.04, filter: 260, vib: 6, rate: 14 });
        noise({ type: 'lowpass', f: 250, dur: d, vol: 0.05 });
      },
      board(o) {
        const f = note(560, seat(o));
        tone({ type: 'triangle', f, to: f * 1.5, dur: 0.08, vol: 0.12, filter: 2400 });
        tone({ type: 'triangle', f: f * 1.5, to: f * 0.9, at: 0.08, dur: 0.12, vol: 0.1, filter: 2400, vib: 15, rate: 22 });
      },
    },
    // Candy Land: boing, wobbly jelly drive, sparkly bell
    candy: {
      select() { tone({ type: 'sine', f: 180, to: 640, dur: 0.26, vol: 0.16, vib: 35, rate: 18 }); },
      drive(o) {
        const d = driveLen(o);
        tone({ type: 'sine', f: 260, to: 520, dur: d, vol: 0.09, attack: 0.05, vib: 45, rate: 7 });
        tone({ type: 'sine', f: 1568, at: d - 0.12, dur: 0.12, vol: 0.05 });
      },
      board(o) {
        const f = note(1046, seat(o));
        tone({ type: 'sine', f, dur: 0.22, vol: 0.1 });
        tone({ type: 'sine', f: f * 2, dur: 0.12, vol: 0.035 });
      },
    },
    // School Run: two-tone bus horn, diesel rumble, school-bell ding
    school: {
      select() {
        tone({ type: 'sawtooth', f: 233, dur: 0.26, vol: 0.08, attack: 0.02, filter: 1200 });
        tone({ type: 'sawtooth', f: 294, dur: 0.26, vol: 0.08, attack: 0.02, filter: 1200 });
      },
      drive(o) {
        const d = driveLen(o);
        tone({ type: 'sawtooth', f: 45, to: 95, dur: d, vol: 0.1, attack: 0.06, filter: 360 });
        tone({ type: 'square', f: 90, to: 140, dur: d, vol: 0.03, attack: 0.06, filter: 220 });
      },
      board(o) {
        const f = note(784, seat(o));
        tone({ type: 'triangle', f, dur: 0.2, vol: 0.12 });
        tone({ type: 'sine', f: f * 2.4, dur: 0.08, vol: 0.03 });
      },
    },
  };

  const SHARED = {
    bump() {
      tone({ type: 'sine', f: 130, to: 55, dur: 0.14, vol: 0.28 });
      noise({ type: 'lowpass', f: 500, dur: 0.07, vol: 0.12, attack: 0.003 });
    },
    nospot() {
      tone({ type: 'square', f: 150, dur: 0.12, vol: 0.07, filter: 900 });
      tone({ type: 'square', f: 140, at: 0.15, dur: 0.16, vol: 0.07, filter: 900 });
    },
    full() {
      [0, 2, 4].forEach((s, i) => tone({ type: 'triangle', f: note(660, s + 5), at: i * 0.06, dur: 0.16, vol: 0.09 }));
    },
    win() {
      [523, 659, 784, 1046, 1318].forEach((f, i) => tone({ type: 'triangle', f, at: i * 0.1, dur: 0.3, vol: 0.12 }));
      tone({ type: 'sine', f: 2093, at: 0.5, dur: 0.5, vol: 0.05, vib: 20, rate: 9 });
    },
    lose() {
      [[392, 370], [370, 349], [349, 262]].forEach(([f, to], i) =>
        tone({ type: 'sawtooth', f, to, at: i * 0.32, dur: i === 2 ? 0.7 : 0.3, vol: 0.09, filter: 1100, vib: i === 2 ? 8 : 0, rate: 5 }));
    },
  };

  // ---------- background music ----------
  // A gentle I-V-vi-IV loop in eighth notes: an arpeggio over a soft bass,
  // with each theme's own tempo, key and instrument. Notes are scheduled a
  // little ahead on the audio clock so timing stays steady.
  const CHORDS = [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]];
  const MUSIC = {
    city:   { bpm: 112, root: 262, wave: 'triangle', arp: [0, 1, 2, 1, 0, 1, 2, 3], vol: 0.05 },
    space:  { bpm: 88,  root: 220, wave: 'sine',     arp: [0, 2, 3, 2, 1, 2, 3, 2], vol: 0.06, filter: 2400 },
    harbor: { bpm: 96,  root: 196, wave: 'triangle', arp: [0, 1, 2, 3, 2, 1, 0, 1], vol: 0.05 },
    pets:   { bpm: 120, root: 294, wave: 'square',   arp: [0, 2, 1, 2, 0, 2, 1, 3], vol: 0.025, filter: 1400 },
    candy:  { bpm: 126, root: 349, wave: 'sine',     arp: [0, 1, 2, 3, 2, 3, 1, 2], vol: 0.06 },
    school: { bpm: 108, root: 247, wave: 'triangle', arp: [0, 2, 1, 2, 0, 2, 3, 2], vol: 0.05 },
  };
  const music = { gain: null, timer: null, next: 0, step: 0 };
  const semis = (base, n) => base * Math.pow(2, n / 12);

  function musicStep(step, t) {
    const m = MUSIC[theme] || MUSIC.city;
    const chord = CHORDS[Math.floor(step / 8) % CHORDS.length];
    const i = m.arp[step % 8];
    const n = chord[i % 3] + (i >= 3 ? 12 : 0);
    const len = 60 / m.bpm / 2;
    const at = Math.max(0, t - ctx.currentTime);
    tone({ type: m.wave, f: semis(m.root, n), at, dur: len * 0.9, vol: m.vol, attack: 0.01, filter: m.filter, out: music.gain });
    if (step % 4 === 0) {
      tone({ type: 'sine', f: semis(m.root / 2, chord[0]), at, dur: len * 3.6, vol: m.vol * 1.4, attack: 0.02, out: music.gain });
    }
  }
  function musicTick() {
    if (!ctx) return;
    const len = 60 / (MUSIC[theme] || MUSIC.city).bpm / 2;
    if (music.next < ctx.currentTime) music.next = ctx.currentTime + 0.05; // fell behind (tab was asleep)
    while (music.next < ctx.currentTime + 0.3) {
      try { musicStep(music.step, music.next); } catch (e) { /* never let audio break the game */ }
      music.next += len;
      music.step++;
    }
  }
  const hidden = () => !!(root.document && root.document.hidden);
  function updateMusic() {
    const want = unlocked && musicOn() && !isMuted() && !hidden() && !!AC;
    if (want && !music.timer) {
      if (!ensure()) return;
      if (!music.gain) { music.gain = ctx.createGain(); music.gain.connect(master); }
      const g = music.gain.gain, t = ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0.0001, t);
      g.exponentialRampToValueAtTime(1, t + 0.8);
      music.next = t + 0.1;
      music.step = 0;
      musicTick();
      music.timer = root.setInterval(musicTick, 100);
    } else if (!want && music.timer) {
      root.clearInterval(music.timer);
      music.timer = null;
      const g = music.gain.gain, t = ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.exponentialRampToValueAtTime(0.0001, t + 0.25);
    }
  }

  const SOUNDS = ['select', 'drive', 'board', 'bump', 'nospot', 'full', 'win', 'lose'];

  /** Plays a sound for the current theme. Returns whether anything was scheduled. */
  function play(name, opts = {}) {
    const entry = { name, theme, played: false };
    history.push(entry);
    if (history.length > 100) history.shift();
    if (isMuted() || !ensure()) return false;
    const fn = (BANKS[theme] && BANKS[theme][name]) || SHARED[name];
    if (!fn) return false;
    try { fn(opts); entry.played = true; } catch (e) { /* never let audio break the game */ }
    return entry.played;
  }

  function setMuted(m) {
    store.set({ muted: !!m });
    if (!isMuted()) ensure();
    updateMusic();
    return isMuted();
  }
  function setMusic(on) {
    store.set({ music: !!on });
    updateMusic();
    return musicOn();
  }

  // iOS silences Web Audio with the ring/silent switch unless the page asks
  // for media playback (Safari 17+). The in-game mute button still works.
  try { if (root.navigator && root.navigator.audioSession) root.navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }

  // Browsers only start audio inside a user gesture. A touch pointerdown is
  // not one, so listen to the events that are and keep listening until the
  // context is actually running. Playing a silent buffer unlocks older iOS.
  function unlock() {
    unlocked = true; // a gesture happened, so music may start once unmuted
    if (isMuted() || !ensure()) return;
    updateMusic();
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) { /* ignore */ }
    if (ctx.state === 'running') {
      for (const ev of UNLOCK_EVENTS) root.document.removeEventListener(ev, unlock, true);
    }
  }
  const UNLOCK_EVENTS = ['pointerup', 'touchend', 'mousedown', 'keydown', 'click'];
  if (root.document) {
    for (const ev of UNLOCK_EVENTS) root.document.addEventListener(ev, unlock, true);
    root.document.addEventListener('visibilitychange', updateMusic);
  }
  store.ready.then(updateMusic, () => { /* ignore */ });

  root.TKSound = {
    THEMES: Object.keys(BANKS),
    SOUNDS,
    history,
    play,
    setTheme(k) { theme = BANKS[k] ? k : 'city'; music.step = 0; return theme; },
    get theme() { return theme; },
    get muted() { return isMuted(); },
    setMuted,
    toggle() { return setMuted(!isMuted()); },
    get music() { return musicOn(); },
    /** Whether music is actually playing right now. */
    get musicPlaying() { return !!music.timer; },
    setMusic,
    toggleMusic() { return setMusic(!musicOn()); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
