/**
 * replay-verify (PLAN §3.12): plays replays (.rtsreplay or FAFL command logs) headless and checks
 * every recorded rule hash and sub-hash row.
 *
 *   pnpm --filter @faf/headless replay-verify -- <dateien…> [--goldens] [--map <pfad.rtsmap>]
 *                                                [--until <tick>] [--json]
 *
 * Relative paths are resolved against the caller's directory (INIT_CWD); `--goldens` adds every
 * test/golden-replays/*.rtsreplay; all content/maps/*.rtsmap are candidates for HEAD.mapSimHash
 * (`--map` adds more). Exit code (maximum over all files): 0 = every file played bit-identically
 * with every recorded hash compared, 1 = divergence (first one with tick, expected/actual,
 * tables) or incomplete verification (fewer recorded rule hashes / sub-hash rows compared than
 * the replay holds up to the playback end), 2 = incompatible (ReplayCompatError: SIM_BUILD /
 * format or protocol version / buildHash / map / blueprints, with the /b/<buildHash>/ redirect) or
 * format error (code, chunk, offset) or usage error.
 */
import { SIM_BUILD } from '@faf/sim-host';
import { hex32, verifyReplayFile, type VerifyReplayFileResult } from '../src/replay/verify.ts';
import {
  CliUsageError,
  de,
  displayPath,
  explainInputError,
  goldenReplayPaths,
  inputPath,
  loadReplayAssets,
  optTick,
  parseCli,
  readInput,
  textTable,
  type CliArgs,
} from './replay-cli-lib.ts';

const USAGE = 'Aufruf: replay-verify -- <dateien…> [--goldens] [--map <pfad.rtsmap>] [--until <tick>] [--json]';

interface FileOutcome {
  readonly file: string;
  readonly exitCode: 0 | 1 | 2;
  readonly result: string;
  readonly detail: string;
  readonly verify: VerifyReplayFileResult | null;
}

function outcomeOf(file: string, v: VerifyReplayFileResult): FileOutcome {
  if (v.divergences.length === 0 && !v.fullyCompared) {
    const missing: string[] = [];
    if (v.compared < v.expectedHashes) missing.push(`${de(v.compared)} von ${de(v.expectedHashes)} Regel-Hashes`);
    if (v.subCompared < v.expectedSubHashes) missing.push(`${de(v.subCompared)} von ${de(v.expectedSubHashes)} Sub-Hash-Zeilen`);
    const detail = `unvollständig geprüft: nur ${missing.join(' und ')} bis Tick ${de(v.endTick)} verglichen (Hinweise beachten)`;
    return { file, exitCode: 1, result: 'unvollständig geprüft', detail, verify: v };
  }
  if (v.divergences.length === 0) {
    const partial = v.endTick < v.replayEndTick ? ` (bis Tick ${de(v.endTick)})` : '';
    return { file, exitCode: 0, result: `bitgleich${partial}`, detail: '', verify: v };
  }
  const d = v.divergences[0]!;
  const tables = d.regions.length > 0 ? d.regions.join(', ') : 'keine Sub-Hash-Region weicht ab (nur der aufgezeichnete Hash)';
  const kind = d.kind === 'rule' ? 'Regel-Hash' : 'nur Sub-Hashes';
  const detail =
    `erste Abweichung bei Tick ${de(d.tick)} (${kind}): erwartet ${d.expected < 0 ? '–' : hex32(d.expected)}, ist ${hex32(d.actual)}; ` +
    `Tabelle(n): ${tables}; ${de(v.divergences.length)} Abweichung(en) insgesamt`;
  return { file, exitCode: 1, result: `Abweichung @ ${de(d.tick)}`, detail, verify: v };
}

function main(argv: readonly string[]): number {
  let args: CliArgs;
  try {
    args = parseCli(argv, ['--goldens', '--json', '--help'], ['--map', '--until']);
  } catch (e) {
    console.error(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  if (args.flags.has('--help')) {
    console.log(USAGE);
    return 0;
  }
  const json = args.flags.has('--json');
  const files = args.positional.map(inputPath);
  if (args.flags.has('--goldens')) {
    const g = goldenReplayPaths();
    if (g.length === 0) console.error('Hinweis: keine test/golden-replays/*.rtsreplay gefunden (pnpm --filter @faf/headless replay-goldens -- --update)');
    files.push(...g);
  }
  if (files.length === 0) {
    console.error(`keine Dateien angegeben\n${USAGE}`);
    return 2;
  }
  let untilTick: number | undefined;
  let assets;
  try {
    untilTick = optTick(args, '--until');
    assets = loadReplayAssets((args.values.get('--map') ?? []).map(inputPath));
  } catch (e) {
    const ex = explainInputError(e);
    if (ex === null) throw e;
    console.error(ex.detail);
    return 2;
  }

  const outcomes: FileOutcome[] = [];
  for (const abs of files) {
    const file = displayPath(abs);
    try {
      const v = verifyReplayFile(readInput(abs), assets, untilTick !== undefined ? { untilTick } : {});
      outcomes.push(outcomeOf(file, v));
    } catch (e) {
      if (e instanceof CliUsageError) throw e;
      const ex = explainInputError(e);
      if (ex === null) throw e;
      outcomes.push({ file, exitCode: 2, result: ex.result, detail: ex.detail, verify: null });
    }
  }
  const exit = outcomes.reduce<number>((m, o) => Math.max(m, o.exitCode), 0);

  if (json) {
    console.log(JSON.stringify({ simBuild: SIM_BUILD, exitCode: exit, files: outcomes }, null, 2));
    return exit;
  }
  console.log(`replay-verify – ${outcomes.length} Datei(en), Build ${SIM_BUILD}, Node ${process.version}${untilTick !== undefined ? `, bis Tick ${de(untilTick)}` : ''}`);
  console.log('');
  const rows = outcomes.map((o) => {
    const v = o.verify;
    if (v === null) return [o.file, '–', '–', '–', o.result, '–'];
    return [
      o.file + (v.kind === 'fafl' ? ' (FAFL)' : ''),
      de(v.endTick),
      `${de(v.compared)}/${de(v.recordedHashes)}`,
      v.recordedSubHashes > 0 ? `${de(v.subCompared)}/${de(v.recordedSubHashes)}` : '–',
      o.result,
      `${de(v.xRealtime)}x`,
    ];
  });
  console.log(textTable(['Datei', 'Ticks', 'Hashes geprüft', 'Sub-Hashes', 'Ergebnis', 'Tempo x Echtzeit'], rows, [false, true, true, true, false, true]));
  const notes: string[] = [];
  for (const o of outcomes) {
    if (o.detail !== '') notes.push(`${o.file}: ${o.detail}`);
    const v = o.verify;
    if (v !== null) {
      const flags = [v.tainted ? 'getaintet (Cheats/DevReload)' : '', v.truncated ? 'trunkiert' : '', v.complete ? '' : 'nicht abgeschlossen'].filter((s) => s !== '');
      if (flags.length > 0) notes.push(`${o.file}: ${flags.join(', ')}; Karte ${v.mapName}`);
      for (const w of v.warnings) notes.push(`${o.file}: Hinweis: ${w}`);
    }
  }
  if (notes.length > 0) {
    console.log('');
    for (const n of notes) console.log(n);
  }
  console.log('');
  const verdict = exit === 0 ? 'alle Dateien bitgleich abgespielt' : exit === 1 ? 'Abweichung gefunden oder unvollständig geprüft' : 'inkompatible/fehlerhafte Eingabe';
  console.log(`Ergebnis: ${verdict} (Exit ${exit}).`);
  return exit;
}

process.exitCode = main(process.argv.slice(2));
