/**
 * Test fakes for the router and alert tests: a SoundResolver over a manifest (lookup rule
 * '<faction>:<name>' → 'common:<name>', fq-ids exact), a recording SoundSink and a controllable
 * VoiceHandle. The real SoundCatalog (src/catalog, audioeng-b2) is deliberately not used.
 */

import {
  MANIFEST_BUS_TO_BUS,
  categoryIndex,
  type AlertRequest,
  type AudioManifest,
  type DropReason,
  type PlayRequest,
  type ResolvedSound,
  type SoundResolver,
  type SoundSink,
  type VoiceHandle,
} from '../../src/types.ts';
import type { AudioBufferLike } from '../../src/ports.ts';

export class ManifestResolver implements SoundResolver {
  readonly sounds: ResolvedSound[];
  private readonly byId = new Map<string, ResolvedSound>();
  resolveCalls = 0;
  loadRequests: number[] = [];

  constructor(manifest: AudioManifest) {
    this.sounds = manifest.sounds.map((s, index) => {
      const r: ResolvedSound = {
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
      };
      this.byId.set(s.id, r);
      return r;
    });
  }

  get size(): number {
    return this.sounds.length;
  }

  resolve(nameOrId: string, faction: string): ResolvedSound | null {
    this.resolveCalls++;
    if (nameOrId.includes(':')) return this.byId.get(nameOrId) ?? null;
    return this.byId.get(`${faction}:${nameOrId}`) ?? this.byId.get(`common:${nameOrId}`) ?? null;
  }

  byIndex(index: number): ResolvedSound {
    const s = this.sounds[index];
    if (s === undefined) throw new RangeError(`sound index ${index}`);
    return s;
  }

  buffer(_index: number, _variant: number): AudioBufferLike | null {
    return null;
  }

  isLoaded(_index: number): boolean {
    return true;
  }

  requestLoad(index: number): void {
    this.loadRequests.push(index);
  }

  /** Index of a fully qualified id (throws if missing). */
  idx(id: string): number {
    const s = this.byId.get(id);
    if (s === undefined) throw new Error(`no sound ${id}`);
    return s.index;
  }
}

export class FakeHandle implements VoiceHandle {
  alive = true;
  stopped = false;
  constructor(readonly id: number) {}
  stop(): void {
    this.alive = false;
    this.stopped = true;
  }
  setGain(): void {}
  setPosition(): void {}
  setRate(): void {}
}

/** A recorded play (copy of the request fields). */
export interface PlayRecord {
  sound: string | number;
  soundId: string;
  x: number | undefined;
  z: number | undefined;
  gain: number | undefined;
  rate: number | undefined;
  when: number | undefined;
  nowMs: number;
}

export class RecordingSink implements SoundSink {
  readonly plays: PlayRecord[] = [];
  readonly handles: FakeHandle[] = [];
  lastDrop: DropReason | null = null;
  /** Drop every request with this reason (null = accept). */
  dropAll: DropReason | null = null;
  /** false: count only (allocation tests); returns one shared handle. */
  record = true;
  count = 0;
  private readonly shared = new FakeHandle(0);

  constructor(private readonly resolver?: ManifestResolver) {}

  play(req: PlayRequest, nowMs: number): VoiceHandle | null {
    this.count++;
    if (this.dropAll !== null) {
      this.lastDrop = this.dropAll;
      return null;
    }
    this.lastDrop = null;
    if (!this.record) return this.shared;
    const soundId =
      typeof req.sound === 'number' && this.resolver !== undefined ? this.resolver.byIndex(req.sound).id : String(req.sound);
    const pos = req.spatial !== false;
    this.plays.push({ sound: req.sound, soundId, x: pos ? req.x : undefined, z: pos ? req.z : undefined, gain: req.gain, rate: req.rate, when: req.when, nowMs });
    const h = new FakeHandle(this.handles.length + 1);
    this.handles.push(h);
    return h;
  }
}

/** Alert sink that records copies of the requests. */
export class RecordingAlerts {
  readonly pushed: { kind: string; x: number | undefined; z: number | undefined }[] = [];
  accept = true;
  record = true;
  push(req: AlertRequest): boolean {
    if (this.record) this.pushed.push({ kind: req.kind, x: req.located === false ? undefined : req.x, z: req.located === false ? undefined : req.z });
    return this.accept;
  }
}
