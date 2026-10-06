import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import {
  DE_TABLES,
  EN_TABLES,
  NAMESPACES,
  PSEUDO_EXPANSION,
  hasMsg,
  interpolate,
  locale,
  pseudo,
  setLocale,
  t,
  tDynamic,
  tn,
  visibleLength,
} from '../../src/i18n/index.ts';

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/i18n/locales');

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1] as string).sort();
}

afterEach(() => setLocale('de'));

describe('tables', () => {
  test('every namespace has a DE and an EN file and nothing else lives in locales/', () => {
    const files = readdirSync(LOCALES_DIR).sort();
    const expected = NAMESPACES.flatMap((ns) => [`${ns}.de.json`, `${ns}.en.json`]).sort();
    expect(files).toEqual(expected);
  });

  test.each(NAMESPACES)('namespace %s: EN has exactly the DE keys (no missing, no extra)', (ns) => {
    const de = Object.keys(DE_TABLES[ns]).sort();
    // Read the raw EN file: the typed table cannot show extra keys.
    const en = Object.keys(JSON.parse(readFileSync(join(LOCALES_DIR, `${ns}.en.json`), 'utf8')) as object).sort();
    expect(en).toEqual(de);
    expect(Object.keys(EN_TABLES[ns]).sort()).toEqual(de);
  });

  test.each(NAMESPACES)('namespace %s: keys use the prefix ui.<ns>. and values are non-empty', (ns) => {
    for (const table of [DE_TABLES[ns], EN_TABLES[ns]] as Readonly<Record<string, string>>[]) {
      for (const [key, value] of Object.entries(table)) {
        expect(key.startsWith(`ui.${ns}.`), key).toBe(true);
        expect(typeof value).toBe('string');
        expect(value.trim().length, key).toBeGreaterThan(0);
      }
    }
  });

  test.each(NAMESPACES)('namespace %s: placeholders match between DE and EN', (ns) => {
    const de = DE_TABLES[ns] as Readonly<Record<string, string>>;
    const en = EN_TABLES[ns] as Readonly<Record<string, string>>;
    for (const key of Object.keys(de)) {
      expect(placeholders(en[key] ?? ''), key).toEqual(placeholders(de[key] ?? ''));
    }
  });

  test('plural keys come in .one/.other pairs', () => {
    for (const ns of NAMESPACES) {
      const keys = Object.keys(DE_TABLES[ns]);
      for (const k of keys) {
        if (k.endsWith('.one')) expect(keys, k).toContain(`${k.slice(0, -4)}.other`);
      }
    }
  });

  test('JSON files are LF-terminated, 2-space indented objects of strings', () => {
    for (const f of readdirSync(LOCALES_DIR)) {
      const text = readFileSync(join(LOCALES_DIR, f), 'utf8');
      expect(text.endsWith('\n'), f).toBe(true);
      expect(text.includes('\r'), f).toBe(false);
      const parsed = JSON.parse(text) as Record<string, unknown>;
      for (const v of Object.values(parsed)) expect(typeof v).toBe('string');
      if (Object.keys(parsed).length > 0) expect(text).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
    }
  });
});

describe('t / tn', () => {
  test('translates for the active locale and follows the signal', () => {
    expect(t('ui.common.back')).toBe('Zurück');
    setLocale('en');
    expect(locale.value).toBe('en');
    expect(t('ui.common.back')).toBe('Back');
    expect(t('ui.common.back', undefined, 'de')).toBe('Zurück');
  });

  test('interpolates parameters and formats numbers per locale', () => {
    expect(t('ui.common.of', { value: 2840, max: 4900 })).toBe('2.840 / 4.900');
    expect(t('ui.common.of', { value: 2840, max: 4900 }, 'en')).toBe('2,840 / 4,900');
    expect(t('ui.common.worldUnits', { value: 18.5 })).toBe('18,5 WU');
    expect(interpolate('{a} {missing}', { a: 'x' }, 'de')).toBe('x {missing}');
  });

  test('plural forms', () => {
    expect(tn('ui.common.units', 1)).toBe('1 Einheit');
    expect(tn('ui.common.units', 19)).toBe('19 Einheiten');
    expect(tn('ui.common.units', 0, undefined, 'en')).toBe('0 units');
    expect(tn('ui.common.types', 1, undefined, 'en')).toBe('1 type');
    expect(tn('ui.common.units', 1200)).toBe('1.200 Einheiten');
  });

  test('dynamic keys fall back to the key', () => {
    expect(tDynamic('ui.common.level.crit')).toBe('Kritisch');
    expect(tDynamic('ui.nope.missing')).toBe('ui.nope.missing');
    expect(hasMsg('ui.common.yes')).toBe(true);
    expect(hasMsg('ui.nope')).toBe(false);
  });

  test('pseudo locale derives from German, stretched and bracketed', () => {
    setLocale('pseudo');
    const p = t('ui.common.back');
    expect(p.startsWith('[')).toBe(true);
    expect(p.endsWith(']')).toBe(true);
    expect(p).not.toContain('Zurück');
    expect(t('ui.common.of', { value: 1, max: 2 })).toContain('1 / 2');
  });
});

describe('pseudo()', () => {
  const samples = ['Zurück', 'Gefecht starten', 'Stall · Flow {pct}', 'A', 'Werk freigesprochen: Landwerk II'];
  test.each(samples)('"%s" grows by at least 30 % and keeps placeholders', (s) => {
    const p = pseudo(s);
    const inner = p.slice(1, -1);
    expect(visibleLength(inner)).toBeGreaterThanOrEqual(Math.ceil(visibleLength(s) * (1 + PSEUDO_EXPANSION)));
    expect(placeholders(p)).toEqual(placeholders(s));
    expect(/[a-z]/i.test(inner.replace(/\{[^{}]+\}/g, ''))).toBe(false);
  });

  test('empty stays empty', () => {
    expect(pseudo('')).toBe('');
  });
});
