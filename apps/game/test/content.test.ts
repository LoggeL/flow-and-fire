import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeSimBin } from '@faf/blueprints/simbin';
import { describe, expect, it } from 'vitest';
import { spawnSpreadWU, visualsFromViewJson } from '../src/content.ts';

const generated = resolve(import.meta.dirname, '../../../content/generated');

describe('content glue', () => {
  it('view.json → one visual per blueprint sim id (placeholder spec for the renderer)', () => {
    const visuals = visualsFromViewJson(readFileSync(resolve(generated, 'view.json'), 'utf8'));
    const bp = decodeSimBin(new Uint8Array(readFileSync(resolve(generated, 'sim.bin'))));
    expect(visuals).toHaveLength(bp.ids.length);
    const cube = bp.indexOf('core:cube');
    expect(cube).toBeGreaterThanOrEqual(0);
    const v = visuals[cube]!;
    expect(v.spec.hull).toBe('box');
    expect(v.spec.size.every((s) => s > 0)).toBe(true);
  });

  it('spawn spread leaves ≈ 4.5 WU² per cube, at least 3 WU', () => {
    expect(spawnSpreadWU(1)).toBe(3);
    const r = spawnSpreadWU(1000);
    expect((Math.PI * r * r) / 1000).toBeGreaterThan(4);
    expect((Math.PI * r * r) / 1000).toBeLessThan(5);
  });
});
