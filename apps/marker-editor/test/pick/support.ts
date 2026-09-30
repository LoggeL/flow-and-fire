/**
 * WebGL-free stand-in for TerrainView (overlay/picker tests): scene, perspective camera posed
 * like CameraRig, a fixed canvas rectangle and heightWuAt via @faf/rules sampleHeightRaw.
 */
import { createRtsMap, type MapPropField, type RtsMap } from '@faf/formats';
import { sampleHeightRaw, type Heightfield } from '@faf/rules';
import * as THREE from 'three';
import type { ClientRect, OverlayView, ViewMarkers } from '../../src/overlay/types.ts';

export interface Pose {
  readonly targetX: number;
  readonly targetZ: number;
  readonly distance: number;
  readonly yaw: number;
  readonly pitch: number;
}

export class FakeView implements OverlayView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rect: ClientRect;
  readonly canvas: { getBoundingClientRect(): ClientRect };
  map: RtsMap | null;
  renders = 0;
  private hf: Heightfield | null = null;
  private readonly cbs: (() => void)[] = [];

  constructor(map: RtsMap | null, rect: ClientRect = { left: 20, top: 10, width: 1280, height: 720 }) {
    this.rect = rect;
    this.canvas = { getBoundingClientRect: () => this.rect };
    this.camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.5, 10_000);
    this.map = null;
    this.setMap(map);
  }

  setMap(map: RtsMap | null): void {
    this.map = map;
    this.hf = map === null ? null : { sizeWu: map.meta.sizeWu, dim: map.meta.sizeWu + 1, heights: map.heights, heightScaleRaw: map.meta.heightScaleRaw };
  }

  heightWuAt(xWu: number, zWu: number): number {
    const hf = this.hf;
    return hf === null ? 0 : sampleHeightRaw(hf, Math.round(xWu * 4096), Math.round(zWu * 4096)) / 4096;
  }

  requestRender(): void {
    this.renders++;
  }

  onBeforeRender(cb: () => void): () => void {
    this.cbs.push(cb);
    return () => {
      const i = this.cbs.indexOf(cb);
      if (i >= 0) this.cbs.splice(i, 1);
    };
  }

  /** Runs the before-render callbacks (what TerrainView.renderNow does before drawing). */
  frame(): void {
    for (const cb of this.cbs.slice()) cb();
  }

  get listeners(): number {
    return this.cbs.length;
  }

  /** Same placement as CameraRig.apply (orbit around a ground target). */
  setPose(p: Pose): void {
    const t = new THREE.Vector3(p.targetX, this.heightWuAt(p.targetX, p.targetZ), p.targetZ);
    const cp = Math.cos(p.pitch);
    const cam = this.camera;
    cam.position.set(t.x + Math.sin(p.yaw) * cp * p.distance, t.y + Math.sin(p.pitch) * p.distance, t.z + Math.cos(p.yaw) * cp * p.distance);
    cam.up.set(0, 1, 0);
    cam.lookAt(t);
    const size = this.map?.meta.sizeWu ?? 512;
    cam.near = Math.max(0.1, p.distance * 0.004);
    cam.far = p.distance * 4 + size * 3;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }
}

/** Deterministic PRNG for test samples (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Synthetic 64 WU maps (heightScale 32 raw = 1/128 WU per step). */
export const SYNTH_SIZE = 64;

export function flatMap(): RtsMap {
  return createRtsMap({ sizeWu: SYNTH_SIZE, name: 'flat', heights: () => 1280 });
}

/** Tilted plane: 0.75 WU/WU along x, 0.25 WU/WU along z. */
export function rampMap(): RtsMap {
  return createRtsMap({ sizeWu: SYNTH_SIZE, name: 'ramp', heights: (x, z) => 640 + x * 96 + z * 32 });
}

/** 20 WU cliff at x = 30 (one sample cell wide) plus a thin 8 WU ridge along z = 48. */
export function cliffMap(): RtsMap {
  return createRtsMap({
    sizeWu: SYNTH_SIZE,
    name: 'cliff',
    heights: (x, z) => 640 + (x >= 30 ? 2560 : 0) + (z === 48 ? 1024 : 0),
  });
}

export function field(name: string, kind: MapPropField['kind'], shape: MapPropField['shape'], extra: Partial<MapPropField> = {}): MapPropField {
  return {
    name,
    kind,
    shape,
    entries: [{ id: kind === 'tree' ? 'core:tree_01' : kind === 'rock' ? 'core:rock_01' : 'core:wreck_01', weight: 1 }],
    densityPerKWu2: 64,
    seed: 7,
    scaleMinPermille: 800,
    scaleMaxPermille: 1200,
    maxSlopePermille: 0,
    dryOnly: false,
    reclaimMassMilli: 5000,
    reclaimEnergyMilli: 0,
    ...extra,
  };
}

export const WU = 4096;

/** Empty marker set for a map of `sizeWu`. */
export function markers(sizeWu: number, over: Partial<ViewMarkers> = {}): ViewMarkers {
  return {
    sizeWu,
    starts: [],
    spots: [],
    fields: [],
    props: [],
    expanded: [],
    selection: [],
    hover: null,
    issues: [],
    symmetry: 'none',
    draft: null,
    ...over,
  };
}
