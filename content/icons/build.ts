/**
 * Writes the icon grammar as SVG files (called by `pnpm models`):
 *   svg/forms/<form>.svg        base forms (domain)
 *   svg/glyphs/<glyph>.svg      role glyphs
 *   svg/notches/t1..t3.svg      tech notches
 *   svg/states/blip_<kind>.svg  radar blips (ground / air / struct)
 *   svg/icons/<id>.svg          every icon id used by a roster (+ .selected.svg, structures also .ghost.svg)
 *   icons.json                  index (id → form, glyph, tech, scale, units)
 * Deterministic output; stale files in svg/ are removed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blipSvg, formSvg, FORMS, GLYPHS, glyphSvg, iconScale, iconSvg, notchSvg, parseIconId, type IconForm } from './grammar.ts';

export const ICONS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(ICONS_DIR, '../..');

interface RosterLike {
  readonly units?: readonly { readonly id: string; readonly icon?: string }[];
}

/** Roster files of all factions (Varkan at docs/design/roster.json, others at docs/design/factions/<slug>/roster.json). */
export function rosterFiles(): string[] {
  const out: string[] = [];
  const main = join(REPO_ROOT, 'docs/design/roster.json');
  if (existsSync(main)) out.push(main);
  const facDir = join(REPO_ROOT, 'docs/design/factions');
  if (existsSync(facDir)) {
    for (const slug of readdirSync(facDir).sort()) {
      const f = join(facDir, slug, 'roster.json');
      if (existsSync(f)) out.push(f);
    }
  }
  return out;
}

export interface IconIndexEntry {
  readonly id: string;
  readonly form: IconForm;
  readonly glyph: string | null;
  readonly tech: number;
  readonly scale: number;
  readonly units: string[];
}

export function collectIcons(): IconIndexEntry[] {
  const map = new Map<string, IconIndexEntry>();
  for (const file of rosterFiles()) {
    const roster = JSON.parse(readFileSync(file, 'utf8')) as RosterLike;
    for (const u of roster.units ?? []) {
      if (u.icon === undefined) continue;
      let e = map.get(u.icon);
      if (e === undefined) {
        const p = parseIconId(u.icon);
        e = { id: p.id, form: p.form, glyph: p.glyph, tech: p.tech, scale: iconScale(p), units: [] };
        map.set(u.icon, e);
      }
      e.units.push(u.id);
    }
  }
  return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Returns the number of SVG files written. */
export function writeIcons(): number {
  const svgDir = join(ICONS_DIR, 'svg');
  const files = new Map<string, string>();
  for (const form of Object.keys(FORMS) as IconForm[]) files.set(`forms/${form}.svg`, formSvg(form, { title: FORMS[form].label }));
  for (const g of Object.keys(GLYPHS).sort()) files.set(`glyphs/${g}.svg`, glyphSvg(g, { title: GLYPHS[g]!.label }));
  for (const n of [1, 2, 3] as const) files.set(`notches/t${n}.svg`, notchSvg(n, { title: `Tech ${n}` }));
  for (const k of ['ground', 'air', 'struct'] as const) files.set(`states/blip_${k}.svg`, blipSvg(k, { title: `Radar-Blip ${k}` }));
  const icons = collectIcons();
  for (const e of icons) {
    files.set(`icons/${e.id}.svg`, iconSvg(e.id, { title: e.id }));
    files.set(`icons/${e.id}.selected.svg`, iconSvg(e.id, { variant: 'selected', title: `${e.id} (ausgewählt)` }));
    if (e.form === 'struct' || e.form === 'wall') files.set(`icons/${e.id}.ghost.svg`, iconSvg(e.id, { variant: 'ghost', title: `${e.id} (Ghost)` }));
  }
  // remove stale svgs
  if (existsSync(svgDir)) {
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith('.svg') && !files.has(relative(svgDir, p))) rmSync(p);
      }
    };
    walk(svgDir);
  }
  for (const [rel, svg] of files) {
    const p = join(svgDir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, `${svg}\n`);
  }
  writeFileSync(join(ICONS_DIR, 'icons.json'), `${JSON.stringify({ schema: 'faf-icons/1', icons }, null, 2)}\n`);
  return files.size;
}
