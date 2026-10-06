/**
 * Foreign-load detection of the FX benchmark (as in tools/render-bench/scripts/spk4.ts): other
 * processes that falsify GPU/JS timings – the user's MLX jobs, Playwright runs of other agents,
 * vitest. Detection only: nothing is stopped or locked.
 */
import { execFileSync } from 'node:child_process';

/** Commands that load the GPU or the browser processes heavily. */
export const GPU_LOAD_RE = /h3mlx|mlx_lm|\bmlx\b|tools\/gpurun|playwright test|@playwright\/test\/cli\.js test|vitest|scripts\/shot\.ts|scripts\/smoke\.ts|scripts\/spk4\.ts/i;

/** Lines of `ps -axo pid=,command=` (empty when ps fails). */
function psLines(): string[] {
  try {
    return execFileSync('ps', ['-axo', 'pid=,pcpu=,command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\n');
  } catch {
    return [];
  }
}

/** Test runners count as load even when their own process is idle (the browsers/workers do the work). */
const RUNNER_RE = /playwright test|@playwright\/test\/cli\.js test|vitest/i;

/** CPU share (%) from which a matching GPU job counts as active (an idle model server does not). */
export const ACTIVE_CPU_PCT = 2;

/**
 * Filters `ps` lines (`pid pcpu command`) for foreign GPU load; the own process tree (`ownPids`) and
 * the benchmark itself are ignored. GPU jobs count only while active (≥ {@link ACTIVE_CPU_PCT} % CPU),
 * test runners always. Exported for tests.
 */
export function contentionFrom(lines: readonly string[], ownPids: ReadonlySet<string>): string[] {
  const hits: string[] = [];
  for (const line of lines) {
    const m = /^\s*(\d+)\s+([\d.]+)\s+(.*)$/.exec(line);
    if (m === null || ownPids.has(m[1]!)) continue;
    const cmd = m[3]!;
    if (cmd.includes('scripts/bench.ts') || cmd.includes('fxbench') || cmd.startsWith('ps ')) continue;
    const hit = GPU_LOAD_RE.exec(cmd);
    // The matched keyword goes first: command lines of agent shells are long and get truncated.
    if (hit !== null && (RUNNER_RE.test(cmd) || Number(m[2]) >= ACTIVE_CPU_PCT)) hits.push(`${hit[0]} · ${cmd.slice(0, 100)}`);
  }
  return hits;
}

const OWN = new Set([String(process.pid), String(process.ppid)]);

/** Foreign GPU/browser load right now. */
export function gpuContention(): string[] {
  return contentionFrom(psLines(), OWN);
}

/** Busy processes (≥ 1 % CPU) of the usual suspects, noted in the report. */
export function concurrentLoad(): string[] {
  const hits: string[] = [];
  for (const line of psLines()) {
    const m = /^\s*(\d+)\s+([\d.]+)\s+(.*)$/.exec(line);
    if (m === null || OWN.has(m[1]!)) continue;
    const cmd = m[3]!;
    if (cmd.includes('scripts/bench.ts') || cmd.includes('fxbench')) continue;
    const hit = /playwright|vite|test:e2e|mlx|ms-playwright|vitest|tsc -b/i.exec(cmd);
    if (hit !== null && Number(m[2]) >= 1) hits.push(`${hit[0]} · ${m[2]} % · ${cmd.slice(0, 100)}`);
  }
  return hits;
}

/** GPU utilisation (%) from which the GPU counts as busy while the benchmark itself renders nothing. */
export const GPU_BUSY_PCT = 25;

/** Parses `"Device Utilization %"=NN` from `ioreg -c IOAccelerator` output (max over all GPUs); null if absent. */
export function parseGpuUtilization(ioreg: string): number | null {
  let best: number | null = null;
  for (const m of ioreg.matchAll(/"Device Utilization %"\s*=\s*(\d+)/g)) {
    const v = Number(m[1]);
    if (best === null || v > best) best = v;
  }
  return best;
}

/**
 * Current GPU utilisation of the machine (macOS IOAccelerator statistics), null where unavailable.
 * Catches GPU jobs whose command line the process filter does not know (e.g. other ML scripts).
 */
export function gpuUtilization(): number | null {
  if (process.platform !== 'darwin') return null;
  try {
    return parseGpuUtilization(execFileSync('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
  } catch {
    return null;
  }
}

/**
 * Foreign load while the benchmark renders nothing: known processes plus a busy GPU (≥ GPU_BUSY_PCT, two
 * samples 0.5 s apart to skip spikes).
 */
export async function idleContention(): Promise<string[]> {
  const hits = gpuContention();
  const u0 = gpuUtilization();
  if (u0 !== null && u0 >= GPU_BUSY_PCT) {
    await new Promise((r) => setTimeout(r, 500));
    const u1 = gpuUtilization();
    if (u1 !== null && u1 >= GPU_BUSY_PCT) hits.push(`GPU-Auslastung ${Math.min(u0, u1)} % ohne Benchmark`);
  }
  return hits;
}

/**
 * Waits (polling every 2 s) until no foreign GPU load is visible (processes and GPU utilisation; the
 * benchmark's own browser must be idle), at most `maxS` seconds. Returns the load still seen (empty = quiet).
 */
export async function waitQuiet(maxS: number, log: (s: string) => void): Promise<string[]> {
  const t0 = Date.now();
  let announced = false;
  let busy: string[] = [];
  while ((Date.now() - t0) / 1000 < maxS) {
    busy = await idleContention();
    if (busy.length === 0) return busy;
    if (!announced) {
      log(`  (waiting up to ${maxS} s for foreign GPU load to finish: ${busy[0]} …)`);
      announced = true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return busy;
}
