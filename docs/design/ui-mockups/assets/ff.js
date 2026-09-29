/*
 * Flow & Fire – gemeinsame Mockup-Helfer (klassisches Script, läuft auch über file://).
 * Nur Mockup-Glue: Icons, Zahlenformat, Skalierung, Tabs, prozedurales Terrain. Im Spiel übernehmen
 * Preact-Komponenten diese Rollen (ui.md §10); die Markup-Struktur hier entspricht deren Ausgabe.
 */
(function () {
  'use strict';
  const FF = (window.FF = {});
  const qs = new URLSearchParams(location.search);
  FF.qs = qs;

  /* ---------- Skalierung (ui.md §4.1) ---------- */
  FF.autoScale = function (h) {
    // Auto: 1,0 bei 1080p, 1,25 bei 1440p, dazwischen in 0,05-Schritten; Grenzen 0,8–1,5
    const s = Math.pow(h / 1080, 0.78);
    return Math.min(1.5, Math.max(0.8, Math.round(s * 20) / 20));
  };
  FF.applyScale = function () {
    const forced = parseFloat(qs.get('scale') || '');
    const s = Number.isFinite(forced) ? forced : FF.autoScale(window.innerHeight);
    document.documentElement.style.setProperty('--ui-scale', String(s));
    document.documentElement.dataset.scale = String(s);
    return s;
  };
  if (qs.get('teams')) document.documentElement.dataset.teams = qs.get('teams');

  /* ---------- Zahlen (de-DE, fester Zeichenvorrat) ---------- */
  const nf0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  FF.n0 = (v) => nf0.format(v);
  FF.n1 = (v) => nf1.format(v);
  FF.signed = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '±') + (d ? nf1 : nf0).format(Math.abs(v));
  FF.short = (v) => (v >= 10000 ? nf1.format(v / 1000) + ' k' : nf0.format(v));
  FF.time = (s) => { s = Math.round(s); const m = Math.floor(s / 60); return m + ':' + String(s % 60).padStart(2, '0'); };

  /* ---------- Strategic Icons (content/icons, Teamfarbe per --team) ---------- */
  FF.si = function (id, cls = '', style = '') {
    const svg = (window.FF_ICONS && window.FF_ICONS[id]) || '';
    return `<span class="ff-si ${cls}" style="${style}" aria-hidden="true">${svg}</span>`;
  };

  /* ---------- Linien-Icons 24×24 (eigene Zeichnung, currentColor) ---------- */
  const P = {
    move: '<path d="M5 19 17 7M10 7h7v7"/>',
    attack: '<circle cx="12" cy="12" r="6"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1" class="f"/>',
    attackmove: '<path d="M3 21 10 14M5 14h5v5"/><circle cx="16" cy="8" r="4.2"/><path d="M16 1.5v3M16 11.5v3M9.5 8h3M19.5 8h3"/>',
    patrol: '<path d="M5.5 10a7 7 0 0 1 12.3-3.6M18 3v4h-4M18.5 14a7 7 0 0 1-12.3 3.6M6 21v-4h4"/>',
    assist: '<path d="M3 17l5-5-5-5M10 17l5-5-5-5"/><path d="M18 6h3v12h-3z"/>',
    guard: '<path d="M12 3 20 6v6c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V6z"/>',
    reclaim: '<path d="M4 4h16l-6 8v6l-4 2v-8z"/><path d="M8 4c1 1.5 2.5 2 4 2s3-.5 4-2"/>',
    repair: '<path d="M14.7 6.3a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.7-7.7a4 4 0 0 0-2-2z"/><path d="M5 5l4 4"/>',
    stop: '<path d="M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7z"/><path d="M9 12h6"/>',
    fire_return: '<circle cx="12" cy="12" r="5.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M8.5 12h7"/>',
    fire_hold: '<circle cx="12" cy="12" r="5.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5 5l14 14"/>',
    fire_ground: '<circle cx="12" cy="10" r="5"/><path d="M12 2v3M12 15v2M4 10h3M17 10h3M3 21h18M7 21l2-3M15 18l2 3"/>',
    fire_free: '<circle cx="12" cy="12" r="5.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="1.4" class="f"/>',
    attackground: '<circle cx="12" cy="9.5" r="5"/><path d="M12 2v3M12 14v3M4.5 9.5h3M16.5 9.5h3M3 21h18"/><path d="M8 21l4-4 4 4"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="M7 5l12 7-12 7z" class="f"/>',
    selfdestruct: '<path d="M12 2.5l1.8 5.2 5-2.6-2.6 5 5.3 1.9-5.3 1.9 2.6 5-5-2.6-1.8 5.2-1.8-5.2-5 2.6 2.6-5L2.5 12l5.3-1.9-2.6-5 5 2.6z"/>',
    shield: '<path d="M3.5 18a8.5 8.5 0 0 1 17 0z"/><path d="M12 9.5v8.5M7.5 12l2 6M16.5 12l-2 6"/>',
    radar: '<path d="M12 21v-9"/><path d="M6.5 4.5l12 5.5-3 3.5-12-5.5z"/><path d="M8 21h8"/>',
    tapshot: '<path d="M13 2 6 13h5l-1.5 9L18 10h-5.2z"/>',
    formation: '<path d="M3 17h18"/><circle cx="6" cy="11" r="2"/><circle cx="12" cy="11" r="2"/><circle cx="18" cy="11" r="2"/>',
    repeat: '<path d="M17 2l3.5 3.5L17 9M3.5 11V10a4.5 4.5 0 0 1 4.5-4.5h12.5M7 22l-3.5-3.5L7 15M20.5 13v1a4.5 4.5 0 0 1-4.5 4.5H3.5"/>',
    rally: '<path d="M6 21V3.5M6 4h12l-2.5 4 2.5 4H6"/>',
    upgrade: '<path d="M6 13l6-6 6 6M6 19l6-6 6 6"/>',
    idle: '<circle cx="11" cy="13" r="7.5"/><path d="M11 9v8M7 13h8"/><path d="M16 3h5l-5 5h5" class="thin"/>',
    f_all: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"/>',
    f_land: '<path d="M6 4h12l2 2v12l-2 2H6l-2-2V6z"/>',
    f_air: '<path d="M12 4l9 16H3z"/>',
    f_fac: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M9 10h6v4H9z"/>',
    f_eng: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>',
    f_def: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><circle cx="12" cy="12" r="2.5" class="f"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
    cap: '<path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z"/><path d="M14 17h6M17 14v6"/>',
    score: '<path d="M5 20V11M12 20V4M19 20v-6M3 20h18"/>',
    speed: '<path d="M4 6l7 6-7 6M13 6l7 6-7 6"/>',
    warn: '<path d="M12 3.5 21.5 20h-19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
    crit: '<path d="M8.5 3h7L21 8.5v7L15.5 21h-7L3 15.5v-7z"/><path d="M12 7.5v6M12 16.5v.3"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.3"/>',
    ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    jump: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="1"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    console: '<path d="M4 6l6 6-6 6M12 18h8"/>',
    mass: '<path d="M12 3l8 9-8 9-8-9z" class="f"/>',
    energy: '<path d="M12 2.5c3 4.6 7 7.6 7 12a7 7 0 0 1-14 0c0-2.5 1.3-4.5 3-6 .3 2 1.3 3 2.3 3.4C9.8 8.8 10.5 5.4 12 2.5z" class="f"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    speaker: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="1"/><path d="M6 10h.5M10 10h.5M14 10h.5M18 10h.5M7 14h10"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z"/>',
    flag: '<path d="M5 21V4M5 4c3-1.5 5 1.5 8 0s4-1 6 0v9c-2-1-3-1.5-6 0s-5-1.5-8 0"/>',
    replay: '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 3v4h4"/><path d="M10 9l5 3-5 3z" class="f"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
    exit: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    chevdown: '<path d="M6 9l6 6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9" r="1" class="f"/><circle cx="15" cy="15" r="1" class="f"/><circle cx="15" cy="9" r="1" class="f"/><circle cx="9" cy="15" r="1" class="f"/>',
    cpu: '<rect x="7" y="7" width="10" height="10"/><path d="M10 2v5M14 2v5M10 17v5M14 17v5M2 10h5M2 14h5M17 10h5M17 14h5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    layers: '<path d="M12 3 21 8l-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    skull: '<path d="M12 3a7.5 7.5 0 0 0-4.5 13.5V20h9v-3.5A7.5 7.5 0 0 0 12 3z"/><circle cx="9.5" cy="11" r="1.4" class="f"/><circle cx="14.5" cy="11" r="1.4" class="f"/>',
  };
  FF.gi = function (name, cls = '') {
    const body = (P[name] || '').replace(/class="f"/g, 'fill="currentColor" stroke="none"').replace(/class="thin"/g, 'stroke-width="1.6"');
    return `<svg class="ff-gi ${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  };
  FF.giNames = Object.keys(P);

  /* ---------- Einheiten-Tooltip (Daten aus roster-data.js) ---------- */
  FF.unit = (id) => window.FF_ROSTER.units[id];
  FF.unitTip = function (id, extra = {}) {
    const u = FF.unit(id);
    if (!u) return '';
    const w = (u.weapons || []).filter((x) => x.dps && !/Abstich/.test(x.type || ''));
    const dps = w.reduce((a, x) => a + x.dps, 0);
    const range = w.reduce((a, x) => Math.max(a, x.range || 0), 0);
    const bp = extra.bp || 10;
    const secs = u.bt / bp;
    const cells = [
      ['HP', FF.n0(u.hp)],
      ['DPS', dps ? FF.n1(dps) : '–'],
      ['Reichweite', range ? FF.n0(range) + ' WU' : '–'],
    ];
    if (u.massPerSec) cells[1] = ['Mass', '+' + FF.n1(u.massPerSec) + '/s'];
    if (u.energyPerSec && u.group !== 'cmd') cells[1] = ['Energy', '+' + FF.n0(u.energyPerSec) + '/s'];
    if (u.storageMass && u.group === 'eco') cells[2] = ['Speicher', FF.n0(u.storageMass) + ' M'];
    if (u.storageEnergy && u.group === 'eco') cells[2] = ['Speicher', FF.n0(u.storageEnergy) + ' E'];
    if (u.bp && u.group !== 'eco') cells[2] = ['Build Power', FF.n0(u.bp)];
    if (u.speed) cells.push(['Tempo', FF.n1(u.speed) + ' WU/s']);
    else if (u.upkeep) cells.push(['Unterhalt', '−' + FF.n0(u.upkeep) + ' E/s']);
    else cells.push(['Sicht', u.vision ? FF.n0(u.vision) + ' WU' : '–']);
    cells.push(['Bauzeit', FF.n1(secs) + ' s', 'bei BP ' + bp]);
    cells.push(['Tech', 'T' + u.tech]);
    const layers = w.length ? [...new Set(w.flatMap((x) => x.layers || []))].map((l) => (l === 'air' ? 'Luft' : l === 'land' ? 'Land' : l)).join(' + ') : '';
    const adj = extra.adj || u.adjacency;
    return `
      <div class="ff-tip__head">${FF.si(u.icon)}<div><div class="ff-tip__name">${u.name.de}</div><div class="ff-tip__role">${u.role.de}${layers ? ' · Ziel: ' + layers : ''}</div></div>${extra.key ? `<span class="ff-key ff-key--ember">${extra.key}</span>` : ''}</div>
      <div class="ff-tip__cost">
        <span>${FF.gi('mass', 'ff-gi--mass')}<b class="num" style="color:var(--mass)">${FF.n0(u.mass)}</b></span>
        <span>${FF.gi('energy', 'ff-gi--energy')}<b class="num" style="color:var(--energy)">${FF.n0(u.energy)}</b></span>
        <span class="ff-dim num">≈ ${FF.n1(u.mass / secs)} M/s · ${FF.n0(u.energy / secs)} E/s Flow</span>
      </div>
      <div class="ff-tip__grid">${cells.map((c) => `<div><small>${c[0]}</small><b class="num">${c[1]}</b>${c[2] ? `<small style="text-transform:none">${c[2]}</small>` : ''}</div>`).join('')}</div>
      ${extra.desc ? `<div class="ff-tip__body">${extra.desc}</div>` : ''}
      ${adj ? `<div class="ff-tip__adj"><b>Nachbarschaft:</b> ${adj}</div>` : ''}
      <div class="ff-tip__foot"><span><span class="ff-key">Klick</span> platzieren</span><span><span class="ff-key">⇧</span> mehrere</span>${extra.foot || ''}</div>`;
  };

  /* ---------- Tabs (data-tabs → data-tab / data-pane) ---------- */
  FF.bindTabs = function (root = document) {
    root.querySelectorAll('[data-tabs]').forEach((group) => {
      const name = group.dataset.tabs;
      group.addEventListener('click', (e) => {
        const t = e.target.closest('[data-tab]');
        if (!t || t.classList.contains('is-disabled')) return;
        FF.selectTab(name, t.dataset.tab);
      });
    });
  };
  FF.selectTab = function (name, id) {
    document.querySelectorAll(`[data-tabs="${name}"] [data-tab]`).forEach((t) => {
      const on = t.dataset.tab === id;
      t.classList.toggle('is-selected', on);
      t.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll(`[data-pane-of="${name}"]`).forEach((p) => { p.hidden = p.dataset.pane !== id; });
  };

  /* ---------- Prozedurales Terrain (Welt-Platzhalter, keine Spiel-Assets) ---------- */
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function makeNoise(seed) {
    const r = rng(seed), perm = new Uint8Array(512), g = new Float32Array(256);
    for (let i = 0; i < 256; i++) { perm[i] = i; g[i] = r(); }
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
    const v = (x, y) => g[perm[(x & 255) + perm[y & 255]]];
    const sm = (t) => t * t * (3 - 2 * t);
    return function (x, y) {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
      const u = sm(xf), w = sm(yf);
      return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
    };
  }
  FF.heightField = function (seed, opts = {}) {
    const n = makeNoise(seed);
    const sym = opts.mirror; // Spiegelung für faire 1v1-Karten
    return function (x, y) { // x,y in 0..1
      if (sym && y < x) { const t = x; x = y; y = t; }
      let f = 0, amp = 0.55, fr = opts.freq || 3.2;
      for (let o = 0; o < 5; o++) { f += amp * n(x * fr + 17.3 * o, y * fr - 9.1 * o); amp *= 0.5; fr *= 2.03; }
      const ridge = 1 - Math.abs(n(x * 2.1 + 40, y * 2.1 - 12) * 2 - 1);
      let h = f * 0.8 + ridge * 0.28 - 0.06;
      if (opts.plateau) h = Math.round(h * 5) / 5 * 0.55 + h * 0.45; // Terrassen → Klippen
      return h;
    };
  };
  const RAMP = [
    [0.00, [18, 36, 44]], [0.34, [27, 58, 66]], [0.385, [44, 70, 66]], // Wasser
    [0.40, [58, 62, 48]], [0.47, [66, 70, 50]], [0.56, [82, 76, 56]],
    [0.65, [96, 84, 64]], [0.74, [112, 100, 84]], [0.86, [134, 126, 112]], [1.0, [160, 154, 142]],
  ];
  function ramp(h) {
    if (h <= 0) return RAMP[0][1];
    for (let i = 1; i < RAMP.length; i++) {
      if (h <= RAMP[i][0]) {
        const [h0, c0] = RAMP[i - 1], [h1, c1] = RAMP[i], t = (h - h0) / (h1 - h0);
        return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
      }
    }
    return RAMP[RAMP.length - 1][1];
  }
  FF.WATER = 0.385;
  /** Zeichnet Terrain (Draufsicht mit Hillshade) in ein Canvas. view = [x0,y0,x1,y1] in Kartenkoordinaten 0..1 */
  FF.drawTerrain = function (canvas, field, opts = {}) {
    const W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, H), d = img.data;
    const [x0, y0, x1, y1] = opts.view || [0, 0, 1, 1];
    const sx = (x1 - x0) / W, sy = (y1 - y0) / H, e = Math.max(sx, sy) * 1.5;
    const tint = opts.tint || 1, grid = opts.grid;
    const dn = opts.detail ? makeNoise(opts.detail) : null;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const x = x0 + i * sx, y = y0 + j * sy;
        const h = field(x, y);
        const dx = field(x + e, y) - field(x - e, y), dy = field(x, y + e) - field(x, y - e);
        let shade = 0.82 + (-dx * 0.9 - dy * 1.2) / (e * 2) * 0.018;
        shade = Math.max(0.45, Math.min(1.35, shade));
        let c = ramp(h);
        if (dn && h >= FF.WATER) {
          const v = dn(x * 90, y * 90) * 0.6 + dn(x * 260 + 5, y * 260) * 0.4;
          const moss = Math.max(0, dn(x * 22 + 3, y * 22 - 7) - 0.5) * 1.2;
          c = [c[0] * (0.9 + v * 0.2) - moss * 14, c[1] * (0.9 + v * 0.2) + moss * 4, c[2] * (0.88 + v * 0.18) - moss * 10];
          if (h < 0.62 && moss > 0.08 && dn(x * 900, y * 900) > 0.8) { c = [c[0] * 0.7, c[1] * 0.76, c[2] * 0.62]; }
        }
        if (h < FF.WATER) { shade = 0.92 + (FF.WATER - h) * -0.9; }
        const k = (j * W + i) * 4;
        d[k] = c[0] * shade * tint; d[k + 1] = c[1] * shade * tint; d[k + 2] = c[2] * shade * tint; d[k + 3] = 255;
        if (grid && ((i % grid) === 0 || (j % grid) === 0)) { d[k] *= 0.9; d[k + 1] *= 0.9; d[k + 2] *= 0.9; }
      }
    }
    ctx.putImageData(img, 0, 0);
    if (opts.contours) {
      ctx.globalAlpha = 0.08; ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    }
  };
  /** Deterministische Ressourcenpunkte (symmetrisch) für Karten-Vorschau, Minimap und Welt. */
  FF.spots = function (seed, field, count = 14) {
    const r = rng(seed * 7 + 3), out = [];
    let guard = 0;
    while (out.length < count && guard++ < 4000) {
      const x = 0.06 + r() * 0.88, y = 0.06 + r() * 0.88;
      if (y < x + 0.03) continue;
      const h = field(x, y);
      if (h < FF.WATER + 0.03 || h > 0.8) continue;
      if (out.some((p) => Math.hypot(p.x - x, p.y - y) < 0.09)) continue;
      const kind = out.length % 12 === 10 ? 'hydro' : 'mass';
      out.push({ x, y, kind }, { x: y, y: x, kind });
    }
    return out;
  };
})();

/* ---------- Menü-Hintergrund + Emblem ---------- */
(function () {
  const FF = window.FF;
  FF.menuBg = function (seed = 23, view = [0.18, 0.2, 0.82, 0.56]) {
    const c = document.querySelector('.menu-bg canvas');
    if (!c) return;
    c.width = Math.round(window.innerWidth / 3); c.height = Math.round(window.innerHeight / 3);
    const vw = view[2] - view[0], vh = vw * (c.height / c.width);
    FF.drawTerrain(c, FF.heightField(seed, { mirror: true, plateau: true, freq: 2.6 }), { view: [view[0], view[1], view[0] + vw, view[1] + vh], tint: 0.8, detail: 3 });
  };
  /* Emblem: Lot (Tropfen, Spitze unten) in Gussring mit Glutnaht – eigene Zeichnung */
  FF.emblem = function () {
    return `<svg viewBox="0 0 400 400" aria-hidden="true">
      <defs>
        <radialGradient id="eg" cx="50%" cy="58%" r="50%"><stop offset="0" stop-color="#ffd9a0"/><stop offset=".35" stop-color="#ff8a2a"/><stop offset="1" stop-color="#6a2a08" stop-opacity="0"/></radialGradient>
        <linearGradient id="iron" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b3632"/><stop offset="1" stop-color="#151311"/></linearGradient>
        <linearGradient id="cu" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d4955f"/><stop offset=".6" stop-color="#b06a3b"/><stop offset="1" stop-color="#4f8c7a"/></linearGradient>
      </defs>
      <circle cx="200" cy="215" r="150" fill="url(#eg)" opacity=".35"/>
      <path d="M200 30 L352 118 V282 L200 370 L48 282 V118 Z" fill="none" stroke="#2e2b29" stroke-width="22"/>
      <path d="M200 30 L352 118 V282 L200 370 L48 282 V118 Z" fill="none" stroke="url(#cu)" stroke-width="3" opacity=".8"/>
      <circle cx="200" cy="200" r="118" fill="none" stroke="url(#iron)" stroke-width="26"/>
      <circle cx="200" cy="200" r="118" fill="none" stroke="#ff8a2a" stroke-width="2" stroke-dasharray="3 14" opacity=".75"/>
      <path d="M200 318 L138 238 A76 76 0 1 1 262 238 Z" fill="url(#iron)" stroke="#0e0d0c" stroke-width="6" stroke-linejoin="round"/>
      <path d="M200 300 L152 238 A60 60 0 0 1 176 150" fill="none" stroke="#4e4741" stroke-width="3"/>
      <path d="M200 262 v-70" stroke="#ffd9a0" stroke-width="6" stroke-linecap="round"/>
      <path d="M200 262 v-70" stroke="#ff8a2a" stroke-width="14" stroke-linecap="round" opacity=".35"/>
      <circle cx="200" cy="170" r="12" fill="#ffd9a0"/><circle cx="200" cy="170" r="26" fill="#ff8a2a" opacity=".25"/>
    </svg>`;
  };
})();
