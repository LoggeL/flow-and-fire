/**
 * Node-side helpers of the headless tools: asset loading, paths, golden IO, child processes.
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGolden, type Golden } from '../src/goldens.ts';

export const HEADLESS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = resolve(HEADLESS_DIR, '../..');
export const GOLDENS_DIR = resolve(HEADLESS_DIR, 'goldens');
export const RESULTS_DIR = resolve(HEADLESS_DIR, 'results');
export const DIST_HARNESS_DIR = resolve(HEADLESS_DIR, 'dist-harness');
/** Status fragment whose bench tables `bench --update-docs` replaces (MS2: this package's). */
export const STATUS_DOC = resolve(REPO_DIR, 'docs/status/ms2-p2-sim.md');
export const SIM_BIN_PATH = resolve(REPO_DIR, 'content/generated/sim.bin');
export const XXH32_WASM_PATH = resolve(HEADLESS_DIR, 'src/spk5/xxh32.wasm');

/** Map files the scenarios reference (repo-relative paths, see src/scenarios.ts). */
export const MAP_PATHS: readonly string[] = ['content/maps/hollow-ridge.rtsmap', 'content/maps/setons.rtsmap'];

/** Bytes of every scenario map by repo-relative path (RunOptions.maps / JobAssets.maps). */
export function loadMaps(): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const p of MAP_PATHS) out[p] = new Uint8Array(readFileSync(resolve(REPO_DIR, p)));
  return out;
}

/** The checked-in blueprint bundle (content/generated/sim.bin). */
export function loadSimBin(): Uint8Array {
  return new Uint8Array(readFileSync(SIM_BIN_PATH));
}

/** The checked-in hand-written xxHash32 WASM module. */
export function loadXxh32Wasm(): Uint8Array {
  return new Uint8Array(readFileSync(XXH32_WASM_PATH));
}

export function goldenPath(scenario: string): string {
  return resolve(GOLDENS_DIR, `${scenario}.json`);
}

/** Golden of a scenario or null if none is checked in yet. */
export function readGolden(scenario: string): Golden | null {
  const p = goldenPath(scenario);
  if (!existsSync(p)) return null;
  return parseGolden(readFileSync(p, 'utf8'));
}

export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** Local date as YYYY-MM-DD (report file names). */
export function isoDate(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Runs a command synchronously with inherited stdio; throws on a non-zero exit unless `allowFail`. */
export function run(cmd: string, args: readonly string[], opts: SpawnSyncOptions & { allowFail?: boolean } = {}): number {
  const { allowFail, ...rest } = opts;
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: HEADLESS_DIR, ...rest });
  if (r.error !== undefined) throw r.error;
  const code = r.status ?? 1;
  if (code !== 0 && allowFail !== true) throw new Error(`${cmd} ${args.join(' ')} exited with ${code}`);
  return code;
}

/** Local binary from node_modules/.bin of this package. */
export function bin(name: string): string {
  return resolve(HEADLESS_DIR, 'node_modules/.bin', name);
}

/** Runs one series in a fresh Node process (JIT cold) and returns its parsed result. */
export function nodeSeries<T>(job: unknown): T {
  const r = spawnSync(process.execPath, ['--import', 'tsx', resolve(HEADLESS_DIR, 'scripts/run-series.ts'), JSON.stringify(job)], {
    cwd: HEADLESS_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error !== undefined) throw r.error;
  if (r.status !== 0) throw new Error(`node series ${JSON.stringify(job)} exited with ${r.status}`);
  return JSON.parse(r.stdout) as T;
}

/** Builds the harness (vite) into dist-harness. */
export function buildHarness(): void {
  run(bin('vite'), ['build', '-c', 'vite.harness.config.ts']);
}

/** Runs the Playwright harness specs (all three engines, sequentially); returns the exit code. */
export function playwright(spec: string, env: Record<string, string> = {}): number {
  return run(bin('playwright'), ['test', '-c', 'playwright.xengine.config.ts', spec], {
    allowFail: true,
    env: { ...process.env, ...env },
  });
}

/** Removes raw per-engine outputs with the given prefix (stale results must not be reused). */
export function clearRaw(prefix: string): void {
  if (!existsSync(RESULTS_DIR)) return;
  for (const f of readdirSync(RESULTS_DIR)) if (f.startsWith(prefix) && f.endsWith('.tmp.json')) rmSync(resolve(RESULTS_DIR, f));
}

/** Parsed raw output or null if the spec did not produce it. */
export function readRaw<T>(name: string): T | null {
  const f = resolve(RESULTS_DIR, `${name}.tmp.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : null;
}

/** CPU model of this machine (reports). */
export function machine(): string {
  return cpus()[0]?.model ?? 'unknown CPU';
}

export const ENGINES = ['node', 'chromium', 'firefox', 'webkit'] as const;
export const BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
