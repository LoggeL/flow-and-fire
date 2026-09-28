import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import plugin from '../src/index.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
});

const SIM_FILE = 'packages/sim/src/world.ts';
const OPTIONS = [{ sqrtAllow: ['packages/fixed/src/isqrt.ts'], float64Allow: ['packages/heap/src/safeint.ts'] }];

type Case = { code: string; filename?: string; errors: { messageId: string }[] };

function inv(code: string, ...messageIds: string[]): Case {
  return { code, errors: messageIds.map((messageId) => ({ messageId })) };
}

const invalid: Case[] = [
  // Math
  inv('const a = Math.sin(x);', 'mathMember'),
  inv('const a = Math.cos(x);', 'mathMember'),
  inv('const a = Math.round(x);', 'mathMember'),
  inv('const a = Math.pow(x, 2);', 'mathMember'),
  inv('const a = Math.PI;', 'mathMember'),
  inv('const a = Math.sqrt(x);', 'mathSqrt'),
  inv('const a = Math.random();', 'mathRandom'),
  inv('const m = Math;', 'mathAlias'),
  inv('const a = Math[name](x);', 'mathAlias'),
  inv('const a = globalThis.Math.random();', 'mathRandom'),
  // Wall clock / timers
  inv('const t = Date.now();', 'date'),
  inv('const t = new Date();', 'date'),
  inv('const t = globalThis.Date.now();', 'date'),
  inv('const t = performance.now();', 'performance'),
  inv('setTimeout(tick, 0);', 'timer'),
  inv('setInterval(tick, 100);', 'timer'),
  inv('setImmediate(tick);', 'timer'),
  inv('queueMicrotask(tick);', 'timer'),
  inv('requestAnimationFrame(tick);', 'timer'),
  inv('self.setTimeout(tick, 0);', 'timer'),
  // async
  inv('async function f() {}', 'async'),
  inv('const f = async () => 1;', 'async'),
  inv('const o = { async m() {} };', 'async'),
  inv('async function f() { await g(); }', 'async', 'await'),
  inv('async function f() { for await (const x of xs) use(x); }', 'async', 'await'),
  // iteration / operators
  inv('for (const k in obj) use(k);', 'forIn'),
  inv('const a = b ** 2;', 'pow'),
  inv('let a = 2; a **= 2;', 'pow'),
  // Collections as state
  inv('const m = new Map();', 'collection'),
  inv('const s = new Set();', 'collection'),
  inv('const w = new WeakMap();', 'collection'),
  inv('const w = new WeakSet();', 'collection'),
  inv('const r = new WeakRef(obj);', 'collection'),
  inv('const r = new FinalizationRegistry(cb);', 'collection'),
  inv('const g = Map.groupBy(xs, f);', 'collection'),
  // sort
  inv('arr.sort();', 'sortNoComparator'),
  inv('const b = arr.toSorted();', 'sortNoComparator'),
  // floats
  inv('const f = new Float32Array(4);', 'float32'),
  inv('const f = new Float64Array(4);', 'float64'),
  inv('const x = 1.5;', 'floatLiteral'),
  inv('const x = -0.25;', 'floatLiteral'),
  inv('const x = 1e-3;', 'floatLiteral'),
  inv('const x = scale(1.5);', 'floatLiteral'),
  inv('const x = fx(1.5, 2.5);', 'floatLiteral', 'floatLiteral'),
  inv('const x = fx(a * 1.5);', 'floatLiteral'),
  // locale
  inv("const c = a.localeCompare(b);", 'locale'),
  inv('const s = n.toLocaleString();', 'locale'),
  inv('const s = d.toLocaleDateString();', 'locale'),
  inv('const f = new Intl.NumberFormat();', 'intl'),
  // imports
  inv("import { Renderer } from '@faf/render';", 'forbiddenImport'),
  inv("import type { Ui } from '@faf/client';", 'forbiddenImport'),
  inv("import { brain } from '@faf/ai/brain';", 'forbiddenImport'),
  inv("export { host } from '@faf/sim-host';", 'forbiddenImport'),
  inv("export * from '@faf/render';", 'forbiddenImport'),
  inv("const m = import('@faf/client');", 'forbiddenImport'),
];

const valid: { code: string; filename?: string }[] = [
  { code: 'const a = Math.imul(x, y) >> 12;' },
  { code: 'const a = Math.floor(x / 4096) + Math.trunc(y) + Math.min(a, b) + Math.max(a, b);' },
  { code: 'const a = Math.abs(x) + Math.sign(y) + Math.clz32(z);' },
  { code: 'const x = fx(1.5);' },
  { code: 'const x = fx(-0.25);' },
  { code: 'const x = fxSmall(0.5);' },
  { code: 'const a = deg(22.5);' },
  { code: 'const n = 4096; const m = 0x7fffffff; const k = -3; const big = 1e6;' },
  { code: 'arr.sort((a, b) => a - b);' },
  { code: 'const b = arr.toSorted((a, b) => a - b);' },
  { code: 'const v = new Int32Array(8); const u = new Uint8Array(4);' },
  { code: 'function f(x: Float32Array, m: Map<number, number>): void { void x; void m; }' },
  { code: 'type T = Set<number>;' },
  { code: 'function Map2() {} const s = { Date: 1 }; const d = s.Date;' },
  { code: 'function f(Date: number) { return Date + 1; }' },
  { code: 'for (const x of xs) use(x);' },
  { code: "import { fxMul } from '@faf/fixed';" },
  { code: "import { Units } from '@faf/heap';" },
  { code: 'const r = Math.sqrt(n);', filename: 'packages/fixed/src/isqrt.ts' },
  { code: 'const f = new Float64Array(8);', filename: 'packages/heap/src/safeint.ts' },
];

tester.run('sim/determinism', plugin.rules.determinism, {
  valid: valid.map((v) => ({ code: v.code, filename: v.filename ?? SIM_FILE, options: OPTIONS })),
  invalid: invalid.map((c) => ({
    code: c.code,
    filename: c.filename ?? SIM_FILE,
    options: OPTIONS,
    errors: c.errors,
  })),
});
