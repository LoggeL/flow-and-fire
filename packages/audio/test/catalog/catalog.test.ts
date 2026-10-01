import { describe, expect, it, vi } from 'vitest';
import { ManifestError, SoundCatalog, parseManifest } from '../../src/catalog/index.ts';
import { MANIFEST_BUS_TO_BUS, SOUND_CATEGORIES, categoryIndex } from '../../src/types.ts';
import { FakeAudioBuffer, loadRealManifest, makeManifest } from '../support/index.ts';

function realCatalog(): SoundCatalog {
  return new SoundCatalog(parseManifest(JSON.parse(JSON.stringify(loadRealManifest()))));
}

describe('SoundCatalog — real manifest', () => {
  const cat = realCatalog();
  const m = cat.manifest;

  it('has dense indices over 101 sounds / 246 variants', () => {
    expect(cat.size).toBe(101);
    let variants = 0;
    for (let i = 0; i < cat.size; i++) {
      const r = cat.byIndex(i);
      expect(r.index).toBe(i);
      expect(r.id).toBe(m.sounds[i]!.id);
      expect(cat.indexOf(r.id)).toBe(i);
      variants += r.variantCount;
    }
    expect(variants).toBe(246);
    expect(cat.scopes).toEqual(['common', 'varkan']);
  });

  it('merges category policies with per-sound overrides and maps buses', () => {
    for (let i = 0; i < cat.size; i++) {
      const r = cat.byIndex(i);
      const s = m.sounds[i]!;
      const c = m.categories[s.category];
      expect(r.categoryIndex).toBe(categoryIndex(s.category));
      expect(r.categoryMaxVoices).toBe(c.maxVoices);
      expect(r.bus).toBe(MANIFEST_BUS_TO_BUS[s.bus]);
      expect(r.priority).toBe(s.priority);
      expect(r.cooldownMs).toBe(s.cooldownMs);
      expect(r.maxVoices).toBe(s.maxVoices);
      expect(r.loop).toEqual(s.loop);
      expect(r.channels).toBe(s.channels);
      expect(r.spatial).toBe(s.spatial);
    }
    // Policy per category (docs/design/audio.md §4) — spot checks through the resolver.
    const expectPolicy: Record<string, { bus: string; max: number }> = {
      alert: { bus: 'alerts', max: 1 },
      ack: { bus: 'alerts', max: 2 },
      ui: { bus: 'ui', max: 4 },
      weapon: { bus: 'sfx', max: 10 },
      impact: { bus: 'sfx', max: 8 },
      music: { bus: 'music', max: 1 },
      ambience: { bus: 'ambience', max: 2 },
    };
    for (const [category, p] of Object.entries(expectPolicy)) {
      const sounds = [...Array(cat.size).keys()].map((i) => cat.byIndex(i)).filter((r) => r.category === category);
      expect(sounds.length).toBeGreaterThan(0);
      for (const r of sounds) {
        expect(r.bus).toBe(p.bus);
        expect(r.categoryMaxVoices).toBe(p.max);
      }
    }
    const perCategory = new Set(SOUND_CATEGORIES.filter((c) => [...Array(cat.size).keys()].some((i) => cat.byIndex(i).category === c)));
    expect(perCategory.size).toBe(15);
  });

  it('keeps the alert sounds’ own cooldowns and priorities', () => {
    const base = cat.resolve('alt_base_attacked', 'varkan')!;
    expect(base.id).toBe('common:alt_base_attacked');
    expect(base.cooldownMs).toBe(15000);
    expect(base.priority).toBe(99);
    expect(base.categoryMaxVoices).toBe(1);
    expect(base.bus).toBe('alerts');
    expect(base.spatial).toBe(false);
    expect(cat.resolve('alt_enemy_air', 'varkan')!.cooldownMs).toBe(30000);
    expect(cat.resolve('alt_unit_attacked', 'varkan')!.cooldownMs).toBe(10000);
    expect(cat.resolve('alt_gong', 'varkan')!.cooldownMs).toBe(0);
    expect(cat.resolve('sig_sounding', 'varkan')!.cooldownMs).toBe(0);
  });

  it('resolves faction sounds first and falls back to common', () => {
    expect(cat.resolve('wpn_cannon_t1_fire', 'varkan')!.id).toBe('varkan:wpn_cannon_t1_fire');
    expect(cat.resolve('ui_click', 'varkan')!.id).toBe('common:ui_click');
    expect(cat.resolve('wpn_cannon_t1_fire', 'common')).toBeNull();
    expect(cat.resolve('varkan:wpn_cannon_t1_fire', 'common')!.id).toBe('varkan:wpn_cannon_t1_fire');
    expect(cat.resolve('does_not_exist', 'varkan')).toBeNull();
  });

  it('builds asset URLs below a base URL', () => {
    const i = cat.indexOf('common:ui_click');
    expect(cat.urlFor(i, 0, '/audio/')).toBe('/audio/common/ui_click.v0.webm');
    expect(cat.urlFor(i, 2, '/audio')).toBe('/audio/common/ui_click.v2.webm');
    expect(cat.urlFor(i, 1, '')).toBe('common/ui_click.v1.webm');
    expect(cat.urlFor(i, 0, 'https://cdn.example/a/')).toBe('https://cdn.example/a/common/ui_click.v0.webm');
    expect(() => cat.urlFor(i, 3, '/audio/')).toThrow(RangeError);
  });
});

describe('SoundCatalog — override rule (synthetic manifest)', () => {
  const m = makeManifest({
    sounds: [
      { id: 'common:wpn_x' },
      { id: 'varkan:wpn_x' },
      { id: 'common:ui_y' },
      { id: 'otherfaction:wpn_x' },
      { id: 'varkan:only_varkan', category: 'weapon' },
    ],
  });
  const cat = new SoundCatalog(parseManifest(JSON.parse(JSON.stringify(m))));

  it('varkan:x beats common:x; missing faction sounds fall back to common', () => {
    expect(cat.resolve('wpn_x', 'varkan')!.id).toBe('varkan:wpn_x');
    expect(cat.resolve('wpn_x', 'otherfaction')!.id).toBe('otherfaction:wpn_x');
    expect(cat.resolve('wpn_x', 'common')!.id).toBe('common:wpn_x');
    expect(cat.resolve('ui_y', 'varkan')!.id).toBe('common:ui_y');
    expect(cat.resolve('only_varkan', 'varkan')!.id).toBe('varkan:only_varkan');
    expect(cat.resolve('only_varkan', 'otherfaction')).toBeNull();
  });

  it('unknown factions use the common table', () => {
    expect(cat.resolve('wpn_x', 'zerg')!.id).toBe('common:wpn_x');
    expect(cat.resolve('only_varkan', 'zerg')).toBeNull();
    expect(cat.resolveIndex('wpn_x', '')).toBe(cat.indexOf('common:wpn_x'));
  });

  it('fully qualified ids resolve exactly, whatever the faction', () => {
    expect(cat.resolve('common:wpn_x', 'varkan')!.id).toBe('common:wpn_x');
    expect(cat.resolve('varkan:wpn_x', 'otherfaction')!.id).toBe('varkan:wpn_x');
    expect(cat.resolve('nope:wpn_x', 'varkan')).toBeNull();
    expect(cat.resolveIndex('varkan:missing', 'varkan')).toBe(-1);
  });

  it('returns the same ResolvedSound objects and allocates nothing on repeated lookups', () => {
    const a = cat.resolve('wpn_x', 'varkan');
    expect(cat.resolve('wpn_x', 'varkan')).toBe(a);
    const names = ['wpn_x', 'ui_y', 'common:wpn_x', 'unknown'];
    const factions = ['varkan', 'otherfaction'];
    for (let i = 0; i < 20_000; i++) cat.resolveIndex(names[i & 3]!, factions[i & 1]!); // warm-up
    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const before = process.memoryUsage().heapUsed;
    let sum = 0;
    for (let i = 0; i < 200_000; i++) sum += cat.resolveIndex(names[i & 3]!, factions[(i >> 2) & 1]!);
    gc?.();
    const grown = process.memoryUsage().heapUsed - before;
    expect(sum).not.toBe(0);
    expect(grown).toBeLessThan(512 * 1024);
  });
});

describe('SoundCatalog — buffers and load hook', () => {
  it('stores buffers per variant and tracks loaded sounds and bytes', () => {
    const cat = realCatalog();
    const i = cat.indexOf('varkan:wpn_cannon_t1_fire');
    const variants = cat.byIndex(i).variantCount;
    expect(variants).toBe(4);
    expect(cat.isLoaded(i)).toBe(false);
    expect(cat.buffer(i, 0)).toBeNull();
    const b = new FakeAudioBuffer(1, 1000, 48000);
    cat.setBuffer(i, 2, b);
    expect(cat.isLoaded(i)).toBe(true);
    expect(cat.isFullyLoaded(i)).toBe(false);
    expect(cat.buffer(i, 2)).toBe(b);
    expect(cat.buffer(i, 0)).toBeNull();
    expect(cat.buffer(i, 99)).toBeNull();
    expect(cat.loadedSounds).toBe(1);
    expect(cat.decodedBytes).toBe(4000);
    cat.setBuffer(i, 2, new FakeAudioBuffer(2, 500, 48000)); // replace
    expect(cat.decodedBytes).toBe(4000);
    expect(cat.loadedSounds).toBe(1);
    cat.setBuffer(i, 2, null);
    expect(cat.isLoaded(i)).toBe(false);
    expect(cat.decodedBytes).toBe(0);
    expect(cat.loadedSounds).toBe(0);
    expect(() => cat.setBuffer(i, variants, b)).toThrow(RangeError);
    for (let v = 0; v < variants; v++) cat.setBuffer(i, v, b);
    expect(cat.isFullyLoaded(i)).toBe(true);
    cat.clearBuffers();
    expect(cat.isLoaded(i)).toBe(false);
    expect(cat.decodedBytes).toBe(0);
  });

  it('throws RangeError outside 0..size-1', () => {
    const cat = realCatalog();
    for (const bad of [-1, cat.size, 1.5, Number.NaN]) {
      expect(() => cat.byIndex(bad)).toThrow(RangeError);
      expect(() => cat.buffer(bad, 0)).toThrow(RangeError);
      expect(() => cat.isLoaded(bad)).toThrow(RangeError);
      expect(() => cat.requestLoad(bad)).toThrow(RangeError);
    }
  });

  it('requestLoad delegates to the hook only while the sound is not loaded', () => {
    const cat = realCatalog();
    const i = cat.indexOf('common:ui_click');
    cat.requestLoad(i); // no hook: no-op
    const hook = vi.fn();
    cat.setLoadHook(hook);
    cat.requestLoad(i);
    cat.requestLoad(i);
    expect(hook).toHaveBeenCalledTimes(2);
    expect(hook).toHaveBeenCalledWith(i);
    cat.setBuffer(i, 0, new FakeAudioBuffer(2, 10, 48000));
    cat.requestLoad(i);
    expect(hook).toHaveBeenCalledTimes(2);
    cat.setLoadHook(null);
    cat.setBuffer(i, 0, null);
    cat.requestLoad(i);
    expect(hook).toHaveBeenCalledTimes(2);
  });

  it('fromJson validates untrusted JSON', () => {
    expect(SoundCatalog.fromJson(JSON.parse(JSON.stringify(loadRealManifest()))).size).toBe(101);
    expect(() => SoundCatalog.fromJson({ version: 1 })).toThrow(ManifestError);
  });
});
