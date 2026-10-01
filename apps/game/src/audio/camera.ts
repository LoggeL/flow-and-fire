import { FX_ONE, type ListenerState } from '@faf/audio';

/** Structural view of the actual RtsCamera; target coordinates are Q20.12. */
export interface AudioCamera {
  readonly targetX: number;
  readonly targetZ: number;
  readonly distance: number;
  readonly pitch: number;
  readonly yaw: number;
  readonly fovY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

/** Reuses the listener so the presentation frame does not allocate a camera snapshot. */
export function listenerFromCamera(camera: AudioCamera, out: ListenerState): ListenerState {
  out.focusX = camera.targetX / FX_ONE;
  out.focusZ = camera.targetZ / FX_ONE;
  out.height = Math.max(0.01, camera.distance * Math.sin(camera.pitch));
  out.viewHalfWidth = Math.max(0.01, camera.distance * Math.tan(camera.fovY / 2) * camera.viewportWidth / Math.max(1, camera.viewportHeight));
  out.rightX = -Math.sin(camera.yaw);
  out.rightZ = Math.cos(camera.yaw);
  return out;
}
