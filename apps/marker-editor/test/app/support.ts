/**
 * Helpers of the app controller tests (Node, no DOM/WebGL): a fake ToolEnv with a top-down
 * orthographic "camera" (client px = (WU − camera offset) · scale), a simple hit test with the same
 * priorities as hitTestMarkers, and pointer shorthands.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_FX_ONE, propFieldContains, type MapPoint } from '@faf/formats';
import { EditorController, type HostActions } from '../../src/app/controller.ts';
import { EditorStore } from '../../src/app/store.ts';
import type { PointerInput, ToolEnv } from '../../src/app/tools/types.ts';
import type { MarkerRef } from '../../src/model/types.ts';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const MAPS_DIR = resolve(REPO_ROOT, 'content/maps');
export type MapName = 'hollow-ridge' | 'tessera' | 'braidwater' | 'setons';

const cache: Partial<Record<MapName, Uint8Array>> = {};

export function mapBytes(name: MapName): Uint8Array {
  let b = cache[name];
  if (b === undefined) {
    b = new Uint8Array(readFileSync(resolve(MAPS_DIR, `${name}.rtsmap`)));
    cache[name] = b;
  }
  return b.slice();
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const FX = MAP_FX_ONE;

/** Top-down orthographic environment: px = (wu − cam) · scale. */
export class FakeEnv implements ToolEnv {
  scale = 2;
  camX = 0;
  camZ = 0;
  pans = 0;
  constructor(readonly store: EditorStore) {}

  get sizeWu(): number {
    return this.store.doc.peek()?.sizeWu ?? 512;
  }

  /** Client pixel of a WU point. */
  px(xWu: number, zWu: number): { x: number; y: number } {
    return { x: (xWu - this.camX) * this.scale, y: (zWu - this.camZ) * this.scale };
  }

  pick(x: number, y: number): MapPoint | null {
    const xw = x / this.scale + this.camX;
    const zw = y / this.scale + this.camZ;
    if (xw < 0 || zw < 0 || xw > this.sizeWu || zw > this.sizeWu) return null;
    return { x: Math.round(xw * FX), z: Math.round(zw * FX) };
  }

  project(xRaw: number, zRaw: number): { x: number; y: number } | null {
    return this.px(xRaw / FX, zRaw / FX);
  }

  groundAt(x: number, y: number): { x: number; z: number } {
    return { x: x / this.scale + this.camX, z: y / this.scale + this.camZ };
  }

  panBy(dx: number, dz: number): void {
    this.camX += dx;
    this.camZ += dz;
    this.pans++;
  }

  hitTest(x: number, y: number, selection?: readonly MarkerRef[]): MarkerRef | null {
    const doc = this.store.doc.peek();
    if (doc === null) return null;
    const sel = selection ?? this.store.selection.peek();
    const near = (xRaw: number, zRaw: number, r: number): number | null => {
      const p = this.project(xRaw, zRaw)!;
      const d = Math.hypot(p.x - x, p.y - y);
      return d <= r ? d : null;
    };
    let best: { ref: MarkerRef; d: number } | null = null;
    const offer = (ref: MarkerRef, d: number | null): void => {
      if (d !== null && (best === null || d < best.d)) best = { ref, d };
    };
    for (let i = 0; i < doc.fields.length; i++) {
      if (!sel.some((r) => (r.type === 'field' || r.type === 'fieldVertex' || r.type === 'fieldRadius') && r.index === i)) continue;
      const sh = doc.fields[i]!.shape;
      if (sh.kind === 'polygon') sh.points.forEach((q, v) => offer({ type: 'fieldVertex', index: i, vertex: v }, near(q.x, q.z, 6)));
      else offer({ type: 'fieldRadius', index: i }, near(sh.x + sh.r, sh.z, 6));
    }
    if (best !== null) return (best as { ref: MarkerRef }).ref;
    doc.starts.forEach((s, i) => offer({ type: 'start', index: i }, near(s.x, s.z, 12)));
    if (best !== null) return (best as { ref: MarkerRef }).ref;
    doc.spots.forEach((s, i) => offer({ type: 'spot', index: i }, near(s.x, s.z, 8)));
    if (best !== null) return (best as { ref: MarkerRef }).ref;
    const at = this.pick(x, y);
    if (at === null) return null;
    for (let i = doc.fields.length - 1; i >= 0; i--) if (propFieldContains(doc.fields[i]!.shape, at.x, at.z)) return { type: 'field', index: i };
    return null;
  }
}

export class FakeHost implements HostActions {
  readonly calls: string[] = [];
  save(): void {
    this.calls.push('save');
  }
  open(): void {
    this.calls.push('open');
  }
  fitView(): void {
    this.calls.push('fitView');
  }
  toggleGrid(): void {
    this.calls.push('toggleGrid');
  }
}

export interface Rig {
  readonly store: EditorStore;
  readonly env: FakeEnv;
  readonly host: FakeHost;
  readonly ctl: EditorController;
  readonly original: Uint8Array;
}

/** Store with `map` open (snap 0.5 WU), fake env (2 px per WU), controller. */
export function rig(map: MapName = 'hollow-ridge'): Rig {
  const store = new EditorStore();
  const original = mapBytes(map);
  store.open(original.slice(), `${map}.rtsmap`);
  const env = new FakeEnv(store);
  const host = new FakeHost();
  const ctl = new EditorController(store, env, host);
  return { store, env, host, ctl, original };
}

export function ptr(x: number, y: number, mods: Partial<Pick<PointerInput, 'shift' | 'mod'>> = {}): PointerInput {
  return { x, y, shift: mods.shift ?? false, mod: mods.mod ?? false };
}

/** Client px of a WU point in the rig's env. */
export function at(r: Rig, xWu: number, zWu: number, mods: Partial<Pick<PointerInput, 'shift' | 'mod'>> = {}): PointerInput {
  const p = r.env.px(xWu, zWu);
  return ptr(p.x, p.y, mods);
}

export function click(r: Rig, p: PointerInput): void {
  r.ctl.pointerMove(p);
  r.ctl.pointerDown(p);
  r.ctl.pointerUp(p);
}

/** Press at a, move in `steps` steps to b, release. */
export function drag(r: Rig, a: PointerInput, b: PointerInput, steps = 8): void {
  r.ctl.pointerMove(a);
  r.ctl.pointerDown(a);
  for (let i = 1; i <= steps; i++) r.ctl.pointerMove(ptr(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, { shift: b.shift, mod: b.mod }));
  r.ctl.pointerUp(b);
}

export function wu(raw: number): number {
  return raw / FX;
}
