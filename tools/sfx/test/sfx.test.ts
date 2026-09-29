import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import punze from '../../../content/audio/varkan/wpn_cannon_t1_fire.sfx.ts';
import { analyze, loudness, truePeak } from '../src/analysis.ts';
import { defineSfx } from '../src/define.ts';
import { fft } from '../src/fft.ts';
import { biquadCoeffs, filter, magnitudeAt } from '../src/filter.ts';
import { limiter } from '../src/fx.ts';
import { noise } from '../src/noise.ts';
import { AUDIO_ROOT, FFMPEG, build, findSfxFiles, idForFile, loadDefinition } from '../src/pipeline.ts';

const FIXTURES = path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures/audio');
import { LOOP_PAD, makeLoop, padLoop, renderVariant } from '../src/render.ts';
import { Rng } from '../src/rng.ts';
import { type Mono, SR, fade, gainToDb, isStereo } from '../src/signal.ts';
import { encodePng, spectrogramPng } from '../src/spectrogram.ts';
import { decodeWav, encodeWav } from '../src/wav.ts';

const HAS_FFMPEG = spawnSync(FFMPEG, ['-hide_banner', '-version'], { stdio: 'ignore' }).status === 0;

/** Sine with 10 ms fades (no edge overshoot). */
function sine(freq: number, peak: number, durS: number, phase = 0): Mono {
  const n = Math.round(durS * SR);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = peak * Math.sin((2 * Math.PI * freq * i) / SR + phase);
  return fade(s, 0.01, 0.01, 'cos');
}

const dbfs = (db: number): number => 10 ** (db / 20);
const rms = (a: Float32Array): number => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

describe('Grundlagen', () => {
  it('Rng ist deterministisch und gleichverteilt', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const xs = Array.from({ length: 10000 }, () => a.next());
    expect(xs.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => b.next()));
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
    expect(new Rng(42).fork('x').next()).not.toBe(new Rng(42).fork('y').next());
  });

  it('FFT stimmt mit der naiven DFT überein', () => {
    const n = 64;
    const r = new Rng(1);
    const x = Array.from({ length: n }, () => r.bipolar());
    const re = Float64Array.from(x);
    const im = new Float64Array(n);
    fft(re, im);
    for (const k of [0, 1, 7, 31, 63]) {
      let sr = 0;
      let si = 0;
      for (let t = 0; t < n; t++) {
        sr += x[t]! * Math.cos((-2 * Math.PI * k * t) / n);
        si += x[t]! * Math.sin((-2 * Math.PI * k * t) / n);
      }
      expect(re[k]).toBeCloseTo(sr, 9);
      expect(im[k]).toBeCloseTo(si, 9);
    }
    fft(re, im, true);
    expect(re[5]).toBeCloseTo(x[5]!, 9);
  });

  it('Biquad-Tiefpass: Frequenzgang und gemessene Dämpfung', () => {
    const c = biquadCoeffs('lowpass', 1000, Math.SQRT1_2);
    expect(gainToDb(magnitudeAt(c, 1000))).toBeCloseTo(-3.01, 1);
    expect(gainToDb(magnitudeAt(c, 10000))).toBeLessThan(-38);
    const out = filter(sine(10000, 0.5, 0.5), { type: 'lowpass', freq: 1000, stages: 2 });
    expect(gainToDb(rms(out.subarray(4800)) / rms(sine(10000, 0.5, 0.5).subarray(4800)))).toBeLessThan(-75);
    const pass = filter(sine(100, 0.5, 0.5), { type: 'lowpass', freq: 1000 });
    expect(gainToDb(rms(pass.subarray(4800)) / rms(sine(100, 0.5, 0.5).subarray(4800)))).toBeGreaterThan(-0.1);
  });

  it('Rauschfarben: rosa und braun fallen zu hohen Frequenzen ab', () => {
    const r = new Rng(3);
    const hiShare = (x: Mono): number => rms(filter(x, { type: 'highpass', freq: 4000, stages: 2 })) / rms(x);
    const w = hiShare(noise('white', 1, r));
    const p = hiShare(noise('pink', 1, r));
    const b = hiShare(noise('brown', 1, r));
    expect(w).toBeGreaterThan(p);
    expect(p).toBeGreaterThan(b);
  });
});

describe('Messung (BS.1770 / EBU R128)', () => {
  it('EBU Tech 3341 Fall 1: Stereo-Sinus 1 kHz bei −23 dBFS ⇒ −23,0 LUFS', () => {
    const s = sine(1000, dbfs(-23), 5);
    const l = loudness([s, s.slice()]);
    expect(l.integrated).toBeCloseTo(-23, 1);
  });

  it('Mono zählt als ein Kanal (wie ffmpeg ebur128): −20 dBFS ⇒ −23,0 LUFS', () => {
    expect(loudness(sine(1000, dbfs(-20), 5)).integrated).toBeCloseTo(-23.01, 1);
  });

  it('Relatives Gate entfernt leise Passagen (EBU Tech 3341 Fall 3)', () => {
    // 10 s bei −36 dBFS, 60 s bei −23 dBFS, 10 s bei −36 dBFS (Stereo-Sinus 1 kHz) ⇒ −23,0 ± 0,1 LUFS.
    const x = new Float32Array(80 * SR);
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      x[i] = (t >= 10 && t < 70 ? dbfs(-23) : dbfs(-36)) * Math.sin(2 * Math.PI * 1000 * t);
    }
    const l = loudness([x, x.slice()]);
    expect(Math.abs(l.integrated - -23)).toBeLessThan(0.1);
  });

  it('kurze Signale werden auf einen 400-ms-Block aufgefüllt', () => {
    const s = sine(1000, dbfs(-20), 0.1);
    const l = loudness(s);
    expect(l.short).toBe(true);
    // 100 ms Energie in 400 ms Fenster ≈ −6 dB gegenüber Dauerton (Fades kosten etwas mehr).
    expect(l.momentaryMax).toBeLessThan(-23 - 5.5);
    expect(l.momentaryMax).toBeGreaterThan(-23 - 7.5);
  });

  it('True Peak findet Inter-Sample-Spitzen (12 kHz, 45° Phase)', () => {
    const s = sine(12000, 0.5, 0.5, Math.PI / 4);
    const sp = analyze(s).peakDb;
    expect(sp).toBeLessThan(gainToDb(0.5) - 2.9);
    expect(gainToDb(truePeak(s))).toBeCloseTo(gainToDb(0.5), 1);
  });

  it('Clipping und Spektral-Schwerpunkt', () => {
    const s = sine(2000, 1.2, 0.5).map((v) => Math.max(-1, Math.min(1, v)));
    const a = analyze(s);
    expect(a.clippedSamples).toBeGreaterThan(100);
    expect(analyze(sine(2000, 0.5, 0.5)).centroidHz).toBeGreaterThan(1900);
    expect(analyze(sine(2000, 0.5, 0.5)).centroidHz).toBeLessThan(2100);
  });
});

describe('Effekte und Pipeline-Bausteine', () => {
  it('Limiter hält die True-Peak-Grenze', () => {
    const r = new Rng(9);
    const x = noise('white', 0.5, r).map((v) => v * 1.5);
    const y = limiter(x, { ceilingDb: -1 }) as Mono;
    expect(gainToDb(truePeak(y))).toBeLessThan(-0.9);
  });

  it('padLoop: Rand-Padding ist Wrap-around des Loops', () => {
    const x = new Float32Array(5000).map((_, i) => Math.sin(i * 0.01));
    const p = padLoop(x, 100) as Mono;
    expect(p.length).toBe(5200);
    for (let i = 0; i < 100; i++) {
      expect(p[i]).toBe(x[4900 + i]);
      expect(p[5100 + i]).toBe(x[i]);
    }
    expect(Array.from(p.subarray(100, 5100))).toEqual(Array.from(x));
  });

  it('Loop-Crossfade ergibt eine nahtlose Naht exakter Länge', () => {
    const r = new Rng(5);
    const x = filter(noise('white', 2.4, r), { type: 'lowpass', freq: 2000 });
    const loop = makeLoop(x, 2, 0.3) as Mono;
    expect(loop.length).toBe(2 * SR);
    let typical = 0;
    for (let i = 1; i < loop.length; i++) typical = Math.max(typical, Math.abs(loop[i]! - loop[i - 1]!));
    expect(Math.abs(loop[0]! - loop[loop.length - 1]!)).toBeLessThanOrEqual(typical);
  });

  it('WAV 24/16 Bit und Float: Encode/Decode-Rundreise', () => {
    const s = sine(440, 0.8, 0.2);
    for (const [fmt, tol] of [['pcm24', 2 ** -22], ['pcm16', 2 ** -14], ['float32', 1e-7]] as const) {
      const d = decodeWav(encodeWav([s, s.map((v) => -v)], SR, fmt));
      expect(d.sampleRate).toBe(SR);
      expect(isStereo(d.audio)).toBe(true);
      const [l, rr] = d.audio as [Mono, Mono];
      for (const i of [0, 100, 5000, s.length - 1]) {
        expect(Math.abs(l[i]! - s[i]!)).toBeLessThan(tol);
        expect(Math.abs(rr[i]! + s[i]!)).toBeLessThan(tol);
      }
    }
  });

  it('PNG-Encoder: gültige Signatur, IHDR und Bilddaten', () => {
    const png = encodePng(3, 2, new Uint8Array(18).fill(200));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const dv = new DataView(png.buffer, png.byteOffset);
    expect(dv.getUint32(16)).toBe(3);
    expect(dv.getUint32(20)).toBe(2);
    const idatLen = dv.getUint32(33);
    expect(inflateSync(png.subarray(41, 41 + idatLen)).length).toBe((3 * 3 + 1) * 2);
    const spec = spectrogramPng(sine(1000, 0.5, 0.3));
    expect(new DataView(spec.buffer, spec.byteOffset).getUint32(16)).toBeGreaterThanOrEqual(480);
  });

  it('defineSfx validiert id, Kategorie, Varianten und Loop', () => {
    const render = (): Mono => new Float32Array(10);
    expect(() => defineSfx({ id: 'Bad Id', category: 'ui', variants: 1, render })).toThrow(/ungültige id/);
    expect(() => defineSfx({ id: 'x:y', category: 'nope' as 'ui', variants: 1, render })).toThrow(/Kategorie/);
    expect(() => defineSfx({ id: 'x:y', category: 'ui', variants: 0, render })).toThrow(/variants/);
    expect(() => defineSfx({ id: 'x:y', category: 'ui', variants: 1, loop: { lengthS: 1, crossfadeS: 0.8 }, render })).toThrow(/crossfade/);
    expect(defineSfx({ id: 'x:y', category: 'ui', variants: 2, render }).variants).toBe(2);
  });
});

describe('Referenz-Sound varkan:wpn_cannon_t1_fire (Punze)', () => {
  const renders = Array.from({ length: punze.variants }, (_, v) => renderVariant(punze, v));

  it('ist deterministisch: gleicher Seed ⇒ bitgleiche WAV', () => {
    for (const r of renders) {
      const again = renderVariant(punze, r.variant);
      expect(createHash('sha1').update(encodeWav(again.audio, SR)).digest('hex')).toBe(createHash('sha1').update(encodeWav(r.audio, SR)).digest('hex'));
    }
  });

  it('Varianten unterscheiden sich', () => {
    const hashes = new Set(renders.map((r) => createHash('sha1').update(encodeWav(r.audio, SR)).digest('hex')));
    expect(hashes.size).toBe(punze.variants);
  });

  it('erfüllt die Zielwerte der Kategorie weapon', () => {
    for (const r of renders) {
      const a = r.analysis;
      expect(isStereo(r.audio)).toBe(false); // mono, räumlich
      expect(r.loudnessMode).toBe('momentary');
      expect(Math.abs(a.lufsMomentaryMax - -20)).toBeLessThanOrEqual(0.5);
      expect(a.truePeakDb).toBeLessThanOrEqual(-0.95);
      expect(a.clippedSamples).toBe(0);
      expect(a.durationS).toBeGreaterThan(0.3);
      expect(a.durationS).toBeLessThanOrEqual(2.5);
      // Direktfeuer = mittleres Band (faction.md §8.3): Schwerpunkt zwischen 400 Hz und 2,5 kHz.
      expect(a.centroidHz).toBeGreaterThan(400);
      expect(a.centroidHz).toBeLessThan(2500);
      expect(Math.abs(a.dcOffset)).toBeLessThan(1e-3);
      expect(r.limitedDb).toBeLessThan(6);
      expect(r.warnings).toEqual([]);
    }
  });
});

describe('Content und Build', () => {
  let out = '';
  beforeAll(async () => {
    out = await mkdtemp(path.join(os.tmpdir(), 'faf-sfx-'));
  });
  afterAll(async () => {
    if (out) await rm(out, { recursive: true, force: true });
  });

  it('jede .sfx.ts lädt und ihre id passt zum Pfad', async () => {
    const files = await findSfxFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect((await loadDefinition(f)).id).toBe(idForFile(f, AUDIO_ROOT));
  });

  it('Build (Fixtures): Manifest, Dateien, Loop, Cache und bitgleiches Opus', async () => {
    const opus = HAS_FFMPEG;
    const r1 = await build({ root: FIXTURES, outDir: out, threads: 1, opus, force: true });
    const m = r1.manifest;
    expect(m.sampleRate).toBe(48000);
    expect(m.maxVoices).toBe(32);
    expect(m.sounds.map((s) => s.id)).toEqual(['test:loop', 'test:one_shot']);
    const shot = m.sounds.find((s) => s.id === 'test:one_shot')!;
    expect(shot.category).toBe('weapon');
    expect(shot.variants).toHaveLength(2);
    expect(shot.loop).toBeNull();
    expect(shot.loudnessMode).toBe('momentary');
    expect(shot.priority).toBe(50);
    expect(shot.cooldownMs).toBe(50);
    expect(shot.targetLufs).toBe(-20);
    expect(shot.channels).toBe(1);
    const loop = m.sounds.find((s) => s.id === 'test:loop')!;
    expect(loop.channels).toBe(2);
    expect(loop.loudnessMode).toBe('integrated');
    expect(loop.loop).toEqual({ startSample: LOOP_PAD, endSample: LOOP_PAD + 0.6 * 48000, startS: LOOP_PAD / 48000, endS: LOOP_PAD / 48000 + 0.6 });
    expect(loop.variants[0]!.samples).toBe(0.6 * 48000 + 2 * LOOP_PAD);
    expect(loop.variants[0]!.durationS).toBe(0.6);
    for (const s of m.sounds) {
      expect(s.warnings).toEqual([]);
      for (const v of s.variants) {
        const wav = await readFile(path.join(out, v.wav));
        expect(createHash('sha1').update(wav).digest('hex')).toBe(v.sha1);
        expect(Math.abs(v.lufs - s.targetLufs)).toBeLessThanOrEqual(0.5);
        if (opus) {
          expect(existsSync(path.join(out, v.opus!))).toBe(true);
          // Opus-True-Peak-Wächter: dekodiertes Opus bleibt unter der Grenze, Lautheit nahe am Ziel.
          expect(v.opusTruePeakDb!).toBeLessThanOrEqual(-1);
          expect(Math.abs(v.opusLufs! - s.targetLufs)).toBeLessThanOrEqual(1.5);
        }
      }
    }
    const json = JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8')) as typeof m;
    expect(json.sounds.map((s) => s.id)).toEqual(m.sounds.map((s) => s.id));
    // Zweiter Lauf: alles aus dem Cache.
    const r2 = await build({ root: FIXTURES, outDir: out, threads: 1, opus });
    expect(r2.rendered).toEqual([]);
    expect(r2.cached).toHaveLength(m.sounds.length);
    // --force mit Filter: nur der gefilterte Sound, Opus bitgleich.
    const webm = opus ? path.join(out, shot.variants[0]!.opus!) : '';
    const before = opus ? createHash('sha1').update(await readFile(webm)).digest('hex') : '';
    const r3 = await build({ root: FIXTURES, outDir: out, threads: 1, opus, force: true, filter: /one_shot/ });
    expect(r3.rendered).toEqual(['test:one_shot']);
    if (opus) expect(createHash('sha1').update(await readFile(webm)).digest('hex')).toBe(before);
  });

  it.skipIf(!HAS_FFMPEG)('LUFS stimmt mit ffmpeg ebur128 überein (≤ 0,3 LU)', async () => {
    const s = sine(700, dbfs(-18), 3);
    const n = new Rng(4);
    const x = s.map((v) => v + 0.05 * n.bipolar());
    const f = path.join(out, 'xcheck.wav');
    await writeFile(f, encodeWav([x, x.map((v) => v * 0.5)], SR, 'pcm24'));
    const res = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', f, '-filter_complex', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = /Integrated loudness:\s*I:\s*(-?[\d.]+)\s*LUFS/.exec(res.stderr);
    expect(m).not.toBeNull();
    const ours = loudness(decodeWav(new Uint8Array(await readFile(f))).audio).integrated;
    expect(Math.abs(ours - Number(m![1]))).toBeLessThanOrEqual(0.3);
  });
});
