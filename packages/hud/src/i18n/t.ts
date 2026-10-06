import { fmtNum } from '../format/index.ts';
import { locale } from './locale.ts';
import type { Locale } from './locale.ts';
import { pseudo } from './pseudo.ts';
import { DE_MESSAGES, EN_MESSAGES } from './tables.ts';
import type { MsgKey } from './tables.ts';

/** Parameter values; numbers are formatted for the active locale (fmtNum, ≤ 2 decimals). */
export type MsgParams = Readonly<Record<string, string | number>>;

/** Base keys that have `.one` / `.other` plural forms. */
export type PluralBase = MsgKey extends infer K ? (K extends `${infer B}.other` ? B : never) : never;

const pseudoCache = new Map<string, string>();
const pluralRules = new Map<string, Intl.PluralRules>();

function raw(key: string, l: Locale): string | undefined {
  if (l === 'en') return EN_MESSAGES[key] ?? DE_MESSAGES[key];
  const de = DE_MESSAGES[key];
  if (de === undefined || l === 'de') return de;
  let p = pseudoCache.get(key);
  if (p === undefined) {
    p = pseudo(de);
    pseudoCache.set(key, p);
  }
  return p;
}

/** Replaces `{name}` placeholders; unknown placeholders stay visible. */
export function interpolate(template: string, params: MsgParams | undefined, l: Locale): string {
  if (!params) return template;
  return template.replace(/\{([^{}]+)\}/g, (whole, name: string) => {
    const v = params[name];
    if (v === undefined) return whole;
    return typeof v === 'number' ? fmtNum(v, 2, l) : v;
  });
}

/** True when the key exists in the German source table. */
export function hasMsg(key: string): key is MsgKey {
  return DE_MESSAGES[key] !== undefined;
}

/**
 * Translates a key for the current locale (reads the `locale` signal, so components re-render on change).
 * A key missing at runtime (only possible for computed keys) renders as the key itself.
 */
export function t(key: MsgKey, params?: MsgParams, l: Locale = locale.value): string {
  const template = raw(key, l);
  return template === undefined ? key : interpolate(template, params, l);
}

/** Like `t` for keys built at runtime (e.g. `ui.alerts.${type}`); falls back to the key. */
export function tDynamic(key: string, params?: MsgParams, l: Locale = locale.value): string {
  const template = raw(key, l);
  return template === undefined ? key : interpolate(template, params, l);
}

function pluralCategory(n: number, l: Locale): 'one' | 'other' {
  const tag = l === 'en' ? 'en' : 'de';
  let rules = pluralRules.get(tag);
  if (!rules) {
    rules = new Intl.PluralRules(tag);
    pluralRules.set(tag, rules);
  }
  return rules.select(n) === 'one' ? 'one' : 'other';
}

/** Plural: picks `<base>.one` / `<base>.other` and passes `{n}` (plus extra params). */
export function tn(base: PluralBase, n: number, params?: MsgParams, l: Locale = locale.value): string {
  const cat = pluralCategory(n, l);
  const key = `${base}.${cat}`;
  const template = raw(key, l) ?? raw(`${base}.other`, l);
  if (template === undefined) return key;
  return interpolate(template, { ...params, n }, l);
}
