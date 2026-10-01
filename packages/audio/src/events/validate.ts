/**
 * Cross-checks an event map against a sound manifest: every referenced sound must resolve for
 * every faction (`<faction>:<name>` → `common:<name>`, or an exact fq-id), one-shot contexts must
 * not point at loop sounds (they would never stop), burst loops must be loops, alerts must be
 * alert-category sounds, and (optionally) the weapon refs must match a known list.
 */

import { ALERT_KINDS } from './kinds.ts';
import { referencedSounds, type EventSoundMap } from './sound-map.ts';

/** The manifest fields validation needs (structurally satisfied by `AudioManifest`). */
export interface ManifestLike {
  readonly sounds: readonly {
    readonly id: string;
    readonly category: string;
    readonly loop: unknown;
  }[];
}

export interface EventMapIssue {
  /** JSON path inside the event map. */
  readonly path: string;
  readonly message: string;
}

export interface ValidateEventMapOptions {
  /**
   * Weapon refs the game knows (e.g. from roster.json / view data). When given, unknown refs in
   * the map and refs missing from the map are reported.
   */
  readonly weaponRefs?: readonly string[];
}

/** Resolves `name` for `faction` like the runtime lookup; returns the fq-id or null. */
export function resolveSoundId(ids: ReadonlySet<string>, name: string, faction: string): string | null {
  if (name.includes(':')) return ids.has(name) ? name : null;
  const own = `${faction}:${name}`;
  if (ids.has(own)) return own;
  const common = `common:${name}`;
  return ids.has(common) ? common : null;
}

/** Returns all problems found (empty = valid). */
export function validateEventSoundMap(
  map: EventSoundMap,
  manifest: ManifestLike,
  factions: readonly string[],
  options: ValidateEventMapOptions = {},
): EventMapIssue[] {
  const issues: EventMapIssue[] = [];
  const byId = new Map<string, { category: string; loop: boolean }>();
  for (const s of manifest.sounds) byId.set(s.id, { category: s.category, loop: s.loop !== null && s.loop !== undefined });
  const ids: ReadonlySet<string> = new Set(byId.keys());
  if (factions.length === 0) issues.push({ path: '$', message: 'no factions given to validate against' });

  for (const ref of referencedSounds(map)) {
    for (const faction of factions) {
      const id = resolveSoundId(ids, ref.sound, faction);
      if (id === null) {
        const tried = ref.sound.includes(':') ? `'${ref.sound}'` : `'${faction}:${ref.sound}' or 'common:${ref.sound}'`;
        issues.push({ path: ref.path, message: `sound '${ref.sound}' not resolvable for faction '${faction}' (neither ${tried} in the manifest)` });
        continue;
      }
      const s = byId.get(id)!;
      if (ref.use === 'oneShot' && s.loop) issues.push({ path: ref.path, message: `'${id}' is a loop sound but is used as a one-shot` });
      if (ref.use === 'loop' && !s.loop) issues.push({ path: ref.path, message: `'${id}' is used as a loop but has no loop points` });
      if (ref.use === 'alert' && s.category !== 'alert') issues.push({ path: ref.path, message: `'${id}' is used as an alert but has category '${s.category}'` });
      if (ref.use !== 'alert' && s.category === 'alert') issues.push({ path: ref.path, message: `alert sound '${id}' used outside $.alerts (route alerts through the queue)` });
    }
  }

  if (map.kinds.alert.route === 'alert') {
    for (const a of ALERT_KINDS) {
      if (!map.alerts[a.name]) issues.push({ path: '$.alerts', message: `alert '${a.name}' (index ${a.index}) is missing` });
    }
  }

  if (options.weaponRefs) {
    const known = new Set(options.weaponRefs);
    for (const ref of Object.keys(map.weapons)) {
      if (!known.has(ref)) issues.push({ path: `$.weapons.${ref}`, message: `unknown weapon ref '${ref}'` });
    }
    for (const ref of known) {
      if (!map.weapons[ref]) issues.push({ path: '$.weapons', message: `weapon ref '${ref}' is not mapped` });
    }
  }
  return issues;
}
