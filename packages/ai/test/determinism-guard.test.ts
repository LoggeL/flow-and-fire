/**
 * Determinism guard for the AI (ai.md §2.5) over packages/ai/src/** and tools/ai-arena/src/**:
 * only IEEE-exact Math functions, no Math.random, no exponent operator, no wall clock/timers outside
 * the allowlist, no for…in, no sort() without comparator.
 *
 * Allowlist: wall clock only in packages/ai/src/host/clock.ts and tools/ai-arena/src/bench/**;
 * Math.log10 only in tools/ai-arena/src/stats/** (Elo report number).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './support/fixtures.ts';

const ALLOWED_MATH = new Set(['sqrt', 'floor', 'ceil', 'round', 'trunc', 'min', 'max', 'abs', 'sign', 'imul', 'clz32']);
const WALL_CLOCK_ALLOW = [/^packages\/ai\/src\/host\/clock\.ts$/, /^tools\/ai-arena\/src\/bench\//];
const LOG10_ALLOW = [/^tools\/ai-arena\/src\/stats\//];

/** Replaces comments and string/template literal contents with spaces (keeps line structure). */
export function stripCode(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  ';
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      out += c;
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly text: string;
}

/** Checks one file (path relative to the repo root, forward slashes). */
export function scanSource(file: string, src: string): Violation[] {
  const out: Violation[] = [];
  const code = stripCode(src);
  const lines = code.split('\n');
  const orig = src.split('\n');
  const clockOk = WALL_CLOCK_ALLOW.some((r) => r.test(file));
  const log10Ok = LOG10_ALLOW.some((r) => r.test(file));
  const add = (line: number, rule: string): void => {
    out.push({ file, line: line + 1, rule, text: (orig[line] ?? '').trim() });
  };
  for (let l = 0; l < lines.length; l++) {
    const t = lines[l]!;
    for (const m of t.matchAll(/\bMath\s*\.\s*([A-Za-z0-9_$]+)/g)) {
      const fn = m[1]!;
      if (ALLOWED_MATH.has(fn)) continue;
      if (fn === 'log10' && log10Ok) continue;
      add(l, `Math.${fn}`);
    }
    if (/\*\*(?!\/)/.test(t.replace(/\/\*\*/g, ''))) add(l, 'exponent operator');
    if (!clockOk) {
      if (/\bDate\b/.test(t)) add(l, 'Date');
      if (/\bperformance\b/.test(t)) add(l, 'performance');
      if (/\b(setTimeout|setInterval|setImmediate|requestAnimationFrame|queueMicrotask|hrtime)\b/.test(t)) add(l, 'timer');
    }
    if (/\bfor\s*\(\s*(?:const|let|var)?\s*[A-Za-z_$][\w$]*\s+in\b/.test(t)) add(l, 'for…in');
    if (/\.sort\(\s*\)/.test(t)) add(l, 'sort() without comparator');
  }
  return out;
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
}

describe('determinism guard (ai.md §2.5)', () => {
  it('the scanner catches every forbidden construct', () => {
    const bad = [
      'const a = Math.random();',
      'const b = Math.pow(2, 3) + Math.sin(1) + Math.hypot(1, 2) + Math.log(2) + Math.atan2(1, 1) + Math.cbrt(8);',
      'const c = 2 ** 8;',
      'const d = Date.now();',
      'const e = performance.now();',
      'setTimeout(() => 0, 1);',
      'for (const k in obj) {}',
      'arr.sort();',
      'const f = Math.log10(5);',
    ].join('\n');
    const v = scanSource('packages/ai/src/x.ts', bad);
    expect(v.map((x) => x.rule)).toEqual([
      'Math.random',
      'Math.pow',
      'Math.sin',
      'Math.hypot',
      'Math.log',
      'Math.atan2',
      'Math.cbrt',
      'exponent operator',
      'Date',
      'performance',
      'timer',
      'for…in',
      'sort() without comparator',
      'Math.log10',
    ]);
    const ok = [
      '/** Math.random in a doc comment, 2 ** 3 */',
      "const s = 'Math.pow(Date.now())';",
      'const r = Math.sqrt(Math.floor(x) + Math.imul(a, b));',
      'arr.sort((a, b) => a - b);',
      'for (const k of list) {}',
    ].join('\n');
    expect(scanSource('packages/ai/src/y.ts', ok)).toEqual([]);
    expect(scanSource('tools/ai-arena/src/stats/elo.ts', 'Math.log10(p)')).toEqual([]);
    expect(scanSource('tools/ai-arena/src/bench/run.ts', 'performance.now()')).toEqual([]);
    expect(scanSource('packages/ai/src/host/clock.ts', 'performance.now()')).toEqual([]);
  });

  it('packages/ai/src and tools/ai-arena/src are clean', () => {
    const root = repoRoot();
    const files: string[] = [];
    for (const dir of ['packages/ai/src', 'tools/ai-arena/src']) {
      const abs = join(root, dir);
      if (existsSync(abs)) walk(abs, files);
    }
    expect(files.length).toBeGreaterThan(10);
    const violations: Violation[] = [];
    for (const f of files) {
      const rel = relative(root, f).split('\\').join('/');
      violations.push(...scanSource(rel, readFileSync(f, 'utf8')));
    }
    expect(violations).toEqual([]);
  });
});
