// End-to-end: real headless Chrome (via the DevTools protocol, no npm deps) plays the
// game served from a /transport_king/ subfolder, like GitHub Pages does.
// Needs Chrome; set CHROME_PATH if it is not in a standard location.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.join(import.meta.dirname, '..');
const BASE = '/transport_king/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chromePath = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => p && fs.existsSync(p));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

let server, chrome, profile, ws, origin;
const pending = new Map();
const pageErrors = [];
let msgId = 0;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function js(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function until(expression, timeout = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await js(expression);
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for: ${expression}`);
    await sleep(50);
  }
}
let loads = 0;
/** Loads the page fresh. A unique query makes it a real load, not a same-page hash change. */
async function open(url) {
  const u = new URL(url);
  u.searchParams.set('load', String(++loads));
  await send('Page.navigate', { url: u.href });
  await until(`location.search === '?load=${loads}' && document.readyState === 'complete' && !!window.TKDebug`);
}
const startLevel = (n) => js(`TKDebug.startLevel(${n}), true`);

/** Plays the stored solution through real clicks; returns how the level ended. */
const PLAY = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const g = TKDebug.game();
  let next = 0; const t0 = Date.now();
  while (!g.over && Date.now() - t0 < 90000) {
    const busy = g.cars.filter((c) => c.state === 'arriving' || (c.state === 'parked' && c.filled < c.cap)).length;
    if (next < g.data.solution.length && busy < g.data.window) {
      const c = g.cars[g.data.solution[next]];
      c.el.click();
      if (c.state !== 'grid') next++;
    }
    await sleep(40);
  }
  await sleep(500);
  return { over: g.over, won: !!document.querySelector('[data-act=next]'),
           lost: !!document.querySelector('[data-act=retry]'), carsLeft: g.cars.filter((c) => c.state !== 'gone').length };
})()`;

before(async () => {
  if (!chromePath) return;
  server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (!url.startsWith(BASE)) { res.writeHead(404); return res.end(); }
    let file = path.join(root, url.slice(BASE.length) || 'index.html');
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;

  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-e2e-'));
  chrome = spawn(chromePath, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
    if (!target) await sleep(100);
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await open(`${origin}${BASE}#debug`);
});

after(async () => {
  ws?.close();
  chrome?.kill();
  server?.close();
  if (profile) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
});

const e2e = (name, opts, fn) => {
  if (!fn) [fn, opts] = [opts, {}];
  return test(name, { ...opts, skip: !chromePath && 'Chrome not found (set CHROME_PATH)' }, fn);
};

e2e('loads with the menu open and no errors', async () => {
  assert.equal(await js(`document.title`), 'Transport King');
  assert.ok(await js(`!!document.querySelector('#overlay [data-act=play]')`));
  assert.deepEqual(pageErrors, []);
});

e2e('is installable, with a service worker scoped to its own folder', async () => {
  const scope = await until(`navigator.serviceWorker.ready.then((r) => r.scope)`);
  assert.equal(scope, `${origin}${BASE}`);
  const cacheNames = await until(`caches.keys().then((k) => k.length && k)`);
  assert.deepEqual(cacheNames, ['transport-king-v' + (await js(`fetch('sw.js').then((r) => r.text()).then((t) => t.match(/VERSION = '([^']+)'/)[1])`)) + '-dev']);
  const { installabilityErrors } = await send('Page.getInstallabilityErrors');
  assert.deepEqual(installabilityErrors, []);
  const manifest = await send('Page.getAppManifest');
  assert.deepEqual(manifest.errors, []);
});

e2e('works offline once loaded', async () => {
  await until(`navigator.serviceWorker.controller !== null || (location.reload(), false)`, 15000);
  await send('Network.enable');
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  try {
    await open(`${origin}${BASE}#debug`);
    assert.ok(await js(`document.querySelectorAll('.car').length > 0`));
  } finally {
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }
});

e2e('play button starts the chosen level', async () => {
  await js(`document.querySelector('[data-act=play]').click(), true`);
  assert.ok(await js(`document.getElementById('overlay').classList.contains('hidden')`));
  assert.match(await js(`document.getElementById('hud-level').textContent`), /^Level \d+$/);
});

e2e('the maze fills most of the screen and the parking strip stays small', async () => {
  for (const n of [1, 9, 20]) {
    await startLevel(n);
    const m = await js(`(() => {
      const s = document.getElementById('stage').getBoundingClientRect();
      const road = document.querySelector('.road').getBoundingClientRect();
      const slot = document.querySelector('.slot').getBoundingClientRect();
      return { stageH: s.height, stageW: s.width, roadH: road.height, roadW: road.width, roadRight: road.right, slotH: slot.height,
               scrollW: document.documentElement.scrollWidth };
    })()`);
    assert.ok(m.roadH / m.stageH > 0.55 || m.roadW / m.stageW > 0.9, `level ${n}: lot too small ${JSON.stringify(m)}`);
    assert.ok(m.slotH / m.stageH < 0.2, `level ${n}: parking strip too tall`);
    assert.ok(m.roadRight <= m.stageW + 1 && m.scrollW <= 390, `level ${n}: horizontal overflow`);
  }
});

e2e('tapping a blocked vehicle does not move it', async () => {
  await startLevel(12);
  const r = await js(`(() => {
    const g = TKDebug.game();
    const c = g.cars.find((c) => TKLevels.firstBlocker(c, g.W, g.H, g.occ).blocker >= 0);
    c.el.click();
    return { state: c.state, free: g.slots.filter((s) => s === null).length, slots: g.K };
  })()`);
  assert.equal(r.state, 'grid');
  assert.equal(r.free, r.slots);
});

e2e('a free vehicle drives into a parking spot', async () => {
  await startLevel(12);
  const id = await js(`(() => {
    const g = TKDebug.game();
    const c = g.cars.find((c) => TKLevels.firstBlocker(c, g.W, g.H, g.occ).blocker < 0);
    c.el.click();
    return c.id;
  })()`);
  assert.equal(await js(`TKDebug.game().cars[${id}].state`), 'arriving');
  assert.equal(await js(`TKDebug.game().slots.indexOf(TKDebug.game().cars[${id}])`), 0);
  await until(`TKDebug.game().cars[${id}].state === 'parked'`);
  assert.ok(await js(`TKDebug.game().cars[${id}].el.classList.contains('parked')`));
});

e2e('the front passenger boards a parked vehicle of their colour', async () => {
  await startLevel(1);
  const id = await js(`(() => {
    const g = TKDebug.game();
    const c = g.cars[g.data.solution.find((i) => g.cars[i].color === g.queue[0] && TKLevels.firstBlocker(g.cars[i], g.W, g.H, g.occ).blocker < 0) ?? g.data.solution[0]];
    c.el.click();
    return c.id;
  })()`);
  await until(`TKDebug.game().head > 0`);
  await until(`TKDebug.game().cars[${id}].filled > 0`);
  assert.equal(await js(`TKDebug.game().queue[0]`), await js(`TKDebug.game().cars[${id}].color`));
});

e2e('a full vehicle drives away and frees its spot', async () => {
  await startLevel(1);
  const id = await js(`TKDebug.game().data.solution[0]`);
  await js(`TKDebug.game().cars[${id}].el.click(), true`);
  // keep feeding the solution until that first vehicle has filled up
  await js(`(async () => {
    const g = TKDebug.game(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let next = 1; const t0 = Date.now();
    while (g.cars[${id}].state !== 'gone' && Date.now() - t0 < 30000) {
      if (g.slots.every((s) => s && s.filled === s.cap) || (g.slots.includes(null) && !g.cars.some((c) => (c.state === 'parked' || c.state === 'arriving') && c.color === g.queue[g.head] && c.reserved < c.cap))) {
        const c = g.cars[g.data.solution[next]]; if (c) { c.el.click(); if (c.state !== 'grid') next++; }
      }
      await sleep(40);
    }
  })()`);
  const car = await js(`(() => { const c = TKDebug.game().cars[${id}]; return { state: c.state, filled: c.filled, cap: c.cap, inSlot: TKDebug.game().slots.includes(c) }; })()`);
  assert.deepEqual(car, { state: 'gone', filled: car.cap, cap: car.cap, inSlot: false });
});

e2e('shows a warning when every spot is taken', async () => {
  // find a level with a single spot and park something in it
  const n = await js(`(() => { for (let n = 2; n < 400; n++) if (TKLevels.generateLevel(n).slots === 1) return n; })()`);
  await startLevel(n);
  const msg = await js(`(async () => {
    const g = TKDebug.game();
    const free = () => g.cars.filter((c) => c.state === 'grid' && TKLevels.firstBlocker(c, g.W, g.H, g.occ).blocker < 0);
    const wrong = free().find((c) => c.color !== g.queue[0]) || free()[0];
    wrong.el.click();
    const other = free()[0];
    other.el.click();
    return { text: document.getElementById('toast').textContent, shown: document.getElementById('toast').classList.contains('show'), otherState: other.state };
  })()`);
  assert.equal(msg.otherState, 'grid');
  assert.ok(msg.shown);
  assert.match(msg.text, /No free parking spot/);
});

e2e('filling every spot with wrong vehicles loses the level', async () => {
  const n = await js(`(() => { for (let n = 5; n < 400; n++) { const l = TKLevels.generateLevel(n); if (l.slots <= 2) return n; } })()`);
  await startLevel(n);
  await js(`(async () => {
    const g = TKDebug.game();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let k = 0; k < 30 && g.slots.includes(null); k++) {
      const c = g.cars.find((c) => c.state === 'grid' && c.color !== g.queue[0] && TKLevels.firstBlocker(c, g.W, g.H, g.occ).blocker < 0);
      if (!c) break;
      c.el.click();
      await sleep(30);
    }
  })()`);
  await until(`!!document.querySelector('[data-act=retry]')`, 15000);
  assert.match(await js(`document.querySelector('.panel h2').textContent`), /Parking full/);
  await js(`document.querySelector('[data-act=retry]').click(), true`);
  assert.equal(await js(`TKDebug.game().n`), n);
  assert.equal(await js(`TKDebug.game().head`), 0);
});

for (const n of [1, 4, 8, 15]) {
  e2e(`level ${n} can be won by playing its solution`, { timeout: 120000 }, async () => {
    await startLevel(n);
    const r = await js(PLAY);
    assert.deepEqual(r, { over: true, won: true, lost: false, carsLeft: 0 });
  });
}

e2e('winning saves progress and unlocks the next level', async () => {
  await startLevel(2);
  const r = await js(PLAY);
  assert.ok(r.won);
  assert.ok(await js(`TKStore.get('max')`) >= 3);
  assert.equal(await js(`TKStore.get('level')`), 3);
  await js(`document.querySelector('[data-act=next]').click(), true`);
  assert.equal(await js(`TKDebug.game().n`), 3);
  await js(`document.getElementById('btn-menu').click(), true`);
  assert.match(await js(`document.querySelector('.lvl-pick span').textContent`), /Level 3/);
});

e2e('themes change between levels', async () => {
  const seen = new Set();
  for (let n = 1; n <= 6; n++) {
    await startLevel(n);
    seen.add(await js(`document.getElementById('hud-theme').textContent + '|' + document.body.style.background`));
  }
  assert.equal(seen.size, 6);
});

e2e('big buses render across two lanes', async () => {
  const n = await js(`(() => { for (let n = 5; n < 400; n++) if (TKLevels.generateLevel(n).cars.some((c) => c.type === 'bigbus')) return n; })()`);
  await startLevel(n);
  const r = await js(`(() => {
    const g = TKDebug.game();
    const c = g.cars.find((c) => c.type === 'bigbus');
    const box = c.el.getBoundingClientRect();
    const cs = document.querySelector('.tile').getBoundingClientRect().width + 2;
    return { short: Math.min(box.width, box.height) / cs, long: Math.max(box.width, box.height) / cs };
  })()`);
  assert.ok(Math.abs(r.short - 2) < 0.1, `wide side is ${r.short} cells`);
  assert.ok(Math.abs(r.long - 3) < 0.1, `long side is ${r.long} cells`);
});

e2e('game events play the theme\'s sounds', async () => {
  await startLevel(2); // Space Port
  await js(`TKSound.setMuted(false), TKSound.history.length = 0, true`);
  await js(`(() => {
    const g = TKDebug.game();
    g.cars.find((c) => TKLevels.firstBlocker(c, g.W, g.H, g.occ).blocker >= 0).el.click();
    g.cars.find((c) => c.color === g.queue[0] && TKLevels.firstBlocker(c, g.W, g.H, g.occ).blocker < 0)?.el.click()
      ?? g.cars.find((c) => TKLevels.firstBlocker(c, g.W, g.H, g.occ).blocker < 0).el.click();
  })(), true`);
  await until(`TKSound.history.some((h) => h.name === 'board')`);
  const heard = await js(`TKSound.history.map((h) => h.theme + ':' + h.name + ':' + h.played)`);
  for (const s of ['space:bump:true', 'space:select:true', 'space:drive:true', 'space:board:true']) {
    assert.ok(heard.includes(s), `missing ${s} in ${heard}`);
  }
  assert.equal(await js(`TKSound.history.findIndex((h) => h.name === 'select') < TKSound.history.findIndex((h) => h.name === 'drive')`), true);
});

e2e('the sound button mutes, and the choice survives a reload', async () => {
  await js(`TKSound.setMuted(false), true`);
  await js(`document.getElementById('btn-sound').click(), true`);
  assert.equal(await js(`TKSound.muted`), true);
  assert.equal(await js(`document.getElementById('btn-sound').getAttribute('aria-pressed')`), 'true');
  await open(`${origin}${BASE}#debug`);
  assert.equal(await js(`TKSound.muted`), true);
  assert.equal(await js(`TKSound.play('select')`), false);
  await js(`document.getElementById('btn-sound').click(), true`);
  assert.equal(await js(`JSON.parse(localStorage.getItem('transport-king.save')).muted`), false);
  assert.equal(await js(`TKSound.play('select')`), true);
});

e2e('the music button turns music off and on, and the choice survives a reload', async () => {
  await js(`TKSound.setMuted(false), TKSound.setMusic(true), true`);
  await js(`document.body.click(), true`); // a user gesture unlocks audio
  await until(`TKSound.musicPlaying`);
  const btn = `document.getElementById('btn-music')`;
  await js(`${btn}.click(), true`);
  assert.equal(await js(`TKSound.musicPlaying`), false);
  assert.equal(await js(`${btn}.getAttribute('aria-pressed')`), 'true');
  assert.equal(await js(`${btn}.classList.contains('off')`), true);
  await open(`${origin}${BASE}#debug`);
  assert.equal(await js(`TKSound.music`), false);
  assert.equal(await js(`${btn}.getAttribute('aria-label')`), 'Turn music on');
  await js(`${btn}.click(), true`);
  assert.equal(await js(`TKSound.musicPlaying`), true);
});

// Reads this game's saved state straight from IndexedDB.
const fromDB = `new Promise((ok, no) => { const r = indexedDB.open('transport-king'); r.onerror = no;
  r.onsuccess = () => { const q = r.result.transaction('save').objectStore('save').get('state');
    q.onsuccess = () => { r.result.close(); ok(q.result); }; q.onerror = no; }; })`;

e2e('the level and preferences are kept in IndexedDB and survive a reload', async () => {
  await js(`TKStore.set({ max: 9, level: 7, muted: true, music: false }), true`);
  await until(`${fromDB}.then((s) => s && s.level === 7)`);
  assert.deepEqual(await js(`${fromDB}.then(({ level, max, muted, music }) => ({ level, max, muted, music }))`),
    { level: 7, max: 9, muted: true, music: false });
  // Even if the localStorage copy is lost, the database brings everything back.
  await js(`localStorage.removeItem('transport-king.save'), true`);
  await open(`${origin}${BASE}#debug`);
  assert.equal(await js(`TKDebug.game().n`), 7);
  assert.match(await js(`document.querySelector('.lvl-pick span').textContent`), /Level 7/);
  assert.equal(await js(`TKSound.muted`), true);
  assert.equal(await js(`TKSound.music`), false);
  assert.equal(await js(`JSON.parse(localStorage.getItem('transport-king.save')).level`), 7, 'backup copy restored');
  await js(`TKStore.set({ muted: false, music: true }), true`);
});

e2e('the player\'s level is remembered after playing and reloading', async () => {
  await startLevel(4);
  await open(`${origin}${BASE}#debug`);
  assert.equal(await js(`TKDebug.game().n`), 4);
  assert.match(await js(`document.querySelector('.lvl-pick span').textContent`), /Level 4/);
});

e2e('other games on the same site keep their saved data', async () => {
  await js(`localStorage.setItem('other-game.level', '42'), true`);
  await js(`new Promise((ok) => { const r = indexedDB.open('other-game', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('s');
    r.onsuccess = () => { const tx = r.result.transaction('s', 'readwrite'); tx.objectStore('s').put('mine', 'k');
      tx.oncomplete = () => { r.result.close(); ok(); }; }; })`);
  await open(`${origin}${BASE}#debug`);
  await js(`TKStore.set({ level: 2 }), TKSound.toggle(), TKSound.toggle(), true`);
  await open(`${origin}${BASE}#debug`);
  assert.equal(await js(`localStorage.getItem('other-game.level')`), '42');
  assert.equal(await js(`new Promise((ok) => { const r = indexedDB.open('other-game');
    r.onsuccess = () => { const q = r.result.transaction('s').objectStore('s').get('k'); q.onsuccess = () => ok(q.result); }; })`), 'mine');
  const ours = await js(`Object.keys(localStorage).filter((k) => k !== 'other-game.level')`);
  assert.deepEqual(ours, ['transport-king.save']);
  const dbs = await js(`indexedDB.databases().then((d) => d.map((x) => x.name).sort())`);
  assert.deepEqual(dbs, ['other-game', 'transport-king']);
});

e2e('the top bar fits on a small phone', async () => {
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 2, mobile: true });
  try {
    const r = await js(`(() => {
      const hud = document.getElementById('hud').getBoundingClientRect();
      const kids = [...document.getElementById('hud').children].map((e) => e.getBoundingClientRect());
      return { overflow: document.getElementById('hud').scrollWidth > hud.width + 1,
               offscreen: kids.some((k) => k.right > innerWidth + 0.5 || k.left < -0.5) };
    })()`);
    assert.deepEqual(r, { overflow: false, offscreen: false });
  } finally {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  }
});

e2e('the solve button finds a solution and plays it to a win', { timeout: 60000 }, async () => {
  // it plays slowly on purpose; here only the logic matters, so skip the pauses and run animations fast
  await send('Animation.enable');
  await send('Animation.setPlaybackRate', { playbackRate: 20 });
  await js(`TKDebug.setAutoPace(0), true`);
  try {
    await startLevel(3);
    // the player made a move first; the solver starts from the current board
    await js(`(() => { const g = TKDebug.game(); g.cars[g.data.solution[0]].el.click(); })(), true`);
    await js(`document.getElementById('btn-solve').click(), true`);
    await until(`!!document.querySelector('.autobar')`, 15000);
    assert.ok(await js(`document.getElementById('btn-solve').classList.contains('on')`));
    // the player's own taps are ignored while it plays
    assert.equal(await js(`(() => { const g = TKDebug.game();
      const c = g.cars.find((c) => c.state === 'grid' && !c.el.classList.contains('hint') && TKLevels.firstBlocker(c, g.W, g.H, g.occ).blocker < 0);
      if (!c) return 'grid'; c.el.click(); return c.state; })()`), 'grid');
    await until(`!!document.querySelector('[data-act=next]')`, 50000);
    assert.equal(await js(`TKDebug.game().cars.filter((c) => c.state !== 'gone').length`), 0);
    assert.equal(await js(`!!document.querySelector('.autobar')`), false);
  } finally {
    await js(`TKDebug.setAutoPace(1), true`);
    await send('Animation.setPlaybackRate', { playbackRate: 1 });
  }
});

e2e('the stop button hands control back to the player', async () => {
  await startLevel(5);
  await js(`document.getElementById('btn-solve').click(), true`);
  await until(`!!document.querySelector('.autobar')`, 15000);
  await js(`document.querySelector('.autobar').click(), true`);
  await until(`!document.querySelector('.autobar') && !TKDebug.game().auto`, 5000);
  const moved = await js(`(() => { const g = TKDebug.game();
    const c = g.cars.find((c) => c.state === 'grid' && TKLevels.firstBlocker(c, g.W, g.H, g.occ).blocker < 0);
    c.el.click(); return c.state; })()`);
  assert.notEqual(moved, 'grid');
});

e2e('the solver says so when there is no solution, or when it runs out of time', async () => {
  const real = await js(`(window.__solve = TKSolver.solve, true)`);
  assert.ok(real);
  try {
    await startLevel(6);
    await js(`TKSolver.solve = async () => ({ status: 'unsolvable' }), document.getElementById('btn-solve').click(), true`);
    await until(`/No solution/.test(document.querySelector('.panel h2')?.textContent)`);
    assert.ok(await js(`!!document.querySelector('[data-act=retry]')`));
    await js(`document.querySelector('[data-act=resume]').click(), true`);
    assert.equal(await js(`TKDebug.game().auto`), null);

    await js(`TKSolver.solve = async () => ({ status: 'timeout' }), document.getElementById('btn-solve').click(), true`);
    await until(`/Out of time/.test(document.querySelector('.panel h2')?.textContent)`);
    assert.match(await js(`document.querySelector('.panel p').textContent`), /10 seconds/);
    await js(`document.querySelector('[data-act=resume]').click(), true`);
  } finally {
    await js(`(TKSolver.solve = window.__solve), true`);
  }
});

e2e('no page errors during the whole run', () => {
  assert.deepEqual(pageErrors, []);
});
