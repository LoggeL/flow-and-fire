import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EVENT_MAP_JSON,
  DEFAULT_EVENT_SOUND_MAP,
  EVENT_FLAG_AIR,
  EVENT_FLAG_STRUCTURE,
  EventMapError,
  SIM_EVENT_KINDS,
  alertForIndex,
  collapseAfterDeath,
  deathSound,
  impactFamilyOf,
  impactSound,
  parseEventSoundMap,
  weaponSound,
  withWeaponSounds,
} from '../../src/events/index.ts';

/** Deep copy of the default JSON for mutation. */
function base(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(DEFAULT_EVENT_MAP_JSON)) as Record<string, unknown>;
}

function kinds(m: Record<string, unknown>): Record<string, unknown> {
  return m.kinds as Record<string, unknown>;
}

function expectError(json: unknown, path: string, message?: RegExp): void {
  let err: unknown = null;
  try {
    parseEventSoundMap(json);
  } catch (e) {
    err = e;
  }
  expect(err, `expected EventMapError at ${path}`).toBeInstanceOf(EventMapError);
  expect((err as EventMapError).path).toBe(path);
  expect((err as Error).message.startsWith(`${path}: `)).toBe(true);
  if (message) expect((err as Error).message).toMatch(message);
}

describe('parseEventSoundMap', () => {
  it('parses the default map into the normalized form', () => {
    const m = DEFAULT_EVENT_SOUND_MAP;
    expect(m.version).toBe(1);
    expect(Object.keys(m.kinds).sort()).toEqual([...SIM_EVENT_KINDS].sort());
    expect(m.kinds.buildStart).toEqual({ route: 'sfx', sound: 'bld_start', spatial: true, gainDb: 0, rate: 1, then: null, alert: null });
    expect(m.kinds.buildComplete.then).toEqual({ sound: 'sig_bell_small', gainDb: 0, rate: 1, delayMs: 350 });
    expect(m.kinds.energyStall).toMatchObject({ spatial: false, alert: 'alt_energy_stall' });
    expect(m.kinds.weaponFire.sound).toBeNull();
    expect(m.kinds.reclaimStart.route).toBe('ignore');
    expect(m.kinds.massStall).toMatchObject({ route: 'alert', sound: 'alt_mass_stall' });
    expect(m.commanderDeath).toEqual({ sound: 'exp_commander', gainDb: 0, rate: 1 });
    expect(m.alerts.alt_base_attacked).toEqual({ sound: 'alt_base_attacked', repeatMs: null, radiusWu: 64 });
    expect(m.weapons['core:wpn_gatling_t2']!.burst).toEqual({ loop: 'wpn_gatling_t2_loop', spin: 'wpn_gatling_t2_spin', holdMs: 250, gainDb: 0 });
  });

  it('is deterministic and does not keep references into the input', () => {
    const json = base();
    const a = parseEventSoundMap(json);
    ((json.weapons as Record<string, Record<string, unknown>>)['core:wpn_cannon_t1']!).sound = 'changed';
    expect(a.weapons['core:wpn_cannon_t1']!.sound).toBe('wpn_cannon_t1_fire');
    expect(parseEventSoundMap(DEFAULT_EVENT_MAP_JSON)).toEqual(DEFAULT_EVENT_SOUND_MAP);
  });

  it('fills kinds missing in the JSON with route ignore', () => {
    const m = base();
    delete kinds(m).tapshot;
    expect(parseEventSoundMap(m).kinds.tapshot.route).toBe('ignore');
  });

  it('accepts shorthands and fq-ids', () => {
    const m = base();
    (m.weapons as Record<string, unknown>)['mod:wpn_x'] = 'common:imp_bomb';
    m.weaponDefault = { sound: 'wpn_cannon_t1_fire', gainDb: -6 };
    const p = parseEventSoundMap(m);
    expect(p.weapons['mod:wpn_x']).toEqual({ sound: 'common:imp_bomb', gainDb: 0, rate: 1, impact: 'shell', burst: null });
    expect(p.weaponDefault).toEqual({ sound: 'wpn_cannon_t1_fire', gainDb: -6, rate: 1 });
  });

  it('rejects structural problems with the JSON path', () => {
    expectError(null, '$', /expected an object/);
    expectError([], '$', /expected an object, got an array/);
    expectError({ ...base(), version: 2 }, '$.version', /expected 1/);
    expectError({ ...base(), extra: 1 }, '$.extra', /unknown property/);
    expectError({ ...base(), kinds: 'x' }, '$.kinds', /expected an object/);
  });

  it('rejects unknown kinds and bad rules', () => {
    const unknownKind = base();
    kinds(unknownKind).laserFire = { route: 'sfx', sound: 'x' };
    expectError(unknownKind, '$.kinds.laserFire', /unknown event kind/);

    const badRoute = base();
    kinds(badRoute).buildStart = { route: 'loud', sound: 'bld_start' };
    expectError(badRoute, '$.kinds.buildStart.route', /'sfx' \| 'alert' \| 'ignore'/);

    const noSound = base();
    kinds(noSound).buildStart = { route: 'sfx' };
    expectError(noSound, '$.kinds.buildStart.sound', /required/);

    const tableSound = base();
    kinds(tableSound).weaponFire = { route: 'sfx', sound: 'wpn_cannon_t1_fire' };
    expectError(tableSound, '$.kinds.weaponFire.sound', /from a table/);

    const typo = base();
    kinds(typo).buildStart = { route: 'sfx', sound: 'bld_start', gain: 3 };
    expectError(typo, '$.kinds.buildStart.gain', /unknown property/);

    const badName = base();
    kinds(badName).buildStart = { route: 'sfx', sound: 'Bld Start' };
    expectError(badName, '$.kinds.buildStart.sound', /sound name/);

    const alertNotDefined = base();
    kinds(alertNotDefined).massStall = { route: 'alert', sound: 'alt_nope' };
    expectError(alertNotDefined, '$.kinds.massStall.sound', /not defined in \$\.alerts/);

    const alertWrongName = base();
    kinds(alertWrongName).massStall = { route: 'alert', sound: 'eco_flow_stall' };
    expectError(alertWrongName, '$.kinds.massStall.sound', /alert name/);

    const thenOnIgnore = base();
    kinds(thenOnIgnore).reclaimStart = { route: 'ignore', then: { sound: 'x', delayMs: 1 } };
    expectError(thenOnIgnore, '$.kinds.reclaimStart', /only allowed with route 'sfx'/);
  });

  it('enforces the gain (−24..+6 dB), rate (0.5..2) and delay ranges', () => {
    const loud = base();
    kinds(loud).buildStart = { route: 'sfx', sound: 'bld_start', gainDb: 7 };
    expectError(loud, '$.kinds.buildStart.gainDb', /out of range -24\.\.6/);
    const quiet = base();
    kinds(quiet).buildStart = { route: 'sfx', sound: 'bld_start', gainDb: -24.5 };
    expectError(quiet, '$.kinds.buildStart.gainDb', /out of range/);
    const slow = base();
    (slow.weapons as Record<string, unknown>)['core:wpn_mg_t1'] = { sound: 'wpn_mg_t1_fire', rate: 0.49 };
    expectError(slow, '$.weapons.core:wpn_mg_t1.rate', /out of range 0\.5\.\.2/);
    const fast = base();
    (fast.weapons as Record<string, unknown>)['core:wpn_mg_t1'] = { sound: 'wpn_mg_t1_fire', rate: 2.01 };
    expectError(fast, '$.weapons.core:wpn_mg_t1.rate', /out of range/);
    const nan = base();
    kinds(nan).buildStart = { route: 'sfx', sound: 'bld_start', rate: 'fast' };
    expectError(nan, '$.kinds.buildStart.rate', /expected a number/);
    const delay = base();
    kinds(delay).buildComplete = { route: 'sfx', sound: 'bld_complete', then: { sound: 'sig_bell_small', delayMs: 9000 } };
    expectError(delay, '$.kinds.buildComplete.then.delayMs', /out of range/);
    // Boundaries are inclusive.
    const edge = base();
    kinds(edge).buildStart = { route: 'sfx', sound: 'bld_start', gainDb: -24, rate: 2 };
    expect(parseEventSoundMap(edge).kinds.buildStart).toMatchObject({ gainDb: -24, rate: 2 });
  });

  it('validates weapons, impacts, deaths and alerts tables', () => {
    const badRef = base();
    (badRef.weapons as Record<string, unknown>).wpn_x = 'wpn_mg_t1_fire';
    expectError(badRef, '$.weapons.wpn_x', /core:wpn_name/);
    const badFamily = base();
    (badFamily.weapons as Record<string, unknown>)['core:wpn_mg_t1'] = { sound: 'wpn_mg_t1_fire', impact: 'laser' };
    expectError(badFamily, '$.weapons.core:wpn_mg_t1.impact', /unknown impact family/);
    const noGround = base();
    ((noGround.impacts as Record<string, Record<string, unknown>>).families!).laser = { metal: 'imp_rail' };
    expectError(noGround, '$.impacts.families.laser.ground', /ground sound/);
    const badSurface = base();
    ((badSurface.impacts as Record<string, Record<string, unknown>>).families!).laser = { ground: 'imp_rail', lava: 'imp_bomb' };
    expectError(badSurface, '$.impacts.families.laser.lava', /unknown property/);
    const badDefault = base();
    (badDefault.impacts as Record<string, unknown>).defaultFamily = 'laser';
    expectError(badDefault, '$.impacts.defaultFamily', /unknown family/);
    const missingDeath = base();
    delete (missingDeath.deaths as Record<string, unknown>).huge;
    expectError(missingDeath, '$.deaths.huge', /required/);
    const badAlert = base();
    (badAlert.alerts as Record<string, unknown>).gong = { sound: 'alt_gong' };
    expectError(badAlert, '$.alerts.gong', /alt_/);
    const missingAlert = base();
    delete (missingAlert.alerts as Record<string, unknown>).alt_storage_full;
    expectError(missingAlert, '$.alerts', /alt_storage_full/);
    const noCommander = base();
    delete noCommander.commanderDeath;
    expectError(noCommander, '$.commanderDeath', /required/);
    const badBurst = base();
    (badBurst.weapons as Record<string, unknown>)['core:wpn_gatling_t2'] = { sound: 'wpn_mg_t1_fire', burst: { loop: 'wpn_gatling_t2_loop', holdMs: 5 } };
    expectError(badBurst, '$.weapons.core:wpn_gatling_t2.burst.holdMs', /out of range/);
  });
});

describe('event map lookups', () => {
  const m = DEFAULT_EVENT_SOUND_MAP;

  it('weaponSound falls back to weaponDefault (null by default)', () => {
    expect(weaponSound(m, 'core:wpn_cannon_t1')!.sound).toBe('wpn_cannon_t1_fire');
    expect(weaponSound(m, 'core:wpn_unknown')).toBeNull();
    expect(weaponSound(m, undefined)).toBeNull();
  });

  it('impactSound resolves family × surface with ground fallback and silent shields', () => {
    expect(impactFamilyOf(m, 'core:wpn_mg_t1')).toBe('bullet');
    expect(impactFamilyOf(m, 'core:unknown')).toBe('shell');
    expect(impactSound(m, 'shell', 0)!.sound).toBe('imp_shell_ground');
    expect(impactSound(m, 'shell', 1)!.sound).toBe('imp_shell_metal');
    expect(impactSound(m, 'shell', 2)).toMatchObject({ sound: 'imp_shell_ground', gainDb: -6 });
    expect(impactSound(m, 'shell', 3)).toBeNull();
    expect(impactSound(m, 'shell', 4)!.sound).toBe('imp_structure_metal');
    expect(impactSound(m, 'slag', 1)!.sound).toBe('imp_slag_splash'); // missing surface → ground
    expect(impactSound(m, 'bullet', 99)!.sound).toBe('imp_bullet_ground'); // unknown surface → ground
    expect(impactSound(m, 'nope', 1)!.sound).toBe('imp_shell_metal'); // unknown family → default
  });

  it('deathSound / collapseAfterDeath follow size class and flags', () => {
    expect(deathSound(m, 0, 0).sound).toBe('exp_small');
    expect(deathSound(m, 1, 0).sound).toBe('exp_medium');
    expect(deathSound(m, 2, 0).sound).toBe('exp_large');
    expect(deathSound(m, 3, 0)).toMatchObject({ sound: 'exp_large', gainDb: 3 });
    expect(deathSound(m, 42, 0).sound).toBe('exp_large');
    expect(deathSound(m, 1, EVENT_FLAG_AIR).sound).toBe('exp_air_crash');
    expect(collapseAfterDeath(m, 0, EVENT_FLAG_STRUCTURE)).toBeNull();
    expect(collapseAfterDeath(m, 2, EVENT_FLAG_STRUCTURE)).toMatchObject({ sound: 'exp_structure_collapse', delayMs: 600 });
    expect(collapseAfterDeath(m, 2, 0)).toBeNull();
  });

  it('alertForIndex maps aux to ALERT_KINDS', () => {
    expect(alertForIndex(m, 3)).toEqual({ name: 'alt_base_attacked', rule: m.alerts.alt_base_attacked });
    expect(alertForIndex(m, 11)).toBeNull();
  });
});

describe('withWeaponSounds', () => {
  it('merges weapon entries over the map (add + replace, rest kept) without touching the input', () => {
    const m = DEFAULT_EVENT_SOUND_MAP;
    const before = m.weapons['core:wpn_mg_t1'];
    const merged = withWeaponSounds(m, {
      'core:wpn_new_gun': { sound: 'wpn_cannon_t2_fire', impact: 'shell', rate: 1.1 },
      'core:wpn_mg_t1': 'wpn_cannon_t1_fire',
    });
    expect(merged.weapons['core:wpn_new_gun']).toMatchObject({ sound: 'wpn_cannon_t2_fire', impact: 'shell', rate: 1.1 });
    expect(merged.weapons['core:wpn_mg_t1']!.sound).toBe('wpn_cannon_t1_fire');
    expect(merged.weapons['core:wpn_cannon_t1']).toBe(m.weapons['core:wpn_cannon_t1']);
    expect(m.weapons['core:wpn_mg_t1']).toBe(before);
    expect(m.weapons['core:wpn_new_gun']).toBeUndefined();
    expect(merged.kinds).toBe(m.kinds);
  });

  it('validates like the map parser', () => {
    expect(() => withWeaponSounds(DEFAULT_EVENT_SOUND_MAP, { 'Bad Ref': 'x' })).toThrow(EventMapError);
    expect(() => withWeaponSounds(DEFAULT_EVENT_SOUND_MAP, { 'core:wpn_x': { sound: 'x', impact: 'nope' } })).toThrow(/impact family/);
    expect(() => withWeaponSounds(DEFAULT_EVENT_SOUND_MAP, [])).toThrow(EventMapError);
  });
});
