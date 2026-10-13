/*
 * Transport King — saved progress and preferences.
 *
 * The game shares its origin (user.github.io) with other games, so it only
 * ever reads, writes or deletes its own data:
 *   IndexedDB     database "transport-king", store "save", key "state"
 *   localStorage  "transport-king.save" (plus the old transport-king.* keys,
 *                 which are migrated once and removed)
 * IndexedDB is the main store. The localStorage copy is read synchronously so
 * the first frame already knows the saved state, and is the backup wherever
 * IndexedDB is missing or broken. Failures never break the game.
 */
(function (root) {
  'use strict';

  const NS = 'transport-king';
  const DB_NAME = NS, DB_STORE = 'save', DB_KEY = 'state';
  const LS_KEY = NS + '.save';
  const LEGACY = { level: NS + '.level', max: NS + '.max', muted: NS + '.muted' };
  const DEFAULTS = { level: 1, max: 1, muted: false, music: true };

  const posInt = (v, d) => (Number.isInteger(v) && v >= 1 ? v : d);
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  /** Only known fields with valid values survive, so bad data can't break the game. */
  function clean(s) {
    s = s && typeof s === 'object' ? s : {};
    const max = posInt(s.max, DEFAULTS.max);
    return {
      level: Math.min(max, posInt(s.level, DEFAULTS.level)),
      max,
      muted: bool(s.muted, DEFAULTS.muted),
      music: bool(s.music, DEFAULTS.music),
      updated: Number.isFinite(s.updated) ? s.updated : 0,
    };
  }
  /** Newest save wins, but unlocked levels are never lost. */
  function merge(a, b) {
    const [old, neu] = a.updated > b.updated ? [b, a] : [a, b];
    return clean({ ...neu, max: Math.max(old.max, neu.max) });
  }

  // ---------- localStorage copy ----------
  let ls = null;
  try { ls = root.localStorage || null; } catch (e) { /* blocked */ }
  const lsGet = (k) => { try { return ls ? ls.getItem(k) : null; } catch (e) { return null; } };
  const lsSet = (k, v) => { try { if (ls) ls.setItem(k, v); } catch (e) { /* full or blocked */ } };
  const lsDel = (k) => { try { if (ls) ls.removeItem(k); } catch (e) { /* blocked */ } };
  const parse = (v) => { try { return v == null ? null : JSON.parse(v); } catch (e) { return null; } };

  let state = clean(parse(lsGet(LS_KEY)));
  if (lsGet(LS_KEY) == null) {
    const old = { level: parse(lsGet(LEGACY.level)), max: parse(lsGet(LEGACY.max)), muted: lsGet(LEGACY.muted) };
    if (old.level != null || old.max != null || old.muted != null) {
      state = clean({ level: old.level, max: Math.max(old.max | 0, old.level | 0), muted: old.muted === '1', updated: 1 });
      lsSet(LS_KEY, JSON.stringify(state));
    }
  }
  for (const k of Object.values(LEGACY)) lsDel(k);

  // ---------- IndexedDB ----------
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = root.indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('IndexedDB blocked'));
      });
      dbp.catch(() => { /* handled by callers */ });
    }
    return dbp;
  }
  function idb(mode, fn) {
    if (!root.indexedDB) return Promise.reject(new Error('no IndexedDB'));
    return db().then((d) => new Promise((resolve, reject) => {
      const tx = d.transaction(DB_STORE, mode);
      const req = fn(tx.objectStore(DB_STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    }));
  }
  const save = () => idb('readwrite', (s) => s.put(state, DB_KEY)).catch(() => { /* localStorage copy remains */ });

  // Load the database copy, merge with the localStorage copy and bring both up
  // to date. Some browsers hang on open, so give up after a moment.
  const ready = Promise.race([
    idb('readonly', (s) => s.get(DB_KEY)).then((saved) => {
      const before = JSON.stringify(state);
      if (saved) state = merge(state, clean(saved));
      if (JSON.stringify(state) !== before) lsSet(LS_KEY, JSON.stringify(state));
      if (!saved || JSON.stringify(clean(saved)) !== JSON.stringify(state)) return save();
    }),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]).catch(() => { /* fall back to the localStorage copy */ });

  /** Asks the browser not to evict saved progress (it may say no). Origin-wide, deletes nothing. */
  let asked = false;
  function persist() {
    if (asked) return;
    asked = true;
    try {
      const s = root.navigator && root.navigator.storage;
      if (s && s.persist) s.persisted().then((p) => p || s.persist()).catch(() => { /* ignore */ });
    } catch (e) { /* ignore */ }
  }

  root.TKStore = {
    NAME: NS,
    DB_NAME,
    LS_KEY,
    ready,
    persist,
    get(k) { return state[k]; },
    /** Updates some fields and saves them to both stores. */
    set(changes) {
      const next = clean({ ...state, ...changes, updated: state.updated });
      if (JSON.stringify(next) === JSON.stringify(state)) return state;
      state = { ...next, updated: Math.max(Date.now(), state.updated + 1) };
      lsSet(LS_KEY, JSON.stringify(state));
      save();
      return state;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
