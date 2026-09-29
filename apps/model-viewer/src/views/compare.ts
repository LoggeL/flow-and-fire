/**
 * Size comparison: all models of the selected factions side by side on a 1-WU grid, true scale (roster scale is
 * baked into the GLBs), one row per faction, orthographic 3/4 view, labels with name and bounds.
 */
import type { ModelMeta } from '@faf/modelkit';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadManifest, loadModel, UnitView } from '../models.ts';
import { BG_COLOR, BG_SILHOUETTE, createRenderer, footprintOutline, groundGrid, viewDir } from '../stage.ts';
import { el, esc, markReady, teamHex, type Cleanup } from '../util.ts';

const GAP = 0.8;
const ROW_GAP = 3;

interface Placed {
  readonly meta: ModelMeta;
  readonly x: number;
  readonly z: number;
}

export async function mountCompare(app: HTMLElement, query: URLSearchParams): Promise<Cleanup> {
  const manifest = await loadManifest();
  const selected = (query.get('f') ?? manifest.factions.map((f) => f.slug).join(',')).split(',').filter((s) => s !== '');
  const silhouette = query.get('mode') === 'silhouette';
  const team = teamHex(query.get('team'));

  const tabs = el('div', { class: 'tabs' });
  tabs.innerHTML =
    manifest.factions
      .map((f) => {
        const on = selected.includes(f.slug);
        const next = on ? selected.filter((s) => s !== f.slug) : [...selected, f.slug];
        return `<a href="#/compare?f=${next.join(',')}${silhouette ? '&mode=silhouette' : ''}" class="${on ? 'active' : ''}">${esc(f.name)}</a>`;
      })
      .join('') +
    `<a href="#/compare?f=${selected.join(',')}${silhouette ? '' : '&mode=silhouette'}">${silhouette ? 'Farbe' : 'Silhouette'}</a>`;
  app.append(tabs, el('p', { class: 'small' }, 'Raster 1 WU (kräftig alle 4 WU), gelb = Footprint. Maßstab laut Roster (in den GLBs eingebacken). Mausrad = Zoom, Rechtsziehen = Verschieben.'));

  // layout: one row per faction along x, sorted by footprint area then length
  const placed: Placed[] = [];
  let z = 0;
  for (const slug of selected) {
    const metas = manifest.models
      .filter((m) => m.faction === slug)
      .slice()
      .sort((a, b) => a.footprint[0] * a.footprint[1] - b.footprint[0] * b.footprint[1] || a.bounds.size[2] - b.bounds.size[2]);
    let x = 0;
    let depth = 0;
    for (const m of metas) {
      const w = Math.max(m.bounds.size[0], m.footprint[0]);
      placed.push({ meta: m, x: x + w / 2 - (m.bounds.min[0] + m.bounds.max[0]) / 2, z });
      x += w + GAP;
      depth = Math.max(depth, m.bounds.size[2], m.footprint[1]);
    }
    z -= depth + ROW_GAP;
  }

  const stage = el('div', { class: 'stage' });
  const canvas = el('canvas');
  stage.append(canvas);
  app.append(stage);
  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(silhouette ? BG_SILHOUETTE : BG_COLOR);
  const views: UnitView[] = [];
  const labels: { el: HTMLElement; pos: THREE.Vector3 }[] = [];
  let maxX = 1;
  for (const p of placed) {
    const v = new UnitView(await loadModel(p.meta));
    v.setTeam(team);
    v.setSilhouette(silhouette);
    v.group.position.set(p.x, 0, p.z);
    scene.add(v.group);
    if (!silhouette) {
      const fp = footprintOutline(p.meta.footprint);
      fp.position.set(p.x, 0, p.z);
      scene.add(fp);
    }
    views.push(v);
    maxX = Math.max(maxX, p.x + p.meta.bounds.size[0]);
    const label = el('div', { class: 'label' }, `<b>${esc(p.meta.name)}</b>${p.meta.bounds.size.map((s) => s.toFixed(2)).join('×')} WU`);
    stage.append(label);
    labels.push({ el: label, pos: new THREE.Vector3(p.x, 0, p.z + Math.max(p.meta.bounds.max[2], p.meta.footprint[1] / 2) + 0.3) });
  }
  const minZ = z;
  if (!silhouette) {
    const grid = groundGrid(Math.max(maxX, -minZ) * 2 + 8);
    grid.position.set(maxX / 2, 0, minZ / 2);
    scene.add(grid);
  }

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 500);
  const target = new THREE.Vector3(maxX / 2, 0.3, (minZ + ROW_GAP) / 2);
  cam.position.copy(target).addScaledVector(viewDir(20, 28), 100);
  cam.lookAt(target);
  const orbit = new OrbitControls(cam, canvas);
  orbit.target.copy(target);
  orbit.enableRotate = true;

  function resize(): void {
    const w = stage.clientWidth || app.clientWidth;
    const h = Math.max(420, Math.round(window.innerHeight - 170));
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const rowsDepth = -minZ - ROW_GAP;
    const span = Math.max(maxX + 1.5, (rowsDepth + 1.5) * 1.8, 4);
    const aspect = w / h;
    cam.left = (-span / 2) * 1.05;
    cam.right = (span / 2) * 1.05;
    cam.top = cam.right / aspect;
    cam.bottom = cam.left / aspect;
    cam.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  let raf = 0;
  const tick = (): void => {
    raf = requestAnimationFrame(tick);
    orbit.update();
    renderer.render(scene, cam);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    for (const l of labels) {
      const p = l.pos.clone().project(cam);
      l.el.style.left = `${((p.x + 1) / 2) * w}px`;
      l.el.style.top = `${((1 - p.y) / 2) * h}px`;
    }
  };
  tick();
  markReady();
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    orbit.dispose();
    for (const v of views) v.dispose();
    renderer.dispose();
  };
}
