/**
 * Render-only routes for tools/model-shots:
 * - contact sheet of a faction (`mode=color`: 3/4 view; `mode=silhouette`: black silhouettes from the game camera
 *   (pitch 50°) plus the same silhouette at 48 px and 32 px, faction.md §5.3)
 * - single shot of one model (3/4 view on the 1-WU grid with footprint).
 * One WebGL canvas per route, tiles via scissor/viewport; the DOM labels sit on top of it.
 */
import type { ModelMeta } from '@faf/modelkit';
import * as THREE from 'three';
import { boundsSphere, loadManifest, loadModel, UnitView } from '../models.ts';
import { BG_COLOR, BG_SILHOUETTE, createRenderer, footprintOutline, frameSphere, groundGrid, viewDir } from '../stage.ts';
import { el, esc, markReady, teamHex, type Cleanup } from '../util.ts';

const TILE = 260;
const LABEL_H = 58;
const TITLE_H = 44;
const MINI = [48, 32] as const;

function tileCamera(meta: ModelMeta, silhouette: boolean, margin = 1.04): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
  const { center, radius } = boundsSphere(meta);
  frameSphere(cam, center, radius, silhouette ? viewDir(30, 50) : viewDir(35, 32), margin);
  return cam;
}

export async function mountSheet(app: HTMLElement, faction: string, query: URLSearchParams): Promise<Cleanup> {
  const manifest = await loadManifest();
  const f = manifest.factions.find((x) => x.slug === faction);
  if (f === undefined) throw new Error(`Fraktion ${faction} nicht im Manifest`);
  const silhouette = query.get('mode') === 'silhouette';
  const team = teamHex(query.get('team'));
  const metas = manifest.models.filter((m) => m.faction === faction);
  const cols = Math.max(1, Math.min(Number(query.get('cols') ?? 6), metas.length));
  const rows = Math.ceil(metas.length / cols);
  const W = Math.max(cols * TILE, 820);
  const H = TITLE_H + rows * (TILE + LABEL_H);

  const sheet = el('div', { class: 'sheet', id: 'sheet' });
  sheet.style.width = `${W}px`;
  sheet.style.height = `${H}px`;
  const canvas = el('canvas');
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  sheet.append(canvas);
  sheet.append(el('div', { class: 'title' }, `${esc(f.name)} – ${silhouette ? 'Silhouetten (Spielkamera 50°, 32 px / 48 px)' : 'Kontaktabzug (3/4-Ansicht, Teamfarbe)'} · ${metas.length} Modelle`));
  app.innerHTML = '';
  app.style.padding = '0';
  app.append(sheet);

  const renderer = createRenderer(canvas, { preserve: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setScissorTest(true);
  const bg = new THREE.Color(silhouette ? BG_SILHOUETTE : BG_COLOR);
  renderer.setScissor(0, 0, W, H);
  renderer.setViewport(0, 0, W, H);
  renderer.setClearColor(bg, 1);
  renderer.clear();
  const views: UnitView[] = [];
  for (let i = 0; i < metas.length; i++) {
    const meta = metas[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * TILE;
    const yTop = TITLE_H + row * (TILE + LABEL_H);
    const view = new UnitView(await loadModel(meta));
    views.push(view);
    view.setTeam(team);
    view.setSilhouette(silhouette);
    const scene = new THREE.Scene();
    scene.add(view.group);
    const draw = (px: number, pyTop: number, size: number, margin: number): void => {
      const cam = tileCamera(meta, silhouette, margin);
      renderer.setViewport(px, H - pyTop - size, size, size);
      renderer.setScissor(px, H - pyTop - size, size, size);
      renderer.render(scene, cam);
    };
    draw(x + 6, yTop + 6, TILE - 12, 1.04);
    let minis = '';
    if (silhouette) {
      let mx = x + TILE - 8;
      for (const s of MINI) {
        mx -= s + 6;
        draw(mx, yTop + TILE + (LABEL_H - s) / 2, s, 1.0);
      }
      minis = ' · 32 / 48 px →';
    }
    const label = el(
      'div',
      { class: 'tile-label' },
      `<b>${esc(meta.name)}</b> <span class="small">T${meta.tech}</span><br><span class="small">${esc(meta.id)}<br>${meta.lods.map((l) => l.triangles).join('/')} Tris${minis}</span>`,
    );
    label.style.left = `${x + 6}px`;
    label.style.top = `${yTop + TILE - 2}px`;
    label.style.width = silhouette ? `${TILE - 110}px` : `${TILE - 12}px`;
    label.style.textAlign = silhouette ? 'left' : 'center';
    sheet.append(label);
  }
  markReady();
  return () => {
    app.style.padding = '';
    for (const v of views) v.dispose();
    renderer.dispose();
  };
}

export async function mountShot(app: HTMLElement, faction: string, unit: string, query: URLSearchParams): Promise<Cleanup> {
  const manifest = await loadManifest();
  const meta = manifest.models.find((m) => m.faction === faction && m.unit === unit);
  if (meta === undefined) throw new Error(`Modell ${faction}/${unit} nicht im Manifest`);
  const silhouette = query.get('mode') === 'silhouette';
  const team = teamHex(query.get('team'));
  const W = Number(query.get('w') ?? 960);
  const H = Number(query.get('h') ?? 720);
  const sheet = el('div', { class: 'sheet', id: 'sheet' });
  sheet.style.width = `${W}px`;
  sheet.style.height = `${H}px`;
  const canvas = el('canvas');
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  sheet.append(canvas);
  sheet.append(
    el(
      'div',
      { class: 'title' },
      `${esc(meta.name)} <span class="small">${esc(meta.id)} · ${esc(meta.role)} · Tris ${meta.lods.map((l) => l.triangles).join(' / ')} · ${meta.bounds.size.map((s) => s.toFixed(2)).join('×')} WU · Footprint ${meta.footprint.join('×')}</span>`,
    ),
  );
  app.innerHTML = '';
  app.style.padding = '0';
  app.append(sheet);
  const renderer = createRenderer(canvas, { preserve: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(silhouette ? BG_SILHOUETTE : BG_COLOR);
  const view = new UnitView(await loadModel(meta));
  view.setTeam(team);
  view.setSilhouette(silhouette);
  scene.add(view.group);
  if (!silhouette) {
    const { radius } = boundsSphere(meta);
    scene.add(groundGrid(Math.max(6, Math.ceil(radius * 5))), footprintOutline(meta.footprint));
  }
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.01, 1000);
  const { center, radius } = boundsSphere(meta);
  frameSphere(cam, center, radius, silhouette ? viewDir(30, 50) : viewDir(35, 28), 1.25);
  renderer.render(scene, cam);
  markReady();
  return () => {
    app.style.padding = '';
    view.dispose();
    renderer.dispose();
  };
}
