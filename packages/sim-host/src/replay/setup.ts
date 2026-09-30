/**
 * Shared setup helpers of the replay library (TRACK-REPLAY p4): sim build identification, the
 * GAME alliance matrix ↔ world alliance region, army lists and the end tick of a replay.
 */

import { MAX_ARMIES } from '@faf/fixed';
import { replayContentEndTick, ReplayArmyKind, type ReplayArmy, type ReplayGame, type RtsReplay } from '@faf/formats';
import { computeSimId } from '@faf/protocol';
import { isAllied, setAlliance, type World } from '@faf/sim';
import { MOD_LIST, SIM_BUILD } from '../identity.ts';

/** Sub-hash cadence of converted/recorded replays (PLAN §3.11 "Sub-Hashes alle 100 Ticks"). */
export const SUB_HASH_INTERVAL_TICKS = 100;

/**
 * SIM_BUILD values of this and earlier builds (append-only; the current SIM_BUILD must be the
 * last entry — replay-convert.test.ts enforces it, so a SIM_BUILD bump without extending the list
 * fails). Only used to NAME the build of a foreign log (HEAD.simBuild) when its simId does not
 * match the current SIM_BUILD: a replay of such a log is
 * refused by the player with a ReplayCompatError that names this build and the /b/<buildHash>/
 * redirect. The current SIM_BUILD is always tried first.
 */
export const KNOWN_SIM_BUILDS: readonly string[] = ['faf-sim/ms1.1', 'faf-sim/ms1.2', 'faf-sim/ms2.0'];

/** HEAD.simBuild written when no known build reproduces a log's simId. */
export const UNKNOWN_SIM_BUILD = 'unknown';

/**
 * The SIM_BUILD whose simId (with the given blueprint and map identity, no mods) equals `simId`:
 * the current SIM_BUILD first, then KNOWN_SIM_BUILDS; null if none matches.
 */
export function identifySimBuild(simId: number, bpSimHash: number, mapSimHash: number): string | null {
  const id = simId >>> 0;
  if (computeSimId(SIM_BUILD, bpSimHash, mapSimHash, MOD_LIST) >>> 0 === id) return SIM_BUILD;
  for (let i = KNOWN_SIM_BUILDS.length - 1; i >= 0; i--) {
    const b = KNOWN_SIM_BUILDS[i]!;
    if (b !== SIM_BUILD && computeSimId(b, bpSimHash, mapSimHash, MOD_LIST) >>> 0 === id) return b;
  }
  return null;
}

/** Bytes of the GAME alliance matrix (16 × 16 bits). */
export const ALLIANCE_MATRIX_BYTES = (MAX_ARMIES * MAX_ARMIES) >>> 3;

function bitIndex(a: number, b: number): number {
  return a * MAX_ARMIES + b;
}

/** True if bit a·16+b of a GAME alliance matrix is set. */
export function allianceBit(alliances: Uint8Array, a: number, b: number): boolean {
  const bit = bitIndex(a, b);
  return ((alliances[bit >>> 3]! >>> (bit & 7)) & 1) === 1;
}

/** The alliance matrix of a freshly created world (FFA: every army allied only with itself). */
export function defaultAllianceMatrix(): Uint8Array {
  const out = new Uint8Array(ALLIANCE_MATRIX_BYTES);
  for (let i = 0; i < MAX_ARMIES; i++) {
    const bit = bitIndex(i, i);
    out[bit >>> 3]! |= 1 << (bit & 7);
  }
  return out;
}

/** The world's alliance region as a GAME alliance matrix. */
export function allianceMatrixOf(world: World): Uint8Array {
  const out = new Uint8Array(ALLIANCE_MATRIX_BYTES);
  for (let a = 0; a < MAX_ARMIES; a++) {
    for (let b = 0; b < MAX_ARMIES; b++) {
      if (!isAllied(world, a, b)) continue;
      const bit = bitIndex(a, b);
      out[bit >>> 3]! |= 1 << (bit & 7);
    }
  }
  return out;
}

/**
 * Applies a GAME alliance matrix to a world at match setup (tick 0, before the first step) via
 * @faf/sim setAlliance. The sim keeps alliances symmetric and every army allied with itself, so
 * the matrix must be symmetric (RangeError otherwise); the diagonal is ignored.
 */
export function applyGameAlliances(world: World, alliances: Uint8Array): void {
  if (alliances.length !== ALLIANCE_MATRIX_BYTES) throw new RangeError(`alliance matrix must have ${ALLIANCE_MATRIX_BYTES} bytes, got ${alliances.length}`);
  for (let a = 0; a < MAX_ARMIES; a++) {
    for (let b = a + 1; b < MAX_ARMIES; b++) {
      const ab = allianceBit(alliances, a, b);
      if (ab !== allianceBit(alliances, b, a)) throw new RangeError(`alliance matrix is not symmetric (armies ${a} and ${b})`);
      if (ab !== isAllied(world, a, b)) setAlliance(world, a, b, ab);
    }
  }
}

/** Standard name of army `index` in converted replays ("Army 1", …). */
export function defaultArmyName(index: number): string {
  return `Army ${index + 1}`;
}

/**
 * GAME armies of a converted command log: armies 0 … count−1, all human (the FAFL log has no
 * setup data), each on its own team (team = index, FFA), AIx 1000 ‰, standard names.
 */
export function defaultArmies(count: number): ReplayArmy[] {
  const out: ReplayArmy[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ index: i, kind: ReplayArmyKind.Human, team: i, aixPermille: 1000, name: defaultArmyName(i), aiProfile: '', faction: '' });
  }
  return out;
}

/** Number of world armies a GAME describes (highest army index + 1; 0 without armies). */
export function armyCountOf(game: ReplayGame): number {
  let n = 0;
  for (const a of game.armies) if (a.index + 1 > n) n = a.index + 1;
  return n;
}

/** Where a replay's playback ends and why (see replayPlaybackEnd). */
export interface ReplayPlaybackEnd {
  /** Tick the playback / verification runs to. */
  readonly endTick: number;
  /** Largest tick of any command, rule hash, sub-hash row or mark (formats replayContentEndTick). */
  readonly contentEndTick: number;
  /** META.endTick, null without META. */
  readonly metaEndTick: number | null;
  /** True if META.endTick was not followed (it lies further behind the content than allowed). */
  readonly metaClamped: boolean;
}

/**
 * End of a replay's playback, derived from the CONTENT (PLAN §3.11; TRACK-REPLAY review): the
 * playback always reaches the last command, rule hash, sub-hash row and mark, so every recorded
 * hash is compared. META.endTick is descriptive; it may only extend the playback by the idle ticks
 * a recording can have after its last rule hash (hashInterval − 1; none without rule hashes).
 * The reader already refuses a META.endTick before the content; one further behind the content
 * than allowed is ignored (metaClamped: the playback ends at the content) instead of simulating up
 * to 2³² empty ticks.
 */
export function replayPlaybackEnd(replay: RtsReplay): ReplayPlaybackEnd {
  const contentEndTick = replayContentEndTick(replay);
  const meta = replay.meta;
  if (meta === null) return { endTick: contentEndTick, contentEndTick, metaEndTick: null, metaClamped: false };
  const tail = replay.head.hashInterval > 0 ? replay.head.hashInterval - 1 : 0;
  const trusted = meta.endTick >= contentEndTick && meta.endTick <= contentEndTick + tail;
  const endTick = trusted ? meta.endTick : contentEndTick;
  return { endTick, contentEndTick, metaEndTick: meta.endTick, metaClamped: endTick !== meta.endTick };
}

/** Last tick of a replay's playback (replayPlaybackEnd(replay).endTick). */
export function replayEndTick(replay: RtsReplay): number {
  return replayPlaybackEnd(replay).endTick;
}
