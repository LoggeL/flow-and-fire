/**
 * Validation benchmark of the marker editor (TRACK-EDITOR P3): measurement only, no gate
 * (DECISIONS 16).
 *
 *   pnpm --filter @faf/marker-editor bench
 *
 * Per shipped map (hollow-ridge, tessera, braidwater, setons), p50/p95 over RUNS runs:
 * - createTerrainAnalysis (slope, passability, components; target < 150 ms on Setons)
 * - validate with a cached analysis (a marker moved per run, as in the editor; target < 5 ms on
 *   Setons with ~120 markers)
 * - the first validate call of a fresh validator (analysis + rules)
 * Plus: Setons with 16 prop fields (≈ 30k props) – validate with a changed field per run (one
 * expansion) and with unchanged fields (cached) – and readRtsMap + writeRtsMap of setons.rtsmap.
 *
 * Writes apps/marker-editor/bench/results/validate-<timestamp>.json (gitignored).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRtsMap, writeRtsMap, type MapPropField, type RtsMap } from '@faf/formats';
import { createTerrainAnalysis, createValidator, fieldExpansionStats } from '../src/validate/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAPS_DIR = resolve(HERE, '../../../content/maps');
const MAP_NAMES = ['hollow-ridge', 'tessera', 'braidwater', 'setons'] as const;
const RUNS = 25;
const WARMUP = 3;
const ONE = 4096;

interface Stat {
  readonly runs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
}

function measure(fn: (run: number) => unknown, runs = RUNS): Stat {
  for (let i = 0; i < WARMUP; i++) fn(-1 - i);
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn(i);
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  const q = (p: number): number => Number(t[Math.min(t.length - 1, Math.floor(p * t.length))]!.toFixed(3));
  return { runs, p50Ms: q(0.5), p95Ms: q(0.95), minMs: Number(t[0]!.toFixed(3)), maxMs: Number(t[t.length - 1]!.toFixed(3)) };
}

const fmt = (s: Stat): string => `p50 ${s.p50Ms.toFixed(2)} ms · p95 ${s.p95Ms.toFixed(2)} ms`;

/** The same map with spot 0 moved by `run` raw units (new meta, same heights: like an editor drag). */
function nudged(map: RtsMap, run: number): RtsMap {
  const spots = map.meta.spots.map((s, k) => (k === 0 ? { ...s, x: s.x + ((run & 7) - 4) * 256 } : s));
  return { ...map, meta: { ...map.meta, spots } };
}

/** 4×4 circle fields (r = 110 WU) over the map, density 71 (≈ 30k props on Setons), half dryOnly + maxSlope. */
function gridFields(sizeWu: number): MapPropField[] {
  const out: MapPropField[] = [];
  const step = sizeWu / 4;
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const k = j * 4 + i;
      const strict = k % 2 === 1;
      out.push({
        name: `Feld ${k}`,
        kind: k % 3 === 0 ? 'rock' : 'tree',
        shape: { kind: 'circle', x: Math.round((i + 0.5) * step * ONE), z: Math.round((j + 0.5) * step * ONE), r: 110 * ONE },
        entries: [
          { id: 'core:tree_01', weight: 5 },
          { id: 'core:rock_01', weight: 1 },
        ],
        densityPerKWu2: 71,
        seed: 1000 + k,
        scaleMinPermille: 700,
        scaleMaxPermille: 1300,
        maxSlopePermille: strict ? 500 : 0,
        dryOnly: strict,
        reclaimMassMilli: 2500,
        reclaimEnergyMilli: 0,
      });
    }
  }
  return out;
}

const results: Record<string, unknown> = {};
console.log(`validate.bench – Node ${process.version}, ${cpus()[0]?.model ?? 'unknown CPU'}, ${RUNS} runs + ${WARMUP} warm-up`);

for (const name of MAP_NAMES) {
  const bytes = new Uint8Array(readFileSync(join(MAPS_DIR, `${name}.rtsmap`)));
  const map = readRtsMap(bytes);
  const analysis = createTerrainAnalysis(map);
  const analysisStat = measure(() => createTerrainAnalysis(map));
  const validate = createValidator();
  validate(map);
  const issues = validate(map);
  const validateStat = measure((run) => validate(nudged(map, run)));
  const firstStat = measure(() => createValidator()(map), 10);
  const markers = map.meta.starts.length + map.meta.spots.length;
  const counts = { errors: 0, warnings: 0, infos: 0 };
  for (const i of issues) counts[i.severity === 'error' ? 'errors' : i.severity === 'warning' ? 'warnings' : 'infos']++;
  results[name] = {
    sizeWu: map.meta.sizeWu,
    samples: analysis.dim * analysis.dim,
    markers,
    components: analysis.componentCount,
    passableSamples: analysis.passableCount,
    issues: counts,
    createTerrainAnalysis: analysisStat,
    validateCached: validateStat,
    validateFirstCall: firstStat,
    analysisBuilds: validate.analysisBuilds(),
  };
  console.log(
    `${name.padEnd(13)} ${map.meta.sizeWu} WU, ${markers} markers, ${analysis.componentCount} components | analysis ${fmt(analysisStat)} | validate (cached) ${fmt(validateStat)} | first call ${fmt(firstStat)} | issues ${counts.errors}E/${counts.warnings}W/${counts.infos}I`,
  );
}

// Setons with prop fields.
{
  const setons = readRtsMap(new Uint8Array(readFileSync(join(MAPS_DIR, 'setons.rtsmap'))));
  const fields = gridFields(setons.meta.sizeWu);
  const withFields: RtsMap = { ...setons, propFields: fields };
  const validate = createValidator();
  validate(withFields);
  const expansions0 = fieldExpansionStats.expansions;
  const cached = measure((run) => validate(nudged(withFields, run)));
  const cachedExpansions = fieldExpansionStats.expansions - expansions0;
  const changed = measure((run) => {
    const f = fields.slice();
    f[5] = { ...fields[5]!, seed: 5000 + run + WARMUP };
    return validate({ ...withFields, propFields: f });
  });
  let coverWarnings = 0;
  for (const i of validate(withFields)) if (i.code === 'field-covers-spot') coverWarnings++;
  results['setons+fields'] = {
    fields: fields.length,
    fieldCoverWarnings: coverWarnings,
    validateCachedFields: cached,
    expansionsDuringCachedRuns: cachedExpansions,
    validateOneChangedField: changed,
  };
  console.log(`setons+fields  16 fields | validate (fields cached) ${fmt(cached)} (${cachedExpansions} expansions) | one field changed ${fmt(changed)} | field-covers-spot ${coverWarnings}`);
}

// Setons read / write.
{
  const bytes = new Uint8Array(readFileSync(join(MAPS_DIR, 'setons.rtsmap')));
  const read = measure(() => readRtsMap(bytes));
  const map = readRtsMap(bytes);
  const write = measure(() => writeRtsMap(map));
  const both = measure(() => writeRtsMap(readRtsMap(bytes)));
  const out = writeRtsMap(map);
  const identical = out.length === bytes.length && out.every((b, i) => b === bytes[i]);
  results['setons-io'] = { bytes: bytes.length, identical, read, write, readWrite: both };
  console.log(`setons io      ${bytes.length} B | read ${fmt(read)} | write ${fmt(write)} | read+write ${fmt(both)} | byte-identical ${identical}`);
}

const outDir = join(HERE, 'results');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = join(outDir, `validate-${stamp}.json`);
writeFileSync(file, `${JSON.stringify({ node: process.version, cpu: cpus()[0]?.model ?? null, runs: RUNS, warmup: WARMUP, results }, null, 2)}\n`);
console.log(`→ ${file}`);
