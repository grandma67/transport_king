/*
 * Transport King — game engine.
 *
 * Car lifecycle: grid -> arriving (driving to a spot) -> parked -> leaving -> gone.
 * The front passenger boards the earliest-parked car of their colour that
 * still has a free seat. A full car drives away and frees its spot.
 */
(function () {
  'use strict';

  const TK = window.TKLevels;
  const { PALETTE, DIRS } = TK;

  const THEMES = [
    { name: 'City Rush', vehicle: 'car', passenger: 'person',
      bg: 'linear-gradient(180deg,#a8d8ff,#e6f4ff)', road: '#2d323a', tile: '#4b525e', line: 'rgba(255,255,255,.22)', ui: '#12304d' },
    { name: 'Space Port', vehicle: 'rocket', passenger: 'alien',
      bg: 'radial-gradient(circle at 30% 15%,#3a3f8f 0%,#141838 55%,#070818 100%)', road: '#0d1030', tile: '#252a63', line: 'rgba(150,170,255,.25)', ui: '#eef1ff' },
    { name: 'Harbor Hop', vehicle: 'boat', passenger: 'penguin',
      bg: 'linear-gradient(180deg,#8fdcff,#dff6ff)', road: '#b98a52', tile: '#2c87bd', line: 'rgba(255,255,255,.25)', ui: '#0b3954' },
    { name: 'Pet Express', vehicle: 'truck', passenger: 'cat',
      bg: 'linear-gradient(180deg,#c9f29b,#f4fde8)', road: '#8d6a43', tile: '#5f9e45', line: 'rgba(255,255,255,.22)', ui: '#24461a' },
    { name: 'Candy Land', vehicle: 'jelly', passenger: 'blob',
      bg: 'linear-gradient(180deg,#ffc6e5,#fff0f8)', road: '#7a3b69', tile: '#a05590', line: 'rgba(255,255,255,.25)', ui: '#5a1846' },
    { name: 'School Run', vehicle: 'bus', passenger: 'person',
      bg: 'linear-gradient(180deg,#ffe0a3,#fff7e6)', road: '#3a3a3a', tile: '#5a5a5a', line: 'rgba(255,230,120,.35)', ui: '#4a3000' },
  ];

  const DIR_ANGLE = { R: 0, D: 90, L: 180, U: -90 };
  const BOARD_INTERVAL = 120;

  const $ = (s) => document.querySelector(s);
  const app = $('#app');
  const stage = $('#stage');
  const overlay = $('#overlay');
  const toastEl = $('#toast');

  let G = null;   // current game
  let geo = null; // current layout measurements

  // ---------- storage (best effort) ----------
  // Keys are namespaced: other games share this origin on GitHub Pages.
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  let maxLevel = Math.max(1, store.get('transport-king.max', 1) | 0);
  let menuLevel = Math.min(maxLevel, Math.max(1, store.get('transport-king.level', 1) | 0));

  // ---------- drawing ----------
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    const ch = (v) => Math.round((t - v) * p + v);
    return '#' + ((1 << 24) | (ch(n >> 16) << 16) | (ch((n >> 8) & 255) << 8) | ch(n & 255)).toString(16).slice(1);
  }

  // Vehicles are drawn facing right in a (len*100 x wid*100) box; CSS rotates them.
  // The theme body is drawn for one lane and stretched across a wide vehicle.
  function vehicleSVG(kind, car) {
    const { len, cap, filled } = car, wid = car.wid || 1, colorIdx = car.color;
    const w = len * 100, h = wid * 100;
    if (kind === 'car' && car.type !== 'car' && car.type !== 'van') kind = 'bus';
    const c = PALETTE[colorIdx].hex, d = shade(c, -0.3), l = shade(c, 0.4);
    const glass = '#cfeaff';
    let body = '', chevron = null;
    switch (kind) {
      case 'rocket':
        body = `<path d="M10 22 L36 22 L14 2 Z M10 72 L36 72 L14 94 Z" fill="${d}"/>
          <path d="M2 36 L10 30 L10 64 L2 58 Z" fill="#ffb020"/>
          <path d="M8 20 L${w - 52} 18 Q${w - 2} 47 ${w - 52} 76 L8 74 Z" fill="${c}"/>
          <path d="M${w - 52} 18 Q${w - 2} 47 ${w - 52} 76 Q${w - 40} 47 ${w - 52} 18 Z" fill="${l}"/>`;
        chevron = w - 28; break;
      case 'boat':
        body = `<path d="M8 12 L${w - 56} 12 Q${w - 4} 47 ${w - 56} 82 L8 82 Q2 47 8 12 Z" fill="${d}"/>
          <path d="M14 18 L${w - 58} 18 Q${w - 18} 47 ${w - 58} 76 L14 76 Q10 47 14 18 Z" fill="${c}"/>`;
        chevron = w - 36; break;
      case 'truck':
        body = `<rect x="5" y="10" width="${w - 64}" height="74" rx="10" fill="${c}"/>
          <path d="M5 30 H${w - 59} M5 64 H${w - 59}" stroke="${d}" stroke-width="3" opacity=".5"/>
          <rect x="${w - 62}" y="14" width="56" height="66" rx="14" fill="${d}"/>
          <rect x="${w - 22}" y="20" width="10" height="54" rx="4" fill="${glass}"/>`;
        chevron = w - 44; break;
      case 'jelly':
        body = `<rect x="5" y="8" width="${w - 10}" height="78" rx="39" fill="${c}"/>
          <ellipse cx="${w / 2}" cy="22" rx="${w * 0.3}" ry="7" fill="#fff" opacity=".45"/>
          <circle cx="${w - 26}" cy="33" r="9" fill="#fff"/><circle cx="${w - 26}" cy="61" r="9" fill="#fff"/>
          <circle cx="${w - 21}" cy="33" r="4.5" fill="#222"/><circle cx="${w - 21}" cy="61" r="4.5" fill="#222"/>`;
        break;
      case 'bus': {
        let win = '';
        for (let x = 40; x < w - 50; x += 28) win += `<rect x="${x}" y="13" width="18" height="7" rx="2" fill="${glass}" opacity=".85"/><rect x="${x}" y="74" width="18" height="7" rx="2" fill="${glass}" opacity=".85"/>`;
        body = `<rect x="4" y="10" width="${w - 8}" height="74" rx="12" fill="${c}"/>${win}
          <rect x="${w - 24}" y="16" width="12" height="62" rx="5" fill="${glass}"/>`;
        chevron = w - 44; break;
      }
      default: // car
        body = `<rect x="5" y="13" width="${w - 10}" height="76" rx="24" fill="${d}"/>
          <rect x="5" y="10" width="${w - 10}" height="74" rx="24" fill="${c}"/>
          <rect x="${w - 56}" y="20" width="16" height="54" rx="7" fill="${glass}"/>
          <circle cx="${w - 12}" cy="24" r="5" fill="#fff7b0"/><circle cx="${w - 12}" cy="70" r="5" fill="#fff7b0"/>`;
        chevron = w - 24;
    }
    // a two-lane bus gets a centre roof divider
    const deck = wid > 1 ? `<rect x="30" y="${h / 2 - 4}" width="${w - 90}" height="8" rx="4" fill="${d}" opacity=".45"/>` : '';
    // seats: two rows per lane, filled from the front
    const rows = 2 * wid, cols = Math.ceil(cap / rows), x0 = 40, x1 = w - 64;
    const step = (x1 - x0) / cols, rowStep = (h - 36) / rows;
    const r = Math.min(11, step * 0.36, rowStep * 0.36);
    let seats = '';
    for (let i = 0; i < cap; i++) {
      const col = cols - 1 - Math.floor(i / rows), row = i % rows;
      const cx = x0 + step * (col + 0.5), cy = 18 + rowStep * (row + 0.5);
      seats += i < filled
        ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="${d}" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="${r * 0.45}" fill="${c}"/>`
        : `<circle cx="${cx}" cy="${cy}" r="${r - 1}" fill="rgba(0,0,0,.28)"/>`;
    }
    const glyph = `<text x="22" y="${h / 2}" font-size="24" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="#fff" stroke="rgba(0,0,0,.4)" stroke-width="3" paint-order="stroke">${PALETTE[colorIdx].glyph}</text>`;
    const arrow = chevron == null ? '' :
      `<path d="M${chevron - 5} ${h / 2 - 11} L${chevron + 5} ${h / 2} L${chevron - 5} ${h / 2 + 11}" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>`;
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><g transform="scale(1,${wid})">${body}</g>${deck}${seats}${glyph}${arrow}</svg>`;
  }

  const HAIR = ['#5b3a29', '#1f1f1f', '#d9a441', '#a3471f', '#7d7d7d'];
  function passengerSVG(kind, colorIdx, seed) {
    const c = PALETTE[colorIdx].hex, d = shade(c, -0.3), l = shade(c, 0.35);
    const shadow = '<ellipse cx="20" cy="49" rx="12" ry="3" fill="rgba(0,0,0,.22)"/>';
    let s;
    switch (kind) {
      case 'alien':
        s = `<rect x="9" y="25" width="22" height="23" rx="9" fill="${d}"/>
          <path d="M15 9 L11 1 M25 9 L29 1" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>
          <circle cx="11" cy="1.5" r="2.6" fill="${l}"/><circle cx="29" cy="1.5" r="2.6" fill="${l}"/>
          <ellipse cx="20" cy="17" rx="13" ry="10" fill="${c}"/>
          <ellipse cx="15" cy="17" rx="3" ry="4" fill="#111"/><ellipse cx="25" cy="17" rx="3" ry="4" fill="#111"/>`;
        break;
      case 'penguin':
        s = `<ellipse cx="20" cy="30" rx="14" ry="19" fill="#23262e"/>
          <ellipse cx="20" cy="34" rx="9.5" ry="13" fill="${c}"/>
          <circle cx="15" cy="18" r="3" fill="#fff"/><circle cx="25" cy="18" r="3" fill="#fff"/>
          <circle cx="15.5" cy="18.5" r="1.4" fill="#111"/><circle cx="24.5" cy="18.5" r="1.4" fill="#111"/>
          <path d="M16.5 22 L23.5 22 L20 26.5 Z" fill="#f59e0b"/>`;
        break;
      case 'cat':
        s = `<rect x="10" y="27" width="20" height="21" rx="9" fill="${c}"/>
          <path d="M9.5 13 L11 1.5 L19 8 Z M30.5 13 L29 1.5 L21 8 Z" fill="${d}"/>
          <circle cx="20" cy="17" r="11" fill="${c}"/>
          <circle cx="16" cy="16" r="2" fill="#111"/><circle cx="24" cy="16" r="2" fill="#111"/>
          <path d="M18.5 20.5 L21.5 20.5 L20 22.5 Z" fill="#ff8fab"/>`;
        break;
      case 'blob':
        s = `<path d="M5 47 Q2 18 20 9 Q38 18 35 47 Z" fill="${c}"/>
          <ellipse cx="14" cy="20" rx="4" ry="2.5" fill="#fff" opacity=".45"/>
          <circle cx="15" cy="28" r="4" fill="#fff"/><circle cx="25" cy="28" r="4" fill="#fff"/>
          <circle cx="16" cy="29" r="2" fill="#222"/><circle cx="24" cy="29" r="2" fill="#222"/>`;
        break;
      default: // person
        s = `<rect x="8" y="22" width="24" height="26" rx="10" fill="${c}"/>
          <circle cx="20" cy="13" r="9" fill="#ffd9b8"/>
          <path d="M11 12 Q20 -1 29 12 Q20 7 11 12 Z" fill="${HAIR[seed % HAIR.length]}"/>`;
    }
    return `<svg viewBox="0 0 40 52">${shadow}${s}</svg>`;
  }

  // ---------- layout ----------
  function computeGeo() {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const pad = 8, K = G.K;
    const qh = Math.max(36, Math.min(48, sw / 10));
    const slotW = Math.min((sw - 2 * pad) / K, 64);
    const slotsX0 = (sw - slotW * K) / 2;
    const maxLen = Math.min(3, Math.max(...G.cars.map((c) => c.len)));
    const parkCell = Math.min(slotW * 0.4, 20) / 0.76; // cell length of a parked car
    const slotH = parkCell * maxLen + 8;
    const queueY = 4;
    const slotsY = queueY + qh + 6;
    const lotTop = slotsY + slotH + 4;
    const avail = Math.max(60, sh - lotTop - 4);
    // the lot gets everything that is left; the ring road is 0.55 of a cell wide
    const cs = Math.min((sw - 8) / (G.W + 1.1), avail / (G.H + 1.1), 72);
    const road = cs * 0.55;
    const gx = (sw - G.W * cs) / 2;
    const gy = lotTop + road + Math.max(0, avail - (G.H * cs + 2 * road)) * 0.5;
    const stopW = qh * 0.62, moreW = 52;
    const qx0 = pad + stopW;
    const qs = (sw - 2 * pad - stopW - moreW - 6) / G.V;
    const pw = Math.min(qs * 0.86, (qh * 0.9) / 1.3);
    return { sw, sh, pad, qh, queueY, slotW, slotsX0, slotsY, slotH, parkScale: parkCell / cs,
      cs, road, gx, gy, qx0, qs, pw, ph: pw * 1.3, stopW, moreW };
  }

  const px = (v) => v + 'px';
  function place(el, x, y, w, h) {
    el.style.left = px(x); el.style.top = px(y); el.style.width = px(w); el.style.height = px(h);
  }

  function T(cx, cy, a, s, car) {
    return `translate(${cx - (car.len * geo.cs) / 2}px, ${cy - ((car.wid || 1) * geo.cs) / 2}px) rotate(${a}deg) scale(${s})`;
  }
  function carCenter(car) {
    const { gx, gy, cs } = geo;
    return car.horiz
      ? [gx + (car.x + car.len / 2) * cs, gy + (car.y + car.wid / 2) * cs]
      : [gx + (car.x + car.wid / 2) * cs, gy + (car.y + car.len / 2) * cs];
  }
  function slotCenter(i) {
    return [geo.slotsX0 + geo.slotW * (i + 0.5), geo.slotsY + geo.slotH / 2];
  }
  function gridTransform(car) { return T(...carCenter(car), DIR_ANGLE[car.dir], 1, car); }
  function slotTransform(car) { return T(...slotCenter(car.slot), -90, parkScale(car), car); }
  /** Parked vehicles shrink, and the biggest ones shrink further to fit their spot. */
  function parkScale(car) {
    return Math.min(geo.parkScale, (geo.slotH - 6) / (car.len * geo.cs), (geo.slotW - 8) / (car.wid * geo.cs));
  }
  function queueTransform(r) {
    return `translate(${geo.qx0 + r * geo.qs + (geo.qs - geo.pw) / 2}px, ${geo.queueY + geo.qh - geo.ph - 3}px)`;
  }

  function layout() {
    if (!G) return;
    geo = computeGeo();
    const { els } = G;
    place(els.lane, geo.pad, geo.queueY, geo.sw - 2 * geo.pad, geo.qh);
    els.stop.style.fontSize = px(geo.stopW * 0.7);
    place(els.more, geo.sw - geo.pad - geo.moreW - 4, geo.queueY + geo.qh * 0.2, geo.moreW, geo.qh * 0.6);
    els.slots.forEach((s, i) => place(s, geo.slotsX0 + i * geo.slotW + 3, geo.slotsY, geo.slotW - 6, geo.slotH));
    const r = geo.road;
    place(els.road, geo.gx - r, geo.gy - r, G.W * geo.cs + 2 * r, G.H * geo.cs + 2 * r);
    els.road.style.borderRadius = px(r * 0.8);
    place(els.lot, geo.gx, geo.gy, G.W * geo.cs, G.H * geo.cs);
    for (const t of els.tiles) place(t.el, t.x * geo.cs + 1, t.y * geo.cs + 1, geo.cs - 2, geo.cs - 2);
    for (const car of G.cars) positionCar(car);
    stage.classList.add('notrans');
    positionQueue();
    void stage.offsetWidth;
    stage.classList.remove('notrans');
  }

  function positionCar(car) {
    if (car.state === 'gone') return;
    car.el.style.width = px(car.len * geo.cs);
    car.el.style.height = px(car.wid * geo.cs);
    car.el.style.transform = car.state === 'grid' ? gridTransform(car) : slotTransform(car);
  }

  function positionQueue() {
    const total = G.queue.length;
    for (let r = 0; r < G.V; r++) {
      const i = G.head + r;
      if (i >= total) break;
      let el = G.qEls.get(i);
      if (!el) {
        el = document.createElement('div');
        el.className = 'pass';
        el.innerHTML = passengerSVG(G.theme.passenger, G.queue[i], i);
        el.style.opacity = '0';
        el.style.transform = queueTransform(r + 1);
        stage.appendChild(el);
        G.qEls.set(i, el);
        void el.offsetWidth; // start the slide-in from the right
      }
      el.style.width = px(geo.pw);
      el.style.height = px(geo.ph);
      el.style.opacity = '1';
      el.style.transform = queueTransform(r);
      el.classList.toggle('front', r === 0);
    }
    const hidden = Math.max(0, total - G.head - G.V);
    G.els.more.textContent = '+' + hidden;
    G.els.more.classList.toggle('empty', hidden === 0);
  }

  // ---------- level setup ----------
  function startLevel(n) {
    if (G) { clearTimeout(G.timer); G.dead = true; }
    hideOverlay();
    const data = TK.generateLevel(n);
    const theme = THEMES[data.themeIndex % THEMES.length];
    G = {
      n, data, theme,
      W: data.W, H: data.H, K: data.slots, V: data.visible,
      cars: data.cars.map((c) => ({ ...c, state: 'grid', reserved: 0, filled: 0, slot: -1, parkedAt: 0, el: null })),
      slots: new Array(data.slots).fill(null),
      queue: data.queue, head: 0, qEls: new Map(),
      parkCounter: 0, timer: null, over: false, dead: false, els: {},
    };
    G.occ = TK.buildOcc(G.cars, G.W, G.H);
    store.set('transport-king.level', n);
    applyTheme(theme);
    buildStage();
    layout();
    updateHud();
  }

  function applyTheme(t) {
    document.body.style.background = t.bg;
    app.style.setProperty('--ui', t.ui);
    app.style.setProperty('--road', t.road);
    app.style.setProperty('--tile', t.tile);
    app.style.setProperty('--line', t.line);
  }

  function buildStage() {
    stage.innerHTML = '';
    const mk = (cls, parent = stage) => {
      const e = document.createElement('div');
      e.className = cls;
      parent.appendChild(e);
      return e;
    };
    const els = G.els;
    els.lane = mk('lane');
    els.stop = mk('stop', els.lane);
    els.stop.textContent = '\u{1F68F}';
    els.more = mk('qmore');
    els.slots = G.slots.map(() => { const s = mk('slot'); s.textContent = 'P'; return s; });
    els.road = mk('road');
    els.lot = mk('lot');
    els.tiles = [];
    for (let y = 0; y < G.H; y++) {
      for (let x = 0; x < G.W; x++) {
        if (G.data.mask[y * G.W + x]) els.tiles.push({ x, y, el: mk('tile', els.lot) });
      }
    }
    for (const car of G.cars) {
      car.el = mk('car');
      renderCar(car);
      car.el.addEventListener('click', () => onCarTap(car));
    }
  }

  function renderCar(car) {
    car.el.innerHTML = vehicleSVG(G.theme.vehicle, car);
  }

  function updateHud() {
    $('#hud-level').textContent = 'Level ' + G.n;
    $('#hud-theme').textContent = G.theme.name;
    $('#hud-cars').textContent = G.cars.filter((c) => c.state !== 'gone').length;
    $('#hud-pass').textContent = G.queue.length - G.head;
  }

  // ---------- player input ----------
  function onCarTap(car) {
    if (G.over || car.state !== 'grid') return;
    const info = TK.firstBlocker(car, G.W, G.H, G.occ);
    if (info.blocker >= 0) { bump(car, info); return; }
    const slot = G.slots.indexOf(null);
    if (slot < 0) {
      toast('No free parking spot!');
      for (const s of G.els.slots) { s.classList.remove('warn'); void s.offsetWidth; s.classList.add('warn'); }
      return;
    }
    G.slots[slot] = car;
    car.slot = slot;
    car.state = 'arriving';
    car.parkedAt = ++G.parkCounter;
    for (const [x, y] of TK.carCells(car)) G.occ[y * G.W + x] = -1;
    drive(car);
  }

  function bump(car, info) {
    const [dx, dy] = DIRS[car.dir];
    const [cx, cy] = carCenter(car);
    const a = DIR_ANGLE[car.dir];
    const off = info.dist * geo.cs + geo.cs * 0.18;
    const duration = 240 + info.dist * 50;
    car.el.animate([
      { transform: T(cx, cy, a, 1, car) },
      { transform: T(cx + dx * off, cy + dy * off, a, 1, car), offset: 0.45 },
      { transform: T(cx, cy, a, 1, car) },
    ], { duration, easing: 'ease-in-out' });
    const blocker = G.cars[info.blocker].el;
    setTimeout(() => {
      blocker.classList.remove('hit');
      void blocker.offsetWidth;
      blocker.classList.add('hit');
    }, duration * 0.4);
  }

  // Route: forward out of the lot, around the ring road to the top, then up into the spot.
  function exitPath(car) {
    const { cs, road, gx, gy } = geo;
    const [cx, cy] = carCenter(car);
    const left = gx - road / 2, right = gx + G.W * cs + road / 2;
    const top = gy - road / 2, bottom = gy + G.H * cs + road / 2;
    const [sx, sy] = slotCenter(car.slot);
    const pts = [[cx, cy]];
    if (car.dir === 'U') pts.push([cx, top]);
    else if (car.dir === 'R') pts.push([right, cy], [right, top]);
    else if (car.dir === 'L') pts.push([left, cy], [left, top]);
    else {
      const side = Math.abs(cx - left) + Math.abs(left - sx) <= Math.abs(cx - right) + Math.abs(right - sx) ? left : right;
      pts.push([cx, bottom], [side, bottom], [side, top]);
    }
    pts.push([sx, top], [sx, sy]);
    return pts;
  }

  function drive(car) {
    const g = G;
    const pts = exitPath(car);
    const turn = geo.cs * 0.6;
    let ang = DIR_ANGLE[car.dir], dist = 0;
    const frames = [{ x: pts[0][0], y: pts[0][1], a: ang, d: 0 }];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.5) continue;
      let h = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
      while (h - ang > 180) h -= 360;
      while (h - ang < -180) h += 360;
      if (Math.abs(h - ang) > 1) { dist += turn; frames.push({ x: ax, y: ay, a: h, d: dist }); ang = h; }
      dist += len;
      frames.push({ x: bx, y: by, a: ang, d: dist });
    }
    const last = frames.length - 1;
    const keyframes = frames.map((f, i) => ({
      transform: T(f.x, f.y, f.a, i === last ? parkScale(car) : 1, car),
      offset: f.d / dist,
    }));
    car.el.classList.add('moving');
    const anim = car.el.animate(keyframes, {
      duration: 220 + dist / Math.max(0.7, geo.cs * 0.022),
      easing: 'ease-in-out',
    });
    anim.onfinish = () => {
      if (g.dead) return;
      car.el.classList.remove('moving');
      car.el.classList.add('parked');
      car.state = 'parked';
      positionCar(car);
      pump();
    };
  }

  // ---------- boarding loop ----------
  function pump() {
    if (G && !G.timer && !G.over) step();
  }

  function step() {
    const g = G;
    g.timer = null;
    if (g.over) return;
    if (g.head >= g.queue.length) { checkWin(); return; }
    const color = g.queue[g.head];
    let target = null;
    for (const c of g.cars) {
      if ((c.state === 'parked' || c.state === 'arriving') && c.color === color && c.reserved < c.cap &&
          (!target || c.parkedAt < target.parkedAt)) target = c;
    }
    if (!target) { checkLose(); return; }
    if (target.state !== 'parked') return; // wait for it to arrive; arrival pumps again
    target.reserved++;
    board(target, g.head++);
    positionQueue();
    updateHud();
    g.timer = setTimeout(step, BOARD_INTERVAL);
  }

  function board(car, idx) {
    const g = G;
    const el = g.qEls.get(idx);
    g.qEls.delete(idx);
    el.classList.remove('front');
    el.classList.add('boarding');
    const from = el.style.transform;
    const [sx, sy] = slotCenter(car.slot);
    const tx = sx - geo.pw / 2, ty = sy - geo.ph / 2;
    const anim = el.animate([
      { transform: from, opacity: 1 },
      { transform: `translate(${(tx + geo.qx0) / 2}px, ${geo.queueY - geo.ph * 0.15}px) scale(1.05)`, opacity: 1, offset: 0.35 },
      { transform: `translate(${tx}px, ${ty}px) scale(.35)`, opacity: 0.3 },
    ], { duration: 320, easing: 'ease-in', fill: 'forwards' });
    anim.onfinish = () => {
      el.remove();
      if (g.dead) return;
      car.filled++;
      renderCar(car);
      if (car.filled === car.cap) setTimeout(() => { if (!g.dead) depart(car); }, 160);
    };
  }

  function depart(car) {
    const g = G;
    car.state = 'leaving';
    g.slots[car.slot] = null;
    const [sx, sy] = slotCenter(car.slot);
    const s = parkScale(car);
    const anim = car.el.animate([
      { transform: T(sx, sy, -90, s, car), opacity: 1 },
      { transform: T(sx, sy, -90, s * 1.12, car), opacity: 1, offset: 0.25 },
      { transform: T(sx, sy - geo.slotH * 0.7, -90, s * 0.8, car), opacity: 0 },
    ], { duration: 420, easing: 'ease-in', fill: 'forwards' });
    anim.onfinish = () => {
      car.el.remove();
      if (g.dead) return;
      car.state = 'gone';
      updateHud();
      checkWin();
      pump();
    };
  }

  // ---------- win / lose ----------
  function checkWin() {
    const g = G;
    if (g.over || g.head < g.queue.length || g.cars.some((c) => c.state !== 'gone')) return;
    g.over = true;
    maxLevel = Math.max(maxLevel, g.n + 1);
    menuLevel = g.n + 1;
    store.set('transport-king.max', maxLevel);
    store.set('transport-king.level', menuLevel);
    setTimeout(() => {
      if (G !== g) return;
      showOverlay(`<div class="big">&#127881;</div><h2>Level ${g.n} cleared!</h2>
        <p>Every passenger made it home.</p>
        <button class="btn" data-act="next">Next level &rarr;</button>
        <button class="btn secondary" data-act="menu">Menu</button>`);
      confetti();
    }, 350);
  }

  // Lost when every spot holds a parked car that still has room, and the
  // front passenger fits none of them: nothing can ever move again.
  function checkLose() {
    const g = G;
    if (g.slots.some((c) => c === null || c.state !== 'parked' || c.reserved >= c.cap)) return;
    g.over = true;
    const front = g.qEls.get(g.head);
    if (front) front.classList.add('sad');
    setTimeout(() => {
      if (G !== g) return;
      const name = PALETTE[g.queue[g.head]].name;
      showOverlay(`<div class="big">&#128679;</div><h2>Parking full!</h2>
        <p>The ${name.toLowerCase()} passenger has nowhere to go.</p>
        <button class="btn" data-act="retry">Try again</button>
        <button class="btn secondary" data-act="menu">Menu</button>`);
    }, 900);
  }

  // ---------- UI ----------
  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1100);
  }

  function showOverlay(html) {
    overlay.innerHTML = `<div class="panel">${html}</div>`;
    overlay.classList.remove('hidden');
  }
  function hideOverlay() { overlay.classList.add('hidden'); overlay.innerHTML = ''; }

  function showMenu() {
    showOverlay(`<div class="big">&#128661;</div><h1>Transport King</h1>
      <ul>
        <li>Tap a vehicle whose path is clear to send it to a parking spot.</li>
        <li>Passengers board vehicles of their own colour, in line order.</li>
        <li>A full vehicle drives off and frees its spot.</li>
        <li>You only see the front of the line. If every spot is taken and nobody can board, you lose!</li>
      </ul>
      <div class="lvl-pick">
        <button data-act="lvl-down" aria-label="Previous level" ${menuLevel <= 1 ? 'disabled' : ''}>&lsaquo;</button>
        <span>Level ${menuLevel}</span>
        <button data-act="lvl-up" aria-label="Next level" ${menuLevel >= maxLevel ? 'disabled' : ''}>&rsaquo;</button>
      </div>
      <button class="btn" data-act="play">Play</button>
      ${installPrompt ? '<button class="btn secondary" data-act="install">Install app</button>' : ''}
      ${G && !G.over ? '<button class="btn secondary" data-act="resume">Resume</button>' : ''}`);
  }

  function confetti() {
    const colors = PALETTE.map((p) => p.hex);
    for (let i = 0; i < 60; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = Math.random() * 100 + '%';
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = 1.6 + Math.random() * 1.6 + 's';
      c.style.animationDelay = Math.random() * 0.5 + 's';
      overlay.appendChild(c);
    }
  }

  overlay.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'play': startLevel(menuLevel); break;
      case 'resume': hideOverlay(); break;
      case 'next': startLevel(G.n + 1); break;
      case 'retry': startLevel(G.n); break;
      case 'menu': showMenu(); break;
      case 'install':
        installPrompt.prompt();
        installPrompt.userChoice.finally(() => { installPrompt = null; showMenu(); });
        break;
      case 'lvl-down': menuLevel = Math.max(1, menuLevel - 1); showMenu(); break;
      case 'lvl-up': menuLevel = Math.min(maxLevel, menuLevel + 1); showMenu(); break;
    }
  });
  $('#btn-menu').addEventListener('click', showMenu);
  $('#btn-restart').addEventListener('click', () => startLevel(G.n));
  window.addEventListener('resize', layout);

  // ---------- installable app ----------
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    if (overlay.querySelector('[data-act=play]')) showMenu();
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => { /* offline support is optional */ });
  }

  // Used by automated browser tests: index.html#debug
  if (location.hash === '#debug') window.TKDebug = { game: () => G, startLevel };

  startLevel(menuLevel);
  showMenu();
})();
