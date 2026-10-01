import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseViewJson } from '@faf/blueprints/view';
import { findUnit, unitText } from '@faf/hud';
import { describe, expect, it } from 'vitest';
import { hudTypeId } from '../src/hud/type-ids.ts';
import { liveUnitText } from '../src/hud/unit-text.ts';

const repo = resolve(import.meta.dirname, '../../..');
describe('live unit text outside the design roster', () => {
  it('labels the real heavy assault tank as Bulwark/Bollwerk without a siege-bot alias', () => {
    expect(findUnit('core:lnd_t3_heavy')).toBeUndefined();
    expect(hudTypeId('core:lnd_t3_heavy')).toBe('core:lnd_t3_heavy');
    expect(liveUnitText('core:lnd_t3_heavy', 'name', 'en')).toBe('Bulwark');
    expect(liveUnitText('core:lnd_t3_heavy', 'name', 'de')).toBe('Bollwerk');
    expect(liveUnitText('core:lnd_t3_heavy', 'desc', 'en')).toBe('Heavy assault tank: slow, massive and hard to push aside.');
    expect(liveUnitText('core:lnd_t3_heavy', 'role', 'en')).toBe('Unit');
    expect(liveUnitText('core:lnd_t3_heavy', 'role', 'de')).toBe('Einheit');
    expect(liveUnitText('core:lnd_t3_heavy', 'name', 'en')).not.toBe(unitText('core:lnd_t3_bot', 'name', 'en'));
  });

  it('handles the actual Cube/Würfel placeholder and never invents missing metadata', () => {
    expect(liveUnitText('core:cube', 'name', 'en')).toBe('Cube');
    expect(liveUnitText('cube', 'name', 'de')).toBe('Würfel');
    expect(liveUnitText('core:cube', 'desc', 'en')).toBe('Test unit of the test plane (MS1 placeholder).');
    expect(liveUnitText('core:cube', 'adjacency', 'en')).toBe('');
    expect(liveUnitText('missing:unit', 'name', 'en')).toBe('Unit');
    expect(liveUnitText('missing:unit', 'role', 'de')).toBe('Einheit');
    expect(liveUnitText('missing:unit', 'desc', 'en')).toBe('');
  });

  it('preserves known design text and all explicit Sim-to-HUD aliases', () => {
    for (const id of ['core:cmd_commander', 'core:eng_t1', 'core:fac_land_t1', 'core:str_t1_estorage']) {
      for (const locale of ['en', 'de', 'pseudo'] as const) {
        for (const field of ['name', 'role', 'desc', 'short', 'adjacency'] as const) {
          expect(liveUnitText(id, field, locale)).toBe(unitText(hudTypeId(id), field, locale));
        }
      }
    }
  });

  it('covers every compiled unit absent from the roster using its actual compiled locale keys', () => {
    const view = parseViewJson(readFileSync(resolve(repo, 'content/generated/view.json'), 'utf8'));
    const missing = view.visuals.filter(v => findUnit(hudTypeId(v.id)) === undefined);
    expect(missing.map(v => v.id)).toEqual([
      'core:cmd_commander_armored',
      'core:cmd_commander_engineering',
      'core:cube',
      'core:lnd_t3_heavy',
    ]);
    for (const locale of ['en', 'de'] as const) {
      const actual = JSON.parse(readFileSync(resolve(repo, `content/locales/${locale}.json`), 'utf8')) as Record<string, string>;
      for (const visual of missing) {
        expect(liveUnitText(visual.id, 'name', locale)).toBe(actual[visual.nameKey]);
        expect(liveUnitText(visual.id, 'desc', locale)).toBe(actual[visual.descKey]);
      }
    }
  });

  it('supports pseudo locale while retaining the bounded short-label contract', () => {
    expect(liveUnitText('core:lnd_t3_heavy', 'name', 'pseudo')).toContain('Ɓóľľŵéŕķ');
    expect(liveUnitText('core:lnd_t3_heavy', 'short', 'pseudo')).toHaveLength(8);
    expect(liveUnitText('core:cube', 'adjacency', 'pseudo')).toBe('');
  });
});
