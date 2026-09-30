/**
 * Prop field benchmark (TRACK-EDITOR P0): measurement only, no gate (DECISIONS 16).
 *
 *   pnpm --filter @faf/formats bench
 *
 * - expandPropFields on the Setons heights (1024 WU) with ≈ 30,000 and ≈ 65,000 props
 *   (16 fields, half of them dryOnly + maxSlope; the density is searched once so the total lands
 *   just below the target), p50/p95 over RUNS runs, plus the count-only validation pass
 * - PFLD encode / decode with MAP_MAX_PROP_FIELDS (256) fields
 * - readRtsMap + writeRtsMap of setons.rtsmap (legacy, no PFLD) and with the 65k fields
 *
 * Writes packages/formats/bench/results/propfields-<timestamp>.json (gitignored).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodePropFieldsChunk,
  encodePropFieldsChunk,
  expandPropFields,
  MAP_MAX_PROP_FIELDS,
  readRtsMap,
  validatePropFields,
  writeRtsMap,
  type MapPropField,
  type RtsMap,
} from '../src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SETONS = resolve(HERE, '../../../content/maps/setons.rtsmap');
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

function measure(fn: () => unknown, runs = RUNS): Stat {
  for (let i = 0; i < WARMUP; i++) fn();
  const t: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  const q = (p: number): number => Number(t[Math.min(t.length - 1, Math.floor(p * t.length))]!.toFixed(3));
  return { runs, p50Ms: q(0.5), p95Ms: q(0.95), minMs: Number(t[0]!.toFixed(3)), maxMs: Number(t[t.length - 1]!.toFixed(3)) };
}

/** 4×4 circle fields (r = 110 WU) over the map; odd ones dryOnly + maxSlope 500 ‰. */
function gridFields(sizeWu: number, density: number): MapPropField[] {
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
          { id: 'core:tree_02', weight: 3 },
          { id: 'core:rock_01', weight: 1 },
        ],
        densityPerKWu2: density,
        seed: 1000 + k,
        scaleMinPermille: 700,
        scaleMaxPermille: 1300,
        maxSlopePermille: strict ? 500 : 0,
        dryOnly: strict,
        reclaimMassMilli: 1500,
        reclaimEnergyMilli: 4000,
      });
    }
  }
  return out;
}

/** Largest density whose expansion stays <= target (monotone in practice; binary search). */
function fieldsForTarget(base: RtsMap, target: number): { fields: MapPropField[]; count: number } {
  let lo = 1;
  let hi = 4096;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const n = expandPropFields({ ...base, propFields: gridFields(base.meta.sizeWu, mid) }).length;
    if (n <= target) lo = mid;
    else hi = mid - 1;
  }
  const fields = gridFields(base.meta.sizeWu, lo);
  return { fields, count: expandPropFields({ ...base, propFields: fields }).length };
}

function fields256(): MapPropField[] {
  const out: MapPropField[] = [];
  for (let k = 0; k < MAP_MAX_PROP_FIELDS; k++) {
    const cx = (64 + (k % 16) * 56) * ONE;
    const cz = (64 + Math.floor(k / 16) * 56) * ONE;
    const shape: MapPropField['shape'] =
      k % 2 === 0
        ? { kind: 'circle', x: cx, z: cz, r: 20 * ONE }
        : {
            kind: 'polygon',
            points: Array.from({ length: 32 }, (_, i) => ({
              x: cx + Math.round(Math.cos((i * Math.PI) / 16) * 20 * ONE),
              z: cz + Math.round(Math.sin((i * Math.PI) / 16) * 20 * ONE),
            })),
          };
    out.push({
      name: `Feld Nummer ${k}`,
      kind: k % 3 === 0 ? 'wreck' : 'tree',
      shape,
      entries: [
        { id: 'core:tree_01', weight: 3 },
        { id: 'core:tree_02', weight: 2 },
        { id: 'core:rock_01', weight: 1 },
        { id: 'core:wreck_small', weight: 1 },
      ],
      densityPerKWu2: 4,
      seed: k,
      scaleMinPermille: 800,
      scaleMaxPermille: 1200,
      maxSlopePermille: 0,
      dryOnly: false,
      reclaimMassMilli: 1000,
      reclaimEnergyMilli: 0,
    });
  }
  return out;
}

function main(): void {
  const setonsBytes = new Uint8Array(readFileSync(SETONS));
  const setons = readRtsMap(setonsBytes);
  const result: Record<string, unknown> = {
    bench: 'propfields',
    date: new Date().toISOString(),
    node: process.version,
    cpu: cpus()[0]?.model ?? 'unknown',
    runs: RUNS,
    map: { name: 'setons', sizeWu: setons.meta.sizeWu, props: setons.props.length, bytes: setonsBytes.length },
  };

  const expansion: Record<string, unknown>[] = [];
  let big: RtsMap | null = null;
  for (const target of [30_000, 65_000]) {
    const { fields, count } = fieldsForTarget(setons, Math.min(target, 65_536 - setons.props.length));
    const m: RtsMap = { ...setons, propFields: fields };
    const expand = measure(() => expandPropFields(m));
    const validate = measure(() => validatePropFields(m));
    expansion.push({ target, props: count, fields: fields.length, densityPerKWu2: fields[0]!.densityPerKWu2, expand, validate });
    console.log(`[propfields] expand ${count} props (${fields.length} fields, density ${fields[0]!.densityPerKWu2}): p50 ${expand.p50Ms} ms, p95 ${expand.p95Ms} ms; validate p50 ${validate.p50Ms} ms`);
    big = m;
  }
  result['expansion'] = expansion;

  const f256 = fields256();
  const chunk = encodePropFieldsChunk(f256);
  const encode = measure(() => encodePropFieldsChunk(f256));
  const decode = measure(() => decodePropFieldsChunk(chunk, 0));
  result['codec256'] = { fields: f256.length, bytes: chunk.length, encode, decode };
  console.log(`[propfields] PFLD 256 fields (${chunk.length} B): encode p50 ${encode.p50Ms} ms, decode p50 ${decode.p50Ms} ms`);

  const bigBytes = writeRtsMap(big!);
  const legacyRead = measure(() => readRtsMap(setonsBytes));
  const legacyWrite = measure(() => writeRtsMap(setons));
  const fieldsRead = measure(() => readRtsMap(bigBytes));
  const fieldsWrite = measure(() => writeRtsMap(big!));
  result['rtsmap'] = {
    legacy: { bytes: setonsBytes.length, read: legacyRead, write: legacyWrite },
    with65kFields: { bytes: bigBytes.length, read: fieldsRead, write: fieldsWrite },
  };
  console.log(`[propfields] setons read p50 ${legacyRead.p50Ms} ms / write p50 ${legacyWrite.p50Ms} ms; with 65k fields read p50 ${fieldsRead.p50Ms} ms / write p50 ${fieldsWrite.p50Ms} ms`);

  const dir = join(HERE, 'results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `propfields-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`[propfields] wrote ${file}`);
}

main();
