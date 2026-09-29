/* HUD-Mockup: Zustand aus URL-Parametern, Rendering als HTML-Strings (entspricht der Preact-Ausgabe). */
(function () {
  'use strict';
  const qs = FF.qs;
  const S = {
    sel: qs.get('sel') || 'vogt',
    stall: qs.get('stall') === '1',
    flow: qs.get('flow') === '1',
    paused: qs.get('paused') === '1',
    speed: parseFloat(qs.get('speed') || '1'),
    console: qs.get('console') === '1',
    place: qs.get('place') === '1',
    tip: qs.get('tip'),
    tab: 'T1',
    mouse: null,
  };
  if (qs.get('clean') === '1') document.body.classList.add('clean');
  FF.applyScale();
  const $ = (id) => document.getElementById(id);
  const gi = FF.gi, si = FF.si, n0 = FF.n0, n1 = FF.n1;

  /* ================= Welt ================= */
  const field = FF.heightField(7, { mirror: true, plateau: true, freq: 3.0 });
  let VIEW = [0, 0, 1, 1];
  const toScreen = (x, y) => [((x - VIEW[0]) / (VIEW[2] - VIEW[0])) * 100, ((y - VIEW[1]) / (VIEW[3] - VIEW[1])) * 100];

  // Kamera: Ausschnitt der 512-WU-Karte (1 WU = 1/512). Die Szene ist in Bildschirm-% notiert
  // (Mockup-Komposition) und wird für Minimap/Fog in Kartenkoordinaten umgerechnet.
  const WU = 1 / 512;
  const CAM = { cx: 0.31, cy: 0.69, vw: 0.26 };
  function setView(W, H) { const vh = CAM.vw * (H / W); VIEW = [CAM.cx - CAM.vw / 2, CAM.cy - vh / 2, CAM.cx + CAM.vw / 2, CAM.cy + vh / 2]; }
  setView(window.innerWidth, window.innerHeight);
  const M = (sx, sy, o = {}) => Object.assign({ x: VIEW[0] + (sx / 100) * (VIEW[2] - VIEW[0]), y: VIEW[1] + (sy / 100) * (VIEW[3] - VIEW[1]), sx, sy }, o);
  let own, army, enemy, blips, ghostsEnemy, wrecks, queuedGhosts, building, allSpots;
  function buildScene() {
    own = [
      M(40, 45, { i: 'cmd_commander', cls: 'wu--cmd', hp: 0.86, sel: 'vogt', bp: 0.64, vision: 26 }),
      M(24, 52, { i: 'struct_fac_land_t1', cls: 'wu--l', sel: 'factory', hp: 1, vision: 20 }),
      M(21.4, 52, { i: 'struct_energy_t1' }), M(26.6, 52, { i: 'struct_energy_t1' }), M(24, 47.2, { i: 'struct_energy_t1' }),
      M(24, 56.8, { i: 'struct_estore_t1' }),
      M(11.5, 58, { i: 'struct_mass_t1', vision: 12 }), M(14.5, 62, { i: 'struct_mass_t1' }), M(10.5, 64.5, { i: 'struct_mass_t1' }), M(12.4, 61.6, { i: 'struct_mstore_t1', cls: 'wu--s' }),
      M(38, 63, { i: 'struct_mass_t1', vision: 12 }), M(32, 67, { i: 'struct_hydro_t1', vision: 14 }),
      M(58, 40, { i: 'struct_direct_t1', vision: 26, ring: 26 }), M(54, 46, { i: 'struct_aa_t1', vision: 20 }),
      M(28.5, 44, { i: 'eng_build_t1', cls: 'wu--s', bp: 0.3, vision: 18 }),
      M(16, 44, { i: 'eng_build_t1', cls: 'wu--s', idle: true, vision: 18 }),
      M(29, 63, { i: 'eng_build_t1', cls: 'wu--s', vision: 18 }),
      M(70, 38, { i: 'land_intel_t1', cls: 'wu--s', hp: 0.4, vision: 34 }),
    ];
    army = [];
    const armyDef = [['land_direct_t1', 9], ['land_bot_t1', 4], ['land_arty_t1', 3], ['land_aa_t1', 2], ['eng_build_t1', 1]];
    let k = 0;
    armyDef.forEach(([id, n]) => { for (let j = 0; j < n; j++, k++) {
      const row = Math.floor(k / 6), col = k % 6;
      army.push(M(55 + col * 2.3 + (row % 2) * 1.1, 17 + row * 4 + col * 0.5, { i: id, cls: id === 'eng_build_t1' ? 'wu--s' : '', hp: k === 3 ? 0.35 : k === 7 ? 0.6 : k === 11 ? 0.2 : 1, sel: 'army', vision: 20 }));
    } });
    enemy = [M(71.5, 20, { i: 'land_direct_t1' }), M(73.5, 16.5, { i: 'land_direct_t1' }), M(70.5, 25, { i: 'land_bot_t1' }), M(75, 23, { i: 'land_arty_t1' })];
    blips = [M(79, 15), M(80.5, 21), M(78.5, 29)];
    ghostsEnemy = [M(77, 9, { i: 'struct_direct_t1.ghost' })];
    wrecks = [M(64.5, 33), M(66.5, 30.5), M(63, 30)];
    queuedGhosts = [M(46.4, 40, { i: 'struct_energy_t1.ghost' }), M(49, 40, { i: 'struct_energy_t1.ghost' }), M(52, 52, { i: 'struct_mass_t1.ghost' })];
    building = M(43.8, 40, { i: 'struct_energy_t1', p: 0.64 });
    const sp = [[11.5, 58], [14.5, 62], [10.5, 64.5], [38, 63], [52, 52], [45, 70], [6, 36], [66, 60], [30, 20], [48, 8]].map(([x, y]) => M(x, y, { kind: 'mass' }));
    sp.push(M(32, 67, { kind: 'hydro' }));
    allSpots = sp.concat(sp.map((p) => ({ x: p.y, y: p.x, kind: p.kind }))).concat(FF.spots(11, field, 6));
  }
  buildScene();

  function drawWorld() {
    const c = $('world'), f = $('fog');
    const W = Math.round(window.innerWidth / 2), H = Math.round(window.innerHeight / 2);
    c.width = W; c.height = H; f.width = W; f.height = H;
    const vw = CAM.vw;
    FF.drawTerrain(c, field, { view: VIEW, tint: 0.95, detail: 5 });
    // Fog of War: nie gesehen sehr dunkel, erkundet gedimmt, sichtbar klar (I1)
    const g = f.getContext('2d');
    g.fillStyle = 'rgba(6,5,4,0.62)'; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-out';
    const pxPerMap = W / vw;
    own.concat(army).forEach((u) => {
      const r = (u.vision || 16) * WU * pxPerMap;
      const [sx, sy] = toScreen(u.x, u.y);
      const grd = g.createRadialGradient(sx / 100 * W, sy / 100 * H, r * 0.7, sx / 100 * W, sy / 100 * H, r);
      grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(sx / 100 * W, sy / 100 * H, r, 0, Math.PI * 2); g.fill();
    });
    g.globalCompositeOperation = 'source-over';
    renderWorldUnits(pxPerMap * 2);
  }

  function unitEl(u, extra = '') {
    const [x, y] = toScreen(u.x, u.y);
    if (x < -3 || x > 103 || y < -3 || y > 103) return '';
    const sel = u.sel && u.sel === S.sel ? ' is-sel' : '';
    const hp = u.hp !== undefined && (sel || u.hp < 1) ? `<span class="wu__hp ${u.hp < 0.3 ? 'is-crit' : u.hp < 0.55 ? 'is-warn' : ''}"><i style="--v:${u.hp}"></i></span>` : '';
    const bp = u.bp && sel ? `<span class="wu__bp"><i style="--v:${u.bp}"></i></span>` : '';
    return `<div class="wu ${u.cls || ''}${sel}${extra}" style="left:${x}%;top:${y}%">${si(u.i, u.enemy ? 'ff-si--enemy' : '')}${hp}${bp}${u.label ? `<span class="wu__label">${u.label}</span>` : ''}</div>`;
  }

  function renderWorldUnits(pxPerMapCss) {
    let h = '';
    allSpots.forEach((p) => {
      const [x, y] = toScreen(p.x, p.y);
      if (x > -2 && x < 102 && y > -2 && y < 102) h += `<span class="wu__spot ${p.kind === 'hydro' ? 'wu__spot--hydro' : ''}" style="left:${x}%;top:${y}%"></span>`;
    });
    wrecks.forEach((w) => { const [x, y] = toScreen(w.x, w.y); h += `<div class="wu wu--s" style="left:${x}%;top:${y}%;opacity:.55;filter:grayscale(1) brightness(.7)">${si('land_direct_t1', 'ff-si--neutral')}</div>`; });
    queuedGhosts.forEach((g) => { if (S.sel === 'vogt') h += unitEl(g, ' is-ghost'); });
    h += unitEl({ ...building }, '');
    own.forEach((u) => (h += unitEl(u)));
    army.forEach((u) => (h += unitEl(u)));
    enemy.forEach((u) => (h += unitEl({ ...u, enemy: true })));
    ghostsEnemy.forEach((u) => { const [x, y] = toScreen(u.x, u.y); h += `<div class="wu" style="left:${x}%;top:${y}%;--team:var(--team-enemy)">${FF.si(u.i, 'ff-si--enemy')}</div>`; });
    blips.forEach((b) => { const [x, y] = toScreen(b.x, b.y); h += `<div class="wu" style="left:${x}%;top:${y}%">${si('blip_ground')}</div>`; });
    if (S.place) h += placementGhosts();
    $('worldUnits').innerHTML = h;

    // SVG-Overlays: Wegpunkte (C5), Baustrahl, Rally (B3), Range-Ring (C15)
    const W = window.innerWidth, H = window.innerHeight;
    const P = (u) => { const [x, y] = toScreen(u.x, u.y); return [x / 100 * W, y / 100 * H]; };
    let s = `<defs><marker id="dot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5"><circle cx="5" cy="5" r="4" fill="#ffd9a0"/></marker></defs>`;
    const pd = own.find((u) => u.ring);
    if (pd && (qs.get('ring') === '1' || S.tip === 'Z')) {
      const [x, y] = P(pd), r = pd.ring * WU * (W / (VIEW[2] - VIEW[0]));
      s += `<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(255,90,69,0.05)" stroke="rgba(255,140,110,0.75)" stroke-width="1.5" stroke-dasharray="7 5"/>`;
    }
    if (S.sel === 'vogt') {
      const v = P(own[0]), b = P(building);
      s += `<path d="M${v[0]} ${v[1] - 8} Q ${(v[0] + b[0]) / 2} ${Math.min(v[1], b[1]) - 26} ${b[0]} ${b[1]}" stroke="#ff8a2a" stroke-width="3" fill="none" opacity=".9" stroke-linecap="round"/>`;
      s += `<path d="M${v[0]} ${v[1] - 8} Q ${(v[0] + b[0]) / 2} ${Math.min(v[1], b[1]) - 26} ${b[0]} ${b[1]}" stroke="#ffd9a0" stroke-width="1" fill="none" stroke-dasharray="2 6"/>`;
      const pts = [b, ...queuedGhosts.map(P)];
      s += `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#ffd9a0" stroke-width="1.5" stroke-dasharray="5 4" opacity=".8" marker-mid="url(#dot)" marker-end="url(#dot)"/>`;
      // Bauradius des Vogts
      const r = 10 * WU * (W / (VIEW[2] - VIEW[0]));
      s += `<circle cx="${v[0]}" cy="${v[1]}" r="${r}" fill="none" stroke="rgba(255,217,160,.35)" stroke-width="1" stroke-dasharray="2 4"/>`;
    }
    if (S.sel === 'factory') {
      const f = P(own[1]), r1 = P(M(34, 50)), r2 = P(M(44, 55));
      s += `<polyline points="${f.join(',')} ${r1.join(',')} ${r2.join(',')}" fill="none" stroke="#8fd18b" stroke-width="1.5" stroke-dasharray="6 4"/>`;
      s += `<g transform="translate(${r2[0]},${r2[1]})"><path d="M0 0V-22M0 -22h14l-4 5 4 5H0" fill="rgba(143,209,139,.25)" stroke="#8fd18b" stroke-width="1.8"/></g>`;
    }
    if (S.sel === 'army') {
      const a = army.slice(0, 18).map(P), cx = a.reduce((q, p) => q + p[0], 0) / a.length, cy = a.reduce((q, p) => q + p[1], 0) / a.length;
      const t = P(M(72, 21));
      s += `<line x1="${cx}" y1="${cy}" x2="${t[0]}" y2="${t[1]}" stroke="#ff7a5c" stroke-width="1.6" stroke-dasharray="6 4"/>`;
      s += `<g transform="translate(${t[0]},${t[1]})" stroke="#ff7a5c" stroke-width="2" fill="none"><circle r="9"/><path d="M0 -15v6M0 9v6M-15 0h6M9 0h6"/></g>`;
    }
    $('worldSvg').setAttribute('viewBox', `0 0 ${W} ${H}`);
    $('worldSvg').innerHTML = s;
  }

  function placementGhosts() {
    // Drag-Build (ui.md §7.5): Linie aus 4 Ghosts, einer ungültig
    const base = M(26.6, 56.8), step = 0.0068;
    let h = '';
    const size = 2 * WU * ((window.innerWidth) / (VIEW[2] - VIEW[0])) * 1.6;
    for (let k = 0; k < 4; k++) {
      const p = { x: base.x + k * step, y: base.y };
      const [x, y] = toScreen(p.x, p.y);
      const bad = k === 3;
      h += `<div class="ghost-fp ${bad ? 'is-bad' : ''}" style="left:${x}%;top:${y}%;width:${size}px;height:${size}px"></div>`;
      h += `<div class="wu is-ghost" style="left:${x}%;top:${y}%">${si('struct_energy_t1.ghost')}</div>`;
      if (k === 0) h += `<div class="ghost-tag" style="left:${x}%;top:calc(${y}% + 1.5rem)">+25 % Produktion (Glutspeicher)</div>`;
      if (bad) h += `<div class="ghost-tag is-bad" style="left:${x}%;top:calc(${y}% + 1.5rem)">blockiert: Neigung</div>`;
    }
    const [cx, cy] = toScreen(base.x + 3 * step, base.y);
    h += `<div class="fake-cursor" style="left:calc(${cx}% + 14px);top:calc(${cy}% - 6px)"><svg viewBox="0 0 32 32" width="100%" height="100%"><path d="M3 3l10 24 3-10 10-3z" fill="#ffd9a0" stroke="#1a0c03" stroke-width="1.5"/><path d="M20 20h9M24.5 15.5v9" stroke="#ffd9a0" stroke-width="2.5"/></svg><span class="fake-cursor__lbl">Glutkessel I ×4 · Ziehen = Linie · ⇧ weiterbauen · Rechtsklick Abbruch</span></div>`;
    return h;
  }

  /* ================= Minimap (C16, Canvas2D 4 Hz) ================= */
  let mmBase = null;
  function drawMinimap() {
    const c = $('minimap'), W = c.width, H = c.height, g = c.getContext('2d');
    if (!mmBase) {
      const t = document.createElement('canvas'); t.width = 200; t.height = 200;
      FF.drawTerrain(t, field, { tint: 0.95 });
      mmBase = t;
    }
    g.imageSmoothingEnabled = true;
    g.drawImage(mmBase, 0, 0, W, H);
    // erkundet/nie gesehen
    g.fillStyle = 'rgba(5,4,3,0.55)';
    g.beginPath(); g.rect(0, 0, W, H);
    g.moveTo(0, H * 0.45); g.lineTo(W * 0.62, H); g.lineTo(0, H); g.closePath();
    g.fill('evenodd');
    g.fillStyle = 'rgba(5,4,3,0.35)'; g.beginPath(); g.moveTo(0, H * 0.45); g.lineTo(W * 0.62, H); g.lineTo(0, H); g.fill();
    g.globalCompositeOperation = 'destination-out';
    own.concat(army).forEach((u) => { const r = (u.vision || 16) * WU * W; g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(u.x * W, u.y * H, r, 0, 7); g.fill(); });
    g.globalCompositeOperation = 'source-over';
    // Ressourcenpunkte
    allSpots.forEach((p) => { g.fillStyle = p.kind === 'hydro' ? '#8fd0e8' : '#7fd1b2'; g.save(); g.translate(p.x * W, p.y * H); g.rotate(Math.PI / 4); g.fillRect(-2.5, -2.5, 5, 5); g.restore(); });
    const team = getComputedStyle(document.documentElement).getPropertyValue('--team-self').trim() || '#2f6fd0';
    const teamE = getComputedStyle(document.documentElement).getPropertyValue('--team-enemy').trim() || '#c8372d';
    const dot = (u, col, s) => { g.fillStyle = '#0b0a09'; g.fillRect(u.x * W - s / 2 - 1, u.y * H - s / 2 - 1, s + 2, s + 2); g.fillStyle = col; g.fillRect(u.x * W - s / 2, u.y * H - s / 2, s, s); };
    own.forEach((u) => dot(u, team, u.i.startsWith('struct') ? 6 : 5));
    army.forEach((u) => dot(u, team, 4));
    // gegnerische Basis (Ghosts, erkundet) + sichtbare Feinde
    [[0.78, 0.22], [0.76, 0.2], [0.8, 0.24], [0.74, 0.25], [0.64, 0.35]].forEach(([x, y]) => { g.strokeStyle = teamE; g.lineWidth = 1.5; g.strokeRect(x * W - 3, y * H - 3, 6, 6); });
    enemy.forEach((u) => dot(u, teamE, 5));
    blips.forEach((b) => { g.strokeStyle = '#9a9a9a'; g.lineWidth = 1.5; g.beginPath(); g.arc(b.x * W, b.y * H, 3.5, 0, 7); g.stroke(); });
    // Alert-Ping
    const ping = [own[own.length - 1].x, own[own.length - 1].y];
    g.strokeStyle = 'rgba(255,138,42,0.95)'; g.lineWidth = 2; g.beginPath(); g.arc(ping[0] * W, ping[1] * H, 11, 0, 7); g.stroke();
    g.strokeStyle = 'rgba(255,138,42,0.45)'; g.beginPath(); g.arc(ping[0] * W, ping[1] * H, 19, 0, 7); g.stroke();
    // Kamera-Rahmen (Trapez = Perspektive)
    const [x0, y0, x1, y1] = VIEW;
    g.strokeStyle = 'rgba(241,235,223,0.95)'; g.lineWidth = 1.5; g.beginPath();
    g.moveTo(x0 * W - 6, y0 * H); g.lineTo(x1 * W + 6, y0 * H); g.lineTo(x1 * W, y1 * H); g.lineTo(x0 * W, y1 * H); g.closePath(); g.stroke();
  }

  /* ================= Ressourcenleiste ================= */
  function ecoModel() {
    if (S.stall) return {
      mass: { store: 0, max: 1230, inc: 28, req: 39.2, use: 28, eff: 0.72, full: false },
      energy: { store: 0, max: 4900, inc: 220, req: 305, use: 220, eff: 0.72, full: false },
    };
    return {
      mass: { store: 312, max: 1230, inc: 28, req: 31.5, use: 31.5, eff: 1 },
      energy: { store: 2840, max: 4900, inc: 340, req: 296, use: 296, eff: 1 },
    };
  }
  function resEl(kind, m) {
    const net = m.inc - m.use;
    const stall = m.eff < 1;
    const cls = stall ? 'is-stall' : m.store >= m.max ? 'is-full' : '';
    const badge = '';
    const shown = stall ? m.inc - m.req : net;
    const label = kind === 'mass' ? 'Mass' : 'Energy';
    return `<div class="res res--${kind} ff-panel ${cls}" data-component="ResourceMeter" data-res="${kind}" tabindex="0" aria-label="${label}: ${n0(m.store)} von ${n0(m.max)}, netto ${FF.signed(net)} pro Sekunde">
      ${badge}
      <div class="res__glyph">${gi(kind)}</div>
      <div class="res__store num">${n0(m.store)}<small>/ ${n0(m.max)}</small></div>
      <div class="res__net num ${shown > 0.05 ? 'is-pos' : shown < -0.05 ? 'is-neg' : 'is-zero'}" title="${stall ? 'Fehlbetrag: Einkommen − Bedarf' : 'Netto: Einkommen − Verbrauch'}">${FF.signed(shown)}</div>
      <div class="res__bar ff-bar ff-bar--${kind}"><i style="--v:${m.store / m.max}"></i></div>
      <div class="res__flow num"><span class="in">+<b>${n1(m.inc)}</b></span><span class="out">−<b>${n1(m.use)}</b></span>${stall ? `<span class="eff"><span class="ff-badge ff-badge--crit">${gi('crit')}Stall · Flow ${Math.round(m.eff * 100)} %</span></span>` : m.store >= m.max ? `<span class="eff"><span class="ff-badge ff-badge--warn">Voll · verfällt</span></span>` : `<span class="eff">Flow <b>${Math.round(m.eff * 100)} %</b></span>`}</div>
    </div>`;
  }
  function renderEco() {
    const m = ecoModel();
    $('eco').innerHTML = resEl('mass', m.mass) + resEl('energy', m.energy);
    const f = $('flow');
    f.hidden = !(S.flow || S.stall);
    if (f.hidden) return;
    const eff = S.stall ? 0.72 : 1;
    const rows = [
      ['struct_fac_land_t1', 'Landwerk I · Punze', 10.9, 54.4, false],
      ['cmd_commander', 'Vogt · Glutkessel I', 6.0, 60, false],
      ['eng_build_t1', 'Lehrling ×2 · Zapfstelle I', 6.0, 60, false],
      ['struct_mass_t1', 'Zapfstelle I → II', 7.3, 43.6, true],
      ['struct_intel_t1', 'Horcher I (Unterhalt)', 0, 20, false],
    ];
    const row = (r, res) => {
      const want = res === 'm' ? r[2] : r[3];
      if (!want) return '';
      const got = r[4] ? 0 : want * eff;
      return `<div class="flow__row ${r[4] ? 'is-paused' : ''}">${si(r[0])}<span>${r[1]}</span><span class="num">${n1(got)}</span><span class="num want">/ ${n1(want)}</span><button class="flow__pause ${r[4] ? 'is-on' : ''}" title="${r[4] ? 'Fortsetzen' : 'Pausieren'} (E13)">${gi(r[4] ? 'play' : 'pause')}</button></div>`;
    };
    f.innerHTML = `<div class="ff-ph">Flow-Verteilung<span class="ff-ph__end">${S.stall ? '<span class="ff-badge ff-badge--crit">alle Verbraucher 72 %</span>' : 'kein Engpass'}</span></div>
      <div class="flow__body">
        <div class="flow__col"><div class="flow__head"><span style="color:var(--mass)">Mass /s</span><span>erhält / Bedarf</span></div>${rows.map((r) => row(r, 'm')).join('')}</div>
        <div class="flow__col"><div class="flow__head"><span style="color:var(--energy)">Energy /s</span><span>erhält / Bedarf</span></div>${rows.map((r) => row(r, 'e')).join('')}</div>
      </div>
      <div class="flow__foot"><span class="flow__paused">${gi('pause')}1 pausiert</span><span>Stall-Priorität: <b style="color:var(--text)">Fabriken ▸ Engineers ▸ Upgrades</b> (E13)</span><span style="margin-left:auto"><span class="ff-key">Klick</span> Leiste öffnet/schließt</span></div>`;
  }

  /* ================= Status / Banner ================= */
  function renderStatus() {
    const speedChanged = S.speed !== 1;
    $('status').innerHTML = `<div class="status__inner">
      <div class="stat stat--timer" title="Spielzeit (Sim-Zeit)">${gi('timer')}<b class="num">11:42</b></div>
      <div class="stat stat--speed ${speedChanged ? 'is-changed' : ''}" title="Sim-Tempo (A6): − / +">${gi('speed')}<b class="num">×${n1(S.speed)}</b></div>
      <div class="stat stat--cap" title="Einheiten / Unit-Cap (U7)">${gi('cap')}<b class="num">${S.sel === 'army' ? '71' : '64'}</b><span class="ff-lo num">/ 500</span></div>
      ${qs.get('score') === '1' ? `<div class="stat stat--score" title="Punkte (A19 Post-MVP; im MVP nur im Replay)">${gi('score')}<span class="score-chip" style="--team:var(--team-self)"><i></i><b class="num">8.412</b></span><span class="score-chip" style="--team:var(--team-enemy)"><i></i><b class="num">7.980</b></span></div>` : ''}
      <button class="status__menu" title="Menü (Esc)" aria-label="Menü">${gi('menu')}</button>
    </div>`;
    const b = $('banner');
    if (S.paused) {
      b.hidden = false; b.className = 'banner ff-panel ff-panel--ember';
      b.innerHTML = `<div class="banner__title">PAUSE</div><div class="banner__sub">Sim angehalten · Kamera und Befehle bleiben aktiv · <span class="ff-key">P</span> fortsetzen</div>`;
    } else if (S.speed !== 1) {
      b.hidden = false; b.className = 'banner banner--speed ff-panel';
      b.innerHTML = `<div class="banner__title num">SIM-TEMPO ×${n1(S.speed)}</div>`;
    } else b.hidden = true;
  }

  /* ================= Alerts (P8) ================= */
  const ALERTS = {
    vogt: [
      ['ok', 'ok', 'Bau fertig: Zapfstelle I', 'Mex-Feld Süd · vor 3 s', true],
      ['warn', 'warn', 'Einheit angegriffen', 'Funke · Kartenmitte · vor 9 s', false],
      ['info', 'info', 'Feind-Vogt gesichtet', 'Nordost · vor 48 s', false, true],
    ],
    army: [
      ['crit', 'crit', 'Vogt unter Feuer', 'Basis · vor 1 s', true],
      ['warn', 'warn', 'Basis angegriffen', 'Riegel I · Osthang · vor 6 s', false],
      ['info', 'info', 'Feind-Vogt gesichtet', 'Nordost · vor 51 s', false, true],
    ],
    factory: [
      ['ok', 'ok', 'Werk freigesprochen: Landwerk II', 'Hauptbasis · vor 2 s', true],
      ['ok', 'ok', 'Bau fertig: Punze ×5', 'Landwerk I · vor 14 s', false, true],
    ],
    none: [['warn', 'warn', 'Einheit angegriffen', 'Funke · Kartenmitte · vor 4 s', true]],
  };
  function renderAlerts() {
    let list = (ALERTS[S.sel] || ALERTS.vogt).slice();
    if (S.stall) list = [['crit', 'crit', 'Energie knapp', 'Flow 72 % · alle Baustellen gedrosselt', true], ...list.slice(0, 2)];
    $('alerts').innerHTML = list.map((a, i) => `<div class="ff-alert ff-alert--${a[0]} ${a[4] ? 'is-new' : ''} ${a[5] ? 'is-stale' : ''}" data-component="Alert">
        <span class="ff-alert__ico">${gi(a[1])}</span>
        <div class="ff-alert__txt"><div class="ff-alert__title">${a[2]}</div><div class="ff-alert__meta">${a[3]}</div></div>
        <button class="ff-alert__jump" title="Zum Ort springen">${gi('jump')}${i === 0 ? '<span class="ff-key">␣</span>' : 'Ort'}</button>
      </div>`).join('') + `<div class="alerts__more">3 ältere · <span class="ff-key">⇧␣</span> durchblättern</div>`;
  }

  /* ================= Filter, Gruppen, Befehlsleiste ================= */
  function renderStrip() {
    $('filters').innerHTML = [
      ['f_land', 'Alle Landeinheiten', 'F2'], ['f_air', 'Alle Lufteinheiten', 'F3'], ['f_fac', 'Alle Fabriken', 'F4'], ['f_eng', 'Alle Engineers', 'F6'],
    ].map(([ic, t, k]) => `<button class="ff-order" title="${t} (${k}) · ⇧ = aktuelle Auswahl filtern">${gi(ic)}<span class="ff-order__key">${k}</span></button>`).join('') +
      `<div class="idle"><button class="ff-order" title="Untätiger Engineer (.) · ⇧. = alle untätigen">${gi('idle')}<span class="ff-order__key">.</span></button><span class="idle__n">2</span></div>`;
    const groups = [['1', 'land_direct_t1', 18], ['2', 'land_arty_t1', 3], ['3', 'struct_fac_land_t1', 1], ['4', 'eng_build_t1', 2], ['5'], ['6'], ['7'], ['8'], ['9'], ['0']];
    const active = S.sel === 'army' ? '1' : S.sel === 'factory' ? '3' : '';
    $('groups').innerHTML = groups.map(([k, ic, n]) => ic
      ? `<button class="grp ${k === active ? 'is-active' : ''}" title="Gruppe ${k}: abrufen ${k} · doppelt = Kamera · Alt+${k} oder Rechtsklick = speichern · ⇧Rechtsklick = hinzufügen">${`<span class="grp__k">${k}</span>`}${si(ic)}<span class="grp__n num">${n}</span></button>`
      : `<button class="grp is-empty" title="Gruppe ${k} leer · Alt+${k} oder Rechtsklick = Auswahl speichern"><span class="grp__k">${k}</span></button>`).join('');
    const hasBuild = S.sel === 'vogt' || S.sel === 'factory';
    const o = $('orders');
    if (!hasBuild) { o.innerHTML = ''; return; }
    const on = (k) => ORDERS_STATE[S.sel] && ORDERS_STATE[S.sel][k];
    o.innerHTML = `<span class="orders__hint">Befehle <span class="ff-key">Alt</span>+</span>` + ORDER_ROWS.map((row) => `<div class="orders__grp">${row.map((k) => orderBtn(k, on(k))).join('')}</div>`).join('');
  }
  // [Icon, Name (Tooltip), ID, Kurzlabel für die 58-px-Zelle (≤ 10 Zeichen, i18n-Key ui.order.<id>.short)]
  const ORDER = {
    Q: ['move', 'Bewegen', 'C4', 'Bewegen'], W: ['patrol', 'Patrouille', 'C12', 'Patrouille'], E: ['assist', 'Assist / Bewachen', 'B2', 'Assist'], R: ['reclaim', 'Reclaim', 'E7', 'Reclaim'], T: ['repair', 'Reparieren', 'G4', 'Reparieren'],
    A: ['attackmove', 'Angriff / Angriffsbewegung', 'C6', 'Angriff'], S: ['stop', 'Stop', 'S3', 'Stop'], D: ['pause', 'Pausieren', 'E13', 'Pause'], F: ['fire_return', 'Feuermodus', 'K6', 'Feuer'], G: ['shield', 'Fähigkeit umschalten', 'C17', 'Fähigkeit'],
    Z: ['attackground', 'Boden angreifen', 'K6', 'Boden'], X: ['tapshot', 'Abstich (manuell)', 'U8', 'Abstich'], C: ['formation', 'Formation', 'C13', 'Formation'], V: null, B: ['selfdestruct', 'Selbstzerstörung – nur Klick oder Strg+Entf, keine Rastertaste', 'C18', 'Sprengen'],
  };
  // Review: Selbstzerstörung liegt nie auf einer Rastertaste (B ist auf Gebäude-/Fabrikseiten „Upgrade“).
  const KEYLBL = (k, bar) => (k === 'B' ? (bar ? '' : 'Entf') : LBL(k)); // Strg+Entf: Zelle zeigt „Entf“, die 40-px-Leiste nur den Tooltip
  const ORDER_ROWS = [['Q', 'W', 'E', 'R', 'T'], ['A', 'S', 'D', 'F', 'G'], ['Z', 'X', 'C', 'B']];
  const ORDERS_STATE = {
    vogt: { R: 'on', G: 'auto', X: 'ready', C: 'off', D: 'off' },
    factory: { Q: 'off', W: 'off', R: 'off', T: 'off', A: 'off', F: 'off', Z: 'off', X: 'off', C: 'off', G: 'off', E: 'off' },
    army: { R: 'off', T: 'off', D: 'off', G: 'off', X: 'off', C: 'off', Z: 'part' },
  };
  function orderBtn(k, st) {
    const d = ORDER[k];
    if (!d) return '';
    const dis = st === 'off';
    const cls = ['ff-order', dis ? 'is-disabled' : '', st === 'auto' ? 'is-on' : '', k === 'B' ? 'ff-order--danger' : '', S.armed === k ? 'is-armed' : ''].join(' ');
    const dots = k === 'F' ? `<span class="ff-order__dots"><i class="on"></i><i></i><i></i></span>` : '';
    return `<button class="${cls}" data-order="${k}" title="${d[1]} (${k === 'B' ? 'Strg+Entf' : 'Alt+' + LBL(k)}) · ${d[2]}${dis ? ' – für diese Auswahl nicht verfügbar' : ''}">${dots}${gi(d[0])}<span class="ff-order__key">${KEYLBL(k, true)}</span></button>`;
  }

  /* ================= Auswahl-Panel (C9) ================= */
  function renderSel() {
    const el = $('sel');
    if (S.sel === 'none') {
      el.innerHTML = `<div class="ff-ph">Auswahl<span class="ff-ph__end">leer</span></div><div class="sel__body" style="place-items:center;color:var(--text-lo);text-align:center;font-size:var(--fs-cap)"><div>Nichts ausgewählt<br><span class="ff-lo">Klick / Rahmen ziehen · <span class="ff-key">H</span> Vogt · <span class="ff-key">.</span> untätiger Engineer · <span class="ff-key">Strg</span>+<span class="ff-key">A</span> alle</span></div></div>`;
      return;
    }
    if (S.sel === 'vogt') {
      const u = FF.unit('core:cmd_commander');
      el.innerHTML = `<div class="ff-ph">Auswahl · 1 Einheit<span class="ff-ph__end">Haus Ambrecht</span></div>
      <div class="sel__body sel__body--single">
        <div class="portrait">${si('cmd_commander')}<span class="portrait__tech">CMD</span><span class="portrait__vet"><span class="ff-vet" title="Veteranenstufe 1 von 5 (U9)"><i class="on"></i><i></i><i></i><i></i><i></i></span></span></div>
        <div class="uinfo">
          <div class="uinfo__name"><b>${u.name.de}</b><span>${u.role.de} · Tod = Niederlage</span></div>
          <div class="meter"><span>HP</span><div class="ff-bar ff-bar--hp"><i style="--v:.86"></i></div><span class="num">10.320 / 12.000</span></div>
          <div class="meter"><span>Vet</span><div class="ff-bar" style="height:.3125rem"><i style="--v:.42;--bar:var(--copper-300)"></i></div><span class="num">420 / 1.000 M</span></div>
          <div class="meter"><span>Abstich</span><div class="ff-bar ff-bar--energy"><i style="--v:.58"></i></div><span class="num" style="color:var(--text-mid)">2.840 / 7.500 E</span></div>
          <div class="stats num"><span>DPS <b>100</b></span><span>RW <b>22</b></span><span>Tempo <b>1,7</b></span><span>Sicht <b>26</b></span><span>BP <b>10</b></span><span>Regen <b>10/s</b></span></div>
        </div>
        <div class="qlist" data-component="OrderQueue">
          <div class="qlist__h"><span>Befehlskette</span><span class="ff-lo">⇧ anhängen</span></div>
          <div class="qi is-now">${gi('assist')}${si('struct_energy_t1')}<span>Glutkessel I</span><span class="qi__p num">64 %</span></div>
          <div class="qi"><span class="n">2</span>${si('struct_energy_t1')}<span>Glutkessel I</span><span class="ff-lo num">0 %</span></div>
          <div class="qi"><span class="n">3</span>${si('struct_energy_t1')}<span>Glutkessel I</span><span class="ff-lo num">0 %</span></div>
          <div class="qi"><span class="n">4</span>${si('struct_mass_t1')}<span>Zapfstelle I</span><span class="ff-lo num">0 %</span></div>
          <div class="qi"><span class="n">5</span>${gi('reclaim')}<span>Reclaim · 3 Wracks</span><span class="ff-lo num">86 M</span></div>
        </div>
      </div>`;
      return;
    }
    if (S.sel === 'army') {
      const types = [
        ['land_direct_t1', 'Punze', 9, 0.82, 2, 2], ['land_bot_t1', 'Stichel', 4, 0.9, 0, 1], ['land_arty_t1', 'Kelle', 3, 1, 0, 0],
        ['land_aa_t1', 'Sieb', 2, 1, 0, 0], ['eng_build_t1', 'Lehrling', 1, 1, 0, 0],
      ];
      el.innerHTML = `<div class="ff-ph">Auswahl · 19 Einheiten · 5 Typen<span class="ff-ph__end">Gruppe 1</span></div>
      <div class="sel__body sel__body--multi">
        <div class="tiles" data-component="SelectionGroups">${types.map((t, i) => `<button class="tile ${i === 0 ? 'is-focus' : ''}" title="${t[1]} ×${t[2]} · Klick: nur diese · ⇧Klick: entfernen · Strg+Klick: nur beschädigte">
          ${si(t[0])}<span class="tile__n num">×${t[2]}</span>
          <span class="tile__hp ff-bar ff-bar--hp ${t[3] < 0.55 ? 'is-warn' : ''}"><i style="--v:${t[3]}"></i></span>
          ${t[4] ? `<span class="tile__dmg num">${t[4]} &lt;50 %</span>` : ''}
          <span class="ff-vet">${[0, 1, 2].map((v) => `<i class="${v < t[5] ? 'on' : ''}"></i>`).join('')}</span></button>`).join('')}</div>
        <div class="units" data-component="SelectionUnits">${army.map((u, i) => `<button class="unit ${u.hp < 0.3 ? 'is-crit' : u.hp < 0.55 ? 'is-warn' : ''}" title="Klick: nur diese Einheit · ⇧Klick: abwählen">${si(u.i)}<span class="unit__hp"><i style="--v:${u.hp}"></i></span></button>`).join('')}</div>
        <div class="sumrow num"><span>Σ DPS <b>420</b></span><span>Σ Mass <b>1.034</b></span><span>Ø HP <b>88 %</b></span><span>Tempo <b>2,7</b> <span class="ff-lo">(langsamste)</span></span><span class="ff-lo" style="margin-left:auto"><span class="ff-key">Tab</span> Typ wechseln</span></div>
      </div>`;
      return;
    }
    if (S.sel === 'factory') {
      el.innerHTML = `<div class="ff-ph">Auswahl · Landwerk I<span class="ff-ph__end">Gruppe 3</span></div>
      <div class="sel__body sel__body--factory">
        <div class="portrait">${si('struct_fac_land_t1')}<span class="portrait__tech">T1</span></div>
        <div class="uinfo">
          <div class="uinfo__name"><b>Landwerk I</b><span>Landfabrik</span></div>
          <div class="meter"><span>HP</span><div class="ff-bar ff-bar--hp"><i style="--v:1"></i></div><span class="num">4.200 / 4.200</span></div>
          <div class="meter"><span>BP</span><div class="ff-bar" style="height:.3125rem"><i style="--v:.57;--bar:var(--ember-300)"></i></div><span class="num">20 + 15 = <b style="color:var(--ember-100)">35</b></span></div>
          <div class="stats"><span>Helfer <b>3</b> <span class="ff-lo">(Lehrling ×3, Assist)</span></span><span>Nachbarschaft <b style="color:var(--verdigris-300)">−9 % E</b></span></div>
          <div class="stats"><span>Rally <b style="color:var(--ok)">gesetzt</b> <span class="ff-lo">Rechtsklick Boden</span></span></div>
        </div>
        <div class="fq" data-component="FactoryQueue">
          <div class="fq__now">${si('land_direct_t1')}<div><b>Punze</b> <span class="ff-lo">· noch 3,1 s</span><div class="ff-bar ff-bar--build"><i style="--v:.64"></i></div></div><span class="num">64 %</span></div>
          <div class="fq__list">
            <button class="fqi is-first is-loop" title="Punze ×5">${si('land_direct_t1')}<b class="num">5</b></button>
            <button class="fqi is-loop" title="Kelle ×2">${si('land_arty_t1')}<b class="num">2</b></button>
            <button class="fqi is-loop" title="Lehrling ×1">${si('eng_build_t1')}<b class="num">1</b></button>
            <button class="fqi is-loop" title="Sieb ×1">${si('land_aa_t1')}<b class="num">1</b></button>
          </div>
          <div class="fq__ctl">
            <button class="ff-btn ff-btn--sm is-on" title="Queue wiederholen (Loop)">${gi('repeat')}Wiederholen</button>
            <button class="ff-btn ff-btn--sm" title="Produktion pausieren (E13)">${gi('pause')}Pause</button>
            <button class="ff-btn ff-btn--sm" title="Rally setzen: Rechtsklick auf Boden, ⇧ = weiterer Wegpunkt">${gi('rally')}Rally</button>
            <button class="ff-btn ff-btn--sm" title="Queue leeren">${gi('close')}Leeren</button>
          </div>
          <div class="fq__help"><span><span class="ff-key">Klick</span> +1</span><span><span class="ff-key">⇧</span>+Klick +5</span><span><span class="ff-key">RMB</span> −1 · <span class="ff-key">⇧</span>RMB −5</span></div>
        </div>
      </div>`;
    }
  }

  /* ================= Command Card (C8) ================= */
  const BAU = { Q: 'str_t1_mex', W: 'str_t1_pgen', E: 'str_t1_hydro', R: 'str_t1_mstore', T: 'str_t1_estore', A: 'str_t1_fac_land', S: 'str_t1_fac_air', D: 'str_t1_radar', F: 'str_t2_shield', Z: 'str_t1_pd', X: 'str_t1_aa', C: 'str_t1_wall', V: 'str_t2_arty' };
  const WERK = { Q: 'lnd_t1_tank', W: 'lnd_t1_arty', E: 'lnd_t1_engineer', R: 'lnd_t1_aa', A: 'lnd_t1_scout', S: 'lnd_t1_bot', D: 'lnd_t2_shield', F: 'lnd_t3_sniper' };
  // Anzeige nach Tastaturlayout (DE: physische KeyZ trägt „Y“); intern zählt KeyboardEvent.code
  const LBL = (k) => (k === 'Z' ? 'Y' : k);
  const KEYS = ['Q', 'W', 'E', 'R', 'T', 'A', 'S', 'D', 'F', 'G', 'Z', 'X', 'C', 'V', 'B'];
  const QUEUED = { Q: 5, W: 2, E: 1, R: 1 };
  // Tech-Striche aus roster.json: welche Stufen die Rolle auf dieser Taste direkt baubar hat (Upgrade-only zählt nicht)
  function tiersFor(menu, k, shownTech) {
    const have = [0, 0, 0];
    Object.values(window.FF_ROSTER.units).forEach((u) => {
      const hb = u.hotbuild; if (!hb || hb.menu !== menu || !(hb.slot === k || hb.slot.startsWith(k + ' '))) return;
      if (menu === 'Bau' && !/ENGINEER|COMMAND/.test(u.buildableBy || '')) return;
      if (u.tech >= 1 && u.tech <= 3) have[u.tech - 1] = 1;
    });
    if (have.reduce((a, b) => a + b, 0) < 2) return null; // nur eine Stufe → keine Striche
    return have.map((h, i) => (h ? (i + 1 === shownTech ? 2 : 1) : 0));
  }
  function cell(k, id, opts = {}) {
    const u = id && FF.unit('core:' + id);
    if (!u && !opts.order) return `<button class="ff-cell is-empty" tabindex="-1"><span class="ff-cell__key">${LBL(k)}</span></button>`;
    if (opts.order) {
      const d = ORDER[k]; if (!d) return `<button class="ff-cell is-empty" tabindex="-1"><span class="ff-cell__key">${LBL(k)}</span></button>`;
      const st = opts.st;
      return `<button class="ff-cell ${st === 'off' ? 'is-disabled' : ''} ${S.armed === k ? 'is-active' : ''} ${k === 'B' ? 'ff-cell--danger' : ''}" data-key="${k}" title="${d[1]}">${st === 'part' ? '<span class="ff-cell__badge">3</span>' : ''}<span class="ff-cell__key">${KEYLBL(k)}</span>${gi(d[0])}<span class="ff-cell__name">${d[3]}</span></button>`;
    }
    const locked = opts.maxTech && u.tech > opts.maxTech;
    const active = (S.place && k === 'W' && S.sel === 'vogt') || S.armed === k;
    const hov = S.tip === k && !S.place;
    const tiers = opts.tiers ? `<span class="ff-cell__tiers" title="Stufen dieser Taste">${opts.tiers.map((t) => `<i class="${t === 2 ? 'on' : t ? '' : 'none'}"></i>`).join('')}</span>` : '';
    const badge = opts.badge ? `<span class="ff-cell__badge">${opts.badge}</span>` : '';
    const prog = opts.prog ? `<span class="ff-cell__prog"><i style="--p:${opts.prog}"></i></span>` : '';
    return `<button class="ff-cell ${locked ? 'is-locked is-disabled' : ''} ${active ? 'is-active' : ''} ${hov ? 'is-hover' : ''}" data-key="${k}" data-unit="${id}" aria-label="${u.name.de} (${LBL(k)})">
      <span class="ff-cell__key">${LBL(k)}</span>${badge || tiers}<span class="ff-cell__icon">${si(u.icon)}</span>${locked ? `<span class="ff-cell__lock">${gi('lock')}</span>` : ''}<span class="ff-cell__name">${u.name.de.replace(/ I$/, '')}</span>${prog}</button>`;
  }
  function renderCard() {
    const el = $('card');
    let head = '', grid = '';
    if (S.sel === 'vogt') {
      head = `<div class="ff-ph">Bau · Vogt<div class="ff-tabs" data-tabs="tech" role="tablist"><button class="ff-tab is-selected" data-tab="T1">T1</button><button class="ff-tab is-disabled" title="Vogt baut nur T1 (U14 Post-MVP)">T2</button><button class="ff-tab is-disabled">T3</button></div></div>`;
      grid = KEYS.map((k) => cell(k, BAU[k] || null, { maxTech: 1, tiers: BAU[k] ? tiersFor('Bau', k, FF.unit('core:' + BAU[k]).tech) : null })).join('');
    } else if (S.sel === 'factory') {
      head = `<div class="ff-ph">Produktion · Landwerk I<div class="ff-tabs" data-tabs="tech"><button class="ff-tab is-selected" data-tab="T1">T1</button><button class="ff-tab is-disabled" title="Freisprechen nötig (Landwerk II)">T2 ${gi('lock')}</button><button class="ff-tab is-disabled">T3</button></div></div>`;
      grid = KEYS.map((k) => {
        if (k === 'B') return `<button class="ff-cell" data-key="B" title="Upgrade: Freisprechen → Landwerk II (U5): 1.400 M · 11.000 E"><span class="ff-cell__key">B</span>${gi('upgrade')}<span class="ff-cell__name" style="color:var(--ember-300)">Upgrade</span></button>`;
        return cell(k, WERK[k] || null, { maxTech: 1, badge: QUEUED[k], tiers: WERK[k] ? tiersFor('Landwerk', k, FF.unit('core:' + WERK[k]).tech) : null, prog: k === 'Q' ? 0.64 : 0 });
      }).join('');
    } else if (S.sel === 'army') {
      head = `<div class="ff-ph">Befehle · 19 Einheiten<span class="ff-ph__end">Feuermodus: <b style="color:var(--text)">Feuer frei</b></span></div>`;
      grid = KEYS.map((k) => cell(k, null, { order: true, st: ORDERS_STATE.army[k] })).join('');
    } else {
      head = `<div class="ff-ph">Command Card</div>`;
      grid = KEYS.map((k) => `<button class="ff-cell is-empty" tabindex="-1"><span class="ff-cell__key">${LBL(k)}</span></button>`).join('');
    }
    el.innerHTML = head + `<div class="card__grid" role="grid" aria-label="Hotbuild-Raster">${grid}</div>`;
  }

  /* ================= Tooltip ================= */
  function showTip(key) {
    const box = $('tipbox'), tip = $('tip');
    let html = '';
    if (S.sel === 'vogt' && BAU[key]) html = FF.unitTip('core:' + BAU[key], { key: LBL(key), bp: 10, desc: key === 'W' ? 'Kessel mit Schlot: verbrennt Erz zu Energy. Steht er an einem Werk, zieht das Werk weniger Energy.' : '' });
    else if (S.sel === 'factory' && WERK[key]) html = FF.unitTip('core:' + WERK[key], { key: LBL(key), bp: 35, foot: '<span><span class="ff-key">⇧</span> +5</span><span><span class="ff-key">RMB</span> −1</span>', desc: key === 'Q' ? 'Kettenpanzer mit Glocke. Hält die Linie, wo Stichel schon rennen.' : '' }).replace('<span><span class="ff-key">Klick</span> platzieren</span><span><span class="ff-key">⇧</span> mehrere</span>', '<span><span class="ff-key">Klick</span> +1</span>');
    if (!html) { box.hidden = true; return; }
    tip.innerHTML = html;
    box.hidden = false;
    // Position: über der Command Card, rechtsbündig (einmal messen, dann nur transform)
    const card = $('card').getBoundingClientRect();
    const strip = $('orders').getBoundingClientRect();
    box.style.right = (window.innerWidth - card.right) + 'px';
    box.style.bottom = (window.innerHeight - Math.min(card.top, strip.top || card.top) + 8) + 'px';
  }

  /* ================= Dev-Konsole (S8) ================= */
  function renderConsole() {
    const c = $('console');
    c.hidden = !S.console;
    if (!S.console) return;
    c.innerHTML = `<div class="console__head"><b>DEV-KONSOLE</b><span>Build 3f9a1c2 · simId 0x7b21e04c · Tick 7.020</span><span class="sp"><span><span class="ff-key">^</span> / <span class="ff-key">F1</span> schließen</span><span><span class="ff-key">Tab</span> vervollständigen</span><span><span class="ff-key">↑</span> Verlauf</span></span></div>
      <div class="console__log">
        <div class="dim">Flow &amp; Fire Dev-Konsole · Befehle laufen als Commands durch die Sim (S3) und landen im Replay.</div>
        <div class="in">spawn core:lnd_t1_tank 5 @cursor army=2</div>
        <div class="ok">ok · 5× Punze für Haus Dorne bei (241,5 | 188,0) · Tick 6.991</div>
        <div class="in">res mass +1000</div>
        <div class="ok">ok · Mass-Speicher 1.230 / 1.230 (Überlauf 0)</div>
        <div class="in">speed 4</div>
        <div class="err">Fehler · speed: Wert 4 außerhalb 0,25–3 (A6)</div>
        <div class="in">hash</div>
        <div class="ok">Tick 7.020 · stateHash 0x1c9e44a0 · Kette ok</div>
        <div class="in">overlay path on</div>
        <div class="ok">Overlay „path" an (Sektorgraph, Flow Fields)</div>
      </div>
      <div class="console__row"><input value="sp" aria-label="Konsolenbefehl" spellcheck="false"></div>
      <div class="console__sugg"><div class="is-sel"><span>spawn &lt;bp&gt; [n] [@cursor] [army=]</span><span class="ff-lo">Einheiten erzeugen</span></div><div><span>speed &lt;0,25–3&gt;</span><span class="ff-lo">Sim-Tempo</span></div><div><span>spots</span><span class="ff-lo">Ressourcenpunkte anzeigen</span></div></div>
      <div class="console__budget" data-component="BudgetOverlay">
        <div class="flow__head"><span>Tick-Budget p95</span><span>ms</span></div>
        ${[['CommandApply', 0.12], ['Movement', 2.1], ['Pathfinding', 1.4], ['Targeting', 1.1], ['Projectiles', 1.9], ['Economy', 0.3], ['FrameWriter', 0.9], ['Hash', 0.6]].map(([n, v]) => `<div class="row"><span>${n}</span><span class="ff-bar"><i style="--v:${v / 3};--bar:${v > 2 ? 'var(--warn)' : 'var(--copper-300)'}"></i></span><span class="num">${n1(v)}</span></div>`).join('')}
        <div class="row" style="border-top:1px solid var(--line);padding-top:.1875rem"><span><b>Summe</b></span><span></span><span class="num"><b>8,4</b> / 10</span></div>
      </div>`;
  }

  /* ================= Alles zeichnen ================= */
  function renderAll() {
    drawWorld(); drawMinimap(); renderEco(); renderStatus(); renderAlerts(); renderStrip(); renderSel(); renderCard(); renderConsole();
    const tipKey = S.tip || (S.place ? 'W' : null);
    if (tipKey) showTip(tipKey); else $('tipbox').hidden = true;
    document.querySelectorAll('.minimap__tools button').forEach((b, i) => { b.innerHTML = gi(['layers', 'mass', 'fullscreen'][i]); });
    document.querySelectorAll('#mock [data-set]').forEach((b) => { const [k, v] = b.dataset.set.split('='); b.classList.toggle('is-on', (qs.get(k) || (k === 'sel' ? 'vogt' : '')) === v); });
    document.querySelectorAll('#mock [data-toggle]').forEach((b) => b.classList.toggle('is-on', !!S[b.dataset.toggle]));
  }
  renderAll();
  let rT; window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { FF.applyScale(); setView(window.innerWidth, window.innerHeight); buildScene(); renderAll(); }, 120); });

  /* ================= Interaktion (Mockup) ================= */
  function go(changes) {
    const p = new URLSearchParams(location.search);
    Object.entries(changes).forEach(([k, v]) => (v === '' || v === null ? p.delete(k) : p.set(k, v)));
    location.search = p.toString();
  }
  $('mock').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.set) { const [k, v] = b.dataset.set.split('='); go({ [k]: v }); }
    if (b.dataset.toggle) { const k = b.dataset.toggle; go({ [k]: S[k] ? '' : '1' }); }
  });
  document.addEventListener('mouseover', (e) => {
    const c = e.target.closest('.card__grid .ff-cell[data-key]');
    if (c) showTip(c.dataset.key);
  });
  document.addEventListener('mouseout', (e) => { if (e.target.closest('.card__grid') && !S.tip) $('tipbox').hidden = true; });
  document.addEventListener('click', (e) => {
    const c = e.target.closest('.card__grid .ff-cell[data-key]');
    if (c) { flash(c.dataset.key, e.shiftKey ? 5 : 1); }
    const a = e.target.closest('.ff-alert__jump'); if (a) pingMinimap();
    const g = e.target.closest('.grp:not(.is-empty)'); if (g) go({ sel: { 1: 'army', 3: 'factory', 4: 'vogt' }[g.querySelector('.grp__k').textContent] || 'army' });
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  function flash(k, n) {
    const c = document.querySelector(`.card__grid .ff-cell[data-key="${k}"]`); if (!c || c.classList.contains('is-disabled') || c.classList.contains('is-empty')) return;
    if (S.sel === 'factory') {
      QUEUED[k] = (QUEUED[k] || 0) + n; renderCard();
    } else { S.armed = S.armed === k ? null : k; renderCard(); renderStrip(); }
    const c2 = document.querySelector(`.card__grid .ff-cell[data-key="${k}"]`); if (c2) { c2.classList.add('is-flash'); setTimeout(() => c2.classList.remove('is-flash'), 140); }
  }
  function pingMinimap() { const w = $('mmWrap'); w.animate([{ boxShadow: 'inset 0 0 0 3px #ff8a2a' }, { boxShadow: 'inset 0 0 0 0 #ff8a2a' }], { duration: 500 }); }
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') { if (e.code === 'F1' || e.code === 'Backquote') { e.preventDefault(); go({ console: '' }); } return; }
    const k = e.code.startsWith('Key') ? e.code.slice(3) : null;
    if (e.code === 'F1' || e.code === 'Backquote' || e.code === 'IntlBackslash') { e.preventDefault(); go({ console: S.console ? '' : '1' }); return; }
    if (e.code === 'Escape') { if (S.armed || S.place) { S.armed = null; go({ place: '' }); } else go({ sel: 'none' }); return; }
    if (e.code === 'KeyP' || e.code === 'Pause') { go({ paused: S.paused ? '' : '1' }); return; }
    if (e.code === 'Space') { e.preventDefault(); pingMinimap(); return; }
    if (/^Digit[1-4]$/.test(e.code) && !e.altKey) { go({ sel: { 1: 'army', 2: 'army', 3: 'factory', 4: 'vogt' }[e.code.slice(5)] }); return; }
    if (e.code === 'KeyH') { go({ sel: 'vogt' }); return; }
    if (k && KEYS.includes(k)) {
      e.preventDefault();
      if ((e.altKey || S.sel === 'army') && k === 'B') return; // Selbstzerstörung nur über Strg+Entf / Klick
      if (e.altKey || S.sel === 'army') {
        const b = document.querySelector(`[data-order="${k}"]`) || document.querySelector(`.card__grid .ff-cell[data-key="${k}"]`);
        if (b && !b.classList.contains('is-disabled')) { S.armed = S.armed === k ? null : k; renderStrip(); renderCard(); }
        return;
      }
      if (S.sel === 'vogt' && k === 'W') { go({ place: S.place ? '' : '1' }); return; }
      flash(k, e.shiftKey ? 5 : 1);
    }
  });
})();
