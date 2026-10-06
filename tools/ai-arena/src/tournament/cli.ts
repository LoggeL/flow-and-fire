/**
 * Command line of scripts/tournament.ts:
 *
 *   node --import tsx tools/ai-arena/scripts/tournament.ts [--suite ms9|diff|quick] [--games N]
 *        [--workers 0..4] [--maps a,b,c] [--seeds 1-105|1,5,9] [--host sync|worker] [--clock thread|wall]
 *        [--brain module#export] [--minutes M | --max-ticks T] [--out file.json|dir] [--md file.md]
 *        [--no-json] [--quiet]
 *
 * A leading '--' (pnpm run tournament -- …) is ignored. Unknown options are errors.
 */
import { MAX_POOL_WORKERS } from '../stats/pool.ts';
import { HOST_CLOCK_KINDS, type HostClockKind } from '../bench/clock.ts';
import { HOST_KINDS, type HostKind } from '../host-node/sides.ts';
import { SUITE_NAMES, type PlanOverrides, type SuiteName } from './suites.ts';

export interface TournamentArgs {
  readonly suite: SuiteName;
  readonly overrides: PlanOverrides;
  readonly workers: number;
  /** JSON output file or directory (null = default results/<suite>-<date>.json). */
  readonly out: string | null;
  readonly json: boolean;
  readonly md: string | null;
  readonly quiet: boolean;
}

export const TOURNAMENT_USAGE =
  'usage: tournament.ts [--suite ms9|diff|quick] [--games N] [--workers 0..4] [--maps a,b] [--seeds 1-105|1,2,3] ' +
  '[--host sync|worker] [--clock thread|wall] [--brain module#export] [--minutes M | --max-ticks T] [--out file|dir] [--md file] [--no-json] [--quiet]';

function positiveInt(name: string, v: string, min = 1): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name}: expected an integer ≥ ${min} (got '${v}')`);
  return n;
}

/** Parses '1-105', '1,5,9' or a mix ('1-3,7'). */
export function parseSeeds(v: string): number[] {
  const out: number[] = [];
  for (const part of v.split(',')) {
    const p = part.trim();
    if (p.length === 0) continue;
    const m = /^(-?\d+)-(-?\d+)$/.exec(p);
    if (m !== null) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (b < a) throw new Error(`--seeds: empty range '${p}'`);
      for (let s = a; s <= b; s++) out.push(s);
    } else {
      const s = Number(p);
      if (!Number.isInteger(s)) throw new Error(`--seeds: '${p}' is not an integer`);
      out.push(s);
    }
  }
  if (out.length === 0) throw new Error('--seeds: no seeds');
  return out;
}

/** Parses the tournament command line (argv without node and script). */
export function parseTournamentArgs(argv: readonly string[]): TournamentArgs {
  const args = argv[0] === '--' ? argv.slice(1) : argv.slice();
  let suite: SuiteName = 'quick';
  let workers = 4;
  let out: string | null = null;
  let json = true;
  let md: string | null = null;
  let quiet = false;
  const ov: { -readonly [K in keyof PlanOverrides]: PlanOverrides[K] } = {};
  for (let i = 0; i < args.length; i++) {
    const k = args[i]!;
    if (k === '--') continue;
    if (k === '--no-json') {
      json = false;
      continue;
    }
    if (k === '--quiet') {
      quiet = true;
      continue;
    }
    if (k === '--help' || k === '-h') throw new Error(TOURNAMENT_USAGE);
    const eq = k.indexOf('=');
    const key = eq > 0 ? k.slice(0, eq) : k;
    let v: string | undefined;
    if (eq > 0) v = k.slice(eq + 1);
    else {
      v = args[i + 1];
      i++;
    }
    if (v === undefined) throw new Error(`${key}: missing value\n${TOURNAMENT_USAGE}`);
    switch (key) {
      case '--suite':
        if (!(SUITE_NAMES as readonly string[]).includes(v)) throw new Error(`--suite: unknown suite '${v}' (${SUITE_NAMES.join('|')})`);
        suite = v as SuiteName;
        break;
      case '--games':
        ov.games = positiveInt(key, v);
        break;
      case '--workers':
        workers = positiveInt(key, v, 0);
        if (workers > MAX_POOL_WORKERS) throw new Error(`--workers: at most ${MAX_POOL_WORKERS} (memory rule)`);
        break;
      case '--maps':
        ov.maps = v.split(',').map((m) => m.trim()).filter((m) => m.length > 0);
        if (ov.maps.length === 0) throw new Error('--maps: no maps');
        break;
      case '--seeds':
        ov.seeds = parseSeeds(v);
        break;
      case '--host':
        if (!(HOST_KINDS as readonly string[]).includes(v)) throw new Error(`--host: expected sync|worker (got '${v}')`);
        ov.host = v as HostKind;
        break;
      case '--clock':
        if (!(HOST_CLOCK_KINDS as readonly string[]).includes(v)) throw new Error(`--clock: expected thread|wall (got '${v}')`);
        ov.clock = v as HostClockKind;
        break;
      case '--brain':
        if (v.length === 0) throw new Error('--brain: empty spec');
        ov.brain = v;
        break;
      case '--minutes':
        ov.maxTicks = positiveInt(key, v) * 600;
        break;
      case '--max-ticks':
        ov.maxTicks = positiveInt(key, v);
        break;
      case '--out':
        out = v;
        break;
      case '--md':
        md = v;
        break;
      default:
        throw new Error(`unknown option '${key}'\n${TOURNAMENT_USAGE}`);
    }
  }
  return { suite, overrides: ov, workers, out, json, md, quiet };
}
