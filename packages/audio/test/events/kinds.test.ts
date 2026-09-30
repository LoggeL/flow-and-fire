import { describe, expect, it } from 'vitest';
import {
  ALERT_KINDS,
  DEFAULT_EVENT_TYPES,
  DEFAULT_EVENT_TYPE_TABLE,
  SIM_EVENT_KINDS,
  SIM_EVENT_KIND_INFO,
  alertKindIndex,
  isSimEventKind,
} from '../../src/events/index.ts';
import { loadRealManifest } from '../support/manifest.ts';

describe('sim event kinds', () => {
  it('contains at least the kinds required by the plan, without duplicates', () => {
    const required = [
      'weaponFire',
      'projectileImpact',
      'unitDeath',
      'commanderDeath',
      'buildStart',
      'buildComplete',
      'reclaimStart',
      'reclaimComplete',
      'factoryRollOff',
      'unitRollOff',
      'shieldHit',
      'shieldCollapse',
      'shieldRestore',
      'overchargeFire',
      'tapshot',
      'radarContact',
      'massStall',
      'energyStall',
      'alert',
    ];
    for (const k of required) expect(isSimEventKind(k), k).toBe(true);
    expect(new Set(SIM_EVENT_KINDS).size).toBe(SIM_EVENT_KINDS.length);
    expect(isSimEventKind('laserFire')).toBe(false);
    expect(isSimEventKind('toString')).toBe(false);
  });

  it('DEFAULT_EVENT_TYPE_TABLE is a bijection 1..n ↔ kinds', () => {
    const entries = Object.entries(DEFAULT_EVENT_TYPE_TABLE);
    expect(entries.length).toBe(SIM_EVENT_KINDS.length);
    const types = entries.map(([t]) => Number(t)).sort((a, b) => a - b);
    expect(types).toEqual(SIM_EVENT_KINDS.map((_, i) => i + 1));
    expect(new Set(entries.map(([, k]) => k)).size).toBe(entries.length);
    for (const k of SIM_EVENT_KINDS) expect(DEFAULT_EVENT_TYPE_TABLE[DEFAULT_EVENT_TYPES[k]]).toBe(k);
    expect(DEFAULT_EVENT_TYPE_TABLE[0]).toBeUndefined();
    // Fits the u16 type field of Event 32 B.
    expect(Math.max(...types)).toBeLessThan(65536);
  });

  it('documents visual/aux/flags/pos/handle for every kind', () => {
    for (const k of SIM_EVENT_KINDS) {
      const info = SIM_EVENT_KIND_INFO[k];
      for (const field of ['meaning', 'visual', 'aux', 'flags', 'pos', 'handle', 'milestone'] as const) {
        expect(info[field].length, `${k}.${field}`).toBeGreaterThan(0);
      }
      expect(info.milestone).toMatch(/^MS\d+$/);
    }
    expect(Object.keys(SIM_EVENT_KIND_INFO).sort()).toEqual([...SIM_EVENT_KINDS].sort());
  });

  it('ALERT_KINDS lists all 11 alt_* sounds with dense indices', () => {
    const manifest = loadRealManifest();
    const alertNames = manifest.sounds.filter((s) => s.category === 'alert').map((s) => s.name).sort();
    expect(alertNames.length).toBe(11);
    expect(ALERT_KINDS.map((a) => a.name).sort()).toEqual(alertNames);
    ALERT_KINDS.forEach((a, i) => {
      expect(a.index).toBe(i);
      expect(alertKindIndex(a.name)).toBe(i);
    });
    expect(alertKindIndex('alt_nope')).toBe(-1);
  });
});
