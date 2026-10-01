/**
 * Generates the HUD data tables in packages/hud/src/data from the design sources:
 *   docs/design/roster.json            → roster.gen.ts (units), build-table.gen.ts (direct build lists)
 *   packages/hud/scripts/unit-texts.json → merged into roster.gen.ts (short names, descriptions, EN adjacency)
 *   content/icons/svg/{icons,states}   → icons.gen.ts (SVG sprite), icons-mask.gen.css (mask-image data URLs)
 *
 * Usage: pnpm --filter @faf/hud run gen [--check]
 *   --check compares instead of writing and exits with 1 if any file differs (a literal `--` is ignored).
 *
 * Output is deterministic: stable ordering (roster order for units, code-unit order for icons), LF line
 * endings, no timestamps. buildableBy category expressions are evaluated here with @faf/rules; src/data
 * never imports @faf/rules (dependency rule hud-deps).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CategoryRegistry, categoryExprNames, compileCategoryExpr, matchesMask, parseCategoryExpr } from '@faf/rules';
import type { HotbuildMenu, RosterSlot, UnitRecord } from '../src/data/types.ts';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(PKG_DIR, '../..');
const ROSTER_PATH = join(REPO_ROOT, 'docs/design/roster.json');
const TEXTS_PATH = join(PKG_DIR, 'scripts/unit-texts.json');
const ICON_DIR = join(REPO_ROOT, 'content/icons/svg/icons');
const STATE_DIR = join(REPO_ROOT, 'content/icons/svg/states');
const OUT_DIR = join(PKG_DIR, 'src/data');

/** Maximum length of a cell label (ui.md §5.6: ≤ 10 characters at 11 px in a 58 px cell). */
export const SHORT_MAX = 10;

const MENUS: readonly HotbuildMenu[] = ['Bau', 'Landwerk', 'Luftwerk', 'Großguss'];
const SLOTS: readonly RosterSlot[] = ['Q', 'W', 'E', 'R', 'T', 'A', 'S', 'D', 'F', 'G', 'Z', 'X', 'C', 'V', 'B'];

// ---------------------------------------------------------------------------------------------------------------
// Source shapes (only the fields the HUD needs)

interface RawWeapon {
  ref: string;
  type: string;
  dps: number;
  range: number;
  rangeMin?: number;
  layers: string[];
}
interface RawUnit {
  id: string;
  name: { de: string; en: string };
  role: { de: string; en: string };
  tech: number;
  group: string;
  ms9Core: boolean;
  msFirst: string;
  postMvp?: boolean;
  categories: string[];
  buildableBy: string | null;
  economy: Record<string, number | undefined>;
  health: { max: number; regenPerSec?: number };
  shield: { hp: number; radius: number; regenPerSec: number; upkeepEnergyPerSec: number } | null;
  weapons: RawWeapon[] | null;
  motion: { layer: string; speed: number; footprint: [number, number]; structure?: boolean };
  intel: { vision?: number; radar?: number };
  special: { toggles: string[]; upgradesTo: string | null; upgradeFrom: string | null; adjacency: string | null };
  hotbuild: { menu: string; slot: string } | null;
  icon: string;
}
interface RawRoster {
  units: RawUnit[];
}
interface UnitTexts {
  short: { de: string; en: string };
  desc: { de: string; en: string };
  adjacency?: { en: string };
}

export class GenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenError';
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function num(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Rounds to 2 decimals (generated display values, not sim state). */
function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Player-facing texts never mention the FA reference (faction.md §2.4). */
export function cleanAdjacencyDe(text: string): string {
  return text
    .replace(/\s*\(FA-Relation\)/g, '')
    .replace(/\(FA-Relation,\s*/g, '(')
    .trim();
}

// ---------------------------------------------------------------------------------------------------------------
// Roster

function parseHotbuild(u: RawUnit, byId: Readonly<Record<string, RawUnit>>): UnitRecord['hotbuild'] {
  if (u.hotbuild === null) return null;
  const menu = u.hotbuild.menu as HotbuildMenu;
  if (!MENUS.includes(menu)) throw new GenError(`${u.id}: unknown hotbuild menu '${u.hotbuild.menu}'`);
  const text = u.hotbuild.slot;
  const direct = /^([A-Z])(?:\s|$)/.exec(text);
  if (direct !== null) {
    const slot = direct[1] as RosterSlot;
    if (!SLOTS.includes(slot)) throw new GenError(`${u.id}: unknown hotbuild slot '${text}'`);
    return { menu, slot, viaUpgrade: /upgrade/i.test(text) };
  }
  if (!/^Upgrade\b/i.test(text)) throw new GenError(`${u.id}: cannot parse hotbuild slot '${text}'`);
  // Upgrade-only tier: the role keeps the slot of the root of its upgrade chain.
  let cur: RawUnit = u;
  for (let guard = 0; guard < 8; guard++) {
    const from = cur.special.upgradeFrom;
    if (from === null) break;
    const next = byId[from];
    if (next === undefined) throw new GenError(`${cur.id}: upgradeFrom '${from}' is not in the roster`);
    cur = next;
  }
  if (cur === u || cur.hotbuild === null) throw new GenError(`${u.id}: upgrade-only slot without an upgrade root`);
  const root = /^([A-Z])(?:\s|$)/.exec(cur.hotbuild.slot);
  if (root === null) throw new GenError(`${cur.id}: upgrade root has no direct slot ('${cur.hotbuild.slot}')`);
  return { menu, slot: root[1] as RosterSlot, viaUpgrade: true };
}

function weaponSummary(ws: readonly RawWeapon[]): UnitRecord['weapons'] {
  let dps = 0;
  let range = 0;
  let rangeMin = Number.POSITIVE_INFINITY;
  let count = 0;
  const layers: string[] = [];
  for (const w of ws) {
    // DPS without tap shot / overcharge (ui.md §5.12).
    if (/tapshot|overcharge/i.test(w.ref) || /Abstich|Overcharge/i.test(w.type)) continue;
    count++;
    dps += w.dps;
    if (w.range > range) range = w.range;
    const mn = num(w.rangeMin);
    if (mn < rangeMin) rangeMin = mn;
    for (const l of w.layers) if (!layers.includes(l)) layers.push(l);
  }
  layers.sort();
  return { count, dps: r2(dps), range, rangeMin: count === 0 ? 0 : rangeMin, layers };
}

function normaliseToggle(t: string): string {
  const m = /^[a-z_]+/.exec(t.trim());
  if (m === null) throw new GenError(`cannot parse toggle '${t}'`);
  return m[0];
}

export function buildRoster(roster: RawRoster, texts: Readonly<Record<string, UnitTexts>>): UnitRecord[] {
  const byId: Record<string, RawUnit> = {};
  for (const u of roster.units) {
    if (byId[u.id] !== undefined) throw new GenError(`duplicate unit id ${u.id}`);
    byId[u.id] = u;
  }
  const out: UnitRecord[] = [];
  for (const u of roster.units) {
    const t = texts[u.id];
    if (t === undefined) throw new GenError(`${u.id}: missing entry in scripts/unit-texts.json`);
    for (const lang of ['de', 'en'] as const) {
      if (!t.short[lang] || !t.desc[lang]) throw new GenError(`${u.id}: short/desc.${lang} missing`);
      if ([...t.short[lang]].length > SHORT_MAX) {
        throw new GenError(`${u.id}: short.${lang} '${t.short[lang]}' longer than ${SHORT_MAX} characters`);
      }
    }
    const adjDe = u.special.adjacency;
    if (adjDe !== null && (t.adjacency === undefined || !t.adjacency.en)) {
      throw new GenError(`${u.id}: adjacency.en missing in scripts/unit-texts.json`);
    }
    if (adjDe === null && t.adjacency !== undefined) throw new GenError(`${u.id}: adjacency.en without roster adjacency`);
    if (!u.id.startsWith('core:')) throw new GenError(`${u.id}: expected the core: namespace`);
    const e = u.economy;
    const cats = [...u.categories];
    const rec: UnitRecord = {
      id: u.id,
      key: u.id.slice('core:'.length),
      name: { de: u.name.de, en: u.name.en },
      role: { de: u.role.de, en: u.role.en },
      short: { de: t.short.de, en: t.short.en },
      desc: { de: t.desc.de, en: t.desc.en },
      adjacency: adjDe === null ? null : { de: cleanAdjacencyDe(adjDe), en: t.adjacency!.en },
      tech: u.tech,
      group: u.group,
      icon: u.icon,
      postMvp: u.postMvp === true,
      ms9Core: u.ms9Core,
      msFirst: u.msFirst,
      categories: cats,
      structure: cats.includes('STRUCTURE'),
      layer: u.motion.layer,
      footprint: [u.motion.footprint[0], u.motion.footprint[1]],
      hotbuild: parseHotbuild(u, byId),
      economy: {
        mass: num(e['mass']),
        energy: num(e['energy']),
        buildTime: num(e['buildTime']),
        buildPower: num(e['buildPower']),
        massPerS: num(e['massPerSec']),
        energyPerS: num(e['energyPerSec']),
        storageMass: num(e['storageMass']),
        storageEnergy: num(e['storageEnergy']),
        upkeepEnergyPerS: num(e['upkeepEnergyPerSec']),
      },
      health: { max: u.health.max, regenPerS: num(u.health.regenPerSec) },
      shield:
        u.shield === null
          ? null
          : {
              hp: u.shield.hp,
              radius: u.shield.radius,
              regenPerS: u.shield.regenPerSec,
              upkeepEnergyPerS: u.shield.upkeepEnergyPerSec,
            },
      weapons: weaponSummary(u.weapons ?? []),
      speed: u.motion.structure === true ? 0 : u.motion.speed,
      vision: num(u.intel.vision),
      radar: num(u.intel.radar),
      upgradesTo: u.special.upgradesTo,
      upgradeFrom: u.special.upgradeFrom,
      toggles: u.special.toggles.map(normaliseToggle),
    };
    for (const ref of [rec.upgradesTo, rec.upgradeFrom]) {
      if (ref !== null && byId[ref] === undefined) throw new GenError(`${u.id}: upgrade reference ${ref} not in roster`);
    }
    out.push(rec);
  }
  for (const id of Object.keys(texts)) {
    if (byId[id] === undefined) throw new GenError(`scripts/unit-texts.json: unknown unit ${id}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Build table

/** True for units that open a build/production page: engineers, commander, factories. */
export function isBuilder(categories: readonly string[]): boolean {
  return categories.includes('ENGINEER') || categories.includes('FACTORY') || categories.includes('COMMAND');
}

export function buildTable(roster: RawRoster): Record<string, string[]> {
  const names = new Set<string>();
  for (const u of roster.units) for (const c of u.categories) names.add(c);
  for (const u of roster.units) {
    if (u.buildableBy !== null) for (const n of categoryExprNames(parseCategoryExpr(u.buildableBy))) names.add(n);
  }
  const reg = new CategoryRegistry(names);
  const compiled = roster.units.map((u) => (u.buildableBy === null ? null : compileCategoryExpr(u.buildableBy, reg)));
  const table: Record<string, string[]> = {};
  for (const b of roster.units) {
    if (!isBuilder(b.categories)) continue;
    const mask = reg.maskOf(b.categories);
    const list: string[] = [];
    roster.units.forEach((u, i) => {
      const c = compiled[i];
      if (c !== null && c !== undefined && u.id !== b.id && matchesMask(mask, c)) list.push(u.id);
    });
    table[b.id] = list;
  }
  return table;
}

// ---------------------------------------------------------------------------------------------------------------
// Icons

interface IconSource {
  /** Icon name (file name without .svg); ghosts carry the `.ghost` suffix. */
  name: string;
  viewBox: string;
  inner: string;
}

function parseSvg(name: string, text: string): IconSource {
  const svg = text.replace(/<title>[\s\S]*?<\/title>/g, '').trim();
  const m = /^<svg\b([^>]*)>([\s\S]*)<\/svg>$/.exec(svg);
  if (m === null) throw new GenError(`icon ${name}: not a single <svg> element`);
  const vb = /\bviewBox="([^"]+)"/.exec(m[1]!);
  if (vb === null) throw new GenError(`icon ${name}: no viewBox`);
  const inner = m[2]!.trim();
  if (/\sid="/.test(inner)) throw new GenError(`icon ${name}: inner ids would collide in the sprite`);
  return { name, viewBox: vb[1]!, inner };
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function readIcons(): IconSource[] {
  const out: IconSource[] = [];
  for (const dir of [ICON_DIR, STATE_DIR]) {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.svg') && !f.endsWith('.selected.svg'))
      .sort(compareCodeUnits);
    for (const f of files) out.push(parseSvg(f.slice(0, -4), readFileSync(join(dir, f), 'utf8')));
  }
  out.sort((a, b) => compareCodeUnits(a.name, b.name));
  return out;
}

/** Sprite symbol id of an icon name (`land_direct_t1` → `si-land_direct_t1`, `x.ghost` → `si-x--ghost`). */
export function symbolId(name: string): string {
  return name.endsWith('.ghost') ? `si-${name.slice(0, -'.ghost'.length)}--ghost` : `si-${name}`;
}

/**
 * Mask variant of an icon for one-node buttons (ui.md §9.2): opaque where the icon has team colour or
 * outline, transparent where the ceramic glyph sits, so a single background colour still shows the role.
 */
function maskSvg(icon: IconSource): string {
  const [x, y, w, h] = icon.viewBox.split(/\s+/);
  const body = icon.inner
    .replace(/var\(--team,\s*#[0-9a-fA-F]{3,6}\)/g, '#fff')
    .replace(/\sstyle="[^"]*"/g, '')
    // Ceramic glyph strokes/fills are cut out; tech notches (<rect>) and T4 brackets (square caps) stay solid.
    .replace(/<(rect|path|circle|ellipse|polygon|line)\b[^>]*>/g, (el, tag: string) =>
      el.replace(/#EDE6D6/gi, tag === 'rect' || /stroke-linecap="square"/.test(el) ? '#fff' : '#000'),
    )
    .replace(/#(?!fff\b|000\b)[0-9a-fA-F]{6}\b/g, '#fff');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}">` +
    `<mask id="m" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}">${body}</mask>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000" mask="url(#m)"/></svg>`
  );
}

/** Data URL encoding for CSS url("…"): single quotes inside, minimal percent-encoding. */
function svgDataUrl(svg: string): string {
  const s = svg.replace(/"/g, "'").replace(/[\r\n]+/g, ' ');
  return 'data:image/svg+xml,' + s.replace(/[%#<>{}]/g, (c) => encodeURIComponent(c));
}

// ---------------------------------------------------------------------------------------------------------------
// Emit

const HEADER = (src: string): string =>
  `// Generated by packages/hud/scripts/gen-data.ts from ${src}. Do not edit; run \`pnpm --filter @faf/hud run gen\`.\n`;

function emitRoster(units: readonly UnitRecord[]): string {
  const lines = units.map((u) => `  ${JSON.stringify(u)},`);
  return (
    HEADER('docs/design/roster.json and scripts/unit-texts.json') +
    `import type { UnitRecord } from './types.ts';\n\n` +
    `/** All roster units in roster.json order (experimentals carry postMvp: true). */\n` +
    `export const ROSTER: readonly UnitRecord[] = [\n${lines.join('\n')}\n];\n`
  );
}

function emitBuildTable(table: Readonly<Record<string, readonly string[]>>, order: readonly string[]): string {
  const lines = order.filter((id) => table[id] !== undefined).map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(table[id])},`);
  return (
    HEADER('docs/design/roster.json (buildableBy evaluated with @faf/rules)') +
    `\n/** Builder type id → type ids it can build directly (roster order). Upgrade-only tiers never appear. */\n` +
    `export const BUILD_TABLE: Readonly<Record<string, readonly string[]>> = {\n${lines.join('\n')}\n};\n`
  );
}

function emitIcons(icons: readonly IconSource[]): string {
  const base = icons.filter((i) => !i.name.endsWith('.ghost')).map((i) => i.name);
  const ghosts = icons.filter((i) => i.name.endsWith('.ghost')).map((i) => i.name.slice(0, -'.ghost'.length));
  const symbols = icons.map(
    (i) => `  ${JSON.stringify(`<symbol id="${symbolId(i.name)}" viewBox="${i.viewBox}">${i.inner}</symbol>`)},`,
  );
  return (
    HEADER('content/icons/svg (icons + states, without .selected)') +
    `\n/** Base icon names (strategic icons and radar blips). */\n` +
    `export const ICON_IDS = ${JSON.stringify(base)} as const;\n` +
    `export type IconId = (typeof ICON_IDS)[number];\n\n` +
    `/** Icons that also have a ghost variant (symbol id si-<icon>--ghost). */\n` +
    `export const GHOST_ICON_IDS: readonly IconId[] = ${JSON.stringify(ghosts)};\n\n` +
    `/** <symbol> elements, team colour kept as var(--team, …). */\n` +
    `export const ICON_SYMBOLS: readonly string[] = [\n${symbols.join('\n')}\n];\n`
  );
}

function emitMaskCss(icons: readonly IconSource[]): string {
  const base = icons.filter((i) => !i.name.endsWith('.ghost'));
  const rules = base.map((i) => `.si-mask-${i.name} { --si-mask: url("${svgDataUrl(maskSvg(i))}"); }`);
  return (
    `/* Generated by packages/hud/scripts/gen-data.ts from content/icons/svg. Do not edit. */\n` +
    `/* One-node icons (ui.md §9.2): .si-mask-<icon> sets --si-mask; .si-mask paints it in the team colour.\n` +
    `   Elements with their own children/pseudo-elements use mask-image: var(--si-mask) on a pseudo-element. */\n` +
    `.si-mask {\n  background-color: var(--team, var(--team-self));\n  mask-image: var(--si-mask);\n` +
    `  mask-repeat: no-repeat;\n  mask-position: center;\n  mask-size: contain;\n}\n` +
    `/* Ghost state for icons without a ghost symbol (mobile units): dimmed and desaturated like faction.md §6.5. */\n` +
    `.ff-sicon.is-ghost-fallback {\n  opacity: 0.48;\n  filter: saturate(0.25);\n}\n` +
    rules.join('\n') +
    '\n'
  );
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export function generate(): GeneratedFile[] {
  const roster = readJson<RawRoster>(ROSTER_PATH);
  const texts = readJson<{ units: Record<string, UnitTexts> }>(TEXTS_PATH).units;
  const units = buildRoster(roster, texts);
  const icons = readIcons();
  const iconNames = new Set(icons.map((i) => i.name));
  for (const u of units) if (!iconNames.has(u.icon)) throw new GenError(`${u.id}: icon '${u.icon}' not in content/icons`);
  const table = buildTable(roster);
  return [
    { path: join(OUT_DIR, 'roster.gen.ts'), content: emitRoster(units) },
    { path: join(OUT_DIR, 'build-table.gen.ts'), content: emitBuildTable(table, roster.units.map((u) => u.id)) },
    { path: join(OUT_DIR, 'icons.gen.ts'), content: emitIcons(icons) },
    { path: join(OUT_DIR, 'icons-mask.gen.css'), content: emitMaskCss(icons) },
  ];
}

function main(argv: readonly string[]): number {
  const args = argv.filter((a) => a !== '--');
  const check = args.includes('--check');
  const unknown = args.filter((a) => a !== '--check');
  if (unknown.length > 0) {
    console.error(`gen-data: unknown argument(s) ${unknown.join(' ')} (usage: gen-data [--check])`);
    return 2;
  }
  let files: GeneratedFile[];
  try {
    files = generate();
  } catch (e) {
    console.error(`gen-data: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  let stale = 0;
  for (const f of files) {
    const rel = relative(REPO_ROOT, f.path);
    const current = existsSync(f.path) ? readFileSync(f.path, 'utf8') : null;
    if (current === f.content) {
      if (!check) console.log(`gen-data: ${rel} unchanged`);
      continue;
    }
    if (check) {
      stale++;
      console.error(`gen-data --check: ${rel} is ${current === null ? 'missing' : 'out of date'}`);
    } else {
      writeFileSync(f.path, f.content, 'utf8');
      console.log(`gen-data: wrote ${rel} (${f.content.length} bytes)`);
    }
  }
  if (check) {
    if (stale > 0) {
      console.error('gen-data --check: run `pnpm --filter @faf/hud run gen`');
      return 1;
    }
    console.log(`gen-data --check: ${files.length} files up to date`);
  }
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
