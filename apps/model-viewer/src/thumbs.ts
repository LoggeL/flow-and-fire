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
  /** Background color, also the low end of the HUD portrait's studio gradient. */
  readonly background?: string;
  /** HUD studio lighting and projected silhouette framing, independent of the gallery. */
  readonly portrait?: boolean;
}

/** Fit the visible LOD's actual vertices, including long gun barrels and antennas. */
function portraitCamera(view: UnitView, azimuth: number, elevation: number): THREE.OrthographicCamera {
  const direction = viewDir(azimuth, elevation);
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const point = new THREE.Vector3();
  const positions = view.model.lods[0]!.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i);
    const x = point.dot(right), y = point.dot(up);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const half = Math.max(x1 - x0, y1 - y0) / (2 * 0.86);
  const center = right.clone().multiplyScalar((x0 + x1) / 2).addScaledVector(up, (y0 + y1) / 2);
  const { radius } = boundsSphere(view.model.meta);
  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.01, radius * 8 + 10);
  camera.position.copy(center).addScaledVector(direction, radius * 4 + 1);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  return camera;
}

/** Deterministic recessed industrial stage; no texture or lighting is baked into model data. */
function portraitStage(size: number, background: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size * 0.42, size * 0.30, 0, size * 0.5, size * 0.5, size * 0.78);
  gradient.addColorStop(0, '#43575c');
  gradient.addColorStop(0.5, '#27383e');
  gradient.addColorStop(1, background);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  ctx.lineWidth = size / 192;
  // Sparse diagonal panel seams stay subordinate to the unit at button size.
  for (const offset of [-0.35, 0.15, 0.65, 1.15]) {
    ctx.strokeStyle = '#a6c2c20b';
    ctx.beginPath();
    ctx.moveTo(size * offset, size);
    ctx.lineTo(size * (offset + 0.6), 0);
    ctx.stroke();
  }
  const shadow = ctx.createRadialGradient(size * 0.5, size * 0.75, 0, size * 0.5, size * 0.75, size * 0.36);
  shadow.addColorStop(0, '#00000065');
  shadow.addColorStop(1, '#00000000');
  ctx.save();
  ctx.translate(0, size * 0.375);
  ctx.scale(1, 0.5);
  ctx.fillStyle = shadow;
  ctx.fillRect(0, 0, size, size * 2);
  ctx.restore();
  return canvas;
}

export async function thumbnail(meta: ModelMeta, o: ThumbOptions = {}): Promise<string> {
  const size = o.size ?? 320;
  renderer ??= createRenderer(undefined, { preserve: true, alpha: true });
  renderer.setPixelRatio(1);
  // Supersample portraits before their final 192px export to keep barrels and seams crisp.
  renderer.setSize(size * (o.portrait ? 2 : 1), size * (o.portrait ? 2 : 1), false);
  const model = await loadModel(meta);
  const view = new UnitView(model);
  view.setTeam(o.team ?? '#2F6FD0');
  view.setSilhouette(o.silhouette === true);
  const scene = new THREE.Scene();
  scene.background = o.portrait ? null : new THREE.Color(o.background ?? (o.silhouette === true ? BG_SILHOUETTE : BG_COLOR));
  scene.add(view.group);
  let cam: THREE.Camera;
  if (o.portrait) {
    cam = portraitCamera(view, o.azimuth ?? 35, o.elevation ?? 32);
    view.material.uniforms.uPortrait.value = 1;
    view.material.uniforms.uSunDir.value.set(0.6, 0.75, 0.7).normalize();
    view.material.uniforms.uGlow.value = 0.7;
  } else {
    const perspective = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
    const { center, radius } = boundsSphere(meta);
    frameSphere(perspective, center, radius, viewDir(o.azimuth ?? 35, o.elevation ?? 32), 1.02);
    cam = perspective;
  }
  renderer.render(scene, cam);
  let url: string;
  if (o.portrait) {
    const canvas = portraitStage(size, o.background ?? '#10191d');
    canvas.getContext('2d')!.drawImage(renderer.domElement, 0, 0, size, size);
    url = canvas.toDataURL('image/png');
  } else {
    url = renderer.domElement.toDataURL('image/png');
  }
  view.dispose();
  return url;
}
