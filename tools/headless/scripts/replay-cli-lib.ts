/**
 * Node helpers of the replay CLIs (replay-verify, desync-diff, bench:replay): input paths relative
 * to the caller's directory (INIT_CWD under pnpm), every content/maps/*.rtsmap, argument parsing,
 * German tables and the mapping of errors to exit code 2.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { FormatError } from '@faf/formats';
import { CommandLogError, ReplayCompatError } from '@faf/sim-host';
import { DesyncIncompatibleError } from '../src/replay/desync.ts';
import { ReplayInputError, type ReplayAssets } from '../src/replay/verify.ts';
import { loadSimBin, REPO_DIR } from './lib.ts';

/** Directory relative CLI paths are resolved against (pnpm sets INIT_CWD to the caller's cwd). */
export function callerDir(): string {
  return process.env['INIT_CWD'] ?? process.cwd();
}

/** Absolute path of a CLI argument. */
export function inputPath(p: string): string {
  return isAbsolute(p) ? p : resolve(callerDir(), p);
}

/** Path as shown in reports: relative to the caller's directory if inside it. */
export function displayPath(abs: string): string {
  const rel = relative(callerDir(), abs);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) ? rel : abs;
}

export const MAPS_DIR = resolve(REPO_DIR, 'content/maps');
export const GOLDEN_REPLAYS_DIR = resolve(REPO_DIR, 'test/golden-replays');

/** Every content/maps/*.rtsmap by repo-relative path (plus extra files by their absolute path). */
export function loadAllMaps(extra: readonly string[] = []): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  if (existsSync(MAPS_DIR)) {
    for (const f of readdirSync(MAPS_DIR).sort()) {
      if (f.endsWith('.rtsmap')) out[`content/maps/${f}`] = new Uint8Array(readFileSync(resolve(MAPS_DIR, f)));
    }
  }
  for (const p of extra) out[p] = new Uint8Array(readFileSync(p));
  return out;
}

/** sim.bin + all maps. */
export function loadReplayAssets(extraMaps: readonly string[] = []): ReplayAssets {
  return { simBin: loadSimBin(), maps: loadAllMaps(extraMaps) };
}

/** test/golden-replays/*.rtsreplay (sorted). */
export function goldenReplayPaths(): string[] {
  if (!existsSync(GOLDEN_REPLAYS_DIR)) return [];
  return readdirSync(GOLDEN_REPLAYS_DIR)
    .filter((f) => f.endsWith('.rtsreplay'))
    .sort()
    .map((f) => resolve(GOLDEN_REPLAYS_DIR, f));
}

export function readInput(abs: string): Uint8Array {
  return new Uint8Array(readFileSync(abs));
}

/** Parsed command line: positional arguments, flags and options with values. */
export interface CliArgs {
  readonly positional: string[];
  readonly flags: Set<string>;
  readonly values: Map<string, string[]>;
}

/** Usage error (exit code 2). */
export class CliUsageError extends Error {
  override readonly name = 'CliUsageError';
}

/**
 * Parses `argv` (a leading/standalone `--` from pnpm is ignored). `flags` take no value,
 * `valued` options take the next argument (repeatable); anything else starting with `--` is an
 * error.
 */
export function parseCli(argv: readonly string[], flags: readonly string[], valued: readonly string[]): CliArgs {
  const out: CliArgs = { positional: [], flags: new Set(), values: new Map() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') continue;
    if (a.startsWith('--')) {
      if (flags.includes(a)) out.flags.add(a);
      else if (valued.includes(a)) {
        const v = argv[i + 1];
        if (v === undefined || v === '--') throw new CliUsageError(`${a} erwartet einen Wert`);
        const list = out.values.get(a) ?? [];
        list.push(v);
        out.values.set(a, list);
        i++;
      } else throw new CliUsageError(`unbekannte Option ${a} (erlaubt: ${[...flags, ...valued].join(', ')})`);
    } else out.positional.push(a);
  }
  return out;
}

/** Last value of an option or undefined. */
export function optValue(args: CliArgs, name: string): string | undefined {
  const v = args.values.get(name);
  return v === undefined ? undefined : v[v.length - 1];
}

/** Non-negative integer option (accepts 1.100 / 1_100 / 1100). */
export function optTick(args: CliArgs, name: string): number | undefined {
  const v = optValue(args, name);
  if (v === undefined) return undefined;
  const n = Number(v.replace(/[._]/g, ''));
  if (!Number.isInteger(n) || n < 0) throw new CliUsageError(`${name} erwartet einen Tick (Ganzzahl ≥ 0), nicht '${v}'`);
  return n;
}

/** Error of an input the tools cannot use: exit code 2 with a German explanation, or null. */
export function explainInputError(e: unknown): { result: string; detail: string } | null {
  if (e instanceof ReplayCompatError) {
    return {
      result: 'inkompatibel',
      detail: `inkompatibel (${e.reason}): aufgezeichnet mit ${e.simBuild}, Build ${e.buildHash} – abspielbar über ${e.redirect}. ${e.message}`,
    };
  }
  if (e instanceof FormatError) {
    const where = [e.chunkId !== null ? `Chunk ${e.chunkId}` : '', e.offset >= 0 ? `Offset ${e.offset}` : ''].filter((s) => s !== '').join(', ');
    return { result: 'Formatfehler', detail: `Formatfehler ${e.code}${where !== '' ? ` (${where})` : ''}: ${e.message}` };
  }
  if (e instanceof CommandLogError) return { result: 'Formatfehler', detail: `Formatfehler im FAFL-Log: ${e.message}` };
  if (e instanceof ReplayInputError) return { result: 'Formatfehler', detail: `keine Replay-Datei: ${e.message}` };
  if (e instanceof DesyncIncompatibleError) return { result: 'inkompatibel', detail: `inkompatibel: ${e.message}` };
  if (e instanceof CliUsageError) return { result: 'Aufruffehler', detail: `Aufruffehler: ${e.message}` };
  if (e instanceof RangeError) return { result: 'Aufruffehler', detail: `Aufruffehler: ${e.message}` };
  const code = (e as { code?: unknown }).code;
  if (code === 'ENOENT' || code === 'EISDIR' || code === 'EACCES') return { result: 'Dateifehler', detail: `Datei nicht lesbar: ${(e as Error).message}` };
  return null;
}

/** German number format (1.234). */
export function de(n: number, digits = 0): string {
  return n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Plain-text table with `|` separators; `right` marks right-aligned columns. */
export function textTable(header: readonly string[], rows: readonly (readonly string[])[], right: readonly boolean[] = []): string {
  const all = [header, ...rows];
  const w = header.map((_, c) => Math.max(...all.map((r) => (r[c] ?? '').length)));
  const cell = (s: string, c: number): string => (right[c] === true ? s.padStart(w[c]!) : s.padEnd(w[c]!));
  const line = (r: readonly string[]): string => r.map((s, c) => cell(s, c)).join(' | ').trimEnd();
  return [line(header), w.map((n) => '-'.repeat(n)).join('-|-'), ...rows.map(line)].join('\n');
}
