/**
 * Locale tables (content/locales/<lang>.json): flat maps i18n key → text. The compiler checks that
 * every key referenced by a blueprint (`nameKey`, `descKey`, …) exists in every language of
 * {@link LOCALE_LANGS}. Keys follow `I18N_KEY_PATTERN` (`unit.core.lnd_t1_tank.name`).
 */
import { Value } from '@sinclair/typebox/value';
import { isPlainObject } from './merge.ts';
import { LocaleTableSchema } from './schema.ts';

/** Languages every referenced key must exist in (DECISIONS: German UI first, English second). */
export const LOCALE_LANGS = ['de', 'en'] as const;
export type LocaleLang = (typeof LOCALE_LANGS)[number];

/** A validated locale table. */
export type LocaleTable = Readonly<Record<string, string>>;

/** One table per language. */
export type LocaleTables = Readonly<Record<LocaleLang, LocaleTable>>;

/** Default repo-relative source path of a language's table (used in diagnostics). */
export function localeSource(lang: LocaleLang): string {
  return `content/locales/${lang}.json`;
}

/** A problem in a locale table (`path` is a JSON pointer, e.g. `/unit.core.cube.name`). */
export interface LocaleIssue {
  readonly path: string;
  readonly message: string;
}

function pointerEscape(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Validates a parsed locale table. Returns the table (only when valid) and the issues found
 * (unknown/invalid keys, empty or non-string values).
 */
export function validateLocaleTable(value: unknown): { table: LocaleTable | null; issues: LocaleIssue[] } {
  if (!isPlainObject(value)) return { table: null, issues: [{ path: '', message: 'locale table must be a JSON object' }] };
  const issues: LocaleIssue[] = [];
  for (const e of Value.Errors(LocaleTableSchema, value)) {
    const path = e.path === '' ? '' : e.path;
    if (!issues.some((i) => i.path === path && i.message === e.message)) issues.push({ path, message: e.message });
  }
  for (const k of Object.keys(value)) {
    if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(k)) {
      const path = `/${pointerEscape(k)}`;
      if (!issues.some((i) => i.path === path)) issues.push({ path, message: `invalid i18n key '${k}'` });
    }
  }
  return { table: issues.length === 0 ? (value as LocaleTable) : null, issues };
}
