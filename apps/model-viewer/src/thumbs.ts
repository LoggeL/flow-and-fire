/** Offscreen thumbnails (one shared WebGL context for the whole gallery). */
import type { ModelMeta } from '@faf/modelkit';
import * as THREE from 'three';
import { boundsSphere, loadModel, UnitView } from './models.ts';
import { BG_COLOR, BG_SILHOUETTE, createRenderer, frameSphere, viewDir } from './stage.ts';

let renderer: THREE.WebGLRenderer | null = null;

export interface ThumbOptions {
  readonly size?: number;
  readonly team?: string;
  readonly silhouette?: boolean;
  readonly azimuth?: number;
  readonly elevation?: number;
  /** HUD build buttons use a dark terrain-colored backdrop instead of the gallery grey. */
  readonly background?: string;
}

export async function thumbnail(meta: ModelMeta, o: ThumbOptions = {}): Promise<string> {
  const size = o.size ?? 320;
  renderer ??= createRenderer(undefined, { preserve: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  const model = await loadModel(meta);
  const view = new UnitView(model);
  view.setTeam(o.team ?? '#2F6FD0');
  view.setSilhouette(o.silhouette === true);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(o.background ?? (o.silhouette === true ? BG_SILHOUETTE : BG_COLOR));
  scene.add(view.group);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
  const { center, radius } = boundsSphere(meta);
  frameSphere(cam, center, radius, viewDir(o.azimuth ?? 35, o.elevation ?? 32), 1.02);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  view.dispose();
  return url;
}
