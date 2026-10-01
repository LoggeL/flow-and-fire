/**
 * Camera of the lab: scene preset + user offsets (mouse) + optional slow flight + camera shake.
 * Flight and shake are functions of the scene time, so `freeze` holds the camera as well.
 *
 * Mouse: left drag = pan, right drag (or Shift + left) = rotate/tilt, wheel = zoom, double click = reset.
 * Roll of the shake is not applied (RtsCamera has no roll axis); the displacement is.
 */
import type { RtsCamera } from '@faf/render';
import type { ShakeSample } from '@faf/render-fx';
import type { LabCameraPreset } from './context.ts';

const DEG = Math.PI / 180;
/** Flight: heading change per second of scene time and orbit of the target. */
export const FLIGHT_DEG_PER_S = 3;
export const FLIGHT_ORBIT_WU = 18;
export const FLIGHT_ORBIT_PERIOD_S = 70;

export class LabCameraRig {
  preset: LabCameraPreset;
  panX = 0;
  panZ = 0;
  yawOffset = 0;
  pitchOffset = 0;
  zoom = 1;
  /** Target of the last {@link apply} without shake (WU); used as shake listener position. */
  readonly target = new Float64Array(3);
  private detachFn: (() => void) | null = null;

  constructor(preset: LabCameraPreset) {
    this.preset = preset;
  }

  setPreset(p: LabCameraPreset): void {
    this.preset = p;
    this.reset();
  }

  reset(): void {
    this.panX = 0;
    this.panZ = 0;
    this.yawOffset = 0;
    this.pitchOffset = 0;
    this.zoom = 1;
  }

  /** Target (WU, without shake) at scene time t; also stored in {@link target}. */
  computeTarget(t: number, flight: boolean, ground: (x: number, z: number) => number): Float64Array {
    const p = this.preset;
    let x = p.targetWu[0] + this.panX;
    let z = p.targetWu[1] + this.panZ;
    if (flight) {
      const a = (t / FLIGHT_ORBIT_PERIOD_S) * Math.PI * 2;
      x += Math.cos(a) * FLIGHT_ORBIT_WU - FLIGHT_ORBIT_WU;
      z += Math.sin(a) * FLIGHT_ORBIT_WU;
    }
    this.target[0] = x;
    this.target[1] = ground(x, z);
    this.target[2] = z;
    return this.target;
  }

  /** Writes the camera for scene time t (call {@link computeTarget} first; shake may be null). */
  apply(camera: RtsCamera, t: number, flight: boolean, shake: ShakeSample | null): void {
    const p = this.preset;
    camera.yaw = p.headingDeg * DEG + this.yawOffset + (flight ? t * FLIGHT_DEG_PER_S * DEG : 0);
    camera.pitch = p.pitchDeg * DEG + this.pitchOffset;
    camera.distance = p.distanceWu * this.zoom;
    const tg = this.target;
    const sx = shake !== null ? shake.dx : 0;
    const sy = shake !== null ? shake.dy : 0;
    const sz = shake !== null ? shake.dz : 0;
    camera.groundHeight = tg[1]! - 2;
    camera.setTargetWU(tg[0]! + sx, tg[1]! + sy, tg[2]! + sz);
  }

  /** Mouse controls on `el`. */
  attach(el: HTMLElement, camera: RtsCamera): void {
    this.detach();
    let mode: 'pan' | 'rotate' | null = null;
    let lx = 0;
    let ly = 0;
    const down = (e: PointerEvent): void => {
      mode = e.button === 2 || e.shiftKey ? 'rotate' : e.button === 0 ? 'pan' : null;
      lx = e.clientX;
      ly = e.clientY;
      if (mode !== null) el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent): void => {
      if (mode === null) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      if (mode === 'rotate') {
        this.yawOffset += dx * 0.005;
        this.pitchOffset = Math.max(-0.6, Math.min(0.6, this.pitchOffset + dy * 0.004));
        return;
      }
      // Pan in screen-aligned ground directions, scaled with the distance.
      const k = (camera.distance * 1.6) / Math.max(1, camera.viewportHeight);
      const c = Math.cos(camera.yaw);
      const s = Math.sin(camera.yaw);
      const right = -dx * k;
      const fwd = dy * k;
      this.panX += c * fwd - s * right;
      this.panZ += s * fwd + c * right;
    };
    const up = (e: PointerEvent): void => {
      mode = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      this.zoom = Math.max(0.15, Math.min(4, this.zoom * Math.exp(e.deltaY * 0.0012)));
    };
    const menu = (e: Event): void => e.preventDefault();
    const dbl = (): void => this.reset();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('contextmenu', menu);
    el.addEventListener('dblclick', dbl);
    this.detachFn = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('contextmenu', menu);
      el.removeEventListener('dblclick', dbl);
    };
  }

  detach(): void {
    this.detachFn?.();
    this.detachFn = null;
  }
}
