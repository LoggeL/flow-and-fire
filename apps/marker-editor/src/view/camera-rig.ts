/**
 * RTS-style orbit camera for the editor: the camera circles a ground target.
 *
 * Input (the left mouse button stays free for the editor tools):
 * - pan: drag with the right or middle mouse button; keys WASD / arrows (KeyboardEvent.code)
 * - zoom: mouse wheel, towards the point under the cursor
 * - rotate: Alt + left drag (yaw and pitch); keys Q / E (yaw)
 *
 * World: x = WU x, z = WU z, y = height (WU). Yaw 0 looks from +z towards −z (map row z = 0 at the
 * top of the screen, x to the right).
 */
import * as THREE from 'three';

export interface CameraPose {
  readonly targetX: number;
  readonly targetZ: number;
  readonly distance: number;
  /** Radians; 0 = camera on the +z side of the target. */
  readonly yaw: number;
  /** Radians above the horizon. */
  readonly pitch: number;
}

export interface CameraRigOptions {
  /** Terrain height (WU) at a ground point: keeps the orbit target on the ground. */
  readonly heightAt?: (xWu: number, zWu: number) => number;
  /** Called after every camera change (the view schedules a render). */
  readonly onChange?: () => void;
  /** Element that receives keyboard input; default window. */
  readonly keyTarget?: Window | HTMLElement;
}

const MIN_PITCH = (12 * Math.PI) / 180;
const MAX_PITCH = (89 * Math.PI) / 180;
const MIN_DISTANCE = 4;
/** Wheel zoom: factor e^(k·deltaPixels). */
const WHEEL_K = 0.0015;
/** Keyboard pan speed in view heights per second. */
const KEY_PAN_SPEED = 0.9;
/** Keyboard yaw speed (rad/s). */
const KEY_YAW_SPEED = Math.PI / 2;
const DRAG_ROTATE_PER_PX = 0.006;

const PAN_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
const YAW_KEYS: Readonly<Record<string, number>> = { KeyQ: -1, KeyE: 1 };

function isEditableTarget(t: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

type DragMode = 'pan' | 'rotate';

export class CameraRig {
  /** When false, all mouse/keyboard input is ignored (programmatic calls still work). */
  enabled = true;
  readonly camera: THREE.PerspectiveCamera;
  readonly dom: HTMLElement;
  /** Orbit target on the ground (y = terrain height). */
  readonly target = new THREE.Vector3();
  distance = 100;
  yaw = 0;
  pitch = (58 * Math.PI) / 180;
  /** Map edge length (WU): bounds for target and distance. */
  private sizeWu = 512;
  private readonly heightAt: (xWu: number, zWu: number) => number;
  private readonly onChange: () => void;
  private readonly keyTarget: Window | HTMLElement;
  private readonly keys: string[] = [];
  private keyRaf = 0;
  private keyLast = 0;
  private drag: { mode: DragMode; id: number; x: number; y: number } | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly plane = new THREE.Plane();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement, opts: CameraRigOptions = {}) {
    this.camera = camera;
    this.dom = dom;
    this.heightAt = opts.heightAt ?? (() => 0);
    this.onChange = opts.onChange ?? (() => undefined);
    this.keyTarget = opts.keyTarget ?? window;
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointercancel', this.onPointerUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', this.onContextMenu);
    this.keyTarget.addEventListener('keydown', this.onKeyDown as EventListener);
    this.keyTarget.addEventListener('keyup', this.onKeyUp as EventListener);
    window.addEventListener('blur', this.onBlur);
    this.apply();
  }

  /** Map size for target clamping and zoom limits. */
  setBounds(sizeWu: number): void {
    this.sizeWu = sizeWu;
    this.apply();
  }

  get maxDistance(): number {
    return this.sizeWu * 2.5;
  }

  /** Current pose (for tests and persistence). */
  pose(): CameraPose {
    return { targetX: this.target.x, targetZ: this.target.z, distance: this.distance, yaw: this.yaw, pitch: this.pitch };
  }

  setPose(p: Partial<CameraPose>): void {
    if (p.targetX !== undefined) this.target.x = p.targetX;
    if (p.targetZ !== undefined) this.target.z = p.targetZ;
    if (p.distance !== undefined) this.distance = p.distance;
    if (p.yaw !== undefined) this.yaw = p.yaw;
    if (p.pitch !== undefined) this.pitch = p.pitch;
    this.apply();
  }

  /** Moves the target by a world-space offset (WU along x and z). */
  panBy(dxWu: number, dzWu: number): void {
    this.target.x += dxWu;
    this.target.z += dzWu;
    this.apply();
  }

  /**
   * Multiplies the distance by `factor` (< 1 zooms in). With client coordinates the ground point
   * under the cursor stays under the cursor.
   */
  zoomBy(factor: number, clientX?: number, clientY?: number): void {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    const anchored = clientX !== undefined && clientY !== undefined;
    const before = anchored ? this.groundAt(clientX, clientY, this.tmp2) : null;
    this.distance *= factor;
    this.apply();
    if (before !== null && anchored) {
      const after = this.groundAt(clientX, clientY, this.tmp);
      if (after !== null) {
        this.target.x += before.x - after.x;
        this.target.z += before.z - after.z;
        this.apply();
      }
    }
  }

  /** Rotates around the target (radians). */
  rotateBy(dYaw: number, dPitch = 0): void {
    this.yaw += dYaw;
    this.pitch += dPitch;
    this.apply();
  }

  /** Ground-plane (y = target height) point under a client pixel, or null if the ray misses. */
  groundAt(clientX: number, clientY: number, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 | null {
    const r = this.dom.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.plane.set(new THREE.Vector3(0, 1, 0), -this.target.y);
    return this.raycaster.ray.intersectPlane(this.plane, out);
  }

  /** Clamps the pose, places the camera and notifies the view. */
  apply(): void {
    const size = this.sizeWu;
    const t = this.target;
    t.x = Math.min(size, Math.max(0, t.x));
    t.z = Math.min(size, Math.max(0, t.z));
    t.y = this.heightAt(t.x, t.z);
    this.distance = Math.min(this.maxDistance, Math.max(MIN_DISTANCE, this.distance));
    this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.pitch));
    const twoPi = Math.PI * 2;
    this.yaw = ((this.yaw % twoPi) + twoPi) % twoPi;
    const cp = Math.cos(this.pitch);
    const cam = this.camera;
    cam.position.set(
      t.x + Math.sin(this.yaw) * cp * this.distance,
      t.y + Math.sin(this.pitch) * this.distance,
      t.z + Math.cos(this.yaw) * cp * this.distance,
    );
    cam.up.set(0, 1, 0);
    cam.lookAt(t);
    cam.near = Math.max(0.1, this.distance * 0.004);
    cam.far = this.distance * 4 + size * 3;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    this.onChange();
  }

  dispose(): void {
    const dom = this.dom;
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerup', this.onPointerUp);
    dom.removeEventListener('pointercancel', this.onPointerUp);
    dom.removeEventListener('wheel', this.onWheel);
    dom.removeEventListener('contextmenu', this.onContextMenu);
    this.keyTarget.removeEventListener('keydown', this.onKeyDown as EventListener);
    this.keyTarget.removeEventListener('keyup', this.onKeyUp as EventListener);
    window.removeEventListener('blur', this.onBlur);
    if (this.keyRaf !== 0) cancelAnimationFrame(this.keyRaf);
    this.keyRaf = 0;
    this.keys.length = 0;
  }

  /** World units per screen pixel at the target distance. */
  private wuPerPixel(): number {
    const h = Math.max(1, this.dom.clientHeight);
    return (2 * this.distance * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
  }

  /** Pans in screen directions: +right moves the view right, +up moves it towards the top of the screen. */
  private panScreen(rightWu: number, upWu: number): void {
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // right = (cos yaw, 0, −sin yaw); screen-up on the ground = forward = (−sin yaw, 0, −cos yaw).
    this.panBy(rightWu * cy - upWu * sy, -rightWu * sy - upWu * cy);
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled || this.drag !== null) return;
    let mode: DragMode | null = null;
    if (e.button === 1 || e.button === 2) mode = 'pan';
    else if (e.button === 0 && e.altKey) mode = 'rotate';
    if (mode === null) return;
    e.preventDefault();
    this.drag = { mode, id: e.pointerId, x: e.clientX, y: e.clientY };
    try {
      this.dom.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events may carry an inactive pointer id
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (d === null || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    if (dx === 0 && dy === 0) return;
    if (d.mode === 'pan') {
      const k = this.wuPerPixel();
      // Dragging moves the ground with the cursor; vertical motion is stretched by the tilt.
      this.panScreen(-dx * k, (dy * k) / Math.max(0.2, Math.sin(this.pitch)));
    } else {
      this.rotateBy(-dx * DRAG_ROTATE_PER_PX, dy * DRAG_ROTATE_PER_PX);
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const d = this.drag;
    if (d === null || e.pointerId !== d.id) return;
    this.drag = null;
    try {
      this.dom.releasePointerCapture(e.pointerId);
    } catch {
      // capture was not taken
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    if (px === 0) return;
    this.zoomBy(Math.exp(px * WHEEL_K), e.clientX, e.clientY);
  };

  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
    const code = e.code;
    if (PAN_KEYS[code] === undefined && YAW_KEYS[code] === undefined) return;
    if (code.startsWith('Arrow')) e.preventDefault();
    if (!this.keys.includes(code)) this.keys.push(code);
    if (this.keyRaf === 0) {
      this.keyLast = performance.now();
      this.keyRaf = requestAnimationFrame(this.keyTick);
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const i = this.keys.indexOf(e.code);
    if (i >= 0) this.keys.splice(i, 1);
  };

  private readonly onBlur = (): void => {
    this.keys.length = 0;
    this.drag = null;
  };

  private readonly keyTick = (now: number): void => {
    this.keyRaf = 0;
    if (this.keys.length === 0 || !this.enabled) return;
    const dt = Math.min(0.1, Math.max(0, (now - this.keyLast) / 1000));
    this.keyLast = now;
    let right = 0;
    let up = 0;
    let yaw = 0;
    for (const code of this.keys) {
      const p = PAN_KEYS[code];
      if (p !== undefined) {
        right += p[0];
        up += p[1];
      }
      yaw += YAW_KEYS[code] ?? 0;
    }
    const viewHeight = 2 * this.distance * Math.tan((this.camera.fov * Math.PI) / 360);
    const speed = viewHeight * KEY_PAN_SPEED * dt;
    if (right !== 0 || up !== 0) this.panScreen(right * speed, up * speed);
    if (yaw !== 0) this.rotateBy(yaw * KEY_YAW_SPEED * dt);
    this.keyRaf = requestAnimationFrame(this.keyTick);
  };
}
