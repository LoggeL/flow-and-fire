import { describe, expect, it } from 'vitest';
import {
  CLIENT_SIDE_SOUNDS,
  DEFAULT_EVENT_SOUND_MAP,
  DEFERRED_SOUNDS,
  referencedSounds,
  validateEventSoundMap,
  weaponSound,
} from '../../src/events/index.ts';
import { loadRealManifest } from '../support/manifest.ts';
import { mvpWeaponRefs } from './roster.ts';

const manifest = loadRealManifest();
const nameOf = (id: string): string => id.slice(id.indexOf(':') + 1);

describe('default event map against the real manifest', () => {
  it('validates without issues for faction varkan, including all MVP weapon refs', () => {
    const issues = validateEventSoundMap(DEFAULT_EVENT_SOUND_MAP, manifest, ['varkan'], { weaponRefs: mvpWeaponRefs() });
    expect(issues).toEqual([]);
  });

  it('assigns each of the 101 manifest sounds to exactly one group (event map, client API, deferred)', () => {
    const groups = new Map<string, string[]>();
    const add = (name: string, group: string): void => {
      const g = groups.get(name) ?? [];
      if (!g.includes(group)) g.push(group);
      groups.set(name, g);
    };
    for (const r of referencedSounds(DEFAULT_EVENT_SOUND_MAP)) add(r.sound, 'eventMap');
    for (const s of CLIENT_SIDE_SOUNDS) add(s.name, 'client');
    for (const s of DEFERRED_SOUNDS) add(s.name, 'deferred');

    expect(manifest.sounds.length).toBe(101);
    const unassigned: string[] = [];
    const multiple: string[] = [];
    for (const s of manifest.sounds) {
      const g = groups.get(nameOf(s.id));
      if (!g) unassigned.push(s.id);
      else if (g.length > 1) multiple.push(`${s.id}: ${g.join('+')}`);
    }
    expect(unassigned, 'manifest sounds without a group').toEqual([]);
    expect(multiple, 'manifest sounds in more than one group').toEqual([]);
    // No group entry points at a sound that does not exist.
    const names = new Set(manifest.sounds.map((s) => nameOf(s.id)));
    const dangling = [...groups.keys()].filter((n) => !names.has(n));
    expect(dangling).toEqual([]);
  });

  it('the client and deferred lists have no duplicates and deferred entries carry a reason', () => {
    const client = CLIENT_SIDE_SOUNDS.map((s) => s.name);
    expect(new Set(client).size).toBe(client.length);
    for (const d of DEFERRED_SOUNDS) {
      expect(d.reason.length).toBeGreaterThan(20);
      expect(d.milestone).toMatch(/^(MS\d+|post-MVP)$/);
    }
  });

  it('none of the 17 MS5 sounds is deferred', () => {
    const ms5 = manifest.sounds.filter((s) => s.tags.includes('MS5')).map((s) => nameOf(s.id));
    expect(ms5.length).toBe(17);
    const deferred = new Set(DEFERRED_SOUNDS.map((d) => d.name));
    expect(ms5.filter((n) => deferred.has(n))).toEqual([]);
    // MS5 client sounds are wired in MS5.
    for (const c of CLIENT_SIDE_SOUNDS) if (ms5.includes(c.name)) expect(c.milestone).toBe('MS5');
  });

  it('maps all 27 MVP weapon refs of roster.json, aliases with SOUNDLIST §3.1 rate/gain', () => {
    const refs = mvpWeaponRefs();
    expect(refs.length).toBe(27);
    const missing = refs.filter((r) => !DEFAULT_EVENT_SOUND_MAP.weapons[r]);
    expect(missing).toEqual([]);
    const w = (ref: string) => weaponSound(DEFAULT_EVENT_SOUND_MAP, ref)!;
    // Aliases without an own file (SOUNDLIST §3.1).
    expect(w('core:wpn_bolt_cannon_t1')).toMatchObject({ sound: 'wpn_cannon_t1_fire', rate: 0.92, gainDb: 0 });
    expect(w('core:wpn_spark_mg_t1')).toMatchObject({ sound: 'wpn_mg_t1_fire', rate: 1.2, gainDb: -3 });
    expect(w('core:wpn_grate_aa_t1')).toMatchObject({ sound: 'wpn_aa_repeater_t1_fire', rate: 1 });
    expect(w('core:wpn_bolt_cannon_t2')).toMatchObject({ sound: 'wpn_cannon_t2_fire', rate: 0.92 });
    expect(w('core:wpn_high_grate_sam_t3')).toMatchObject({ sound: 'wpn_missile_fire', rate: 1 });
    expect(w('core:wpn_grate_flak_t2')).toMatchObject({ sound: 'wpn_flak_t2_fire', rate: 1 });
    expect(w('core:wpn_magpie_gun_t2')).toMatchObject({ sound: 'wpn_air_gun_fire', rate: 0.9 });
    expect(w('core:wpn_magpie_bomb_t2')).toMatchObject({ sound: 'wpn_bomb_release', rate: 1 });
    // Every weapon ref tag in the manifest points at the sound the map uses for that ref.
    const conflicts: string[] = [];
    for (const s of manifest.sounds) {
      for (const tag of s.tags) {
        if (!tag.startsWith('core:wpn_')) continue;
        const ws = DEFAULT_EVENT_SOUND_MAP.weapons[tag];
        const used = ws ? [ws.sound, ws.burst?.loop, ws.burst?.spin] : [];
        if (!used.includes(nameOf(s.id))) conflicts.push(`${tag} tagged on ${s.id}, map uses ${used.join('/')}`);
      }
    }
    expect(conflicts).toEqual([]);
  });

  it('the event map never plays alert sounds outside the alert queue and never one-shots loops', () => {
    const byName = new Map(manifest.sounds.map((s) => [nameOf(s.id), s]));
    for (const r of referencedSounds(DEFAULT_EVENT_SOUND_MAP)) {
      const s = byName.get(r.sound)!;
      if (r.use === 'alert') expect(s.category).toBe('alert');
      else expect(s.category).not.toBe('alert');
      expect(s.loop !== null).toBe(r.use === 'loop');
    }
  });
});
