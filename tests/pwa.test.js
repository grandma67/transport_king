// Installable app: manifest, icons, and a service worker that is safe to share an origin with.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));

function pngSize(file) {
  const b = fs.readFileSync(path.join(root, file));
  assert.equal(b.toString('ascii', 1, 4), 'PNG', `${file} is not a PNG`);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

/** Loads sw.js in a sandbox with fake caches, as if served from user.github.io/transport_king/. */
function loadSW(existingCaches = []) {
  const scope = 'https://user.github.io/transport_king/';
  const store = new Map(existingCaches.map((k) => [k, new Map()]));
  const listeners = {};
  const caches = {
    open: async (name) => {
      if (!store.has(name)) store.set(name, new Map());
      const c = store.get(name);
      return {
        addAll: async (reqs) => reqs.forEach((r) => c.set(r.url, 'cached')),
        match: async (r) => c.get(typeof r === 'string' ? new URL(r, scope).href : r.url),
        put: async (r, res) => c.set(r.url, res),
      };
    },
    keys: async () => [...store.keys()],
    delete: async (k) => store.delete(k),
  };
  class Request { constructor(url) { this.url = new URL(url, scope).href; } }
  const self = {
    registration: { scope },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const src = read('sw.js') + '\n;globalThis.__sw = { APP_ID, VERSION, BUILD, CACHE, ASSETS };';
  const ctx = { self, caches, Request, URL, console, fetch: async () => { throw new Error('offline'); } };
  vm.runInNewContext(src, ctx);
  const run = async (type, extra = {}) => {
    let waited;
    let responded = null;
    listeners[type]({ ...extra, waitUntil: (p) => { waited = p; }, respondWith: (p) => { responded = p; } });
    await waited;
    return responded;
  };
  return { sw: ctx.__sw, store, run, scope };
}

test('manifest makes the game installable from a GitHub Pages subfolder', () => {
  assert.equal(manifest.id, 'transport-king');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.name && manifest.short_name);
  for (const icon of manifest.icons) {
    assert.ok(!icon.src.startsWith('/'), `${icon.src} must be relative to work under /<repo>/`);
    assert.ok(fs.existsSync(path.join(root, icon.src)), `${icon.src} missing`);
    if (icon.type === 'image/png') assert.equal(pngSize(icon.src), icon.sizes, icon.src);
  }
  const png = manifest.icons.filter((i) => i.type === 'image/png');
  assert.ok(png.some((i) => i.sizes === '192x192' && i.purpose.includes('any')));
  assert.ok(png.some((i) => i.sizes === '512x512' && i.purpose.includes('any')));
  assert.ok(png.some((i) => i.purpose.includes('maskable')));
});

test('index.html links the manifest and every local file uses a relative path', () => {
  const html = read('index.html');
  assert.match(html, /<link rel="manifest" href="manifest.webmanifest">/);
  for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^(https?:|data:|#)/.test(url)) continue;
    assert.ok(!url.startsWith('/'), `${url} would break under /<repo>/`);
    assert.ok(fs.existsSync(path.join(root, url)), `${url} missing`);
  }
});

test('service worker cache name is unique per app id, version and build', () => {
  const { sw } = loadSW();
  assert.equal(sw.APP_ID, manifest.id);
  assert.match(sw.VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(sw.CACHE, `${manifest.id}-v${sw.VERSION}-${sw.BUILD}`);
});

test('deploy workflow stamps the build into the cache name', () => {
  const wf = read('.github/workflows/pages.yml');
  assert.match(read('sw.js'), /const BUILD = 'dev';/);
  assert.match(wf, /s\/const BUILD = 'dev';\/const BUILD = '\$\{GITHUB_SHA::7\}';\//);
});

test('service worker precaches every file the page needs', async () => {
  const { sw, store, run, scope } = loadSW();
  for (const a of sw.ASSETS) {
    if (a === './') continue;
    assert.ok(fs.existsSync(path.join(root, a)), `${a} listed in ASSETS but missing`);
  }
  const html = read('index.html');
  const local = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => './' + m[1]);
  for (const f of local) assert.ok(sw.ASSETS.includes(f), `${f} is not precached`);
  for (const icon of manifest.icons) assert.ok(sw.ASSETS.includes('./' + icon.src), `${icon.src} is not precached`);

  await run('install');
  const cached = store.get(sw.CACHE);
  assert.equal(cached.size, sw.ASSETS.length);
  assert.ok(cached.has(scope + 'index.html'));
});

test('activating only removes this app\'s old caches, never other games\' caches', async () => {
  const { sw, store, run } = loadSW([
    'transport-king-v0.9.0-abc1234',
    'transport-king-v1.0.0-dev',
    'other-game-v1',
    'transport-kingdom-v1', // similar name, different app
  ]);
  await run('install');
  await run('activate');
  assert.deepEqual([...store.keys()].sort(), [sw.CACHE, 'other-game-v1', 'transport-kingdom-v1'].sort());
});

test('service worker ignores requests outside its scope', async () => {
  const { run, scope } = loadSW();
  await run('install');
  const outside = await run('fetch', { request: { method: 'GET', url: 'https://user.github.io/other_game/game.js', mode: 'no-cors' } });
  assert.equal(outside, null);
  const post = await run('fetch', { request: { method: 'POST', url: scope + 'x', mode: 'cors' } });
  assert.equal(post, null);
  const inside = await run('fetch', { request: { method: 'GET', url: scope + 'js/game.js', mode: 'no-cors' } });
  assert.equal(await inside, 'cached');
});

test('saved progress uses namespaced storage keys (the origin is shared)', () => {
  const src = read('js/game.js');
  const keys = [...src.matchAll(/store\.(?:get|set)\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 0);
  for (const k of keys) assert.ok(k.startsWith(manifest.id + '.'), `storage key ${k} is not namespaced`);
});
