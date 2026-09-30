/**
 * Keyframe benchmark (PLAN §4 SPK5 "Keyframe-Kompression", follow-up measurement for MS11 seek):
 * compressed arena keyframes of real sessions (`CompressedKeyframeStore`, sim-host) after 600
 * ticks of movement.
 *
 * Scenes: flat test plane 512 WU with 1,000 units, hollow-ridge with 1,000, setons (1,024 WU) with
 * 2,000. Per scene: session snapshot bytes; for fflate level 1/6/9 and the native
 * CompressionStream('deflate-raw') the compressed bytes and rate, median/p95 of capture (snapshot
 * memcpy + compression) and restore (inflate + SimCore.restoreSnapshot), the native path's
 * blocking part (until captureAsync returns its promise = memcpy); every restore is checked
 * against the rule and full hash of the captured state. Plus the projected keyframe memory of a
 * 30-min and a 3-h game at the default level (real store logic incl. thinning, keyframe size held
 * constant at the scene's size) next to the uncompressed equivalent.
 *
 * Environment-neutral (Node and browser workers): the clock is a parameter, no node: imports.
 */
import { asArmyId, asTick, fx, rng32 } from '@faf/fixed';
import { encodeCheatSpawn, encodeMove, Op, type CommandEnvelope } from '@faf/protocol';
import { unitCount, unitHandles, type World } from '@faf/sim';
import { CompressedKeyframeStore, DEFAULT_KEYFRAME_LEVEL, DEFAULT_KEYFRAME_MAX_BYTES, hasNativeDeflate, HeadlessSim } from '@faf/sim-host';
import { summarize, type Clock, type Summary } from '../stats.ts';

export const KEYFRAME_BENCH_WARM_TICKS = 600;
export const KEYFRAME_BENCH_LEVELS: readonly number[] = [1, 6, 9];
/** Game lengths of the memory projection (minutes). */
export const KEYFRAME_PROJECTION_MINUTES: readonly number[] = [30, 180];
const TICKS_PER_MINUTE = 600;

export type KeyframeSceneId = 'testplane-1000' | 'hollow-ridge-1000' | 'setons-2000';

export interface KeyframeBenchOptions {
  readonly simBin: Uint8Array;
  /** content/maps/hollow-ridge.rtsmap bytes. */
  readonly hollowRidge: Uint8Array;
  /** content/maps/setons.rtsmap bytes. */
  readonly setons: Uint8Array;
  readonly clock: Clock;
  /** Timed repetitions per codec and operation (after one untimed warm-up). */
  readonly reps: number;
  /** Subset of scenes (default all). */
  readonly scenes?: readonly KeyframeSceneId[];
  /** Called between measurements (e.g. globalThis.gc). */
  readonly gc?: () => void;
  /** Progress output. */
  readonly log?: (line: string) => void;
}

export interface KeyframeCodecResult {
  /** 'fflate-1' | 'fflate-6' | 'fflate-9' | 'native' ('native' falls back to fflate without CompressionStream). */
  readonly codec: string;
  readonly compressedBytes: number;
  /** compressed / raw, in percent. */
  readonly ratePercent: number;
  /** Snapshot memcpy + compression, ms. */
  readonly capture: Summary;
  /** Part of capture the caller waits for synchronously (native path: the memcpy only), ms. */
  readonly captureBlocking: Summary;
  /** Inflate + restoreSnapshot, ms. */
  readonly restore: Summary;
  /** Every restore reproduced the captured rule and full hash. */
  readonly restoreOk: boolean;
}

export interface KeyframeProjection {
  readonly minutes: number;
  /** Keyframes taken over the game (after thinning the store takes fewer). */
  readonly captured: number;
  readonly held: number;
  readonly heldBytes: number;
  readonly intervalTicks: number;
  readonly thinnings: number;
}

export interface KeyframeSceneResult {
  readonly scene: KeyframeSceneId;
  readonly map: string;
  readonly mapSizeWu: number;
  readonly units: number;
  readonly tick: number;
  /** Session snapshot (16-byte identity header + dynamic arena). */
  readonly snapshotBytes: number;
  /** Plain memcpy of the session snapshot into a reused buffer, ms. */
  readonly memcpy: Summary;
  readonly codecs: readonly KeyframeCodecResult[];
  /** At DEFAULT_KEYFRAME_LEVEL, 128 MiB budget. */
  readonly projection: readonly KeyframeProjection[];
  /** The same games with uncompressed keyframes (same budget and thinning rule). */
  readonly projectionRaw: readonly KeyframeProjection[];
}

export interface KeyframeBenchResult {
  readonly nativeDeflate: boolean;
  readonly defaultLevel: number;
  readonly budgetBytes: number;
  readonly reps: number;
  readonly warmTicks: number;
  readonly scenes: readonly KeyframeSceneResult[];
  /** Restore mismatches and other failures (empty = ok). */
  readonly errors: readonly string[];
}

interface SceneDef {
  readonly id: KeyframeSceneId;
  readonly map: (o: KeyframeBenchOptions) => Uint8Array | undefined;
  /** Spawn per army: [x, z, spread, count]. */
  readonly spawns: readonly (readonly [number, number, number, number])[];
  /** Target square per army: [minX, minZ, span]. */
  readonly targets: readonly (readonly [number, number, number])[];
}

const SCENES: readonly SceneDef[] = [
  {
    id: 'testplane-1000',
    map: () => undefined,
    spawns: [
      [160, 160, 60, 500],
      [352, 352, 60, 500],
    ],
    targets: [
      [32, 32, 448],
      [32, 32, 448],
    ],
  },
  {
    // NW side of the river (plateau cliffs, ramps, mesa), as in the tick bench.
    id: 'hollow-ridge-1000',
    map: (o) => o.hollowRidge,
    spawns: [
      [120, 140, 50, 500],
      [175, 160, 50, 500],
    ],
    targets: [
      [40, 40, 160],
      [40, 40, 160],
    ],
  },
  {
    // Mid starts SW/NO; both armies drive over the land bridge towards the other start.
    id: 'setons-2000',
    map: (o) => o.setons,
    spawns: [
      [354, 678, 45, 1000],
      [670, 346, 45, 1000],
    ],
    targets: [
      [590, 266, 160],
      [274, 598, 160],
    ],
  },
];

const SEED = 0x6b66b3c4;
const SALT_TARGET = 0x4b46544d; // 'KFTM'
const MOVE_GROUPS = 5;
const MOVE_EVERY = 100;

function sceneCommands(def: SceneDef, w: World, tick: number): CommandEnvelope[] {
  const seq = (tick * 8) & 0xffff;
  if (tick === 1) {
    return def.spawns.map(([x, z, spread, count], army) => ({
      tick: asTick(0),
      army: asArmyId(army),
      seq: (seq + army) & 0xffff,
      op: Op.Cheat,
      flags: 0,
      units: [],
      payload: encodeCheatSpawn({ bp: 0, army, count, x: fx(x), z: fx(z), spread: fx(spread) }),
    }));
  }
  if (tick !== 2 && tick % MOVE_EVERY !== 0) return [];
  const out: CommandEnvelope[] = [];
  for (let army = 0; army < def.spawns.length; army++) {
    const hs = unitHandles(w, army);
    const per = Math.ceil(hs.length / MOVE_GROUPS);
    const [minX, minZ, span] = def.targets[army]!;
    for (let g = 0; g < MOVE_GROUPS; g++) {
      const group = hs.slice(g * per, (g + 1) * per);
      if (group.length === 0) continue;
      const r = rng32(SEED, tick, army * MOVE_GROUPS + g, SALT_TARGET);
      out.push({
        tick: asTick(0),
        army: asArmyId(army),
        seq: (seq + 2 + army * MOVE_GROUPS + g) & 0xffff,
        op: Op.Move,
        flags: 0,
        units: group,
        payload: encodeMove({ x: fx(minX + (r % span)), y: fx(0), z: fx(minZ + ((r >>> 12) % span)) }),
      });
    }
  }
  return out;
}

function buildScene(def: SceneDef, o: KeyframeBenchOptions): HeadlessSim {
  const map = def.map(o);
  const sim = new HeadlessSim({ simBin: o.simBin, seed: SEED, armyCount: def.spawns.length, record: false, keyframes: false, ...(map !== undefined ? { map } : {}) });
  while (sim.tick < KEYFRAME_BENCH_WARM_TICKS) {
    const cmds = sceneCommands(def, sim.world, sim.tick + 1);
    if (cmds.length > 0) sim.submit(cmds);
    sim.step(1);
  }
  return sim;
}

/** Projected keyframe memory of a game of `minutes` with keyframes of `keyframeBytes` each. */
export function projectKeyframeMemory(snapshotBytes: number, keyframeBytes: number, minutes: number, maxBytes = DEFAULT_KEYFRAME_MAX_BYTES): KeyframeProjection {
  const store = new CompressedKeyframeStore(snapshotBytes, { maxBytes });
  const blob = new Uint8Array(keyframeBytes); // shared by all entries: no memory cost
  const end = minutes * TICKS_PER_MINUTE;
  let captured = 0;
  for (let t = 0; t <= end; t++) {
    if (store.isDue(t)) {
      store.captureBytes(t, blob, snapshotBytes);
      captured++;
    }
  }
  return { minutes, captured, held: store.count, heldBytes: store.byteLength, intervalTicks: store.intervalTicks, thinnings: store.thinnings };
}

async function measureCodec(
  sim: HeadlessSim,
  codec: string,
  level: number,
  o: KeyframeBenchOptions,
  errors: string[],
  scene: string,
): Promise<KeyframeCodecResult> {
  const core = sim.core;
  const native = codec === 'native';
  const rule = core.ruleHash();
  const full = core.fullHash();
  const store = new CompressedKeyframeStore(core.snapshotByteLength, { level });
  const n = o.reps;
  const cap = new Float64Array(n);
  const block = new Float64Array(n);
  const res = new Float64Array(n);
  let ok = true;
  o.gc?.();
  for (let r = -1; r < n; r++) {
    store.discardAfter(-1);
    const t0 = o.clock();
    let t1: number;
    if (native) {
      const p = store.captureAsync(core);
      t1 = o.clock();
      await p;
    } else {
      store.capture(core);
      t1 = o.clock();
    }
    const t2 = o.clock();
    if (r >= 0) {
      cap[r] = t2 - t0;
      block[r] = t1 - t0;
    }
  }
  for (let r = -1; r < n; r++) {
    const t0 = o.clock();
    if (native) await store.restoreIntoAsync(core, 0);
    else store.restoreInto(core, 0);
    const t1 = o.clock();
    if (r >= 0) res[r] = t1 - t0;
    if (core.ruleHash() !== rule || core.fullHash() !== full) ok = false;
  }
  if (!ok) errors.push(`${scene} ${codec}: restore does not reproduce the captured rule/full hash`);
  const bytes = store.bytesAt(0).length;
  return {
    codec,
    compressedBytes: bytes,
    ratePercent: Math.round((bytes / core.snapshotByteLength) * 100000) / 1000,
    capture: summarize(cap),
    captureBlocking: summarize(block),
    restore: summarize(res),
    restoreOk: ok,
  };
}

export async function runKeyframeBench(o: KeyframeBenchOptions): Promise<KeyframeBenchResult> {
  if (!Number.isInteger(o.reps) || o.reps < 1) throw new RangeError(`reps must be a positive integer, got ${o.reps}`);
  const errors: string[] = [];
  const scenes: KeyframeSceneResult[] = [];
  const wanted = o.scenes ?? SCENES.map((s) => s.id);
  for (const def of SCENES) {
    if (!wanted.includes(def.id)) continue;
    o.log?.(`» ${def.id}: ${KEYFRAME_BENCH_WARM_TICKS} ticks`);
    const sim = buildScene(def, o);
    const core = sim.core;
    const snapBuf = new Uint8Array(core.snapshotByteLength);
    const mc = new Float64Array(o.reps);
    for (let r = -1; r < o.reps; r++) {
      const t0 = o.clock();
      core.snapshot(snapBuf);
      if (r >= 0) mc[r] = o.clock() - t0;
    }
    const codecs: KeyframeCodecResult[] = [];
    for (const level of KEYFRAME_BENCH_LEVELS) {
      o.log?.(`  fflate level ${level}`);
      codecs.push(await measureCodec(sim, `fflate-${level}`, level, o, errors, def.id));
    }
    o.log?.(`  native${hasNativeDeflate() ? '' : ' (fflate fallback)'}`);
    codecs.push(await measureCodec(sim, 'native', DEFAULT_KEYFRAME_LEVEL, o, errors, def.id));
    const dflt = codecs.find((c) => c.codec === `fflate-${DEFAULT_KEYFRAME_LEVEL}`) ?? codecs[0]!;
    const snapshotBytes = core.snapshotByteLength;
    scenes.push({
      scene: def.id,
      map: core.mapName,
      mapSizeWu: sim.world.mapSizeWu,
      units: unitCount(sim.world),
      tick: sim.tick,
      snapshotBytes,
      memcpy: summarize(mc),
      codecs,
      projection: KEYFRAME_PROJECTION_MINUTES.map((m) => projectKeyframeMemory(snapshotBytes, dflt.compressedBytes, m)),
      projectionRaw: KEYFRAME_PROJECTION_MINUTES.map((m) => projectKeyframeMemory(snapshotBytes, snapshotBytes, m)),
    });
    o.gc?.();
  }
  return {
    nativeDeflate: hasNativeDeflate(),
    defaultLevel: DEFAULT_KEYFRAME_LEVEL,
    budgetBytes: DEFAULT_KEYFRAME_MAX_BYTES,
    reps: o.reps,
    warmTicks: KEYFRAME_BENCH_WARM_TICKS,
    scenes,
    errors,
  };
}

// ---- report ----------------------------------------------------------------------------------

const de = (v: number, d: number): string => v.toFixed(d).replace('.', ',');
const ms = (v: number): string => (v >= 10 ? de(v, 1) : v >= 1 ? de(v, 2) : de(v, 3));
const int = (v: number): string => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const mib = (b: number): string => (b >= 1024 * 1024 ? `${de(b / (1024 * 1024), 1)} MiB` : `${de(b / 1024, 0)} KiB`);

/** German Markdown tables of a bench result (stdout and the p2 status fragment). */
export function formatKeyframeBench(r: KeyframeBenchResult): string {
  const lines: string[] = [];
  lines.push(
    `Szenen nach ${int(r.warmTicks)} Ticks Bewegung, je Codec ${r.reps} gemessene Wiederholungen (Median = p50). capture = Session-Snapshot (memcpy) + Kompression, restore = Inflate + \`restoreSnapshot\`; „blockierend“ = Anteil, auf den der Tick wartet (nativ: nur memcpy). Nativ = \`CompressionStream('deflate-raw')\`${r.nativeDeflate ? '' : ' (nicht verfügbar – fflate-Fallback)'}.`,
    '',
    '| Szene | Einheiten | Snapshot | Codec | komprimiert | Rate | capture p50 / p95 | blockierend p50 | restore p50 / p95 | Restore-Hash |',
    '|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const s of r.scenes) {
    for (const c of s.codecs) {
      lines.push(
        `| ${s.scene} | ${int(s.units)} | ${int(s.snapshotBytes)} B | ${c.codec}${c.codec === `fflate-${r.defaultLevel}` ? ' (Standard)' : ''} | ${int(c.compressedBytes)} B | ${de(c.ratePercent, 2)} % | ${ms(c.capture.p50)} / ${ms(c.capture.p95)} ms | ${ms(c.captureBlocking.p50)} ms | ${ms(c.restore.p50)} / ${ms(c.restore.p95)} ms | ${c.restoreOk ? 'gleich' : '**ABWEICHUNG**'} |`,
      );
    }
  }
  lines.push('', 'memcpy allein (Session-Snapshot in wiederverwendeten Puffer):', '');
  lines.push('| Szene | p50 | p95 |', '|---|---|---|');
  for (const s of r.scenes) lines.push(`| ${s.scene} | ${ms(s.memcpy.p50)} ms | ${ms(s.memcpy.p95)} ms |`);
  lines.push(
    '',
    `Hochrechnung Keyframe-Speicher (alle 600 Ticks, Budget ${mib(r.budgetBytes)}, Ausdünnung wie im Store; Keyframe-Größe konstant = Szene bei Level ${r.defaultLevel}):`,
    '',
    '| Szene | Partie | Keyframes aufgenommen / gehalten | Intervall | Ausdünnungen | Speicher komprimiert | unkomprimiert (gehalten / Ausdünnungen) |',
    '|---|---|---|---|---|---|---|',
  );
  for (const s of r.scenes) {
    s.projection.forEach((p, i) => {
      const raw = s.projectionRaw[i]!;
      lines.push(
        `| ${s.scene} | ${p.minutes >= 60 ? `${p.minutes / 60} h` : `${p.minutes} min`} | ${p.captured} / ${p.held} | ${int(p.intervalTicks)} Ticks | ${p.thinnings} | ${mib(p.heldBytes)} | ${mib(raw.heldBytes)} (${raw.held} KF, ${raw.thinnings}×) |`,
      );
    });
  }
  if (r.errors.length > 0) lines.push('', ...r.errors.map((e) => `- **Fehler:** ${e}`));
  return lines.join('\n');
}
