/** Shared three.js helpers: renderer, camera framing, ground grid, footprint outline. */
import * as THREE from 'three';

export const TEAM_BLUE = '#2F6FD0';
export const BG_COLOR = '#C9CDD2';
export const BG_SILHOUETTE = '#F4F3EF';

export function createRenderer(canvas?: HTMLCanvasElement, opts: { preserve?: boolean; alpha?: boolean } = {}): THREE.WebGLRenderer {
  const r = new THREE.WebGLRenderer({
    antialias: true,
    alpha: opts.alpha ?? false,
    preserveDrawingBuffer: opts.preserve ?? false,
    ...(canvas === undefined ? {} : { canvas }),
  });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.0;
  r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  return r;
}

/** Direction from target to camera for azimuth (0 = front, +Z) and elevation, degrees. */
export function viewDir(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
}

/** Places a perspective camera so a sphere fills the view (margin 1 = touching). */
export function frameSphere(cam: THREE.PerspectiveCamera, center: THREE.Vector3, radius: number, dir: THREE.Vector3, margin = 1.08): void {
  const fov = THREE.MathUtils.degToRad(cam.fov);
  const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * cam.aspect));
  const dist = (radius * margin) / Math.sin(fit / 2);
  cam.position.copy(center).addScaledVector(dir, dist);
  cam.near = Math.max(0.01, dist - radius * 3);
  cam.far = dist + radius * 3 + 10;
  cam.lookAt(center);
  cam.updateProjectionMatrix();
}

/** Ground grid with 1-WU cells (dark lines every 1 WU, stronger every 4 WU). */
export function groundGrid(size: number, color = 0x7d848c): THREE.Group {
  const g = new THREE.Group();
  const half = Math.ceil(size / 2);
  const minor: number[] = [];
  const major: number[] = [];
  for (let i = -half; i <= half; i++) {
    const arr = i % 4 === 0 ? major : minor;
    arr.push(i, 0, -half, i, 0, half, -half, 0, i, half, 0, i);
  }
  const line = (pts: number[], c: number, opacity: number): THREE.LineSegments => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity }));
  };
  g.add(line(minor, color, 0.35), line(major, color, 0.7));
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2, half * 2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xb4b9bf }),
  );
  plane.position.y = -0.002;
  g.add(plane);
  return g;
}

/** Footprint rectangle on the ground (cells × 1 WU, centered). */
export function footprintOutline(fp: readonly [number, number], color = 0xf2c14e): THREE.LineLoop {
  const [w, d] = fp;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, 0.003, -d / 2, w / 2, 0.003, -d / 2, w / 2, 0.003, d / 2, -w / 2, 0.003, d / 2], 3));
  return new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color }));
}

/** Screen length in px of a world length at distance `dist` (perspective, vertical fov). */
export function pixelsFor(length: number, dist: number, fovDeg: number, viewportHeight: number): number {
  return (length / (2 * dist * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2))) * viewportHeight;
}
