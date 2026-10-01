import { afterEach, describe, expect, test } from 'vitest';
import { MINUS, fmtBytes, fmtDec, fmtInt, fmtNum, fmtPct, fmtRate, fmtSigned, fmtTime } from '../../src/format/index.ts';
import { setLocale } from '../../src/i18n/index.ts';

const NBSP = ' ';
afterEach(() => setLocale('de'));

describe('numbers', () => {
  test('fmtInt groups per locale and rounds', () => {
    expect(fmtInt(1230, 'de')).toBe('1.230');
    expect(fmtInt(1230, 'en')).toBe('1,230');
    expect(fmtInt(312, 'de')).toBe('312');
    expect(fmtInt(412300, 'de')).toBe('412.300');
    expect(fmtInt(2.5, 'de')).toBe('3');
    expect(fmtInt(-2.5, 'de')).toBe(`${MINUS}3`);
    expect(fmtInt(-0.2, 'de')).toBe('0');
    expect(fmtInt(1230, 'pseudo')).toBe('1.230');
  });

  test('fmtInt follows the locale signal by default', () => {
    expect(fmtInt(4900)).toBe('4.900');
    setLocale('en');
    expect(fmtInt(4900)).toBe('4,900');
  });

  test('fmtDec fixed digits and U+2212', () => {
    expect(fmtDec(28, 1, 'de')).toBe('28,0');
    expect(fmtDec(28, 1, 'en')).toBe('28.0');
    expect(fmtDec(-3.46, 1, 'de')).toBe(`${MINUS}3,5`);
    expect(fmtDec(1234.5, 1, 'de')).toBe('1.234,5');
    expect(fmtDec(0.04, 1, 'de')).toBe('0,0');
    expect(fmtDec(-0.04, 1, 'de')).toBe('0,0');
    expect(fmtDec(6.25, 2, 'en')).toBe('6.25');
  });

  test('fmtNum trims trailing zeros', () => {
    expect(fmtNum(18, 2, 'de')).toBe('18');
    expect(fmtNum(18.5, 2, 'de')).toBe('18,5');
    expect(fmtNum(-1.25, 2, 'en')).toBe(`${MINUS}1.25`);
  });

  test('fmtSigned uses real minus, plus and ± for zero', () => {
    expect(fmtSigned(44, 1, 'de')).toBe('+44,0');
    expect(fmtSigned(-3.5, 1, 'de')).toBe(`${MINUS}3,5`);
    expect(fmtSigned(-85, 1, 'en')).toBe(`${MINUS}85.0`);
    expect(fmtSigned(0, 1, 'de')).toBe('±0,0');
    expect(fmtSigned(0.01, 1, 'de')).toBe('±0,0');
    expect(fmtSigned(12, 0, 'de')).toBe('+12');
    expect(fmtSigned(-1200, 0, 'de')).toBe(`${MINUS}1.200`);
    expect(fmtSigned(-3.5, 1, 'de')).not.toContain('-');
  });

  test('fmtPct', () => {
    expect(fmtPct(0.72, 0, 'de')).toBe(`72${NBSP}%`);
    expect(fmtPct(1, 0, 'en')).toBe('100%');
    expect(fmtPct(0.915, 1, 'de')).toBe(`91,5${NBSP}%`);
  });

  test('fmtRate', () => {
    expect(fmtRate(28, 1, false, 'de')).toBe('28,0/s');
    expect(fmtRate(-31.5, 1, true, 'de')).toBe(`${MINUS}31,5/s`);
    expect(fmtRate(6.5, 1, true, 'en')).toBe('+6.5/s');
  });

  test('non-finite values', () => {
    expect(fmtInt(Number.POSITIVE_INFINITY, 'de')).toBe('∞');
    expect(fmtDec(Number.NaN, 1, 'de')).toBe('–');
  });
});

describe('time and bytes', () => {
  test('fmtTime mm:ss, h:mm:ss from 60 min', () => {
    expect(fmtTime(0)).toBe('00:00');
    expect(fmtTime(5)).toBe('00:05');
    expect(fmtTime(702)).toBe('11:42');
    expect(fmtTime(1458.9)).toBe('24:18');
    expect(fmtTime(3599)).toBe('59:59');
    expect(fmtTime(3600)).toBe('1:00:00');
    expect(fmtTime(3725)).toBe('1:02:05');
    expect(fmtTime(-4)).toBe('00:00');
  });

  test('fmtBytes SI units', () => {
    expect(fmtBytes(512, 'de')).toBe(`512${NBSP}B`);
    expect(fmtBytes(118_000, 'de')).toBe(`118,0${NBSP}KB`);
    expect(fmtBytes(38_200_000, 'de')).toBe(`38,2${NBSP}MB`);
    expect(fmtBytes(52_600_000, 'en')).toBe(`52.6${NBSP}MB`);
    expect(fmtBytes(1_500_000_000, 'de')).toBe(`1,50${NBSP}GB`);
  });
});
