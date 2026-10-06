import { intlTag, locale } from '../i18n/locale.ts';
import type { Locale } from '../i18n/locale.ts';

/**
 * Number/time formatting for the HUD (ui.md §3.2): DE `1.230` / `28,0`, EN `1,230` / `28.0`,
 * real minus sign U+2212, tabular digits via the `num` class. Formatters are cached per locale+options.
 * Every function takes an optional locale; the default reads the `locale` signal (reactive in components).
 */

export const MINUS = '−';
const NBSP = ' ';

const cache = new Map<string, Intl.NumberFormat>();

function numberFormat(l: Locale, minDigits: number, maxDigits: number): Intl.NumberFormat {
  const key = `${l}|${minDigits}|${maxDigits}`;
  let nf = cache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(intlTag(l), {
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
      useGrouping: true,
    });
    cache.set(key, nf);
  }
  return nf;
}

function withMinus(s: string): string {
  return s.replace('-', MINUS);
}

/** Avoids "−0" after rounding. */
function clean(v: number): number {
  return Object.is(v, -0) ? 0 : v;
}

/** Integer with grouping: 1230 → "1.230" (de) / "1,230" (en). Rounds half away from zero. */
export function fmtInt(v: number, l: Locale = locale.value): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? `${MINUS}∞` : '–';
  const r = clean(Math.sign(v) * Math.round(Math.abs(v)));
  return withMinus(numberFormat(l, 0, 0).format(r));
}

/** Fixed decimals: fmtDec(28, 1) → "28,0" (de) / "28.0" (en). */
export function fmtDec(v: number, digits = 1, l: Locale = locale.value): string {
  if (!Number.isFinite(v)) return fmtInt(v, l);
  const f = 10 ** digits;
  const r = clean((Math.sign(v) * Math.round(Math.abs(v) * f)) / f);
  return withMinus(numberFormat(l, digits, digits).format(r));
}

/** Up to `maxDigits` decimals without trailing zeros (used for i18n parameters). */
export function fmtNum(v: number, maxDigits = 2, l: Locale = locale.value): string {
  if (!Number.isFinite(v)) return fmtInt(v, l);
  return withMinus(numberFormat(l, 0, maxDigits).format(clean(v)));
}

/** Always signed: "+44,0", "−3,5" (U+2212), "±0,0" when it rounds to zero. */
export function fmtSigned(v: number, digits = 1, l: Locale = locale.value): string {
  const body = digits === 0 ? fmtInt(Math.abs(v), l) : fmtDec(Math.abs(v), digits, l);
  const f = 10 ** digits;
  const rounded = Math.round(Math.abs(v) * f);
  if (rounded === 0) return `±${body}`;
  return `${v > 0 ? '+' : MINUS}${body}`;
}

/** Fraction as percent: 0.72 → "72 %" (de, no-break space) / "72%" (en). */
export function fmtPct(fraction: number, digits = 0, l: Locale = locale.value): string {
  const n = digits === 0 ? fmtInt(fraction * 100, l) : fmtDec(fraction * 100, digits, l);
  return l === 'en' ? `${n}%` : `${n}${NBSP}%`;
}

/** Rate per second: "28,0/s"; `signed` adds + / − (income/usage lines). */
export function fmtRate(perSec: number, digits = 1, signed = false, l: Locale = locale.value): string {
  return `${signed ? fmtSigned(perSec, digits, l) : fmtDec(perSec, digits, l)}/s`;
}

/** Sim time: "mm:ss", from 60 min "h:mm:ss" (ui.md §5.2). Negative input clamps to 0. */
export function fmtTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${String(m).padStart(2, '0')}:${ss}`;
}

/** Byte counts with SI units (loading screen, replay size): "38,2 MB". */
export function fmtBytes(bytes: number, l: Locale = locale.value): string {
  const b = Math.max(0, bytes);
  if (b < 1000) return `${fmtInt(b, l)}${NBSP}B`;
  if (b < 1e6) return `${fmtDec(b / 1e3, 1, l)}${NBSP}KB`;
  if (b < 1e9) return `${fmtDec(b / 1e6, 1, l)}${NBSP}MB`;
  return `${fmtDec(b / 1e9, 2, l)}${NBSP}GB`;
}

/** U+2007 FIGURE SPACE: as wide as a tabular digit (and, in IBM Plex, as + − ±). */
export const FIGURE_SPACE = '\u2007';
/** U+2008 PUNCTUATION SPACE: as wide as the decimal/group separators `,` and `.`. */
export const PUNCT_SPACE = '\u2008';

const WIDE = /[0-9+\u2212\u00b1\u2007]/u;
const NARROW = /[.,\u2008]/u;

/**
 * Pads a formatted number on the left to a constant rendered width (ui.md §9.2 „reservierte Mindestbreite“):
 * `wide` slots of digit width (digits, signs, U+2007) and `narrow` slots of separator width (`,` `.` U+2008).
 * Right-aligned values keep their start point when the digit count changes, so a 10-Hz value never causes a
 * layout shift (tabular figures: digits, + − ± and U+2007 share one advance). Longer strings stay unchanged.
 * Display only – accessible names use the unpadded text.
 */
export function padFigures(s: string, wide: number, narrow = 0): string {
  let w = 0;
  let n = 0;
  for (const ch of s) {
    if (WIDE.test(ch)) w++;
    else if (NARROW.test(ch)) n++;
  }
  const addNarrow = Math.max(0, narrow - n);
  const addWide = Math.max(0, wide - w);
  return addNarrow === 0 && addWide === 0 ? s : `${PUNCT_SPACE.repeat(addNarrow)}${FIGURE_SPACE.repeat(addWide)}${s}`;
}
