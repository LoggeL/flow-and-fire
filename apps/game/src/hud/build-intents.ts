import { PlacementVerdict, footprintHeight, footprintWidth } from '@faf/rules';
import { UnitFlags, type FrameReader } from '@faf/protocol';

export interface IntentFootprint {
  readonly typeId: string;
  readonly width: number;
  readonly height: number;
}
export interface QueuedBuildGhost {
  readonly key: string;
  readonly bp: number;
  readonly typeId: string;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly builders: readonly number[];
  readonly armies: readonly number[];
  readonly queueIndex: number;
  readonly orders: readonly { readonly builder: number; readonly army: number; readonly queueIndex: number }[];
  /** A known present blocker, never a prediction that the future footprint is valid. */
  readonly verdict: number | null;
  readonly corners: readonly (readonly [number, number])[];
}
interface IntentSite extends Omit<QueuedBuildGhost, 'verdict' | 'corners' | 'builders' | 'armies' | 'orders'> {
  readonly builders: Set<number>;
  readonly armies: Set<number>;
  readonly width: number;
  readonly height: number;
  readonly orders: { readonly builder: number; readonly army: number; readonly queueIndex: number }[];
}
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
export interface IntentProjection {
  heightAt(x: number, z: number): number;
  project(x: number, y: number, z: number, out: Float64Array): boolean;
  /** Uses only the client's replicated current placement world. */
  blocker?(site: { readonly bp: number; readonly x: number; readonly z: number; readonly yaw: number }): number;
}

function siteKey(bp: number, x: number, z: number, yaw: number): string {
  return `${bp}:${x}:${z}:${yaw}`;
}

/** Accepted shared intents are a full snapshot, independent of watched or selected units. */
export class FrameBuildIntents {
  private seq = -1;
  private tick = -1;
  private viewer = -128;
  private sites: readonly IntentSite[] = [];
  private readonly projected = new Float64Array(4);

  project(frame: FrameReader | null, footprint: (bp: number) => IntentFootprint | null, camera: IntentProjection): readonly QueuedBuildGhost[] {
    if (frame === null) { this.seq = -1; this.tick = -1; this.sites = []; return []; }
    if (frame.seq !== this.seq || frame.tick !== this.tick || frame.viewer !== this.viewer) {
      this.seq = frame.seq; this.tick = frame.tick; this.viewer = frame.viewer;
      this.sites = this.read(frame, footprint);
    }
    const ghosts: QueuedBuildGhost[] = [];
    for (const site of this.sites) {
      const corners: [number, number][] = [];
      for (const [dx, dz] of CORNERS) {
        const x = site.x + dx * site.width * 2048, z = site.z + dz * site.height * 2048;
        if (!camera.project(x, camera.heightAt(x, z), z, this.projected) || !Number.isFinite(this.projected[0]) || !Number.isFinite(this.projected[1])) break;
        corners.push([this.projected[0]!, this.projected[1]!]);
      }
      if (corners.length !== 4) continue;
      const current = camera.blocker?.(site);
      ghosts.push({ key: site.key, bp: site.bp, typeId: site.typeId, x: site.x, z: site.z,
        yaw: site.yaw, builders: [...site.builders], armies: [...site.armies], queueIndex: site.queueIndex, orders: site.orders,
        verdict: current === undefined || current === PlacementVerdict.Valid ? null : current, corners });
    }
    return ghosts;
  }

  private read(frame: FrameReader, footprint: (bp: number) => IntentFootprint | null): readonly IntentSite[] {
    const meshes = new Set<string>(), targetHandles = new Set<number>();
    for (let i = 0; i < frame.unitCount; i++) {
      const flags = frame.unitFlags(i);
      if (!(flags & UnitFlags.Building) || flags & (UnitFlags.Ghost | UnitFlags.Blip | UnitFlags.Wreck) || frame.unitBuild(i) === 255) continue;
      targetHandles.add(frame.unitHandle(i));
      meshes.add(siteKey(frame.unitVisual(i), frame.unitCur(i, 0), frame.unitCur(i, 2), frame.unitCurYaw(i)));
    }
    const sites = new Map<string, IntentSite>(), built = new Set<string>();
    // Suppress a shared site even when only one builder's intent points at its current mesh.
    for (let i = 0; i < frame.buildIntentCount; i++) {
      const key = siteKey(frame.buildIntentBp(i), frame.buildIntentX(i), frame.buildIntentZ(i), frame.buildIntentYaw(i));
      if (meshes.has(key) || targetHandles.has(frame.buildIntentTarget(i))) built.add(key);
    }
    for (let i = 0; i < frame.buildIntentCount; i++) {
      const bp = frame.buildIntentBp(i), x = frame.buildIntentX(i), z = frame.buildIntentZ(i), yaw = frame.buildIntentYaw(i);
      const key = siteKey(bp, x, z, yaw);
      if (built.has(key)) continue;
      let site = sites.get(key);
      if (site === undefined) {
        const spec = footprint(bp);
        if (spec === null) continue;
        site = { key, bp, typeId: spec.typeId, x, z, yaw, queueIndex: frame.buildIntentQueueIndex(i),
          width: footprintWidth(spec.width, spec.height, yaw), height: footprintHeight(spec.width, spec.height, yaw),
          builders: new Set(), armies: new Set(), orders: [] };
        sites.set(key, site);
      }
      site.builders.add(frame.buildIntentBuilder(i)); site.armies.add(frame.buildIntentArmy(i));
      site.orders.push({ builder: frame.buildIntentBuilder(i), army: frame.buildIntentArmy(i), queueIndex: frame.buildIntentQueueIndex(i) });
    }
    return [...sites.values()];
  }
}

/** Reprojection must follow the camera even while the accepted simulation tick is paused. */
export function equalQueuedGhosts(a: readonly QueuedBuildGhost[], b: readonly QueuedBuildGhost[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!, right = b[i]!;
    if (left.key !== right.key || left.typeId !== right.typeId || left.verdict !== right.verdict || left.queueIndex !== right.queueIndex ||
      left.builders.length !== right.builders.length || left.armies.length !== right.armies.length || left.orders.length !== right.orders.length) return false;
    if (left.builders.some((handle, k) => handle !== right.builders[k]) || left.armies.some((army, k) => army !== right.armies[k])) return false;
    if (left.orders.some((order, k) => order.builder !== right.orders[k]!.builder || order.army !== right.orders[k]!.army || order.queueIndex !== right.orders[k]!.queueIndex)) return false;
    for (let k = 0; k < 4; k++) if (left.corners[k]![0] !== right.corners[k]![0] || left.corners[k]![1] !== right.corners[k]![1]) return false;
  }
  return true;
}
