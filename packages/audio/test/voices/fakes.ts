/**
 * Test doubles for the voice-manager tests: a SoundResolver over a manifest with fake buffers
 * and a simple SpatialModel. Independent of the real catalog (audioeng-b2) and spatial model
 * (audioeng-b3), which are developed in parallel.
 */

import type { AudioBufferLike } from '../../src/ports.ts';
import {
  MANIFEST_BUS_TO_BUS,
  categoryIndex,
  type AudioManifest,
  type ListenerState,
  type ResolvedSound,
  type SoundResolver,
  type SpatialModel,
  type SpatialResult,
} from '../../src/types.ts';
import { FakeAudioContext, fakeBuffersFor, type FakeBaseAudioContext } from '../support/index.ts';
import { Mixer } from '../../src/mixer/index.ts';
import { VoiceManager, type VoiceManagerOptions } from '../../src/voices/index.ts';

export class FakeResolver implements SoundResolver {
  readonly sounds: ResolvedSound[] = [];
  readonly buffers: (AudioBufferLike | null)[][] = [];
  readonly loadRequests: number[] = [];
  private readonly ids = new Map<string, number>();

  constructor(
    readonly manifest: AudioManifest,
    ctx: FakeBaseAudioContext,
    opts: { loaded?: boolean } = {},
  ) {
    const bufs = fakeBuffersFor(manifest, ctx);
    manifest.sounds.forEach((s, index) => {
      this.sounds.push({
        index,
        id: s.id,
        name: s.name,
        scope: s.scope,
        category: s.category,
        categoryIndex: categoryIndex(s.category),
        bus: MANIFEST_BUS_TO_BUS[s.bus],
        priority: s.priority,
        cooldownMs: s.cooldownMs,
        maxVoices: s.maxVoices,
        categoryMaxVoices: manifest.categories[s.category].maxVoices,
        spatial: s.spatial,
        channels: s.channels,
        loop: s.loop,
        variantCount: s.variants.length,
        durationS: s.durationS,
      });
      this.ids.set(s.id, index);
      const list = bufs.get(s.id)!;
      this.buffers.push(opts.loaded === false ? list.map(() => null) : list.slice());
    });
    this.all = bufs;
  }

  /** All fake buffers by sound id (also for sounds marked as not loaded). */
  readonly all: Map<string, AudioBufferLike[]>;

  get size(): number {
    return this.sounds.length;
  }

  resolve(nameOrId: string, faction: string): ResolvedSound | null {
    if (nameOrId.includes(':')) return this.at(this.ids.get(nameOrId));
    return this.at(this.ids.get(`${faction}:${nameOrId}`) ?? this.ids.get(`common:${nameOrId}`));
  }

  byIndex(index: number): ResolvedSound {
    const s = this.sounds[index];
    if (s === undefined) throw new RangeError(`sound index ${index}`);
    return s;
  }

  buffer(index: number, variant: number): AudioBufferLike | null {
    return this.buffers[index]?.[variant] ?? null;
  }

  isLoaded(index: number): boolean {
    return (this.buffers[index] ?? []).some((b) => b !== null);
  }

  requestLoad(index: number): void {
    this.loadRequests.push(index);
  }

  /** Marks all variants of `id` loaded (true) or unloaded (false). */
  setLoaded(id: string, loaded: boolean): void {
    const i = this.ids.get(id)!;
    const all = this.all.get(id)!;
    this.buffers[i] = loaded ? all.slice() : all.map(() => null);
  }

  /** Index of a fully qualified id. */
  indexOf(id: string): number {
    const i = this.ids.get(id);
    if (i === undefined) throw new Error(`unknown id ${id}`);
    return i;
  }

  /** Variant index of a buffer (identity), −1 if foreign. */
  variantOf(id: string, buf: AudioBufferLike | null): number {
    return buf === null ? -1 : (this.all.get(id) ?? []).indexOf(buf);
  }

  private at(i: number | undefined): ResolvedSound | null {
    return i === undefined ? null : this.sounds[i]!;
  }
}

/**
 * Simple spatial model: pan = clamp(x / 100, −1, 1); gain = 1 − |z| / 1000 (inaudible from
 * |z| ≥ 1000 → returns false). Counts calls.
 */
export class FakeSpatial implements SpatialModel {
  calls = 0;
  listener: ListenerState | null = null;

  setListener(l: ListenerState): void {
    this.listener = l;
  }

  spatialize(_categoryIndex: number, x: number, z: number, out: SpatialResult): boolean {
    this.calls++;
    const az = Math.abs(z);
    if (az >= 1000) return false;
    out.gain = 1 - az / 1000;
    out.pan = Math.max(-1, Math.min(1, x / 100));
    return true;
  }
}

export interface Rig {
  ctx: FakeAudioContext;
  mixer: Mixer;
  resolver: FakeResolver;
  spatial: FakeSpatial;
  vm: VoiceManager;
}

/** Running fake context + mixer + resolver + voice manager. */
export async function makeRig(
  manifest: AudioManifest,
  opts: Partial<Omit<VoiceManagerOptions, 'ctx' | 'mixer' | 'resolver'>> & {
    sampleRate?: number;
    logAutomation?: boolean;
    loaded?: boolean;
  } = {},
): Promise<Rig> {
  const ctx = new FakeAudioContext({ sampleRate: opts.sampleRate ?? 48000, logAutomation: opts.logAutomation ?? true });
  await ctx.resume();
  const mixer = new Mixer(ctx);
  const resolver = new FakeResolver(manifest, ctx, { loaded: opts.loaded ?? true });
  const spatial = new FakeSpatial();
  const { sampleRate: _s, logAutomation: _l, loaded: _d, ...vmOpts } = opts;
  const vm = new VoiceManager({
    ctx,
    mixer,
    resolver,
    spatial,
    faction: 'varkan',
    clockMs: () => ctx.nowMs,
    ...vmOpts,
  });
  return { ctx, mixer, resolver, spatial, vm };
}

/** Deterministic PRNG (mulberry32) for reproducible tests. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
