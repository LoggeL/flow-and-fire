/**
 * Render pipeline for one variant: synth → channel layout → DC block → loop crossfade or tail trim +
 * fade → loudness normalization with true-peak ceiling (limiter if needed) → analysis + checks.
 * Pure (no I/O), deterministic.
 */
import { type Analysis, type LoudnessMode, analyze, loudnessBy, truePeak } from './analysis.ts';
import { type SfxDefinition, resolveSettings } from './define.ts';
import { dcBlock } from './filter.ts';
import { limiter } from './fx.ts';
import { Rng, variantSeed } from './rng.ts';
import { type Audio, SR, dbToGain, fade, gainToDb, isStereo, perChannel, samples, scaleAudio, toMono } from './signal.ts';

export interface RenderedVariant {
  variant: number;
  audio: Audio;
  analysis: Analysis;
  /** Which loudness measure the target applies to (loops: integrated, one-shots: momentary max). */
  loudnessMode: LoudnessMode;
  /** Measured loudness in that mode. */
  lufs: number;
  /** Peak reduction by the limiter in dB. */
  limitedDb: number;
  /** Loop points in samples for loops (the file carries LOOP_PAD samples of wrap-around padding on both sides), else null. */
  loop: { start: number; end: number } | null;
  warnings: string[];
}

/**
 * Wrap-around padding (samples) on both sides of a loop file: [last LOOP_PAD of the loop | loop | first
 * LOOP_PAD of the loop]. Lossy codecs (Opus) reconstruct the first and last frame of a stream less
 * accurately; with the padding the loop points sit in the middle of the stream and the seam stays clean.
 * Playback may start at 0 (the pre-roll is the loop's own tail) and loops between loop.start and loop.end.
 */
export const LOOP_PAD = 1920;

/** Add the wrap-around padding of LOOP_PAD samples to a finished loop. */
export function padLoop(a: Audio, pad = LOOP_PAD): Audio {
  return perChannel(a, (ch) => {
    const n = ch.length;
    const out = new Float32Array(n + 2 * pad);
    for (let i = 0; i < pad; i++) out[i] = ch[(((n - pad + i) % n) + n) % n] as number;
    out.set(ch, pad);
    for (let i = 0; i < pad; i++) out[pad + n + i] = ch[i % n] as number;
    return out;
  });
}

/** Equal-power crossfade of the render tail into its head → seamless loop of exactly lengthS. */
export function makeLoop(a: Audio, lengthS: number, crossfadeS: number, sr = SR): Audio {
  const N = samples(lengthS, sr);
  const X = samples(crossfadeS, sr);
  return perChannel(a, (ch) => {
    if (ch.length < N + X) throw new Error(`Loop braucht ${((N + X) / sr).toFixed(3)} s Render, bekommen ${(ch.length / sr).toFixed(3)} s`);
    const out = ch.slice(0, N);
    for (let i = 0; i < X; i++) {
      const t = (i + 0.5) / X;
      out[i] = (ch[i] as number) * Math.sin((t * Math.PI) / 2) + (ch[N + i] as number) * Math.cos((t * Math.PI) / 2);
    }
    return out;
  });
}

/** Index after the last sample above `rel` × peak (all channels). */
function activeEnd(a: Audio, rel: number): number {
  const chans = isStereo(a) ? a : [a];
  let peak = 0;
  for (const c of chans) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i] as number));
  const thr = peak * rel;
  let end = 0;
  for (const c of chans) {
    for (let i = c.length - 1; i >= end; i--) {
      if (Math.abs(c[i] as number) > thr) {
        end = i + 1;
        break;
      }
    }
  }
  return end;
}

function assertFinite(a: Audio, id: string): void {
  for (const c of isStereo(a) ? a : [a]) {
    for (let i = 0; i < c.length; i++) if (!Number.isFinite(c[i] as number)) throw new Error(`${id}: NaN/Infinity bei Sample ${i}`);
  }
}

/** Normalize to the loudness target (measured by `mode`) without exceeding the true-peak ceiling. */
export function normalize(
  a: Audio,
  targetLufs: number,
  ceilingDb: number,
  useLimiter: boolean,
  mode: LoudnessMode = 'integrated',
  sr = SR,
): { audio: Audio; warnings: string[]; limitedDb: number } {
  const warnings: string[] = [];
  const l0 = loudnessBy(a, mode, sr);
  if (!Number.isFinite(l0)) {
    warnings.push('Stille: Lautheit nicht messbar');
    return { audio: a, warnings, limitedDb: 0 };
  }
  let out = scaleAudio(a, dbToGain(targetLufs - l0));
  const ceil = dbToGain(ceilingDb);
  const tp0 = truePeak(out);
  // Each pass limits the peaks by twice the current excess, then restores the loudness target; this
  // converges in 1–3 passes for transient-heavy one-shots.
  for (let pass = 0; pass < 6 && useLimiter; pass++) {
    const excessDb = gainToDb(truePeak(out)) - ceilingDb;
    if (excessDb <= 0) break;
    out = limiter(out, { ceilingDb: ceilingDb - excessDb - 0.2, releaseMs: 25, sr });
    out = scaleAudio(out, dbToGain(targetLufs - loudnessBy(out, mode, sr)));
  }
  const tp = truePeak(out);
  if (tp > ceil) {
    out = scaleAudio(out, ceil / tp);
    const l = loudnessBy(out, mode, sr);
    if (targetLufs - l > 0.5) warnings.push(`Ziel ${targetLufs} LUFS verfehlt (${l.toFixed(1)} LUFS, begrenzt durch ${ceilingDb} dBTP)`);
  }
  // Gain reduction the limiter had to apply (peak before limiting vs. after).
  const limitedDb = Math.max(0, gainToDb(tp0) - gainToDb(truePeak(out)));
  return { audio: out, warnings, limitedDb };
}

export function renderVariant(def: SfxDefinition, variant: number, sr = SR): RenderedVariant {
  const s = resolveSettings(def);
  const post = def.post ?? {};
  const xf = def.loop ? Math.min(def.loop.crossfadeS ?? 0.25, def.loop.lengthS / 2) : 0;
  const rng = new Rng(variantSeed(def.id, variant, def.seed ?? 0));
  let a = def.render({ id: def.id, variant, variants: def.variants, rng, sr, durationS: def.loop ? def.loop.lengthS + xf : undefined });
  assertFinite(a, def.id);
  const warnings: string[] = [];
  // Channel layout.
  if (s.channels === 1 && isStereo(a)) a = toMono(a);
  if (s.channels === 2 && !isStereo(a)) a = [a, a.slice()];
  if (post.dcBlock !== false) a = perChannel(a, (c) => dcBlock(c, 10, sr));
  let loop: RenderedVariant['loop'] = null;
  if (def.loop) {
    a = makeLoop(a, def.loop.lengthS, xf, sr);
    loop = { start: LOOP_PAD, end: LOOP_PAD + samples(def.loop.lengthS, sr) };
  } else {
    if (post.trimTail !== false) {
      const end = Math.min((isStereo(a) ? a[0] : a).length, activeEnd(a, 1e-4) + samples(0.005, sr));
      a = perChannel(a, (c) => c.slice(0, Math.max(1, end)));
    }
    const fo = post.fadeOutS ?? 0.01;
    // Micro fade-in only if the first sample would click.
    const first = Math.abs((isStereo(a) ? a[0] : a)[0] ?? 0);
    a = perChannel(a, (c) => fade(c, first > 1e-3 ? 0.0005 : 0, fo, 'cos', sr));
  }
  // Loops skip the limiter: its gain envelope would not wrap around the seam.
  const mode: LoudnessMode = def.loop ? 'integrated' : 'momentary';
  const norm = normalize(a, s.targetLufs, post.ceilingDb ?? -1, post.limit !== false && !def.loop, mode, sr);
  a = norm.audio;
  warnings.push(...norm.warnings);
  const analysis = analyze(a, sr);
  if (analysis.durationS > s.maxDurationS + 1e-9) warnings.push(`Dauer ${analysis.durationS.toFixed(2)} s > max ${s.maxDurationS} s`);
  if (analysis.clippedSamples > 0) warnings.push(`${analysis.clippedSamples} geclippte Samples`);
  const measured = mode === 'integrated' ? analysis.lufs : analysis.lufsMomentaryMax;
  if (Math.abs(measured - s.targetLufs) > 0.5 && !norm.warnings.length) {
    warnings.push(`Lautheit ${measured.toFixed(1)} LUFS (${mode}) weicht vom Ziel ${s.targetLufs} ab`);
  }
  if (norm.limitedDb > 6) warnings.push(`Limiter greift stark (${norm.limitedDb.toFixed(1)} dB) – Transiente leiser gestalten oder Ziel senken`);
  if (analysis.truePeakDb > (post.ceilingDb ?? -1) + 0.05) warnings.push(`True Peak ${analysis.truePeakDb.toFixed(2)} dBTP über der Grenze`);
  if (loop) {
    // Seam check: jump at the wrap should look like an ordinary sample step.
    const ch = isStereo(a) ? a[0] : a;
    const wrap = Math.abs((ch[0] as number) - (ch[ch.length - 1] as number));
    let typical = 0;
    for (let i = 1; i < ch.length; i++) typical = Math.max(typical, Math.abs((ch[i] as number) - (ch[i - 1] as number)));
    if (wrap > typical * 1.01 + 1e-6) warnings.push(`Loop-Naht springt (${gainToDb(wrap).toFixed(1)} dB)`);
    // Analysis and seam check above describe the pure loop; the file gets the codec padding.
    a = padLoop(a);
  }
  return { variant, audio: a, analysis, loudnessMode: mode, lufs: measured, limitedDb: norm.limitedDb, loop, warnings };
}
