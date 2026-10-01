/** Parse/format helpers of the panels (src/ui/format.ts). */
import { describe, expect, it } from 'vitest';
import {
  formatCount,
  formatEntries,
  formatMilli,
  formatPercent,
  formatReclaimTotal,
  formatScaled,
  formatSeed,
  formatWu,
  nextSeed,
  parseEntries,
  parseFieldName,
  parseIntRange,
  parseMilli,
  parsePercent,
  parseScaled,
  parseSeed,
  parseWuToRaw,
  PROP_ID_RE,
  type ParseResult,
} from '../../src/ui/format.ts';

function value<T>(r: ParseResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r.value;
}

function error<T>(r: ParseResult<T>): string {
  if (r.ok) throw new Error(`expected an error, got ${JSON.stringify(r.value)}`);
  return r.error;
}

const MAX_512 = 512 * 4096;

describe('WU <-> Fx raw', () => {
  it('formats raw as WU with trimmed decimals', () => {
    expect(formatWu(0)).toBe('0');
    expect(formatWu(4096)).toBe('1');
    expect(formatWu(2048)).toBe('0.5');
    expect(formatWu(51200)).toBe('12.5');
    expect(formatWu(1)).toBe('0'); // 0.000244 WU rounds away at 3 decimals
    expect(formatWu(1024)).toBe('0.25');
    expect(formatWu(4096 * 511 + 3072)).toBe('511.75');
    expect(formatWu(4096 * 100 + 410, 1)).toBe('100.1');
  });

  it('parses WU (dot, comma, unit, whitespace) exactly to raw', () => {
    expect(value(parseWuToRaw('12.5', MAX_512))).toBe(51200);
    expect(value(parseWuToRaw(' 12,5 ', MAX_512))).toBe(51200);
    expect(value(parseWuToRaw('12.5 WU', MAX_512))).toBe(51200);
    expect(value(parseWuToRaw('0', MAX_512))).toBe(0);
    expect(value(parseWuToRaw('.5', MAX_512))).toBe(2048);
    expect(value(parseWuToRaw('512', MAX_512))).toBe(MAX_512);
    expect(value(parseWuToRaw('0.0001', MAX_512))).toBe(0);
    expect(value(parseWuToRaw('0.0002', MAX_512))).toBe(1);
  });

  it('roundtrips every formatted quarter-WU value', () => {
    for (let raw = 0; raw <= MAX_512; raw += 1024 * 37) {
      expect(value(parseWuToRaw(formatWu(raw), MAX_512))).toBe(raw);
    }
  });

  it('rejects empty, garbage, negative and out-of-map values', () => {
    expect(error(parseWuToRaw('', MAX_512))).toMatch(/Wert/);
    expect(error(parseWuToRaw('   ', MAX_512))).toMatch(/Wert/);
    expect(error(parseWuToRaw('abc', MAX_512))).toMatch(/Zahl/);
    expect(error(parseWuToRaw('1e3', MAX_512))).toMatch(/Zahl/);
    expect(error(parseWuToRaw('1.2.3', MAX_512))).toMatch(/Zahl/);
    expect(error(parseWuToRaw('-1', MAX_512))).toBe('Erlaubt: 0 … 512');
    expect(error(parseWuToRaw('512.001', MAX_512))).toBe('Erlaubt: 0 … 512');
  });
});

describe('milli and per mille', () => {
  it('formats milli with exactly three decimals', () => {
    expect(formatMilli(0)).toBe('0.000');
    expect(formatMilli(1)).toBe('0.001');
    expect(formatMilli(25000)).toBe('25.000');
    expect(formatMilli(12345)).toBe('12.345');
    expect(formatMilli(0xffffffff)).toBe('4294967.295');
    expect(formatScaled(-1500, 3)).toBe('-1.500');
    expect(formatScaled(7, 0)).toBe('7');
  });

  it('parses units into milli without float error', () => {
    expect(value(parseMilli('25'))).toBe(25000);
    expect(value(parseMilli('25.5'))).toBe(25500);
    expect(value(parseMilli('0,001'))).toBe(1);
    expect(value(parseMilli('0.1'))).toBe(100);
    expect(value(parseMilli('1.005'))).toBe(1005);
    expect(value(parseMilli('4294967.295'))).toBe(0xffffffff);
    expect(value(parseMilli('000012.300'))).toBe(12300);
    for (const m of [0, 1, 99, 1000, 25000, 123456, 0xffffffff]) expect(value(parseMilli(formatMilli(m)))).toBe(m);
  });

  it('rejects milli input with too many decimals, negatives or overflow', () => {
    expect(error(parseMilli('0.0001'))).toBe('Höchstens 3 Nachkommastellen');
    expect(error(parseMilli('-1'))).toBe('Erlaubt: 0.000 … 4294967.295');
    expect(error(parseMilli('4294967.296'))).toBe('Erlaubt: 0.000 … 4294967.295');
    expect(error(parseMilli('99999999999999999999'))).toMatch(/Erlaubt/);
    expect(error(parseMilli('x'))).toBe('Keine gültige Zahl');
    expect(error(parseMilli(''))).toBe('Bitte einen Wert eingeben');
    expect(error(parseScaled('1.5', 0, 0, 10))).toBe('Nur ganze Zahlen');
  });

  it('percent <-> per mille', () => {
    expect(formatPercent(800)).toBe('80');
    expect(formatPercent(805)).toBe('80.5');
    expect(formatPercent(1)).toBe('0.1');
    expect(formatPercent(1200)).toBe('120');
    expect(value(parsePercent('80'))).toBe(800);
    expect(value(parsePercent('80,5 %'))).toBe(805);
    expect(value(parsePercent('0.1'))).toBe(1);
    expect(value(parsePercent('6553.5'))).toBe(0xffff);
    expect(error(parsePercent('0'))).toBe('Erlaubt: 0.1 … 6553.5');
    expect(error(parsePercent('80.55'))).toBe('Höchstens 1 Nachkommastelle');
    expect(error(parsePercent('7000'))).toBe('Erlaubt: 0.1 … 6553.5');
  });
});

describe('integers and seeds', () => {
  it('parses integer ranges', () => {
    expect(value(parseIntRange('64', 1, 4096))).toBe(64);
    expect(value(parseIntRange(' 4096 ', 1, 4096))).toBe(4096);
    expect(value(parseIntRange('+7', 1, 10))).toBe(7);
    expect(value(parseIntRange('-0', 0, 10))).toBe(0);
    expect(error(parseIntRange('0', 1, 4096))).toBe('Erlaubt: 1 … 4096');
    expect(error(parseIntRange('4097', 1, 4096))).toBe('Erlaubt: 1 … 4096');
    expect(error(parseIntRange('1.5', 1, 4096))).toBe('Nur ganze Zahlen');
    expect(error(parseIntRange('12a', 1, 4096))).toBe('Keine gültige Zahl');
    expect(error(parseIntRange('0x10', 0, 100))).toBe('Keine gültige Zahl');
    expect(error(parseIntRange('1234567890123456789', 0, 100))).toBe('Erlaubt: 0 … 100');
  });

  it('parses seeds as decimal or hex u32', () => {
    expect(value(parseSeed('12345'))).toBe(12345);
    expect(value(parseSeed('0xDEADBEEF'))).toBe(0xdeadbeef);
    expect(value(parseSeed('4294967295'))).toBe(0xffffffff);
    expect(error(parseSeed('4294967296'))).toBe('Erlaubt: 0 … 4294967295');
    expect(error(parseSeed('0x100000000'))).toBe('Erlaubt: 0 … 4294967295');
    expect(error(parseSeed('-1'))).toBe('Erlaubt: 0 … 4294967295');
    expect(formatSeed(0xdeadbeef)).toBe('3735928559');
    expect(formatSeed(-1)).toBe('4294967295');
  });

  it('nextSeed is deterministic, u32 and differs from the current seed', () => {
    const a = nextSeed(12345, 7, 0);
    expect(nextSeed(12345, 7, 0)).toBe(a);
    expect(a).not.toBe(12345);
    expect(Number.isInteger(a) && a >= 0 && a <= 0xffffffff).toBe(true);
    expect(nextSeed(12345, 8, 0)).not.toBe(a);
    expect(nextSeed(12345, 7, 1)).not.toBe(a);
    const seen = new Set<number>();
    let s = 1;
    for (let i = 0; i < 200; i++) {
      s = nextSeed(s, i, 3);
      seen.add(s);
    }
    expect(seen.size).toBe(200);
  });

  it('formats counts with grouping and reclaim totals exactly', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(12345)).toBe('12 345');
    expect(formatCount(1234567)).toBe('1 234 567');
    expect(formatReclaimTotal(3, 25000)).toBe('75.000');
    expect(formatReclaimTotal(30000, 1)).toBe('30.000');
    expect(formatReclaimTotal(0, 12345)).toBe('0.000');
  });
});

describe('prop field entries', () => {
  it('uses the PROP id syntax of the format', () => {
    expect(PROP_ID_RE.test('core:tree_01')).toBe(true);
    expect(PROP_ID_RE.test('mod_x:rocks/big-2.v1')).toBe(true);
    expect(PROP_ID_RE.test('Core:tree')).toBe(false);
    expect(PROP_ID_RE.test('tree_01')).toBe(false);
  });

  it('parses id:weight lists with every separator', () => {
    expect(value(parseEntries('core:tree_01:3, core:tree_02:1'))).toEqual([
      { id: 'core:tree_01', weight: 3 },
      { id: 'core:tree_02', weight: 1 },
    ]);
    expect(value(parseEntries('core:tree_01'))).toEqual([{ id: 'core:tree_01', weight: 1 }]);
    expect(value(parseEntries('core:rock_01 : 5; core:rock_02\ncore:rock_03:65535,'))).toEqual([
      { id: 'core:rock_01', weight: 5 },
      { id: 'core:rock_02', weight: 1 },
      { id: 'core:rock_03', weight: 65535 },
    ]);
    // "core:12" is an id (its head "core" is not an id), not "core" with weight 12.
    expect(value(parseEntries('core:12'))).toEqual([{ id: 'core:12', weight: 1 }]);
  });

  it('roundtrips formatEntries', () => {
    const entries = [
      { id: 'core:tree_01', weight: 2 },
      { id: 'core:tree_02', weight: 1 },
      { id: 'core:bush/a.b-c', weight: 40000 },
    ];
    expect(formatEntries(entries)).toBe('core:tree_01:2, core:tree_02:1, core:bush/a.b-c:40000');
    expect(value(parseEntries(formatEntries(entries)))).toEqual(entries);
  });

  it('rejects invalid lists', () => {
    expect(error(parseEntries(''))).toBe('1 … 16 Einträge');
    expect(error(parseEntries(' , ; '))).toBe('1 … 16 Einträge');
    const many = Array.from({ length: 17 }, (_, i) => `core:t${i}`).join(',');
    expect(error(parseEntries(many))).toBe('1 … 16 Einträge');
    expect(error(parseEntries('tree_01'))).toMatch(/keine gültige ID/);
    expect(error(parseEntries('Core:Tree'))).toMatch(/keine gültige ID/);
    expect(error(parseEntries('core:tree_01:0'))).toMatch(/Gewicht/);
    expect(error(parseEntries('core:tree_01:65536'))).toMatch(/Gewicht/);
    expect(error(parseEntries('core:tree_01:1.5'))).toMatch(/Gewicht/);
    expect(error(parseEntries('core:tree_01:-2'))).toMatch(/Gewicht/);
    expect(error(parseEntries('core:tree_01:1, core:tree_01:2'))).toMatch(/doppelt/);
    expect(error(parseEntries(`core:${'x'.repeat(130)}`))).toMatch(/länger als 128 Bytes/);
  });
});

describe('field names', () => {
  it('trims and accepts up to 64 UTF-8 bytes', () => {
    expect(value(parseFieldName('  Wald Nord  '))).toBe('Wald Nord');
    expect(value(parseFieldName('x'.repeat(64)))).toBe('x'.repeat(64));
    expect(value(parseFieldName('ä'.repeat(32)))).toBe('ä'.repeat(32));
  });

  it('rejects empty, too long and control characters', () => {
    expect(error(parseFieldName('   '))).toBe('Bitte einen Wert eingeben');
    expect(error(parseFieldName('x'.repeat(65)))).toBe('1 … 64 Bytes (UTF-8)');
    expect(error(parseFieldName('ä'.repeat(33)))).toBe('1 … 64 Bytes (UTF-8)');
    expect(error(parseFieldName('a\tb'))).toBe('Keine Steuerzeichen erlaubt');
    expect(error(parseFieldName('a\u007fb'))).toBe('Keine Steuerzeichen erlaubt');
  });
});
