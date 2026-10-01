import { describe, expect, it } from 'vitest';
import { ManifestError, parseManifest } from '../../src/catalog/index.ts';
import { SOUND_CATEGORIES } from '../../src/types.ts';
import { loadRealManifest, makeManifest, realManifestBytes } from '../support/index.ts';

/** Raw JSON of the real manifest (fresh, mutable copy). */
function rawReal(): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(realManifestBytes())) as Record<string, unknown>;
}

type Json = Record<string, unknown>;

function sound(m: Json, i: number): Json {
  return (m['sounds'] as Json[])[i]!;
}

function firstLoop(m: Json): Json {
  return (m['sounds'] as Json[]).find((s) => s['loop'] !== null)!;
}

function expectError(json: unknown, path: string, message?: RegExp): ManifestError {
  let caught: unknown = null;
  try {
    parseManifest(json);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ManifestError);
  const err = caught as ManifestError;
  expect(err.path).toBe(path);
  expect(err.message.startsWith(`${path}: `)).toBe(true);
  if (message !== undefined) expect(err.message).toMatch(message);
  return err;
}

describe('parseManifest — real content/audio/dist/manifest.json', () => {
  it('accepts the real manifest: 101 sounds, 246 variants, 17 loops, 15 categories', () => {
    const m = parseManifest(rawReal());
    expect(m.version).toBe(1);
    expect(m.sampleRate).toBe(48000);
    expect(m.maxVoices).toBe(32);
    expect(m.sounds.length).toBe(101);
    expect(m.sounds.reduce((n, s) => n + s.variants.length, 0)).toBe(246);
    expect(m.sounds.filter((s) => s.loop !== null).length).toBe(17);
    expect(Object.keys(m.categories).sort()).toEqual([...SOUND_CATEGORIES].sort());
  });

  it('keeps every used field of every sound and variant unchanged', () => {
    const parsed = parseManifest(rawReal());
    const real = loadRealManifest();
    for (let i = 0; i < real.sounds.length; i++) {
      const a = parsed.sounds[i]!;
      const b = real.sounds[i]!;
      expect({ ...a, variants: undefined }).toEqual({ ...b, variants: undefined });
      for (let v = 0; v < b.variants.length; v++) expect(a.variants[v]).toEqual(b.variants[v]);
    }
    for (const c of SOUND_CATEGORIES) expect(parsed.categories[c]).toEqual(real.categories[c]);
  });

  it('returns a deeply frozen copy (input objects are not reused)', () => {
    const raw = rawReal();
    const m = parseManifest(raw);
    expect(Object.isFrozen(m)).toBe(true);
    expect(Object.isFrozen(m.sounds)).toBe(true);
    expect(Object.isFrozen(m.sounds[0])).toBe(true);
    expect(Object.isFrozen(m.sounds[0]!.variants[0])).toBe(true);
    expect(Object.isFrozen(m.categories.alert)).toBe(true);
    expect(m.sounds[0]).not.toBe(sound(raw, 0));
  });

  it('accepts synthetic manifests from the test helper', () => {
    const m = makeManifest({ sounds: [{ id: 'varkan:x_loop', category: 'unit', loop: true, variants: 2 }, { id: 'common:wpn_x' }] });
    const p = parseManifest(JSON.parse(JSON.stringify(m)));
    expect(p.sounds.length).toBe(2);
    expect(p.sounds[0]!.loop).toEqual(m.sounds[0]!.loop);
  });

  it('fills missing per-sound policy fields from the category policy', () => {
    const raw = rawReal();
    const s = sound(raw, 0); // common:alt_base_attacked
    for (const k of ['priority', 'cooldownMs', 'maxVoices', 'bus', 'channels', 'spatial', 'tags', 'description']) delete s[k];
    const m = parseManifest(raw);
    const cat = m.categories.alert;
    const r = m.sounds[0]!;
    expect(r.priority).toBe(cat.priority);
    expect(r.cooldownMs).toBe(cat.cooldownMs);
    expect(r.maxVoices).toBe(cat.maxVoices);
    expect(r.bus).toBe(cat.bus);
    expect(r.channels).toBe(cat.channels);
    expect(r.spatial).toBe(cat.spatial);
    expect(r.tags).toEqual([]);
  });
});

describe('parseManifest — ManifestError with JSON path', () => {
  it('rejects non-objects and wrong versions', () => {
    expectError(null, '$', /expected an object/);
    expectError([], '$', /expected an object/);
    const raw = rawReal();
    raw['version'] = 2;
    expectError(raw, '$.version', /unsupported manifest version/);
    delete raw['version'];
    expectError(raw, '$.version');
  });

  it('rejects a sample rate other than 48 kHz and bad voice budgets', () => {
    const raw = rawReal();
    raw['sampleRate'] = 44100;
    expectError(raw, '$.sampleRate', /48000/);
    const raw2 = rawReal();
    raw2['maxVoices'] = 0;
    expectError(raw2, '$.maxVoices', /out of range/);
    const raw3 = rawReal();
    raw3['maxVoices'] = 1.5;
    expectError(raw3, '$.maxVoices', /integer/);
  });

  it('rejects unknown and missing categories and unknown buses', () => {
    const raw = rawReal();
    (raw['categories'] as Json)['laser'] = (raw['categories'] as Json)['weapon'];
    expectError(raw, '$.categories.laser', /unknown category/);
    const raw2 = rawReal();
    delete (raw2['categories'] as Json)['eco'];
    expectError(raw2, '$.categories.eco', /missing/);
    const raw3 = rawReal();
    ((raw3['categories'] as Json)['ui'] as Json)['bus'] = 'speech';
    expectError(raw3, '$.categories.ui.bus', /unknown bus "speech"/);
    const raw4 = rawReal();
    sound(raw4, 3)['category'] = 'laser';
    expectError(raw4, '$.sounds[3].category', /unknown category "laser"/);
    const raw5 = rawReal();
    sound(raw5, 4)['bus'] = 'master';
    expectError(raw5, '$.sounds[4].bus', /unknown bus "master"/);
    const raw6 = rawReal();
    ((raw6['categories'] as Json)['weapon'] as Json)['maxVoices'] = -1;
    expectError(raw6, '$.categories.weapon.maxVoices');
  });

  it('rejects bad, mismatching and duplicate ids', () => {
    const raw = rawReal();
    sound(raw, 2)['id'] = 'NoScope';
    expectError(raw, '$.sounds[2].id', /<scope>:<name>/);
    const raw2 = rawReal();
    sound(raw2, 2)['scope'] = 'varkan';
    expectError(raw2, '$.sounds[2].scope', /do not match id/);
    const raw3 = rawReal();
    sound(raw3, 5)['id'] = sound(raw3, 1)['id'];
    sound(raw3, 5)['scope'] = sound(raw3, 1)['scope'];
    sound(raw3, 5)['name'] = sound(raw3, 1)['name'];
    expectError(raw3, '$.sounds[5].id', /duplicate id/);
  });

  it('rejects broken variants', () => {
    const raw = rawReal();
    sound(raw, 0)['variants'] = [];
    expectError(raw, '$.sounds[0].variants', /non-empty/);
    const raw2 = rawReal();
    const multi = (raw2['sounds'] as Json[]).findIndex((s) => (s['variants'] as unknown[]).length > 1);
    ((sound(raw2, multi)['variants'] as Json[])[1]!)['index'] = 5;
    expectError(raw2, `$.sounds[${multi}].variants[1].index`, /dense/);
    for (const bad of ['../secret.webm', '/etc/x.webm', 'https://evil.example/x.webm', 'common/x.wav', 'common//x.webm']) {
      const r = rawReal();
      ((sound(r, 0)['variants'] as Json[])[0]!)['opus'] = bad;
      expectError(r, '$.sounds[0].variants[0].opus', /invalid relative \.webm path/);
    }
    const raw3 = rawReal();
    ((sound(raw3, 0)['variants'] as Json[])[0]!)['samples'] = 10.5;
    expectError(raw3, '$.sounds[0].variants[0].samples', /integer/);
    const raw4 = rawReal();
    ((sound(raw4, 0)['variants'] as Json[])[0]!)['samples'] = '60230';
    expectError(raw4, '$.sounds[0].variants[0].samples', /finite number/);
  });

  it('rejects inconsistent loop points', () => {
    const idx = (m: Json): number => (m['sounds'] as Json[]).indexOf(firstLoop(m));
    const cases: [string, (loop: Json, s: Json) => void, RegExp][] = [
      ['endS', (l) => ((l['startS'] = 0.5), (l['endS'] = 0.5), (l['startSample'] = 24000), (l['endSample'] = 24001)), /after start/],
      ['endSample', (l) => (l['endSample'] = l['startSample']), /after start/],
      ['startS', (l) => (l['startS'] = 0.05), /does not match startSample/],
      ['endS', (l, s) => ((l['endS'] = (s['durationS'] as number) + 0.2), (l['endSample'] = Math.round(((s['durationS'] as number) + 0.2) * 48000))), /exceeds durationS/],
      ['endSample', (l, s) => {
        const len = ((s['variants'] as Json[])[0]!)['samples'] as number;
        (s['variants'] as Json[]).forEach((v) => (v['samples'] = len - 3000));
      }, /exceeds variant 0 length/],
    ];
    for (const [field, mutate, msg] of cases) {
      const raw = rawReal();
      const s = firstLoop(raw);
      mutate(s['loop'] as Json, s);
      expectError(raw, `$.sounds[${idx(raw)}].loop.${field}`, msg);
    }
    const raw = rawReal();
    delete sound(raw, 0)['loop'];
    expectError(raw, '$.sounds[0].loop', /missing/);
  });

  it('rejects wrongly typed optional fields when present', () => {
    const raw = rawReal();
    sound(raw, 0)['tags'] = ['ok', 3];
    expectError(raw, '$.sounds[0].tags[1]', /expected a string/);
    const raw2 = rawReal();
    sound(raw2, 0)['spatial'] = 'no';
    expectError(raw2, '$.sounds[0].spatial', /boolean/);
    const raw3 = rawReal();
    sound(raw3, 0)['channels'] = 6;
    expectError(raw3, '$.sounds[0].channels', /1 or 2/);
    const raw4 = rawReal();
    sound(raw4, 0)['cooldownMs'] = Number.NaN;
    expectError(raw4, '$.sounds[0].cooldownMs', /finite number/);
    const raw5 = rawReal();
    raw5['sounds'] = {};
    expectError(raw5, '$.sounds', /array/);
  });
});
