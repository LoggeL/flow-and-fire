/**
 * Browser test cases with a REAL (Offline)AudioContext for @faf/audio (TRACK-AUDIOENG, audioeng-c2).
 *
 * Uses only the wave-1 modules (catalog, loader, mixer, voices, spatial) — no engine facade — so the
 * decode chain, the bus graph, the limiter, stereo panning and loop points are verified on the
 * browser's own Web Audio implementation. Every case evaluates its acceptance criteria in the page
 * and returns the measurements plus `failures` (empty = passed); the Playwright spec asserts on both.
 */

import { SoundCatalog } from '@faf/audio/catalog';
import { createDecodeChain, DecodeError, loadManifest, nativeLengthWindow, type DecodeChain } from '@faf/audio/loader';
import { LIMITER_MAKEUP_DB, Mixer, compressorMakeupDb } from '@faf/audio/mixer';
import { CameraSpatialModel } from '@faf/audio/spatial';
import { createVoiceStats, VoiceManager, type VoiceMixer } from '@faf/audio/voices';
import {
  DECODE_PATHS,
  DROP_REASONS,
  SOUND_CATEGORIES,
  type AudioBufferLike,
  type AudioManifest,
  type AudioNodeLike,
  type DecodePath,
  type DropReason,
  type ListenerState,
  type PlayRequest,
} from '@faf/audio';
import { correlation, energy, peak, ratioDb, rms, seamCheck } from './analysis.ts';

export const OFFLINE_CASES = ['decode', 'pan', 'bus', 'limiter', 'loop', 'limits'] as const;
export type OfflineCaseName = (typeof OFFLINE_CASES)[number];

export const SAMPLE_RATE = 48_000;
const FACTION = 'varkan';

/** Common part of every case result. */
export interface CaseResultBase {
  name: OfflineCaseName;
  /** Violated acceptance criteria (empty = passed). */
  failures: string[];
  /** Wall time of the case in ms. */
  ms: number;
  userAgent: string;
}

// ---------------------------------------------------------------------------------------------
// decode
// ---------------------------------------------------------------------------------------------

export interface PathComparison {
  path: DecodePath;
  /** False if the forced path cannot run in this browser (e.g. no AudioDecoder / no Opus config). */
  supported: boolean;
  length: number | null;
  /** Correlation with the default-chain buffer (lag 0 or the best of the pre-skip alignments). */
  corr: number | null;
  lag: number;
  lengthEqual: boolean | null;
  /** Forced-path length − default-path length (null if not decoded). */
  lengthDelta: number | null;
  error: string | null;
}

export interface DecodedFile {
  id: string;
  category: string;
  file: string;
  channels: number;
  loop: boolean;
  expectedSamples: number;
  path: DecodePath | null;
  length: number | null;
  /** Allowed |length − expected|: native ±2 Opus frames (b2), software paths exact. */
  tolerance: number;
  lengthOk: boolean;
  suspicious: boolean;
  bufferChannels: number | null;
  rms: number;
  peak: number;
  compare: PathComparison[];
  error: string | null;
}

export interface DecodeCaseResult extends CaseResultBase {
  name: 'decode';
  files: DecodedFile[];
  nativeSupport: string;
  /** Default chain: successful decodes per path. */
  byPath: Record<DecodePath, number>;
  msByPath: Record<DecodePath, number>;
  /**
   * Whether the browser's WebCodecs decoder applied the Opus pre-skip itself (b2), from the chain
   * that forced 'webcodecs' ('unknown' if WebCodecs could not run).
   */
  webcodecsTrim: string;
  /** Largest |forced − default| length difference (native side within ±nativeTolerance). */
  maxLengthDelta: number;
  hasAudioDecoder: boolean;
  /** Paths the forced comparisons used, with the number of successful files. */
  forced: Record<DecodePath, number>;
}

// ---------------------------------------------------------------------------------------------
// render cases
// ---------------------------------------------------------------------------------------------

export interface PanMeasurement {
  x: number;
  z: number;
  /** 10·log10(E_left / E_right) of the rendered output. */
  lrDb: number;
  rms: number;
}

export interface PanCaseResult extends CaseResultBase {
  name: 'pan';
  sound: string;
  left: PanMeasurement;
  right: PanMeasurement;
  centre: PanMeasurement;
  /** Camera rotated by 90° (right vector = +z): a source at +z must be on the right. */
  rotatedRight: PanMeasurement;
}

export interface BusCaseResult extends CaseResultBase {
  name: 'bus';
  /** RMS of the sfx window with sfx volume 0. */
  sfxMutedRms: number;
  /** RMS of the same window with sfx volume 1 (control). */
  sfxControlRms: number;
  /** RMS of the ui window (ui bus unaffected) in the muted render. */
  uiRms: number;
  /** RMS of the sfx window after a runtime `setVolume('sfx', 0, true)`. */
  sfxRuntimeMutedRms: number;
}

export interface LimiterCaseResult extends CaseResultBase {
  name: 'limiter';
  voices: number;
  byCategory: Record<string, number>;
  /** Peak through the complete mixer (limiter → makeup compensation → safety clip). */
  peak: number;
  /** Peak through the mixer without the safety clip (limiter + makeup compensation alone). */
  peakBeforeClip: number;
  /** Peak of the same voices summed without the mixer (proves the input is loud). */
  unlimitedPeak: number;
  limiterReductionDb: number;
  /**
   * The Web Audio compressor applies an automatic makeup gain of (1 / fullRangeGain)^0.6 (spec,
   * "makeup gain"); for the limiter settings that is this many dB of boost after the gain
   * reduction, which the mixer's `makeup` node removes again.
   */
  makeupGainDb: number;
  /** Diagnosis: peak of the bare compressor (makeup not compensated, no clip) – ≈ 1.17 in Blink/WebKit. */
  peakUncompensated: number;
}

export interface LoopCaseResult extends CaseResultBase {
  name: 'loop';
  sound: string;
  startS: number;
  endS: number;
  passesRendered: number;
  seams: { index: number; jump: number; medianDiff: number; ratio: number }[];
  /** Correlation of loop pass 2 and pass 3 (identical content if the loop points are honoured). */
  passCorrelation: number;
  lastPassRms: number;
  /**
   * Same loop in a 44.1 kHz context with buffers decoded (resampled) for that rate: the loop
   * points are seconds, so they must hold for any buffer rate.
   */
  resampled: {
    sampleRate: number;
    bufferRate: number;
    decodePath: DecodePath;
    seams: { index: number; jump: number; medianDiff: number; ratio: number }[];
    /** Best correlation of pass 2 and pass 3 around the expected pass length (± 2 frames). */
    passCorrelation: number;
    /** Lag of the best correlation minus the expected pass length in frames. */
    lagError: number;
  };
}

export interface LimitsCaseResult extends CaseResultBase {
  name: 'limits';
  requests: number;
  maxVoices: number;
  maxByCategory: Record<string, number>;
  categoryLimits: Record<string, number>;
  maxSoundOverLimit: number;
  played: number;
  stolen: number;
  dropped: Record<DropReason, number>;
  droppedTotal: number;
  peak: number;
}

/** A case result without the fields `runCase` adds. */
type CaseBody<T extends CaseResultBase> = Omit<T, 'ms' | 'userAgent'>;

export type OfflineResult =
  | DecodeCaseResult
  | PanCaseResult
  | BusCaseResult
  | LimiterCaseResult
  | LoopCaseResult
  | LimitsCaseResult;

export interface OfflineApi {
  /** Manifest loaded and sanity-checked. */
  ready: Promise<void>;
  cases: readonly OfflineCaseName[];
  run(name: OfflineCaseName): Promise<OfflineResult>;
}

// ---------------------------------------------------------------------------------------------
// shared bench
// ---------------------------------------------------------------------------------------------

/** Deterministic PRNG in [0, 1) (mulberry32) for variants and positions. */
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

/** Listener used by the render cases: focus (256, 256), low camera (no zoom attenuation). */
export const TEST_LISTENER: Readonly<ListenerState> = Object.freeze({
  focusX: 256,
  focusZ: 256,
  height: 40,
  viewHalfWidth: 32,
  rightX: 1,
  rightZ: 0,
});

function channelsOf(b: AudioBufferLike): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < b.numberOfChannels; c++) out.push(b.getChannelData(c));
  return out;
}

function errorText(e: unknown): string {
  if (e instanceof Error) {
    const cause = e.cause instanceof Error ? ` (cause: ${e.cause.name}: ${e.cause.message})` : '';
    return `${e.name}: ${e.message}${cause}`;
  }
  return String(e);
}

function round(v: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Everything the cases share: manifest, catalog (buffer store), a decode chain, fetched bytes. */
export class OfflineBench {
  readonly catalog: SoundCatalog;
  readonly decodeCtx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
  readonly chain: DecodeChain = createDecodeChain(this.decodeCtx);
  private readonly bytes = new Map<string, Promise<ArrayBuffer>>();

  constructor(
    readonly manifest: AudioManifest,
    readonly baseUrl: string,
  ) {
    this.catalog = new SoundCatalog(manifest);
  }

  static async create(baseUrl: string): Promise<OfflineBench> {
    const manifest = await loadManifest(`${baseUrl}manifest.json`, (u) => fetch(u));
    return new OfflineBench(manifest, baseUrl);
  }

  index(id: string): number {
    const i = this.catalog.indexOf(id);
    if (i < 0) throw new Error(`sound ${id} not in manifest`);
    return i;
  }

  /** Fresh copy of the file bytes (decoders may detach their input). */
  async fileBytes(index: number, variant: number): Promise<ArrayBuffer> {
    const url = this.catalog.urlFor(index, variant, this.baseUrl);
    let p = this.bytes.get(url);
    if (p === undefined) {
      p = fetch(url).then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
        return r.arrayBuffer();
      });
      this.bytes.set(url, p);
    }
    return (await p).slice(0);
  }

  /** Decodes all variants of the given sounds (default chain) into the catalog. */
  async ensureDecoded(ids: readonly string[]): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const id of ids) {
      const i = this.index(id);
      const s = this.catalog.manifestSound(i);
      for (let v = 0; v < s.variants.length; v++) {
        if (this.catalog.buffer(i, v) !== null) continue;
        jobs.push(
          (async () => {
            const res = await this.chain.decode(await this.fileBytes(i, v), { samples: s.variants[v]!.samples, channels: s.channels });
            this.catalog.setBuffer(i, v, res.buffer);
          })(),
        );
      }
    }
    await Promise.all(jobs);
  }
}

/** One render graph: real OfflineAudioContext + Mixer + CameraSpatialModel + VoiceManager. */
function makeRig(bench: OfflineBench, seconds: number, volumes: Partial<Record<'sfx' | 'ui', number>> = {}, listener = TEST_LISTENER) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
  const mixer = new Mixer(ctx, { volumes: { master: 1, sfx: 1, ui: 1, alerts: 1, music: 1, ambience: 1, ...volumes } });
  const spatial = new CameraSpatialModel();
  spatial.setListener(listener);
  const voices = new VoiceManager({
    ctx,
    mixer,
    resolver: bench.catalog,
    spatial,
    faction: FACTION,
    random: seededRandom(7),
    rateJitter: 0,
    clockMs: () => 0,
  });
  return { ctx, mixer, spatial, voices };
}

function req(sound: string, x?: number, z?: number, when?: number, gain?: number): PlayRequest {
  return { sound, x, z, when, gain };
}

async function render(ctx: OfflineAudioContext): Promise<Float32Array[]> {
  return channelsOf(await ctx.startRendering());
}

// ---------------------------------------------------------------------------------------------
// (1) decode
// ---------------------------------------------------------------------------------------------

/**
 * ≥ 12 real files: one sound per category (all 15), all MS5 weapons, mono + stereo, ≥ 2 loops.
 * Exported for the spec (documented selection).
 */
export const DECODE_SOUNDS: readonly string[] = [
  'common:alt_base_attacked', // alert
  'common:mus_victory', // music, stereo
  'varkan:sig_bell_small', // signature
  'varkan:ack_pip_direct', // ack
  'common:ui_click', // ui, stereo
  'varkan:exp_small', // explosion
  'varkan:exp_commander', // explosion (MS5)
  'varkan:wpn_cannon_t1_fire', // weapon (MS5)
  'varkan:wpn_mg_t1_fire', // weapon (MS5)
  'varkan:wpn_reeve_cannon_fire', // weapon (MS5)
  'varkan:wpn_slag_mortar_t1_fire', // weapon (MS5)
  'varkan:shd_hit', // shield
  'common:imp_shell_ground', // impact (MS5)
  'common:imp_shell_metal', // impact (MS5)
  'common:prj_bomb_fall', // projectile
  'varkan:bld_pour_loop', // build, loop (MS5)
  'varkan:rcl_loop', // build, loop (MS5)
  'varkan:ui_cmd_move', // ui (MS5)
  'varkan:ui_select', // ui (MS5)
  'common:int_contact_new', // intel
  'varkan:mov_tracks_loop', // unit, loop (MS5)
  'varkan:mov_bot_heavy_step', // unit (MS5)
  'common:amb_wind_loop', // ambience, stereo loop
  'varkan:eco_flow_stall', // eco
];

function hasAudioDecoder(): boolean {
  return typeof (globalThis as { AudioDecoder?: unknown }).AudioDecoder === 'function';
}

/** Correlation of two decodes over all channels (lag candidates: 0, ±length difference, ±312). */
function compareBuffers(a: AudioBufferLike, b: AudioBufferLike): { corr: number; lag: number } {
  const d = b.length - a.length;
  const lags = [...new Set([0, d, -d, 312, -312])];
  let best = { corr: Number.NaN, lag: 0 };
  const ch = Math.min(a.numberOfChannels, b.numberOfChannels);
  for (const lag of lags) {
    let sum = 0;
    for (let c = 0; c < ch; c++) sum += correlation(a.getChannelData(c), b.getChannelData(c), lag);
    const corr = sum / ch;
    if (!(corr <= best.corr)) best = { corr, lag };
  }
  return best;
}

async function runDecode(bench: OfflineBench): Promise<CaseBody<DecodeCaseResult>> {
  const failures: string[] = [];
  const forcedChains = new Map<DecodePath, DecodeChain>();
  const comparePaths: DecodePath[] = ['wasm'];
  if (hasAudioDecoder()) comparePaths.push('webcodecs');
  for (const p of comparePaths) forcedChains.set(p, createDecodeChain(new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE), { forcePath: p }));
  const forced: Record<DecodePath, number> = { native: 0, webcodecs: 0, wasm: 0 };
  const files: DecodedFile[] = [];
  for (const id of DECODE_SOUNDS) {
    const i = bench.index(id);
    const s = bench.catalog.manifestSound(i);
    const v = s.variants[0]!;
    const f: DecodedFile = {
      id,
      category: s.category,
      file: v.opus,
      channels: s.channels,
      loop: s.loop !== null,
      expectedSamples: v.samples,
      path: null,
      length: null,
      tolerance: 0,
      lengthOk: false,
      suspicious: false,
      bufferChannels: null,
      rms: 0,
      peak: 0,
      compare: [],
      error: null,
    };
    files.push(f);
    let base: AudioBufferLike;
    try {
      const res = await bench.chain.decode(await bench.fileBytes(i, 0), { samples: v.samples, channels: s.channels });
      base = res.buffer;
      f.path = res.path;
      f.length = res.buffer.length;
      f.suspicious = res.suspicious;
      f.bufferChannels = res.buffer.numberOfChannels;
      f.tolerance = res.path === 'native' ? nativeLengthWindow(v.samples, SAMPLE_RATE).tolerance : 0;
      f.lengthOk = Math.abs(res.buffer.length - v.samples) <= f.tolerance && res.buffer.sampleRate === SAMPLE_RATE;
      const chs = channelsOf(res.buffer);
      f.rms = rms(chs);
      f.peak = peak(chs);
      if (!f.lengthOk) failures.push(`${id}: length ${res.buffer.length} (path ${res.path}) vs manifest ${v.samples} ± ${f.tolerance}`);
      if (res.buffer.numberOfChannels !== s.channels) failures.push(`${id}: ${res.buffer.numberOfChannels} channels, manifest ${s.channels}`);
      if (!(f.rms > 1e-4)) failures.push(`${id}: RMS ${f.rms} (silent?)`);
      if (!(f.peak <= 1.0 + 1e-6)) failures.push(`${id}: peak ${f.peak} > 1.0`);
    } catch (e: unknown) {
      f.error = errorText(e);
      failures.push(`${id}: decode failed: ${f.error}`);
      continue;
    }
    for (const path of comparePaths) {
      const cmp: PathComparison = { path, supported: true, length: null, corr: null, lag: 0, lengthEqual: null, lengthDelta: null, error: null };
      f.compare.push(cmp);
      try {
        const res = await forcedChains.get(path)!.decode(await bench.fileBytes(i, 0), { samples: v.samples, channels: s.channels });
        forced[path]++;
        cmp.length = res.buffer.length;
        cmp.lengthEqual = res.buffer.length === base.length;
        cmp.lengthDelta = res.buffer.length - base.length;
        const c = compareBuffers(base, res.buffer);
        cmp.corr = round(c.corr, 6);
        cmp.lag = c.lag;
        if (res.buffer.length !== v.samples) failures.push(`${id}: forced ${path} length ${res.buffer.length} ≠ manifest ${v.samples}`);
        if (f.path !== path) {
          // Software paths are sample-exact; a native default path may deviate within its window
          // (b2: ±2 Opus frames — Firefox's decodeAudioData yields one sample less, see status).
          const allowed = f.path === 'native' ? f.tolerance : 0;
          if (Math.abs(cmp.lengthDelta) > allowed) failures.push(`${id}: ${path} length ${res.buffer.length} vs ${f.path} length ${base.length} (allowed ±${allowed})`);
          if (!(c.corr > 0.99)) failures.push(`${id}: ${path} vs ${f.path} correlation ${c.corr}`);
        }
      } catch (e: unknown) {
        cmp.error = errorText(e);
        if (path === 'webcodecs' && e instanceof DecodeError && e.attempts.every(a => a.error instanceof Error && a.error.message === 'WebCodecs AudioDecoder unavailable or Opus config unsupported')) {
          // Only an explicitly unsupported config skips this path; decode errors fail.
          cmp.supported = false;
        } else {
          failures.push(`${id}: forced ${path} failed: ${cmp.error}`);
        }
      }
    }
  }
  const webcodecsTrim = forcedChains.get('webcodecs')?.stats.webcodecsTrim ?? bench.chain.stats.webcodecsTrim;
  for (const c of forcedChains.values()) c.dispose();
  let maxLengthDelta = 0;
  for (const f of files) for (const c of f.compare) if (c.lengthDelta !== null) maxLengthDelta = Math.max(maxLengthDelta, Math.abs(c.lengthDelta));
  const categories = new Set(files.filter((f) => f.lengthOk).map((f) => f.category));
  for (const c of SOUND_CATEGORIES) if (!categories.has(c)) failures.push(`category ${c}: no correctly decoded file`);
  if (files.filter((f) => f.lengthOk).length < 12) failures.push('fewer than 12 correctly decoded files');
  const st = bench.chain.stats;
  return {
    name: 'decode',
    failures,
    files,
    nativeSupport: bench.chain.nativeSupport,
    byPath: { ...st.byPath },
    msByPath: Object.fromEntries(DECODE_PATHS.map((p) => [p, round(st.msByPath[p], 2)])) as Record<DecodePath, number>,
    webcodecsTrim,
    maxLengthDelta,
    hasAudioDecoder: hasAudioDecoder(),
    forced,
  };
}

// ---------------------------------------------------------------------------------------------
// (2) pan
// ---------------------------------------------------------------------------------------------

const PAN_SOUND = 'varkan:wpn_cannon_t1_fire';

async function measurePan(bench: OfflineBench, x: number, z: number, listener: ListenerState): Promise<PanMeasurement> {
  const { ctx, voices } = makeRig(bench, 1.0, {}, listener);
  const h = voices.play(req(PAN_SOUND, x, z), 0);
  if (h === null) throw new Error(`pan: play at (${x}, ${z}) dropped (${String(voices.lastDrop)})`);
  const ch = await render(ctx);
  return { x, z, lrDb: round(ratioDb(energy(ch[0]!), energy(ch[1]!)), 2), rms: rms(ch) };
}

async function runPan(bench: OfflineBench): Promise<CaseBody<PanCaseResult>> {
  await bench.ensureDecoded([PAN_SOUND]);
  const f = TEST_LISTENER.focusX;
  const left = await measurePan(bench, f - 24, TEST_LISTENER.focusZ, TEST_LISTENER);
  const right = await measurePan(bench, f + 24, TEST_LISTENER.focusZ, TEST_LISTENER);
  const centre = await measurePan(bench, f, TEST_LISTENER.focusZ, TEST_LISTENER);
  // Camera turned by 90°: screen right points along world +z.
  const rotated: ListenerState = { ...TEST_LISTENER, rightX: 0, rightZ: 1 };
  const rotatedRight = await measurePan(bench, f, TEST_LISTENER.focusZ + 24, rotated);
  const failures: string[] = [];
  if (!(left.lrDb >= 6)) failures.push(`left source: L−R ${left.lrDb} dB < 6 dB`);
  if (!(right.lrDb <= -6)) failures.push(`right source: R−L ${-right.lrDb} dB < 6 dB`);
  if (!(Math.abs(centre.lrDb) < 1)) failures.push(`centred source: |L−R| ${centre.lrDb} dB ≥ 1 dB`);
  if (!(rotatedRight.lrDb <= -6)) failures.push(`rotated camera: source on screen right has R−L ${-rotatedRight.lrDb} dB < 6 dB`);
  for (const m of [left, right, centre, rotatedRight]) if (!(m.rms > 1e-4)) failures.push(`pan render at (${m.x}, ${m.z}) silent`);
  return { name: 'pan', failures, sound: PAN_SOUND, left, right, centre, rotatedRight };
}

// ---------------------------------------------------------------------------------------------
// (3) bus
// ---------------------------------------------------------------------------------------------

const BUS_SFX = 'varkan:wpn_cannon_t1_fire';
const BUS_UI = 'common:ui_click';
/** The sfx voice starts here (ui/ack always start immediately). */
const BUS_SFX_AT = 0.2;

async function renderBus(bench: OfflineBench, sfxVolume: number, runtimeMute: boolean): Promise<{ sfx: number; ui: number }> {
  const { ctx, voices, mixer } = makeRig(bench, 1.2, { sfx: sfxVolume });
  if (runtimeMute) mixer.setVolume('sfx', 0, true);
  if (voices.play(req(BUS_UI), 0) === null) throw new Error(`bus: ui play dropped (${String(voices.lastDrop)})`);
  if (voices.play(req(BUS_SFX, TEST_LISTENER.focusX, TEST_LISTENER.focusZ, BUS_SFX_AT), 0) === null) {
    throw new Error(`bus: sfx play dropped (${String(voices.lastDrop)})`);
  }
  const ch = await render(ctx);
  return {
    ui: rms(ch, 0, 0.04 * SAMPLE_RATE),
    sfx: rms(ch, (BUS_SFX_AT + 0.01) * SAMPLE_RATE, 1.0 * SAMPLE_RATE),
  };
}

async function runBus(bench: OfflineBench): Promise<CaseBody<BusCaseResult>> {
  await bench.ensureDecoded([BUS_SFX, BUS_UI]);
  const muted = await renderBus(bench, 0, false);
  const control = await renderBus(bench, 1, false);
  const runtime = await renderBus(bench, 1, true);
  const failures: string[] = [];
  if (!(muted.sfx < 1e-5)) failures.push(`sfx volume 0: RMS ${muted.sfx} ≥ 1e-5`);
  if (!(runtime.sfx < 1e-5)) failures.push(`sfx setVolume(0): RMS ${runtime.sfx} ≥ 1e-5`);
  if (!(control.sfx > 1e-3)) failures.push(`control (sfx 1): RMS ${control.sfx} ≤ 1e-3`);
  if (!(muted.ui > 1e-3)) failures.push(`ui bus with sfx 0: RMS ${muted.ui} ≤ 1e-3 (ui must keep playing)`);
  return { name: 'bus', failures, sfxMutedRms: muted.sfx, sfxControlRms: control.sfx, uiRms: muted.ui, sfxRuntimeMutedRms: runtime.sfx };
}

// ---------------------------------------------------------------------------------------------
// (4) limiter
// ---------------------------------------------------------------------------------------------

/** 32 simultaneous voices exactly filling the category limits: weapon 10 + impact 8 + explosion 6 + unit 8. */
const LIMITER_MIX: readonly [string, number][] = [
  ['varkan:wpn_cannon_t1_fire', 10],
  ['common:imp_shell_ground', 8],
  ['varkan:exp_small', 6],
  ['varkan:mov_bot_heavy_step', 8],
];

/** Mixer stand-in without limiter: every bus sums straight into the destination. */
class PlainSum implements VoiceMixer {
  private readonly node: GainNode;
  constructor(ctx: OfflineAudioContext) {
    this.node = ctx.createGain();
    this.node.connect(ctx.destination);
  }
  busInput(): AudioNodeLike {
    return this.node;
  }
}

/** Re-exported for older callers/tests; the formula lives in @faf/audio/mixer. */
export { compressorMakeupDb };

type LimiterVariant = 'full' | 'noClip' | 'uncompensated';

/**
 * Mixer options per variant: the full mixer (verdict), without the safety clip, and the bare
 * compressor (a +makeup gain after the mixer undoes its compensation; diagnosis only).
 */
function limiterDestination(ctx: OfflineAudioContext, variant: LimiterVariant): AudioNodeLike | undefined {
  if (variant !== 'uncompensated') return undefined;
  const undo = ctx.createGain();
  undo.gain.value = 10 ** (LIMITER_MAKEUP_DB / 20);
  undo.connect(ctx.destination);
  return undo;
}

async function runLimiter(bench: OfflineBench): Promise<CaseBody<LimiterCaseResult>> {
  await bench.ensureDecoded(LIMITER_MIX.map(([id]) => id));
  const startAll = (voices: VoiceManager): void => {
    let n = 0;
    for (const [id, count] of LIMITER_MIX) {
      for (let k = 0; k < count; k++) {
        // Distinct nowMs per request only to pass the per-sound cooldown; all start at t = 0.
        if (voices.play(req(id, TEST_LISTENER.focusX, TEST_LISTENER.focusZ, 0, 1), (n += 1000)) === null) {
          throw new Error(`limiter: ${id} #${k} dropped (${String(voices.lastDrop)})`);
        }
      }
    }
  };
  const renderWith = async (variant: LimiterVariant): Promise<{ peak: number; count: number; byCategory: Record<string, number>; reduction: number }> => {
    const ctx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
    const mixer = new Mixer(ctx, {
      volumes: { master: 1, sfx: 1, ui: 1, alerts: 1, music: 1, ambience: 1 },
      safetyClip: variant === 'full',
      destination: limiterDestination(ctx, variant),
    });
    const spatial = new CameraSpatialModel();
    spatial.setListener(TEST_LISTENER);
    const voices = new VoiceManager({ ctx, mixer, resolver: bench.catalog, spatial, faction: FACTION, random: seededRandom(7), rateJitter: 0, clockMs: () => 0 });
    startAll(voices);
    const byCategory: Record<string, number> = {};
    SOUND_CATEGORIES.forEach((c, i) => {
      const n = voices.categoryVoices(i);
      if (n > 0) byCategory[c] = n;
    });
    const count = voices.voiceCount;
    const p = peak(await render(ctx));
    return { peak: p, count, byCategory, reduction: mixer.limiterReductionDb };
  };
  const main = await renderWith('full');
  const noClip = await renderWith('noClip');
  const uncompensated = await renderWith('uncompensated');

  const plainCtx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
  const spatial = new CameraSpatialModel();
  spatial.setListener(TEST_LISTENER);
  const plain = new VoiceManager({ ctx: plainCtx, mixer: new PlainSum(plainCtx), resolver: bench.catalog, spatial, faction: FACTION, random: seededRandom(7), rateJitter: 0 });
  startAll(plain);
  const unlimited = peak(await render(plainCtx));

  const failures: string[] = [];
  if (main.count !== 32) failures.push(`expected 32 simultaneous voices, got ${main.count}`);
  if (!(main.peak <= 1.0)) failures.push(`peak ${main.peak} > 1.0 with 32 loud voices`);
  // The limiter itself (with makeup compensation) must hold 1.0; the clip is only the last resort.
  if (!(noClip.peak <= 1.0)) failures.push(`peak without safety clip ${noClip.peak} > 1.0`);
  if (!(unlimited > 1.0)) failures.push(`test input not loud enough: unlimited peak ${unlimited} ≤ 1.0`);
  return {
    name: 'limiter',
    failures,
    voices: main.count,
    byCategory: main.byCategory,
    peak: round(main.peak, 5),
    unlimitedPeak: round(unlimited, 3),
    limiterReductionDb: round(main.reduction, 2),
    peakBeforeClip: round(noClip.peak, 5),
    makeupGainDb: round(LIMITER_MAKEUP_DB, 3),
    peakUncompensated: round(uncompensated.peak, 5),
  };
}

// ---------------------------------------------------------------------------------------------
// (5) loop
// ---------------------------------------------------------------------------------------------

const LOOP_SOUND = 'varkan:bld_pour_loop';

/** Seam checks and pass correlation of a loop rendered at `rate` (loop points in seconds). */
function analyseLoop(ch: Float32Array[], startS: number, endS: number, rate: number) {
  const passLen = (endS - startS) * rate;
  // Seam k: output frame where the k-th wrap reads loopStart (rate 1, start offset 0).
  const seam1 = Math.round(endS * rate);
  const seam2 = Math.round(endS * rate + passLen);
  const half = Math.round(0.005 * rate);
  const seams = [seamCheck(ch, seam1, half), seamCheck(ch, seam2, half)].map((x) => ({
    index: x.index,
    jump: round(x.jump, 6),
    medianDiff: round(x.medianDiff, 6),
    ratio: round(x.ratio, 3),
  }));
  // Pass 2 starts at seam1, pass 3 one pass later: identical content if the loop points hold.
  const n = Math.min(Math.floor(passLen), rate);
  const p2 = ch[0]!.subarray(seam1, seam1 + n);
  const expectedLag = Math.round(passLen);
  let best = { corr: Number.NEGATIVE_INFINITY, lag: 0 };
  for (let d = -2; d <= 2; d++) {
    const from = seam1 + expectedLag + d;
    const c = correlation(p2, ch[0]!.subarray(from, from + n), 0);
    if (c > best.corr) best = { corr: c, lag: d };
  }
  return { seams, passCorrelation: best.corr, lagError: best.lag, seam2, passLen };
}

const RESAMPLED_RATE = 44_100;

async function runLoop(bench: OfflineBench): Promise<CaseBody<LoopCaseResult>> {
  await bench.ensureDecoded([LOOP_SOUND]);
  const idx = bench.index(LOOP_SOUND);
  const s = bench.catalog.manifestSound(idx);
  const loop = s.loop!;
  const loopLen = loop.endSample - loop.startSample;
  const total = loop.endSample + 2 * loopLen + Math.round(0.1 * SAMPLE_RATE);
  const { ctx, voices } = makeRig(bench, total / SAMPLE_RATE);
  const h = voices.play(req(LOOP_SOUND), 0);
  if (h === null) throw new Error(`loop: play dropped (${String(voices.lastDrop)})`);
  const ch = await render(ctx);
  const a = analyseLoop(ch, loop.startS, loop.endS, SAMPLE_RATE);
  const lastPassRms = rms(ch, a.seam2, a.seam2 + loopLen);

  // 44.1 kHz: own catalog with buffers decoded for a 44.1 kHz context (native decoding resamples).
  const rCatalog = new SoundCatalog(bench.manifest);
  const rChain = createDecodeChain(new OfflineAudioContext(2, RESAMPLED_RATE, RESAMPLED_RATE));
  let decodePath: DecodePath = 'native';
  for (let v = 0; v < s.variants.length; v++) {
    const res = await rChain.decode(await bench.fileBytes(idx, v), { samples: s.variants[v]!.samples, channels: s.channels });
    rCatalog.setBuffer(idx, v, res.buffer);
    decodePath = res.path;
  }
  rChain.dispose();
  const bufferRate = rCatalog.buffer(idx, 0)!.sampleRate;
  const rTotal = Math.ceil((loop.endS + 2 * (loop.endS - loop.startS) + 0.1) * RESAMPLED_RATE);
  const rCtx = new OfflineAudioContext(2, rTotal, RESAMPLED_RATE);
  const rMixer = new Mixer(rCtx, { volumes: { master: 1, sfx: 1, ui: 1, alerts: 1, music: 1, ambience: 1 } });
  const rSpatial = new CameraSpatialModel();
  rSpatial.setListener(TEST_LISTENER);
  const rVoices = new VoiceManager({ ctx: rCtx, mixer: rMixer, resolver: rCatalog, spatial: rSpatial, faction: FACTION, random: seededRandom(7), rateJitter: 0, clockMs: () => 0 });
  if (rVoices.play(req(LOOP_SOUND), 0) === null) throw new Error(`loop@44.1k: play dropped (${String(rVoices.lastDrop)})`);
  const r = analyseLoop(await render(rCtx), loop.startS, loop.endS, RESAMPLED_RATE);

  const failures: string[] = [];
  for (const x of a.seams) if (!(x.ratio <= 3)) failures.push(`seam at ${x.index}: jump ${x.jump} > 3 × median ${x.medianDiff} (ratio ${x.ratio})`);
  if (!(a.passCorrelation > 0.99) || a.lagError !== 0) failures.push(`loop passes differ: correlation ${a.passCorrelation} at lag error ${a.lagError}`);
  if (!(lastPassRms > 1e-4)) failures.push(`third pass silent (RMS ${lastPassRms})`);
  for (const x of r.seams) if (!(x.ratio <= 3)) failures.push(`44.1 kHz seam at ${x.index}: jump ${x.jump} > 3 × median ${x.medianDiff} (ratio ${x.ratio})`);
  // Fractional pass length at 44.1 kHz: passes are shifted by < 1 frame and interpolated.
  if (!(r.passCorrelation > 0.9) || Math.abs(r.lagError) > 1) failures.push(`44.1 kHz loop passes differ: correlation ${r.passCorrelation} at lag error ${r.lagError}`);
  return {
    name: 'loop',
    failures,
    sound: LOOP_SOUND,
    startS: loop.startS,
    endS: loop.endS,
    passesRendered: round((total - loop.startSample) / loopLen, 2),
    seams: a.seams,
    passCorrelation: round(a.passCorrelation, 6),
    lastPassRms,
    resampled: {
      sampleRate: RESAMPLED_RATE,
      bufferRate,
      decodePath,
      seams: r.seams,
      passCorrelation: round(r.passCorrelation, 6),
      lagError: r.lagError,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// (6) limits
// ---------------------------------------------------------------------------------------------

const LIMITS_WEAPONS = ['varkan:wpn_cannon_t1_fire', 'varkan:wpn_mg_t1_fire', 'varkan:wpn_reeve_cannon_fire', 'varkan:wpn_slag_mortar_t1_fire'];
const LIMITS_IMPACTS = ['common:imp_shell_ground', 'common:imp_shell_metal'];
const LIMITS_EXPLOSION = 'varkan:exp_small';

async function runLimits(bench: OfflineBench): Promise<CaseBody<LimitsCaseResult>> {
  await bench.ensureDecoded([...LIMITS_WEAPONS, ...LIMITS_IMPACTS, LIMITS_EXPLOSION]);
  const { ctx, voices } = makeRig(bench, 1.6);
  const rnd = seededRandom(200);
  const nCat = SOUND_CATEGORIES.length;
  const maxCat = new Int32Array(nCat);
  const catLimit = new Int32Array(nCat);
  for (let i = 0; i < nCat; i++) catLimit[i] = bench.manifest.categories[SOUND_CATEGORIES[i]!].maxVoices;
  let maxVoices = 0;
  let maxSoundOverLimit = Number.NEGATIVE_INFINITY;
  let requests = 0;
  const track = (): void => {
    maxVoices = Math.max(maxVoices, voices.voiceCount);
    for (let c = 0; c < nCat; c++) maxCat[c] = Math.max(maxCat[c]!, voices.categoryVoices(c));
    for (let s = 0; s < bench.catalog.size; s++) {
      const n = voices.soundVoices(s);
      if (n > 0) maxSoundOverLimit = Math.max(maxSoundOverLimit, n - bench.catalog.byIndex(s).maxVoices);
    }
  };
  const r: PlayRequest = { sound: '' };
  // 200 shots in 1 s, ~75 % of them with an impact 50–400 ms later, an explosion every 25 shots.
  for (let i = 0; i < 200; i++) {
    const t = i / 200;
    const nowMs = t * 1000;
    r.sound = LIMITS_WEAPONS[i % LIMITS_WEAPONS.length]!;
    r.x = TEST_LISTENER.focusX + (rnd() * 2 - 1) * 30;
    r.z = TEST_LISTENER.focusZ + (rnd() * 2 - 1) * 30;
    r.when = t;
    r.gain = 0.5 + rnd() * 0.5;
    voices.play(r, nowMs);
    requests++;
    track();
    if (rnd() < 0.75) {
      const dt = 0.05 + rnd() * 0.35;
      r.sound = LIMITS_IMPACTS[i & 1]!;
      r.when = t + dt;
      voices.play(r, nowMs + dt * 1000);
      requests++;
      track();
    }
    if (i % 25 === 12) {
      r.sound = LIMITS_EXPLOSION;
      r.when = t;
      r.gain = 1;
      voices.play(r, nowMs);
      requests++;
      track();
    }
  }
  const st = voices.snapshotStats(createVoiceStats());
  const out = await render(ctx);
  const dropped = Object.fromEntries(DROP_REASONS.map((d, i) => [d, st.dropped[i]!])) as Record<DropReason, number>;
  const droppedTotal = DROP_REASONS.reduce((n, d) => n + dropped[d], 0);
  const maxByCategory: Record<string, number> = {};
  const categoryLimits: Record<string, number> = {};
  const failures: string[] = [];
  SOUND_CATEGORIES.forEach((c, i) => {
    if (maxCat[i]! > 0) {
      maxByCategory[c] = maxCat[i]!;
      categoryLimits[c] = catLimit[i]!;
    }
    if (maxCat[i]! > catLimit[i]!) failures.push(`category ${c}: ${maxCat[i]} voices > limit ${catLimit[i]}`);
  });
  if (maxVoices > 32) failures.push(`${maxVoices} voices > 32`);
  if (maxSoundOverLimit > 0) failures.push(`a sound exceeded its own voice limit by ${maxSoundOverLimit}`);
  if (!(droppedTotal + st.stolen > 0)) failures.push('no drops or steals: limits did not engage');
  if (!(droppedTotal > 0)) failures.push('no drops');
  return {
    name: 'limits',
    failures,
    requests,
    maxVoices,
    maxByCategory,
    categoryLimits,
    maxSoundOverLimit,
    played: st.played,
    stolen: st.stolen,
    dropped,
    droppedTotal,
    peak: round(peak(out), 4),
  };
}

// ---------------------------------------------------------------------------------------------

const RUNNERS: Record<OfflineCaseName, (b: OfflineBench) => Promise<CaseBody<OfflineResult>>> = {
  decode: runDecode,
  pan: runPan,
  bus: runBus,
  limiter: runLimiter,
  loop: runLoop,
  limits: runLimits,
};

/** Runs one case; exceptions become a failure entry (the spec always gets a result object). */
export async function runCase(bench: OfflineBench, name: OfflineCaseName): Promise<OfflineResult> {
  const t0 = performance.now();
  const base = { name, ms: 0, userAgent: navigator.userAgent };
  try {
    const r = await RUNNERS[name](bench);
    return { ...r, ms: round(performance.now() - t0, 1), userAgent: base.userAgent } as OfflineResult;
  } catch (e: unknown) {
    return { ...base, failures: [`exception: ${errorText(e)}`], ms: round(performance.now() - t0, 1) } as OfflineResult;
  }
}
