/**
 * Shared strategic-icon grammar (all factions; faction.md §6): base form = domain (team-colored fill, graphite
 * contour), glyph = role (ceramic white with dark halo), 1–3 tech notches top right outside the form, plus the
 * state variants selected / radar blip / ghost. Experimentals (tech 4, `_t4`) carry a ceramic square bracket
 * around the form instead of notches (faction.md §6.4, docs/design/experimentals.md §5). Pure TS, no DOM: returns SVG strings (the model viewer inlines
 * them, `pnpm models` writes them to content/icons/svg).
 *
 * Grid: 32 × 32 design units (DE), glyph inside the central 16 × 16 field, strokes ≥ 4–5 DE, no angles < 35°.
 * The SVG viewBox adds a margin (notches above the form, contour, selection ring): x −8…40, y −14…40.
 * Icon ids: `<form>_<glyph>_t<n>` (land_direct_t1, struct_fac_land_t3, T4: land_bot_t4), `cmd_commander`, `wall`.
 */

export const ICON_VIEWBOX = '-8 -14 48 54';
export const CONTOUR = '#101010';
export const CERAMIC = '#EDE6D6';
export const BLIP_GRAY = '#9A9A9A';
export const DEFAULT_TEAM = '#2F6FD0';

export type IconForm = 'land' | 'air' | 'eng' | 'struct' | 'cmd' | 'wall' | 'naval';

export interface FormDef {
  readonly label: string;
  /** SVG path data inside 0…32. */
  readonly d: string;
  /** Radar-blip class (faction.md §6.5): octagon ground-mobile, triangle air, hexagon structures. */
  readonly blip: 'ground' | 'air' | 'struct';
  readonly hasGlyph: boolean;
  readonly hasNotches: boolean;
}

const hex = (cx: number, cy: number, r: number): string => {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((-90 + 60 * i) * Math.PI) / 180;
    pts.push(`${fmt(cx + r * Math.cos(a))} ${fmt(cy + r * Math.sin(a))}`);
  }
  return `M${pts.join(' L')} Z`;
};

const oct = (cx: number, cy: number, r: number): string => {
  const pts: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = ((22.5 + 45 * i) * Math.PI) / 180;
    pts.push(`${fmt(cx + r * Math.cos(a))} ${fmt(cy + r * Math.sin(a))}`);
  }
  return `M${pts.join(' L')} Z`;
};

function fmt(v: number): string {
  const r = Math.round(v * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
}

export const FORMS: Readonly<Record<IconForm, FormDef>> = {
  land: { label: 'Land mobil (Quadrat, Fase 4 DE)', d: 'M5 1 H27 L31 5 V27 L27 31 H5 L1 27 V5 Z', blip: 'ground', hasGlyph: true, hasNotches: true },
  air: { label: 'Luft (Dreieck, Spitze oben)', d: 'M16 0 L32 30 H0 Z', blip: 'air', hasGlyph: true, hasNotches: true },
  eng: { label: 'Engineer (Kreis Ø 28 DE)', d: 'M16 2 A14 14 0 1 1 15.99 2 Z', blip: 'ground', hasGlyph: true, hasNotches: true },
  struct: { label: 'Gebäude (Sechseck, Spitze oben)', d: hex(16, 16, 16), blip: 'struct', hasGlyph: true, hasNotches: true },
  cmd: {
    label: 'Kommandant (Lot-Tropfen, Spitze unten)',
    d: 'M16 32 L4.2 17.6 A12.5 12.5 0 1 1 27.8 17.6 Z',
    blip: 'ground',
    hasGlyph: false,
    hasNotches: false,
  },
  wall: { label: 'Mauer (Mini-Quadrat 50 %)', d: 'M8 8 H24 V24 H8 Z', blip: 'struct', hasGlyph: false, hasNotches: false },
  naval: { label: 'Marine (reserviert, Wanne)', d: 'M1 9 H31 V14 A15 15 0 0 1 1 14 Z', blip: 'ground', hasGlyph: true, hasNotches: true },
};

export interface GlyphDef {
  readonly label: string;
  /** SVG elements inside the central field (8…24); `S` = stroke-only element, `F` = filled. */
  readonly parts: readonly { readonly kind: 'S' | 'F'; readonly d: string; readonly w?: number }[];
}

const S = (d: string, w = 5) => ({ kind: 'S' as const, d, w });
const F = (d: string) => ({ kind: 'F' as const, d });
const circle = (cx: number, cy: number, r: number): string => `M${fmt(cx - r)} ${fmt(cy)} A${r} ${r} 0 1 0 ${fmt(cx + r)} ${fmt(cy)} A${r} ${r} 0 1 0 ${fmt(cx - r)} ${fmt(cy)} Z`;
const FLAME = 'M16 7 C20.5 12 23 15 23 19 A7 7 0 0 1 9 19 C9 15 11.5 12 16 7 Z';

/** The 19 role glyphs (faction.md §6.3; `roster.json` → iconGlyphs). */
export const GLYPHS: Readonly<Record<string, GlyphDef>> = {
  direct: { label: 'Direktfeuer (Punkt)', parts: [F(circle(16, 16, 5))] },
  bot: { label: 'Direktfeuer-Läufer (Punkt + Beine)', parts: [F(circle(16, 13.5, 4.5)), S('M12.5 19 L10.5 24', 4.5), S('M19.5 19 L21.5 24', 4.5)] },
  sniper: { label: 'Präzision (—●—)', parts: [S('M7 16 H25', 4), F(circle(16, 16, 4.5))] },
  arty: { label: 'Artillerie (Bogen)', parts: [S('M9 21 Q16 7 23 21')] },
  mml: { label: 'Raketenartillerie (Doppelbogen)', parts: [S('M6.5 22 Q11 11 15.5 22', 4.5), S('M16.5 22 Q21 11 25.5 22', 4.5)] },
  aa: { label: 'Flugabwehr (Chevron ^)', parts: [S('M9 21 L16 11 L23 21')] },
  sam: { label: 'Raketen-Flugabwehr (^^)', parts: [S('M9 17 L16 9 L23 17', 4.5), S('M9 25 L16 17 L23 25', 4.5)] },
  bomb: { label: 'Luft-gegen-Boden (Chevron v)', parts: [S('M9 11 L16 21 L23 11')] },
  fbomb: { label: 'Jagdbomber (^ über v)', parts: [S('M10 14 L16 8 L22 14', 4.5), S('M10 16 L16 22 L22 16', 4.5)] },
  build: { label: 'Bauen (Plus)', parts: [S('M16 8.5 V23.5 M8.5 16 H23.5')] },
  intel: { label: 'Aufklärung / Radar (Ring)', parts: [S(circle(16, 16, 5.5), 4.5)] },
  shield: { label: 'Schild (Kuppel)', parts: [S('M9.5 23 V17 A6.5 6.5 0 0 1 22.5 17 V23')] },
  mass: { label: 'Mass erzeugen (Raute)', parts: [F('M16 7.5 L24.5 16 L16 24.5 L7.5 16 Z')] },
  energy: { label: 'Energy erzeugen (Flamme)', parts: [F(FLAME)] },
  hydro: {
    label: 'Energy aus Spot (Flamme + Welle)',
    parts: [F('M16 5 C19.5 9 21.5 11.5 21.5 14.5 A5.5 5.5 0 0 1 10.5 14.5 C10.5 11.5 12.5 9 16 5 Z'), S('M8 24 Q12 20.5 16 24 T24 24', 4)],
  },
  mstore: { label: 'Mass lagern (Raute hohl)', parts: [S('M16 9 L23 16 L16 23 L9 16 Z', 4)] },
  estore: { label: 'Energy lagern (Flamme hohl)', parts: [S('M16 9 C19.5 13 21.5 15.5 21.5 18.5 A5.5 5.5 0 0 1 10.5 18.5 C10.5 15.5 12.5 13 16 9 Z', 4)] },
  fac_land: { label: 'Landfabrik (Mini-Kachel)', parts: [F('M11 9 H21 L23 11 V21 L21 23 H11 L9 21 V11 Z')] },
  fac_air: { label: 'Luftfabrik (Mini-Dreieck)', parts: [F('M16 8.5 L24 23 H8 Z')] },
};

export interface ParsedIcon {
  readonly id: string;
  readonly form: IconForm;
  readonly glyph: string | null;
  readonly tech: number;
}

export function parseIconId(id: string): ParsedIcon {
  if (id === 'wall') return { id, form: 'wall', glyph: null, tech: 0 };
  if (id === 'cmd_commander') return { id, form: 'cmd', glyph: null, tech: 0 };
  const segs = id.split('_');
  const form = segs[0] as IconForm;
  if (!(form in FORMS)) throw new Error(`icon ${id}: unknown form "${segs[0]}"`);
  const last = segs[segs.length - 1] ?? '';
  const techMatch = /^t([1-4])$/.exec(last);
  const tech = techMatch === null ? 0 : Number(techMatch[1]);
  const glyph = segs.slice(1, techMatch === null ? segs.length : -1).join('_');
  if (glyph !== '' && !(glyph in GLYPHS)) throw new Error(`icon ${id}: unknown glyph "${glyph}"`);
  return { id, form, glyph: glyph === '' ? null : glyph, tech };
}

/** Icon size factor (× 20 px base × UI scale), faction.md §6.5. */
export function iconScale(p: ParsedIcon): number {
  if (p.form === 'cmd') return 1.6;
  if (p.tech === 4) return 1.5; // Experimentals: fast so groß wie der Vogt, aber nie größer

  if (p.form === 'wall') return 0.6;
  if (p.form === 'struct') return p.glyph === 'arty' && p.tech === 3 ? 1.3 : 1.1;
  if (p.glyph === 'intel') return 1.0;
  return [1, 1, 1.15, 1.3][p.tech] ?? 1;
}

/** Relative luminance of an sRGB hex color. */
export function luma(hexColor: string): number {
  const v = Number.parseInt(hexColor.slice(1), 16);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
}

export function glyphMarkup(glyph: string, color: string, halo: string | null): string {
  const g = GLYPHS[glyph];
  if (g === undefined) throw new Error(`unknown glyph ${glyph}`);
  const layer = (col: string, extra: number, opacity: number): string =>
    g.parts
      .map((p) =>
        p.kind === 'S'
          ? `<path d="${p.d}" fill="none" stroke="${col}" stroke-opacity="${opacity}" stroke-width="${(p.w ?? 5) + extra}" stroke-linecap="round" stroke-linejoin="round"/>`
          : `<path d="${p.d}" fill="${col}" fill-opacity="${opacity}"${extra > 0 ? ` stroke="${col}" stroke-opacity="${opacity}" stroke-width="${extra}" stroke-linejoin="round"` : ''}/>`,
      )
      .join('');
  return (halo === null ? '' : layer(halo, 1.6, 0.75)) + layer(color, 0, 1);
}

export function notchMarkup(n: number, color = CERAMIC): string {
  let out = '';
  for (let i = 0; i < n; i++) {
    // 5 × 9 DE, gap 3 DE, top right outside the form (right edge at x = 34)
    const x = 34 - 5 - (n - 1 - i) * 8;
    out += `<rect x="${x}" y="-12" width="5" height="9" rx="1" fill="${color}" stroke="${CONTOUR}" stroke-opacity="0.8" stroke-width="1.5"/>`;
  }
  return out;
}

/**
 * Experimental marker (tech 4): ceramic square brackets left and right of the form, 4 DE stroke with graphite halo,
 * serifs 5 DE long – outside the 0…32 form box like the notches, so it never collides with a glyph. Readable at
 * 20 px × 1.5 as “[■]”, i.e. the same form, but framed.
 */
export function bracketMarkup(color = CERAMIC): string {
  const d = 'M-0.5 -1.5 H-4.5 V33.5 H-0.5 M32.5 -1.5 H36.5 V33.5 H32.5';
  return (
    `<path d="${d}" fill="none" stroke="${CONTOUR}" stroke-opacity="0.8" stroke-width="6" stroke-linecap="square" stroke-linejoin="miter"/>` +
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="3.6" stroke-linecap="square" stroke-linejoin="miter"/>`
  );
}

export type IconVariant = 'normal' | 'selected' | 'blip' | 'ghost';

export interface IconOptions {
  readonly variant?: IconVariant;
  /** Team color (sRGB hex); in the SVG it is `var(--team, <hex>)` so CSS can recolor inline SVGs. */
  readonly team?: string;
  /** Pixel size of the <svg> element (default: none, scales with CSS). */
  readonly size?: number;
  /** Add a <title>. */
  readonly title?: string;
}

const BLIP_FORMS: Record<FormDef['blip'], string> = {
  ground: oct(16, 16, 15),
  air: FORMS.air.d,
  struct: FORMS.struct.d,
};

function wrap(inner: string, o: IconOptions): string {
  const size = o.size === undefined ? '' : ` width="${o.size}" height="${Math.round((o.size * 54) / 48)}"`;
  const title = o.title === undefined ? '' : `<title>${o.title}</title>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ICON_VIEWBOX}"${size}>${title}${inner}</svg>`;
}

/** Complete icon as SVG markup. */
export function iconSvg(id: string, o: IconOptions = {}): string {
  const p = parseIconId(id);
  const form = FORMS[p.form];
  const variant = o.variant ?? 'normal';
  const team = o.team ?? DEFAULT_TEAM;
  const fill = `var(--team, ${team})`;
  if (variant === 'blip') {
    return wrap(`<path d="${BLIP_FORMS[form.blip]}" fill="none" stroke="${BLIP_GRAY}" stroke-width="4" stroke-linejoin="round"/>`, o);
  }
  const glyphCol = luma(team) > 0.7 ? CONTOUR : CERAMIC;
  if (variant === 'ghost') {
    const glyph = p.glyph === null ? '' : glyphMarkup(p.glyph, CERAMIC, CONTOUR);
    return wrap(
      `<g opacity="0.48"><path d="${FORMS.struct.d}" fill="${fill}" style="filter:saturate(0.25)"/>` +
        `<path d="${FORMS.struct.d}" fill="none" stroke="${CONTOUR}" stroke-width="3" stroke-dasharray="4 3" stroke-linejoin="round"/>${glyph}${p.tech === 4 ? bracketMarkup() : ''}</g>`,
      o,
    );
  }
  let inner = '';
  if (variant === 'selected') inner += `<path d="${form.d}" fill="none" stroke="#FFFFFF" stroke-width="9" stroke-linejoin="round"/>`;
  inner += `<path d="${form.d}" fill="${fill}" stroke="${CONTOUR}" stroke-opacity="0.8" stroke-width="3.2" stroke-linejoin="round"/>`;
  if (form.hasGlyph && p.glyph !== null) inner += glyphMarkup(p.glyph, glyphCol, glyphCol === CERAMIC ? CONTOUR : null);
  if (form.hasNotches && p.tech === 4) inner += bracketMarkup();
  else if (form.hasNotches && p.tech > 0) inner += notchMarkup(p.tech);
  return wrap(inner, o);
}

/** A single base form (for the grammar sheet). */
export function formSvg(form: IconForm, o: IconOptions = {}): string {
  const f = FORMS[form];
  return wrap(`<path d="${f.d}" fill="var(--team, ${o.team ?? DEFAULT_TEAM})" stroke="${CONTOUR}" stroke-opacity="0.8" stroke-width="3.2" stroke-linejoin="round"/>`, o);
}

/** A single glyph on a neutral dark tile (for the grammar sheet). */
export function glyphSvg(glyph: string, o: IconOptions = {}): string {
  return wrap(`<rect x="0" y="0" width="32" height="32" rx="3" fill="#3A3F46"/>${glyphMarkup(glyph, CERAMIC, CONTOUR)}`, o);
}

/** Tech notches alone. */
export function notchSvg(n: 1 | 2 | 3, o: IconOptions = {}): string {
  return wrap(`<rect x="0" y="0" width="32" height="32" rx="3" fill="none" stroke="#888" stroke-dasharray="2 2"/>${notchMarkup(n)}`, o);
}

/** Experimental bracket alone (for the grammar sheet). */
export function bracketSvg(o: IconOptions = {}): string {
  return wrap(`<rect x="0" y="0" width="32" height="32" rx="3" fill="none" stroke="#888" stroke-dasharray="2 2"/>${bracketMarkup()}`, o);
}

/** Radar blip of a class. */
export function blipSvg(kind: FormDef['blip'], o: IconOptions = {}): string {
  return wrap(`<path d="${BLIP_FORMS[kind]}" fill="none" stroke="${BLIP_GRAY}" stroke-width="4" stroke-linejoin="round"/>`, o);
}
