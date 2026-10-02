import { PlacementVerdict, footprintHeight, footprintWidth } from '@faf/rules';
import { UnitFlags, type FrameReader } from '@faf/protocol';
import type { BuildRole } from './build-role.ts';

export interface IntentFootprint {
  readonly typeId: string;
  readonly width: number;
  readonly height: number;
  readonly role?: BuildRole;
  readonly previewHeightRaw?: number;
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
  readonly roof?: readonly (readonly [number, number])[];
  readonly role?: BuildRole;
}
interface IntentSite extends Omit<QueuedBuildGhost, 'verdict' | 'corners' | 'roof' | 'builders' | 'armies' | 'orders'> {
  readonly builders: Set<number>;
  readonly armies: Set<number>;
  readonly width: number;
  readonly height: number;
  readonly previewHeightRaw: number;
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

  private refresh(frame: FrameReader | null, footprint: (bp: number) => IntentFootprint | null): void {
    if (frame === null) { this.seq = -1; this.tick = -1; this.sites = []; return; }
    if (frame.seq !== this.seq || frame.tick !== this.tick || frame.viewer !== this.viewer) {
      this.seq = frame.seq; this.tick = frame.tick; this.viewer = frame.viewer;
      this.sites = this.read(frame, footprint);
    }
  }

  /** Reserve accepted future footprints even when the camera clips their ghosts. Touching edges are allowed. */
  overlaps(frame: FrameReader | null, footprint: (bp: number) => IntentFootprint | null, candidate: { readonly x: number; readonly z: number; readonly width: number; readonly height: number }): boolean {
    this.refresh(frame, footprint);
    return this.sites.some(site => Math.abs(site.x - candidate.x) < (site.width + candidate.width) * 2048 &&
      Math.abs(site.z - candidate.z) < (site.height + candidate.height) * 2048);
  }

  project(frame: FrameReader | null, footprint: (bp: number) => IntentFootprint | null, camera: IntentProjection): readonly QueuedBuildGhost[] {
    this.refresh(frame, footprint);
    const ghosts: QueuedBuildGhost[] = [];
    for (const site of this.sites) {
      const corners: [number, number][] = [], roof: [number, number][] = [];
      let base = -Infinity;
      for (const [dx, dz] of CORNERS) {
        const x = site.x + dx * site.width * 2048, z = site.z + dz * site.height * 2048;
        const y = camera.heightAt(x, z); base = Math.max(base, y);
        if (!camera.project(x, y, z, this.projected) || !Number.isFinite(this.projected[0]) || !Number.isFinite(this.projected[1])) break;
        corners.push([this.projected[0]!, this.projected[1]!]);
      }
      if (corners.length !== 4) continue;
      if (site.previewHeightRaw > 0) for (const [dx, dz] of CORNERS) {
        if (!camera.project(site.x + dx * site.width * 2048, base + site.previewHeightRaw, site.z + dz * site.height * 2048, this.projected) ||
          !Number.isFinite(this.projected[0]) || !Number.isFinite(this.projected[1])) break;
        roof.push([this.projected[0]!, this.projected[1]!]);
      }
      const current = camera.blocker?.(site);
      ghosts.push({ key: site.key, bp: site.bp, typeId: site.typeId, x: site.x, z: site.z,
        yaw: site.yaw, builders: [...site.builders], armies: [...site.armies], queueIndex: site.queueIndex, orders: site.orders,
        verdict: current === undefined || current === PlacementVerdict.Valid ? null : current, corners, roof: roof.length === 4 ? roof : [], ...(site.role ? { role: site.role } : {}) });
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
          ...(spec.role ? { role: spec.role } : {}), previewHeightRaw: spec.previewHeightRaw ?? 0,
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
    if (left.key !== right.key || left.typeId !== right.typeId || left.role !== right.role || left.verdict !== right.verdict || left.queueIndex !== right.queueIndex ||
      left.builders.length !== right.builders.length || left.armies.length !== right.armies.length || left.orders.length !== right.orders.length) return false;
    if (left.builders.some((handle, k) => handle !== right.builders[k]) || left.armies.some((army, k) => army !== right.armies[k])) return false;
    if (left.orders.some((order, k) => order.builder !== right.orders[k]!.builder || order.army !== right.orders[k]!.army || order.queueIndex !== right.orders[k]!.queueIndex)) return false;
    for (let k = 0; k < 4; k++) if (left.corners[k]![0] !== right.corners[k]![0] || left.corners[k]![1] !== right.corners[k]![1]) return false;
    if ((left.roof?.length ?? 0) !== (right.roof?.length ?? 0)) return false;
    if (left.roof?.some((point, k) => point[0] !== right.roof![k]![0] || point[1] !== right.roof![k]![1])) return false;
  }
  return true;
}
