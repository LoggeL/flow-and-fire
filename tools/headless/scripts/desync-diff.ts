/**
 * desync-diff (PLAN §3.12: "erster abweichender Tick, dann per Voll-Dump Tabelle, Spalte und
 * Entity"), see src/replay/desync.ts.
 *
 *   pnpm --filter @faf/headless desync-diff -- <a> <b> [--limit <n>] [--dumps <verzeichnis>]
 *                                              [--perturb-b <tick>:<region>.<spalte>[<index>]=<wert>]
 *                                              [--map <pfad.rtsmap>] [--json]
 *   pnpm --filter @faf/headless desync-diff -- --dump <replay> --tick <t> --out <datei.rtsdump> [--label <text>]
 *   pnpm --filter @faf/headless desync-diff -- <a.rtsdump> <b.rtsdump> [--limit <n>] [--json]
 *
 * <a>/<b>: two recordings of the same game (.rtsreplay or FAFL logs). Relative paths are resolved
 * against the caller's directory (INIT_CWD). `--dumps` writes the full dumps of both sides at the
 * first divergent tick (a.rtsdump, b.rtsdump). `--perturb-b` writes one value into B's world after
 * B's step to <tick> (self-check of the tool chain).
 *
 * Exit codes: 0 no divergence · 1 divergence found and explained · 2 incompatible / format error /
 * usage error · 3 only the recordings differ (engine/build desync: re-simulations agree).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SIM_BUILD } from '@faf/sim-host';
import { readStateDump, writeStateDump, type StateDump } from '../src/replay/dump.ts';
import { compareStateDumps, desyncDiff, dumpReplayAt, formatDesyncReport, type DesyncPerturbation, type DesyncReport } from '../src/replay/desync.ts';
import { formatStateDiff, type StateDiff } from '../src/replay/state-diff.ts';
import { detectReplayFileKind, hex32 } from '../src/replay/verify.ts';
import { CliUsageError, de, displayPath, explainInputError, inputPath, loadReplayAssets, optTick, optValue, parseCli, readInput, type CliArgs } from './replay-cli-lib.ts';

const USAGE = [
  'Aufruf:',
  '  desync-diff -- <a> <b> [--limit <n>] [--dumps <verzeichnis>] [--perturb-b <tick>:<region>.<spalte>[<index>]=<wert>] [--map <pfad.rtsmap>] [--json]',
  '  desync-diff -- --dump <replay> --tick <t> --out <datei.rtsdump> [--label <text>] [--map <pfad.rtsmap>]',
  '  desync-diff -- <a.rtsdump> <b.rtsdump> [--limit <n>] [--json]',
].join('\n');

/** Parses `700:units.hp[5]=1`. */
function parsePerturbation(spec: string): DesyncPerturbation {
  const m = /^(\d+):([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\[(\d+)\]=(-?\d+)$/.exec(spec.replace(/[._](?=\d{3}\b)/g, ''));
  if (m === null) throw new CliUsageError(`--perturb-b erwartet <tick>:<region>.<spalte>[<index>]=<wert> (z. B. 700:units.hp[5]=1), nicht '${spec}'`);
  return { tick: Number(m[1]), region: m[2]!, column: m[3]!, index: Number(m[4]), value: Number(m[5]) };
}

function writeFile(abs: string, bytes: Uint8Array): void {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
}

function diffJson(d: StateDiff): unknown {
  return {
    equal: d.equal,
    layoutEqual: d.layoutEqual,
    totalDifferingValues: d.totalDifferingValues,
    regionsDiffering: d.regionsDiffering,
    entries: d.entries,
    layoutDiff: d.layoutDiff,
    tickA: d.tickA,
    tickB: d.tickB,
  };
}

function reportJson(r: DesyncReport): unknown {
  const { dumpA, dumpB, diff, ...rest } = r;
  void dumpA;
  void dumpB;
  return { ...rest, diff: diff === null ? null : diffJson(diff) };
}

function limitOf(args: CliArgs): number | undefined {
  const v = optValue(args, '--limit');
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new CliUsageError(`--limit erwartet eine Ganzzahl ≥ 1, nicht '${v}'`);
  return n;
}

function dumpMode(args: CliArgs): number {
  const src = optValue(args, '--dump')!;
  const tick = optTick(args, '--tick');
  const out = optValue(args, '--out');
  if (tick === undefined || out === undefined || args.positional.length > 0) throw new CliUsageError('--dump braucht --tick <t> und --out <datei.rtsdump> und keine weiteren Dateien');
  const abs = inputPath(src);
  const assets = loadReplayAssets((args.values.get('--map') ?? []).map(inputPath));
  const label = optValue(args, '--label') ?? `${displayPath(abs)}, Node ${process.version}`;
  const dump = dumpReplayAt(readInput(abs), assets, tick, { label });
  const bytes = writeStateDump(dump);
  const outAbs = inputPath(out);
  writeFile(outAbs, bytes);
  console.log(
    `Voll-Dump geschrieben: ${displayPath(outAbs)} – Tick ${de(dump.tick)}, ${SIM_BUILD}, simId ${hex32(dump.simId)}, layoutHash ${hex32(dump.layoutHash)}, ` +
      `Arena ${de(dump.bytes.length)} B → Datei ${de(bytes.length)} B, Label "${dump.label}"`,
  );
  return 0;
}

function dumpCompareMode(a: string, b: string, args: CliArgs, json: boolean): number {
  const da: StateDump = readStateDump(readInput(a));
  const db: StateDump = readStateDump(readInput(b));
  const limit = limitOf(args);
  const { diff, exitCode } = compareStateDumps(da, db, limit !== undefined ? { limit } : {});
  if (json) {
    console.log(JSON.stringify({ mode: 'dumps', exitCode, a: displayPath(a), b: displayPath(b), diff: diffJson(diff) }, null, 2));
    return exitCode;
  }
  console.log(`desync-diff (Dump-Vergleich)  A: ${displayPath(a)}  ↔  B: ${displayPath(b)}`);
  if (da.simBuild !== db.simBuild) console.log(`Hinweis: unterschiedliche Builds (A ${da.simBuild}, B ${db.simBuild})`);
  if (da.tick !== db.tick) console.log(`Hinweis: unterschiedliche Ticks (A ${de(da.tick)}, B ${de(db.tick)})`);
  console.log('');
  console.log(formatStateDiff(diff).trimEnd());
  console.log('');
  console.log(exitCode === 0 ? 'Ergebnis: Dumps identisch (Exit 0).' : `Ergebnis: Abweichung gefunden (Exit 1), zuerst ${diff.entries[0] !== undefined ? `${diff.entries[0].region}.${diff.entries[0].part} ${diff.entries[0].entity}` : 'im Arena-Layout'}.`);
  return exitCode;
}

function replayMode(a: string, b: string, args: CliArgs, json: boolean): number {
  const assets = loadReplayAssets((args.values.get('--map') ?? []).map(inputPath));
  const pSpec = optValue(args, '--perturb-b');
  const limit = limitOf(args);
  const report = desyncDiff(readInput(a), readInput(b), assets, {
    labelA: displayPath(a),
    labelB: displayPath(b),
    ...(pSpec !== undefined ? { perturbB: parsePerturbation(pSpec) } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });
  const dumpsDir = optValue(args, '--dumps');
  const written: string[] = [];
  if (dumpsDir !== undefined && report.dumpA !== null && report.dumpB !== null) {
    const dir = inputPath(dumpsDir);
    for (const [name, d] of [
      ['a.rtsdump', report.dumpA],
      ['b.rtsdump', report.dumpB],
    ] as const) {
      const p = resolve(dir, name);
      writeFile(p, writeStateDump(d));
      written.push(displayPath(p));
    }
  }
  if (json) {
    console.log(JSON.stringify({ mode: 'replays', ...(reportJson(report) as object), dumpsWritten: written }, null, 2));
    return report.exitCode;
  }
  process.stdout.write(formatDesyncReport(report));
  if (written.length > 0) console.log(`Voll-Dumps am Tick ${de(report.tick!)}: ${written.join(', ')}`);
  else if (dumpsDir !== undefined) console.log('Keine Voll-Dumps geschrieben (keine Abweichung der Nachsimulation).');
  console.log(`(Exit ${report.exitCode}, ${de(report.ms)} ms)`);
  return report.exitCode;
}

function main(argv: readonly string[]): number {
  let args: CliArgs;
  try {
    args = parseCli(argv, ['--json', '--help'], ['--dump', '--tick', '--out', '--label', '--limit', '--dumps', '--perturb-b', '--map']);
  } catch (e) {
    console.error(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  if (args.flags.has('--help')) {
    console.log(USAGE);
    return 0;
  }
  const json = args.flags.has('--json');
  try {
    if (args.values.has('--dump')) return dumpMode(args);
    if (args.positional.length !== 2) throw new CliUsageError('genau zwei Dateien angeben');
    const [a, b] = args.positional.map(inputPath) as [string, string];
    const ka = detectReplayFileKind(readInput(a));
    const kb = detectReplayFileKind(readInput(b));
    if (ka === 'rtsdump' && kb === 'rtsdump') return dumpCompareMode(a, b, args, json);
    if (ka === 'rtsdump' || kb === 'rtsdump') throw new CliUsageError('entweder zwei Replays/Logs oder zwei .rtsdump-Dateien vergleichen');
    return replayMode(a, b, args, json);
  } catch (e) {
    const ex = explainInputError(e);
    if (ex === null) throw e;
    if (json) console.log(JSON.stringify({ exitCode: 2, result: ex.result, detail: ex.detail }, null, 2));
    else console.error(`${ex.detail}${e instanceof CliUsageError ? `\n${USAGE}` : ''}\nErgebnis: ${ex.result} (Exit 2).`);
    return 2;
  }
}

process.exitCode = main(process.argv.slice(2));
