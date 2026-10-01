import { FogState, type FrameReader } from '@faf/protocol';
import type { VisibilityFogSnapshot } from '@faf/render';

export interface AcceptedVisibility extends VisibilityFogSnapshot {
  readonly viewer: number;
  readonly tick: number;
  /** Changes when a viewer, map grid or backwards seek invalidates the previous presentation. */
  readonly epoch: number;
}
export interface VisibilityPort { setVisibilityFog(snapshot: VisibilityFogSnapshot | null): void }

/** Retains an accepted frame's bytes independently of the transport's reusable frame buffer. */
export class FrameVisibility {
  snapshot: AcceptedVisibility | null = null;
  private cells = new Uint8Array(0);
  private version = 0;
  private epoch = 0;
  private lastSeq = -1;
  private lastTick = -1;
  private lastViewer = -128;

  /** Terrain is public map artwork; this never reveals filtered unit or event records. */
  constructor(private readonly preRevealTerrain = false) {}

  accept(frame: FrameReader, port: VisibilityPort, now: number): void {
    if (frame.seq === this.lastSeq && frame.tick === this.lastTick && frame.viewer === this.lastViewer) return;
    const reset = frame.viewer !== this.lastViewer || frame.tick < this.lastTick || frame.fogBytes !== this.cells.length;
    if (reset) {
      if (this.snapshot !== null) port.setVisibilityFog(null);
      this.epoch++;
    }
    this.lastSeq = frame.seq; this.lastTick = frame.tick; this.lastViewer = frame.viewer;
    if (frame.fogBytes === 0) {
      if (!reset && this.snapshot !== null) port.setVisibilityFog(null);
      this.snapshot = null;
      return;
    }
    if (this.cells.length !== frame.fogBytes) this.cells = new Uint8Array(frame.fogBytes);
    frame.copyFog(this.cells);
    if (this.preRevealTerrain) {
      for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === FogState.Unexplored) this.cells[i] = FogState.Explored;
    }
    this.snapshot = { dim: frame.fogDim, cells: this.cells, version: ++this.version, timeMs: now,
      viewer: frame.viewer, tick: frame.tick, epoch: this.epoch };
    port.setVisibilityFog(this.snapshot);
  }
}
