import { describe, expect, it } from 'vitest';
import { DEFAULT_EVENT_MAP_JSON, parseEventSoundMap, resolveSoundId, validateEventSoundMap, type ManifestLike } from '../../src/events/index.ts';
import { loadRealManifest } from '../support/manifest.ts';

function base(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(DEFAULT_EVENT_MAP_JSON)) as Record<string, unknown>;
}

const manifest = loadRealManifest();

describe('resolveSoundId', () => {
  const ids = new Set(['varkan:x', 'common:x', 'common:y', 'other:z']);
  it('prefers <faction>:<name>, falls back to common:<name>, exact for fq-ids', () => {
    expect(resolveSoundId(ids, 'x', 'varkan')).toBe('varkan:x');
    expect(resolveSoundId(ids, 'x', 'other')).toBe('common:x');
    expect(resolveSoundId(ids, 'y', 'varkan')).toBe('common:y');
    expect(resolveSoundId(ids, 'z', 'varkan')).toBeNull();
    expect(resolveSoundId(ids, 'other:z', 'varkan')).toBe('other:z');
    expect(resolveSoundId(ids, 'varkan:y', 'varkan')).toBeNull();
  });
});

describe('validateEventSoundMap', () => {
  it('reports sounds that resolve neither in the faction nor in common', () => {
    const m = base();
    (m.kinds as Record<string, unknown>).buildStart = { route: 'sfx', sound: 'bld_nope' };
    const issues = validateEventSoundMap(parseEventSoundMap(m), manifest, ['varkan']);
    expect(issues).toEqual([
      { path: '$.kinds.buildStart.sound', message: "sound 'bld_nope' not resolvable for faction 'varkan' (neither 'varkan:bld_nope' or 'common:bld_nope' in the manifest)" },
    ]);
  });

  it('checks every faction: faction-only sounds fail for a faction without own files', () => {
    const map = parseEventSoundMap(DEFAULT_EVENT_MAP_JSON);
    const issues = validateEventSoundMap(map, manifest, ['varkan', 'nova']);
    // Every varkan-only sound fails for 'nova'; common sounds (impacts, alerts) resolve for both.
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.message.includes("faction 'nova'"))).toBe(true);
    expect(issues.some((i) => i.path === '$.kinds.projectileImpact')).toBe(false);
    expect(issues.some((i) => i.path.startsWith('$.alerts'))).toBe(false);
    expect(issues.some((i) => i.path === '$.weapons.core:wpn_cannon_t1')).toBe(true);
  });

  it('flags loops used as one-shots, non-loops used as burst loops and misused alert sounds', () => {
    const m = base();
    (m.kinds as Record<string, unknown>).buildStart = { route: 'sfx', sound: 'bld_pour_loop' };
    (m.weapons as Record<string, unknown>)['core:wpn_gatling_t2'] = {
      sound: 'wpn_mg_t1_fire',
      burst: { loop: 'wpn_gatling_t2_spin', holdMs: 250 },
    };
    (m.kinds as Record<string, unknown>).radarContact = { route: 'sfx', sound: 'alt_gong' };
    (m.alerts as Record<string, unknown>).alt_gong = { sound: 'ui_click' };
    const issues = validateEventSoundMap(parseEventSoundMap(m), manifest, ['varkan']);
    const messages = issues.map((i) => `${i.path}: ${i.message}`);
    expect(messages).toContain("$.kinds.buildStart.sound: 'varkan:bld_pour_loop' is a loop sound but is used as a one-shot");
    expect(messages).toContain("$.weapons.core:wpn_gatling_t2.burst.loop: 'varkan:wpn_gatling_t2_spin' is used as a loop but has no loop points");
    expect(messages).toContain("$.kinds.radarContact.sound: alert sound 'common:alt_gong' used outside $.alerts (route alerts through the queue)");
    expect(messages).toContain("$.alerts.alt_gong: 'common:ui_click' is used as an alert but has category 'ui'");
  });

  it('reports unknown and unmapped weapon refs against a known list', () => {
    const map = parseEventSoundMap(DEFAULT_EVENT_MAP_JSON);
    const refs = Object.keys(map.weapons).filter((r) => r !== 'core:wpn_mg_t1');
    refs.push('core:wpn_new_gun');
    const issues = validateEventSoundMap(map, manifest, ['varkan'], { weaponRefs: refs });
    expect(issues).toEqual([
      { path: '$.weapons.core:wpn_mg_t1', message: "unknown weapon ref 'core:wpn_mg_t1'" },
      { path: '$.weapons', message: "weapon ref 'core:wpn_new_gun' is not mapped" },
    ]);
  });

  it('works on a synthetic manifest with faction overrides and requires factions', () => {
    const synthetic: ManifestLike = {
      sounds: manifest.sounds.map((s) => ({ id: s.id, category: s.category, loop: s.loop })),
    };
    const map = parseEventSoundMap(DEFAULT_EVENT_MAP_JSON);
    expect(validateEventSoundMap(map, synthetic, ['varkan'])).toEqual([]);
    expect(validateEventSoundMap(map, synthetic, [])).toEqual([{ path: '$', message: 'no factions given to validate against' }]);
  });
});
