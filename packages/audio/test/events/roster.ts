/** Weapon refs of the MVP roster (docs/design/roster.json, experimentals excluded). */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface RosterJson {
  units: { id: string; experimental?: unknown; weapons?: { ref: string }[] | null }[];
}

export function mvpWeaponRefs(): string[] {
  const path = fileURLToPath(new URL('../../../../docs/design/roster.json', import.meta.url));
  const roster = JSON.parse(readFileSync(path, 'utf8')) as RosterJson;
  const refs = new Set<string>();
  for (const u of roster.units) {
    if (u.experimental) continue;
    for (const w of u.weapons ?? []) refs.add(w.ref);
  }
  return [...refs].sort();
}
