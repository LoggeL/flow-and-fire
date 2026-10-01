import { UnitFlags, type FrameReader } from '@faf/protocol';
import type { DynamicDecals, OverlaySegment, VisualTable } from '@faf/render';
import type { ClientMap } from './map.ts';
import { interpolatedPos, type Selection } from './selection.ts';
import type { RigVisualEntry } from './visuals.ts';

export const RALLY_COLOR = 0x55d9f5;
type Segment = { -readonly [K in keyof OverlaySegment]: OverlaySegment[K] };

/** Reused presentation buffers; coordinates always come from accepted factory watches. */
export class AcceptedRallyOverlay {
  readonly segments: Segment[] = Array.from({ length: 64 }, () => ({ ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, color: RALLY_COLOR, widthWU: 0.12 }));
  private readonly position = new Float64Array(3);
  count = 0;

  update(frame: FrameReader | null, selected: Pick<Selection, 'count' | 'handles' | 'indices'>, ownArmy: number,
    visuals: VisualTable, alpha: number, map: ClientMap | null, decals: DynamicDecals, output: OverlaySegment[]): void {
    this.count = 0;
    if (!frame || !map || frame.headerBytes < 160 || frame.viewer !== ownArmy) return;
    for (let w = 0; w < frame.watchCount && this.count < this.segments.length; w++) {
      const handle = frame.watchHandle(w);
      let index = -1;
      for (let k = 0; k < selected.count; k++) if (selected.handles[k] === handle) { index = selected.indices[k]!; break; }
      if (index < 0 || index >= frame.unitCount || frame.unitHandle(index) !== handle || frame.unitArmy(index) !== ownArmy ||
          frame.unitBuild(index) !== 255 || (frame.unitFlags(index) & (UnitFlags.Ghost | UnitFlags.Blip | UnitFlags.Wreck)) ||
          !(visuals[frame.unitVisual(index)] as RigVisualEntry | undefined)?.factory) continue;
      const x = frame.watchRallyX(w), z = frame.watchRallyZ(w), edge = map.sizeWu * 4096;
      if (x < 0 || z < 0 || x > edge || z > edge) continue;
      interpolatedPos(frame, index, alpha, this.position);
      const line = this.segments[this.count++]!;
      line.ax = this.position[0]!; line.az = this.position[2]!; line.ay = map.heightAtRaw(line.ax, line.az);
      line.bx = x; line.bz = z; line.by = map.heightAtRaw(x, z);
      output.push(line);
      const ring = decals.ring(x, z, 0.8, RALLY_COLOR, 0.95, 0.1);
      if (ring >= 0) { decals.minRadiusPx[ring] = 6; decals.maxRadiusWU[ring] = 2; }
      decals.disc(x, z, 0.16, RALLY_COLOR, 0.95, 0.06);
    }
  }
}
