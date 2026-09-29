/**
 * Single model: turntable, team colors, color/gray/silhouette, part animation, wireframe, footprint, and a
 * distance slider in game-camera mode (pitch 50°) with LOD switching (`lodDistances`) and the strategic icon below
 * `iconThreshold` px screen length.
 */
import type { ModelMeta } from '@faf/modelkit';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { iconScale, iconSvg, parseIconId } from '../../../../content/icons/grammar.ts';
import { boundsSphere, demoPose, loadManifest, loadModel, lodForDistance, UnitView } from '../models.ts';
import { BG_COLOR, BG_SILHOUETTE, createRenderer, footprintOutline, frameSphere, groundGrid, pixelsFor, viewDir } from '../stage.ts';
import { el, esc, markReady, TEAM_COLORS, type Cleanup } from '../util.ts';

const GAME_PITCH = 50;
const FOV = 40;
/** Icon base size in px (faction.md §6.5: 20 px × factor × UI scale). */
const ICON_BASE_PX = 20;

type Mode = 'color' | 'gray' | 'silhouette';

function fmt(v: number, d = 2): string {
  return v.toFixed(d);
}

function infoHtml(m: ModelMeta): string {
  const l0 = m.lods[0]!;
  const lodRows = m.lods
    .map((l, i) => `<tr><td>LOD${i}</td><td class="num">${l.triangles}</td><td class="num">${m.budget.tris[i]}</td><td class="num">${l.vertices}</td><td>${l.triangles <= m.budget.tris[i]! ? '✓' : '✗'}</td></tr>`)
    .join('');
  const partRows = m.parts
    .map(
      (p) =>
        `<tr><td>${p.index}</td><td>${esc(p.name)}</td><td>${p.index === 0 ? '–' : esc(m.parts[p.parent]?.name ?? '?')}</td><td class="small">${p.pivot.map((v) => fmt(v)).join(', ')}</td><td>${esc(p.anim)}</td><td class="num">${l0.partTris[p.index] ?? 0}</td></tr>`,
    )
    .join('');
  const total = Object.values(l0.matArea).reduce((a, b) => a + b, 0);
  const matRows = Object.entries(l0.matArea)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `<tr><td>${k}</td><td class="num">${fmt(v, 3)} WU²</td><td class="num">${fmt((100 * v) / total, 1)} %</td></tr>`)
    .join('');
  const fc = m.footprintCheck;
  return `
    <h2>${esc(m.name)}</h2>
    <div class="small">${esc(m.id)} · ${esc(m.role)} · Klasse ${m.class} · T${m.tech}</div>
    <h3>Dreiecke</h3>
    <table><tr><th></th><th class="num">Tris</th><th class="num">Budget</th><th class="num">Verts</th><th></th></tr>${lodRows}</table>
    <div class="small">Roster-Schätzung LOD0: ${m.trisEstimate ?? '–'} · GLB ${(m.bytes / 1024).toFixed(1)} KiB</div>
    <h3>Maße</h3>
    <table>
      <tr><td>Bounds (WU)</td><td class="small">${m.bounds.size.map((v) => fmt(v)).join(' × ')}</td></tr>
      <tr><td>Maßstab (Roster)</td><td class="small">xz ${m.scale.xz} · y ${m.scale.y}</td></tr>
      <tr><td>Footprint</td><td class="small">${fc.footprint.join('×')} · Ausdehnung ${fc.extent.map((v) => fmt(v)).join('×')} · ${fc.ok ? '✓' : '✗'} ${esc(fc.rule)}</td></tr>
      <tr><td>LOD-Distanzen</td><td class="small">${m.lodDistances.join(' / ')} WU</td></tr>
      <tr><td>Icon</td><td class="small">${esc(m.icon)} ab &lt; ${m.iconThreshold} px</td></tr>
      <tr><td>Team-Anteil Draufsicht</td><td class="small">≈ ${fmt(l0.teamTopShare * 100, 0)} % (Draufsicht orthografisch)</td></tr>
    </table>
    <h3>Parts</h3>
    <table><tr><th>#</th><th>Name</th><th>Parent</th><th>Pivot</th><th>Anim</th><th class="num">Tris</th></tr>${partRows}</table>
    <h3>Materialflächen LOD0</h3>
    <table>${matRows}</table>
    ${m.warnings.length > 0 ? `<h3>Hinweise</h3><ul class="small">${m.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
  `;
}

export async function mountSingle(app: HTMLElement, faction: string, unit: string): Promise<Cleanup> {
  const manifest = await loadManifest();
  const meta = manifest.models.find((m) => m.faction === faction && m.unit === unit);
  if (meta === undefined) throw new Error(`Modell ${faction}/${unit} nicht im Manifest`);
  const model = await loadModel(meta);
  const siblings = manifest.models.filter((m) => m.faction === faction);
  const idx = siblings.indexOf(meta);

  const split = el('div', { class: 'split' });
  const vp = el('div', { class: 'viewport' });
  const canvas = el('canvas');
  const hud = el('div', { class: 'hud' });
  const iconEl = el('div', { class: 'overlay-icon' });
  vp.append(canvas, hud, iconEl);
  const panel = el('div', { class: 'panel' });
  split.append(vp, panel);
  app.append(split);

  // controls
  const prev = siblings[(idx - 1 + siblings.length) % siblings.length]!;
  const next = siblings[(idx + 1) % siblings.length]!;
  const controls = el(
    'div',
    {},
    `<div class="row small"><a href="#/f/${faction}">← Galerie</a> · <a href="#/model/${faction}/${prev.unit}">‹ ${esc(prev.name)}</a> · <a href="#/model/${faction}/${next.unit}">${esc(next.name)} ›</a></div>
     <h3>Teamfarbe</h3><div class="swatches">${TEAM_COLORS.map((t, i) => `<div class="swatch${i === 1 ? ' active' : ''}" data-team="${t.hex}" title="${t.de}" style="background:${t.hex}"></div>`).join('')}</div>
     <h3>Darstellung</h3>
     <div class="tabs" id="modes"><button data-mode="color" class="active">Farbe</button><button data-mode="gray">Graustufen</button><button data-mode="silhouette">Silhouette</button></div>
     <div class="row"><label><input type="checkbox" id="turn" checked> Drehteller</label><label><input type="checkbox" id="anim"> Parts animieren</label></div>
     <div class="row"><label><input type="checkbox" id="wire"> Drahtgitter</label><label><input type="checkbox" id="fp" checked> Footprint + Raster</label></div>
     <h3>Distanz (Spielkamera ${GAME_PITCH}°)</h3>
     <div class="row"><label><input type="checkbox" id="game"> Spielkamera statt Orbit</label></div>
     <input type="range" id="dist" min="3" max="400" step="1" value="20">
     <div class="row small">LOD <select id="lod"><option value="auto">auto (Distanz)</option><option value="0">0</option><option value="1">1</option><option value="2">2</option></select>
       <label><input type="checkbox" id="iconauto" checked> Icon unter Schwelle</label></div>`,
  );
  panel.append(controls, el('div', {}, infoHtml(meta)));

  // scene
  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);
  const unitView = new UnitView(model);
  unitView.setTeam('#2F6FD0');
  const turntable = new THREE.Group();
  turntable.add(unitView.group);
  scene.add(turntable);
  const { center, radius } = boundsSphere(meta);
  const grid = groundGrid(Math.max(24, Math.ceil(radius * 8)));
  const fpLine = footprintOutline(meta.footprint);
  scene.add(grid, fpLine);
  const cam = new THREE.PerspectiveCamera(FOV, 1, 0.01, 5000);
  const orbit = new OrbitControls(cam, canvas);
  orbit.target.copy(center);
  orbit.enableDamping = true;

  const state = { mode: 'color' as Mode, turn: true, anim: false, game: false, dist: 20, lod: 'auto', iconAuto: true };
  const q = <T extends HTMLElement>(sel: string): T => controls.querySelector<T>(sel)!;
  const distInput = q<HTMLInputElement>('#dist');

  function resize(): void {
    const w = vp.clientWidth;
    const h = vp.clientHeight;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }
  resize();
  frameSphere(cam, center, radius, viewDir(35, 28), 1.4);
  orbit.update();
  const ro = new ResizeObserver(resize);
  ro.observe(vp);

  controls.querySelectorAll<HTMLElement>('.swatch').forEach((s) =>
    s.addEventListener('click', () => {
      controls.querySelectorAll('.swatch').forEach((x) => x.classList.remove('active'));
      s.classList.add('active');
      unitView.setTeam(s.dataset['team']!);
      updateIcon(true);
    }),
  );
  controls.querySelectorAll<HTMLElement>('#modes button').forEach((b) =>
    b.addEventListener('click', () => {
      controls.querySelectorAll('#modes button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      state.mode = b.dataset['mode'] as Mode;
      unitView.setSilhouette(state.mode === 'silhouette');
      unitView.setGray(state.mode === 'gray');
      scene.background = new THREE.Color(state.mode === 'silhouette' ? BG_SILHOUETTE : BG_COLOR);
      grid.visible = fpLine.visible = state.mode !== 'silhouette' && q<HTMLInputElement>('#fp').checked;
    }),
  );
  q<HTMLInputElement>('#turn').addEventListener('change', (e) => (state.turn = (e.target as HTMLInputElement).checked));
  q<HTMLInputElement>('#anim').addEventListener('change', (e) => {
    state.anim = (e.target as HTMLInputElement).checked;
    if (!state.anim) unitView.setPose(new Map());
  });
  q<HTMLInputElement>('#wire').addEventListener('change', (e) => unitView.setWireframe((e.target as HTMLInputElement).checked));
  q<HTMLInputElement>('#fp').addEventListener('change', (e) => (grid.visible = fpLine.visible = (e.target as HTMLInputElement).checked));
  q<HTMLInputElement>('#game').addEventListener('change', (e) => {
    state.game = (e.target as HTMLInputElement).checked;
    orbit.enabled = !state.game;
  });
  distInput.addEventListener('input', () => {
    state.dist = Number(distInput.value);
    if (!state.game) {
      state.game = true;
      q<HTMLInputElement>('#game').checked = true;
      orbit.enabled = false;
    }
  });
  q<HTMLSelectElement>('#lod').addEventListener('change', (e) => (state.lod = (e.target as HTMLSelectElement).value));
  q<HTMLInputElement>('#iconauto').addEventListener('change', (e) => (state.iconAuto = (e.target as HTMLInputElement).checked));

  const parsedIcon = meta.icon === '' ? null : parseIconId(meta.icon);
  let iconTeam = '';
  function updateIcon(force = false): void {
    const team = controls.querySelector<HTMLElement>('.swatch.active')?.dataset['team'] ?? '#2F6FD0';
    if (parsedIcon === null || (!force && team === iconTeam)) return;
    iconTeam = team;
    const px = Math.round(ICON_BASE_PX * iconScale(parsedIcon) * 2.4);
    iconEl.innerHTML = iconSvg(meta!.icon, { team, size: px });
  }
  updateIcon(true);

  let raf = 0;
  let last = performance.now();
  const t0 = last;
  const length = Math.max(meta.bounds.size[0], meta.bounds.size[2]);
  const tick = (): void => {
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const t = (now - t0) / 1000;
    if (state.turn) turntable.rotation.y += dt * 0.5;
    if (state.anim) unitView.setPose(demoPose(model, t));
    let dist: number;
    if (state.game) {
      cam.position.copy(center).addScaledVector(viewDir(0, GAME_PITCH), state.dist);
      cam.lookAt(center);
      cam.near = Math.max(0.01, state.dist - radius * 4);
      cam.far = state.dist + radius * 4 + 50;
      cam.updateProjectionMatrix();
      dist = state.dist;
    } else {
      orbit.update();
      dist = cam.position.distanceTo(center);
      distInput.value = String(Math.round(dist));
    }
    const px = pixelsFor(length, dist, FOV, vp.clientHeight);
    const lod = state.lod === 'auto' ? lodForDistance(meta, dist) : Number(state.lod);
    unitView.setLod(lod);
    const iconOn = state.iconAuto && px < meta.iconThreshold && parsedIcon !== null;
    unitView.group.visible = !iconOn;
    iconEl.style.display = iconOn ? 'block' : 'none';
    if (iconOn) {
      const p = center.clone().project(cam);
      iconEl.style.left = `${((p.x + 1) / 2) * vp.clientWidth}px`;
      iconEl.style.top = `${((1 - p.y) / 2) * vp.clientHeight}px`;
      const size = ICON_BASE_PX * iconScale(parsedIcon);
      const svg = iconEl.querySelector('svg');
      if (svg !== null) {
        svg.setAttribute('width', String(size));
        svg.setAttribute('height', String(Math.round((size * 54) / 48)));
      }
    }
    hud.textContent = `Distanz ${dist.toFixed(0)} WU · Länge ${px.toFixed(0)} px · ${iconOn ? `Icon (< ${meta.iconThreshold} px)` : `LOD${lod} · ${meta.lods[lod]?.triangles ?? 0} Tris`}`;
    renderer.render(scene, cam);
  };
  tick();
  markReady();
  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    orbit.dispose();
    unitView.dispose();
    renderer.dispose();
  };
}
