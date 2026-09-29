/**
 * Faction config of the model content (`content/models/<slug>/_faction.ts`) and the mapping of roster entries
 * (`faf-roster/1`, docs/design/roster.json or docs/design/factions/<slug>/roster.json) onto build defaults.
 */
import type { RosterDefaults } from './build.ts';
import type { Palette } from './materials.ts';
import type { Budget, ModelClass } from './model.ts';

export interface FactionDef {
  /** Folder name under content/models (`varkan`). */
  readonly slug: string;
  /** Display name. */
  readonly name: string;
  /** Repo-relative roster path; default `docs/design/factions/<slug>/roster.json`. */
  readonly roster?: string;
  readonly palette: Palette;
  readonly budgets?: Partial<Record<ModelClass, Budget>>;
  /** Language of roster names shown in tools (default `de`). */
  readonly language?: 'de' | 'en';
}

export function defineFaction(f: FactionDef): FactionDef {
  if (!/^[a-z][a-z0-9_-]*$/.test(f.slug)) throw new Error(`faction slug "${f.slug}" must be lowercase`);
  if (f.palette.faction !== f.slug) throw new Error(`faction ${f.slug}: palette.faction must equal the slug`);
  return f;
}

/** The part of a roster unit entry the model build uses (all optional: rosters of other factions may differ). */
export interface RosterUnit {
  readonly id: string;
  readonly name?: string | { readonly de?: string; readonly en?: string };
  readonly role?: string | { readonly de?: string; readonly en?: string };
  readonly tech?: number;
  readonly group?: string;
  readonly icon?: string;
  readonly iconThreshold?: number;
  readonly footprint?: readonly number[];
  readonly motion?: { readonly footprint?: readonly number[] } | null;
  readonly kitbash?: {
    readonly scale?: { readonly xz?: number; readonly y?: number };
    readonly trisEstimate?: number;
    readonly description?: string;
  } | null;
}

export interface RosterFile {
  readonly units: readonly RosterUnit[];
}

function text(v: RosterUnit['name'], lang: 'de' | 'en'): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'string') return v;
  return v[lang] ?? v.de ?? v.en;
}

const CLASSES: readonly ModelClass[] = ['land', 'air', 'eng', 'struct', 'cmd', 'wall', 'naval'];

export function classOf(u: RosterUnit): ModelClass | undefined {
  const form = u.icon?.split('_')[0];
  if (form !== undefined && (CLASSES as readonly string[]).includes(form)) return form as ModelClass;
  return undefined;
}

export function rosterDefaults(u: RosterUnit, lang: 'de' | 'en' = 'de'): RosterDefaults {
  const fp = u.motion?.footprint ?? u.footprint;
  const sc = u.kitbash?.scale;
  const out: Record<string, unknown> = {};
  const name = text(u.name, lang);
  const role = text(u.role, lang);
  const cls = classOf(u);
  if (name !== undefined) out['name'] = name;
  if (role !== undefined) out['role'] = role;
  if (cls !== undefined) out['class'] = cls;
  if (u.tech !== undefined && [0, 1, 2, 3, 4].includes(u.tech)) out['tech'] = u.tech;
  if (fp !== undefined && fp.length === 2) out['footprint'] = [fp[0]!, fp[1]!];
  if (sc !== undefined) out['scale'] = { xz: sc.xz ?? 1, y: sc.y ?? sc.xz ?? 1 };
  if (u.icon !== undefined) out['icon'] = u.icon;
  if (u.iconThreshold !== undefined) out['iconThreshold'] = u.iconThreshold;
  if (u.kitbash?.trisEstimate !== undefined) out['trisEstimate'] = u.kitbash.trisEstimate;
  return out as RosterDefaults;
}
