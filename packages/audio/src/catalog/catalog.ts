/**
 * SoundCatalog: dense sound table, faction lookup and decoded-buffer store (implements the
 * {@link SoundResolver} contract of types.ts).
 *
 * Lookup rule (docs/design/audio.md §3): a name containing ':' is an exact fully qualified id;
 * otherwise `<faction>:<name>` wins over `common:<name>`. The lookup runs over tables built once
 * per faction (name → dense index), so a hot-path `resolve`/`resolveIndex` is at most two Map
 * lookups without any string building or allocation.
 */

import type { AudioBufferLike } from '../ports.ts';
import {
  MANIFEST_BUS_TO_BUS,
  categoryIndex,
  type AudioManifest,
  type ManifestSound,
  type ResolvedSound,
  type SoundResolver,
} from '../types.ts';
import { parseManifest } from './manifest.ts';

/** Scope every faction falls back to. */
export const COMMON_SCOPE = 'common';

/** Called by {@link SoundCatalog.requestLoad} for sounds that are not loaded yet. */
export type LoadHook = (index: number) => void;

/**
 * Faction lookup tables kept per catalog. Scopes that exist in the manifest get their own table;
 * any other faction string shares the common-only table, so arbitrary input cannot grow the cache.
 */
type NameTable = ReadonlyMap<string, number>;

/** Bytes a decoded buffer occupies (Float32 planar PCM). */
export function bufferBytes(b: AudioBufferLike): number {
  return b.length * b.numberOfChannels * 4;
}

/** Joins a base URL (with or without trailing '/') and a relative asset path. */
export function joinUrl(baseUrl: string, relPath: string): string {
  if (baseUrl === '') return relPath;
  return baseUrl.endsWith('/') ? baseUrl + relPath : `${baseUrl}/${relPath}`;
}

export class SoundCatalog implements SoundResolver {
  /** The validated manifest this catalog was built from. */
  readonly manifest: AudioManifest;
  readonly size: number;
  /** All scopes present in the manifest ('common' plus faction ids), sorted. */
  readonly scopes: readonly string[];

  private readonly sounds: readonly ResolvedSound[];
  private readonly byId: ReadonlyMap<string, number>;
  /** Name → index for scope 'common' only (shared by unknown factions). */
  private readonly commonTable: NameTable;
  private readonly scopeSet: ReadonlySet<string>;
  private readonly tables = new Map<string, NameTable>();
  private lastFaction: string | null = null;
  private lastTable: NameTable;

  /** Flat buffer store: slot = variantBase[index] + variant. */
  private readonly variantBase: Int32Array;
  private readonly slots: (AudioBufferLike | null)[];
  /** Loaded variants per sound. */
  private readonly loadedVariants: Uint16Array;
  private loadedSoundCount = 0;
  private bytes = 0;
  private hook: LoadHook | null = null;

  /**
   * @param manifest a manifest from {@link parseManifest} (or anything already validated to the
   *        same rules; use {@link SoundCatalog.fromJson} for untrusted JSON)
   */
  constructor(manifest: AudioManifest) {
    this.manifest = manifest;
    const n = manifest.sounds.length;
    this.size = n;
    const sounds: ResolvedSound[] = [];
    const byId = new Map<string, number>();
    const common = new Map<string, number>();
    const scopes = new Set<string>();
    this.variantBase = new Int32Array(n + 1);
    let slot = 0;
    for (let i = 0; i < n; i++) {
      const s = manifest.sounds[i]!;
      if (byId.has(s.id)) throw new Error(`SoundCatalog: duplicate sound id ${s.id}`);
      byId.set(s.id, i);
      scopes.add(s.scope);
      if (s.scope === COMMON_SCOPE) common.set(s.name, i);
      sounds.push(resolveSound(manifest, s, i));
      this.variantBase[i] = slot;
      slot += s.variants.length;
    }
    this.variantBase[n] = slot;
    this.sounds = sounds;
    this.byId = byId;
    this.commonTable = common;
    this.scopeSet = scopes;
    this.scopes = Object.freeze([...scopes].sort());
    this.slots = new Array<AudioBufferLike | null>(slot).fill(null);
    this.loadedVariants = new Uint16Array(n);
    this.tables.set(COMMON_SCOPE, common);
    this.lastTable = common;
  }

  /** Validates untrusted manifest JSON ({@link parseManifest}) and builds a catalog. */
  static fromJson(json: unknown): SoundCatalog {
    return new SoundCatalog(parseManifest(json));
  }

  // -------------------------------------------------------------------------------------------
  // Lookup
  // -------------------------------------------------------------------------------------------

  /**
   * Dense index of a sound name or fully qualified id for `faction`, or −1 if unknown.
   * Allocation-free after the first call for a faction.
   */
  resolveIndex(nameOrId: string, faction: string): number {
    const table = faction === this.lastFaction ? this.lastTable : this.tableFor(faction);
    const i = table.get(nameOrId);
    if (i !== undefined) return i;
    // Names never contain ':' (ID_RE), so a miss in the name table may still be an exact id.
    const j = this.byId.get(nameOrId);
    return j === undefined ? -1 : j;
  }

  resolve(nameOrId: string, faction: string): ResolvedSound | null {
    const i = this.resolveIndex(nameOrId, faction);
    return i < 0 ? null : this.sounds[i]!;
  }

  /** Index of an exact fully qualified id, or −1. */
  indexOf(id: string): number {
    const i = this.byId.get(id);
    return i === undefined ? -1 : i;
  }

  byIndex(index: number): ResolvedSound {
    this.check(index);
    return this.sounds[index]!;
  }

  /** The manifest entry of a sound (variants, tags, description). */
  manifestSound(index: number): ManifestSound {
    this.check(index);
    return this.manifest.sounds[index]!;
  }

  /** True if the manifest contains sounds of this scope (a faction id or 'common'). */
  hasScope(scope: string): boolean {
    return this.scopeSet.has(scope);
  }

  // -------------------------------------------------------------------------------------------
  // Assets and buffers
  // -------------------------------------------------------------------------------------------

  /** URL of one variant's Opus/WebM file below `baseUrl` (e.g. '/audio/' → '/audio/common/ui_click.v0.webm'). */
  urlFor(index: number, variant: number, baseUrl: string): string {
    const s = this.manifestSound(index);
    const v = s.variants[variant];
    if (v === undefined) throw new RangeError(`SoundCatalog.urlFor: variant ${variant} outside 0..${s.variants.length - 1} of ${s.id}`);
    return joinUrl(baseUrl, v.opus);
  }

  /** Decoded buffer of one variant, or null (not loaded, or variant out of range). */
  buffer(index: number, variant: number): AudioBufferLike | null {
    this.check(index);
    if (variant < 0 || variant >= this.sounds[index]!.variantCount) return null;
    return this.slots[this.variantBase[index]! + variant] ?? null;
  }

  /** Stores (or with null removes) the decoded buffer of one variant. */
  setBuffer(index: number, variant: number, buffer: AudioBufferLike | null): void {
    this.check(index);
    const count = this.sounds[index]!.variantCount;
    if (!Number.isInteger(variant) || variant < 0 || variant >= count) {
      throw new RangeError(`SoundCatalog.setBuffer: variant ${variant} outside 0..${count - 1}`);
    }
    const slot = this.variantBase[index]! + variant;
    const old = this.slots[slot] ?? null;
    if (old !== null) {
      this.bytes -= bufferBytes(old);
      if (--this.loadedVariants[index]! === 0) this.loadedSoundCount--;
    }
    this.slots[slot] = buffer;
    if (buffer !== null) {
      this.bytes += bufferBytes(buffer);
      if (this.loadedVariants[index]!++ === 0) this.loadedSoundCount++;
    }
  }

  isLoaded(index: number): boolean {
    this.check(index);
    return this.loadedVariants[index]! > 0;
  }

  /** Number of decoded variants of a sound. */
  loadedVariantCount(index: number): number {
    this.check(index);
    return this.loadedVariants[index]!;
  }

  /** True once every variant of the sound is decoded. */
  isFullyLoaded(index: number): boolean {
    this.check(index);
    return this.loadedVariants[index]! === this.sounds[index]!.variantCount;
  }

  /** Sounds with at least one decoded variant. */
  get loadedSounds(): number {
    return this.loadedSoundCount;
  }

  /** Σ length × channels × 4 over all stored buffers. */
  get decodedBytes(): number {
    return this.bytes;
  }

  /** Drops all buffers (e.g. before closing the context). */
  clearBuffers(): void {
    this.slots.fill(null);
    this.loadedVariants.fill(0);
    this.loadedSoundCount = 0;
    this.bytes = 0;
  }

  /** Registers the loader hook used by {@link requestLoad} (null removes it). */
  setLoadHook(hook: LoadHook | null): void {
    this.hook = hook;
  }

  /** Asks the registered loader to fetch/decode the sound; no-op if loaded or no hook is set. */
  requestLoad(index: number): void {
    this.check(index);
    if (this.loadedVariants[index]! > 0 || this.hook === null) return;
    this.hook(index);
  }

  // -------------------------------------------------------------------------------------------

  private check(index: number): void {
    if (!(index >= 0 && index < this.size) || !Number.isInteger(index)) {
      throw new RangeError(`SoundCatalog: sound index ${index} outside 0..${this.size - 1}`);
    }
  }

  private tableFor(faction: string): NameTable {
    let t = this.tables.get(faction);
    if (t === undefined) {
      if (!this.scopeSet.has(faction)) {
        // Unknown faction: plain common lookup (not cached per string, see NameTable doc).
        t = this.commonTable;
      } else {
        const m = new Map<string, number>(this.commonTable);
        for (let i = 0; i < this.size; i++) {
          const s = this.sounds[i]!;
          if (s.scope === faction) m.set(s.name, i);
        }
        t = m;
        this.tables.set(faction, t);
      }
    }
    this.lastFaction = faction;
    this.lastTable = t;
    return t;
  }
}

function resolveSound(manifest: AudioManifest, s: ManifestSound, index: number): ResolvedSound {
  const cat = manifest.categories[s.category];
  return Object.freeze({
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
    categoryMaxVoices: cat.maxVoices,
    spatial: s.spatial,
    channels: s.channels,
    loop: s.loop,
    variantCount: s.variants.length,
    durationS: s.durationS,
  });
}
