/** Manifest + GLB loading (content/models/dist, served under /models/). */
import type { Manifest, ModelMeta } from '@faf/modelkit';
import { TEAM_COLORS } from '@faf/modelkit/materials';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createUnitMaterial, MAX_PARTS, setTeam, type TeamSwap, type UnitMaterial } from './material.ts';

let manifestPromise: Promise<Manifest> | null = null;

export function loadManifest(): Promise<Manifest> {
  manifestPromise ??= fetch('/models/manifest.json').then(async (r) => {
    if (!r.ok) throw new Error(`manifest.json: HTTP ${r.status} – erst "pnpm models" ausführen`);
    return (await r.json()) as Manifest;
  });
  return manifestPromise;
}

export interface PartInfo {
  readonly name: string;
  readonly parent: number;
  readonly pivot: readonly [number, number, number];
  readonly anim: string;
}

export interface LoadedModel {
  readonly meta: ModelMeta;
  /** Geometry per LOD (finest first). */
  readonly lods: THREE.BufferGeometry[];
  readonly parts: readonly PartInfo[];
  /** Team-conflict color swaps of the faction palette. */
  readonly swaps: readonly TeamSwap[];
}

/** Palette `teamAlt` of the model's faction as shader swaps. */
function factionSwaps(manifest: Manifest, faction: string): TeamSwap[] {
  const f = manifest.factions.find((x) => x.slug === faction);
  if (f === undefined) return [];
  return (f.teamAlt ?? []).flatMap((a) => {
    const from = f.palette[a.slot];
    if (from === undefined) return [];
    const teams = a.teams.map((k) => TEAM_COLORS.find((t) => t.key === k)?.hex.toUpperCase()).filter((h): h is string => h !== undefined);
    return [{ from, to: a.color, teams }];
  });
}

const cache = new Map<string, Promise<LoadedModel>>();
const loader = new GLTFLoader();

export function loadModel(meta: ModelMeta): Promise<LoadedModel> {
  let p = cache.get(meta.file);
  if (p === undefined) {
    p = Promise.all([loader.loadAsync(`/models/${meta.file}?v=${meta.sha256.slice(0, 12)}`), loadManifest()]).then(([gltf, manifest]) => {
      const lods: THREE.BufferGeometry[] = [];
      const extras = gltf.scene.userData as { faf?: { parts?: PartInfo[] } };
      gltf.scene.traverse((o) => {
        const m = /^lod(\d)$/.exec(o.name);
        if (m === null) return;
        o.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) lods[Number(m[1])] = (c as THREE.Mesh).geometry;
        });
      });
      return {
        meta,
        lods,
        parts: extras.faf?.parts ?? meta.parts.map((q) => ({ name: q.name, parent: q.parent, pivot: q.pivot, anim: q.anim })),
        swaps: factionSwaps(manifest, meta.faction),
      };
    });
    cache.set(meta.file, p);
  }
  return p;
}

/** Part angles (radians) by part index: yaw about +Y, pitch nose-up about the part's X axis. */
export type PartPose = ReadonlyMap<number, { yaw: number; pitch: number }>;

/** An instance of a model: one mesh per LOD sharing one material; `setLod` switches. */
export class UnitView {
  readonly group = new THREE.Group();
  readonly material: UnitMaterial;
  readonly meshes: THREE.Mesh[];
  lod = 0;

  constructor(readonly model: LoadedModel) {
    this.material = createUnitMaterial();
    this.meshes = model.lods.map((g, i) => {
      const mesh = new THREE.Mesh(g, this.material);
      mesh.visible = i === 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    });
    this.setPose(new Map());
  }

  setLod(lod: number): void {
    this.lod = Math.max(0, Math.min(this.meshes.length - 1, lod));
    this.meshes.forEach((m, i) => (m.visible = i === this.lod));
  }

  setTeam(hex: string): void {
    setTeam(this.material, hex, this.model.swaps);
  }

  setSilhouette(on: boolean): void {
    this.material.uniforms.uSilhouette.value = on ? 1 : 0;
  }

  setGray(on: boolean): void {
    this.material.uniforms.uGray.value = on ? 1 : 0;
  }

  setWireframe(on: boolean): void {
    this.material.wireframe = on;
  }

  /** Part matrices: M_k = M_parent · T(pivot) · R_k · T(−pivot). */
  setPose(pose: PartPose): void {
    const mats = this.material.uniforms.uPart.value;
    const parts = this.model.parts;
    for (let k = 0; k < MAX_PARTS; k++) mats[k]!.identity();
    for (let k = 1; k < parts.length && k < MAX_PARTS; k++) {
      const p = parts[k]!;
      const a = pose.get(k);
      const local = new THREE.Matrix4();
      if (a !== undefined) {
        const [px, py, pz] = p.pivot;
        const r = new THREE.Matrix4().makeRotationY(a.yaw).multiply(new THREE.Matrix4().makeRotationX(-a.pitch));
        local.makeTranslation(px, py, pz).multiply(r).multiply(new THREE.Matrix4().makeTranslation(-px, -py, -pz));
      }
      mats[k]!.copy(mats[p.parent]!).multiply(local);
    }
  }

  dispose(): void {
    this.material.dispose();
  }
}

/** Parts that turn (yaw) or tilt (pitch) for the "animate parts" demo. */
export function demoPose(model: LoadedModel, t: number): PartPose {
  const pose = new Map<number, { yaw: number; pitch: number }>();
  model.parts.forEach((p, k) => {
    if (k === 0) return;
    const phase = k * 0.7;
    const yaw = p.anim === 'yaw' || p.anim === 'yawpitch' ? Math.sin(t * 0.8 + phase) * 0.7 : p.anim === 'spin' ? t * 4 : 0;
    const pitch = p.anim === 'pitch' || p.anim === 'yawpitch' ? (Math.sin(t * 1.3 + phase) * 0.5 + 0.5) * 0.3 : 0;
    pose.set(k, { yaw, pitch });
  });
  return pose;
}

export function lodForDistance(meta: ModelMeta, dist: number): number {
  return dist >= meta.lodDistances[1] ? 2 : dist >= meta.lodDistances[0] ? 1 : 0;
}

/** Bounding sphere (center, radius) of the model in export space. */
export function boundsSphere(meta: ModelMeta): { center: THREE.Vector3; radius: number } {
  const [x0, y0, z0] = meta.bounds.min;
  const [x1, y1, z1] = meta.bounds.max;
  const center = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const radius = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2;
  return { center, radius };
}
