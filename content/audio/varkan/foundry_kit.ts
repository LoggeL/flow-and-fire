// Gemeinsame Bausteine der Gruppe Bau/Eco/UI (Varkan „Gießhalle und Funk"): periodische Loops ohne
// Crossfade, Blasen-Synthese für flüssiges Metall, Pips der Werkstimme, Flow-Grundton.
//
// Periodische Loops: Alles wird über zwei Perioden gerechnet (Rauschen gekachelt, Ereignisse bei t und
// t + L, LFOs mit ganzzahligen Zyklen pro Periode) und die zweite Periode zurückgegeben. Die Datei ist
// damit exakt periodisch, die Naht ist unhörbar und es braucht keinen Crossfade (der bei tonalen, also
// korrelierten Anteilen eine Pegelbeule erzeugt). Solche Sounds setzen `loop.crossfadeS: 0` und
// `post.dcBlock: false` (ein DC-Hochpass nach dem Rendern würde am Anfang einschwingen); den
// Tiefbass/DC entfernt dann der Hochpass in `render` selbst.
import { type Mono, type Param, SR, comb, concat, decay, fm, highpass, lfo, lowpass, mixMono, mul, noise, paramAt, samples, type LfoShape, type Rng } from '../../../tools/sfx/src/index.ts';

export interface Period {
  /** Periodenlänge in s (= Loop-Länge). */
  L: number;
  /** Samples pro Periode. */
  n: number;
  sr: number;
}

export function period(lengthS: number, sr = SR): Period {
  return { L: lengthS, n: samples(lengthS, sr), sr };
}

/** Zweite Periode eines über 2 Perioden gerechneten Signals (exakt periodisch). */
export function secondHalf(p: Period, sig: Mono): Mono {
  return sig.slice(p.n, 2 * p.n);
}

/** Weißes Rauschen einer Periode, gekachelt auf zwei Perioden und optional eingefärbt (eingeschwungen). */
export function pnoise(p: Period, color: 'white' | 'pink' | 'brown', rng: Rng): Mono {
  const w = noise('white', p.L, rng, p.sr).subarray(0, p.n);
  const t = concat(w, w, w);
  let out: Mono;
  if (color === 'white') out = t;
  else if (color === 'pink') {
    // Paul Kellets Pink-Filter auf dem gekachelten Weiß: nach der ersten Periode eingeschwungen.
    out = new Float32Array(t.length);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < t.length; i++) {
      const x = t[i] as number;
      b0 = 0.99886 * b0 + x * 0.0555179;
      b1 = 0.99332 * b1 + x * 0.0750759;
      b2 = 0.969 * b2 + x * 0.153852;
      b3 = 0.8665 * b3 + x * 0.3104856;
      b4 = 0.55 * b4 + x * 0.5329522;
      b5 = -0.7616 * b5 - x * 0.016898;
      out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
      b6 = x * 0.115926;
    }
  } else {
    out = new Float32Array(t.length);
    let last = 0;
    for (let i = 0; i < t.length; i++) {
      last = (last + 0.02 * (t[i] as number)) / 1.02;
      out[i] = last * 3.5;
    }
  }
  // Erste Kachel war Einschwingen: zwei Perioden zurückgeben.
  return out.slice(p.n);
}

/** LFO über zwei Perioden mit ganzzahliger Zyklenzahl pro Periode. */
export function plfo(p: Period, cycles: number, depth: number, center: number, shape: LfoShape = 'sine', phase = 0): Float32Array {
  return lfo(cycles / p.L, depth, center, 2 * p.L, shape, phase, p.sr);
}

export interface Event {
  t: number;
  sig: Mono;
  /** Lineare Verstärkung (Default 1). */
  g?: number;
}

/** Ereignisse periodisch platzieren (bei t mod L und t mod L + L) in einen Puffer von zwei Perioden. */
export function place(p: Period, events: readonly Event[]): Mono {
  const out = new Float32Array(2 * p.n);
  for (const e of events) {
    const t = ((e.t % p.L) + p.L) % p.L;
    const g = e.g ?? 1;
    for (const base of [0, p.n]) {
      const off = base + Math.round(t * p.sr);
      const len = Math.min(e.sig.length, out.length - off);
      for (let i = 0; i < len; i++) out[off + i] = (out[off + i] as number) + (e.sig[i] as number) * g;
    }
  }
  return out;
}

/** Ereignisse in einen Puffer fester Länge legen (One-Shots). */
export function scatter(durS: number, events: readonly Event[], sr = SR): Mono {
  const out = new Float32Array(samples(durS, sr));
  for (const e of events) {
    const off = Math.round(e.t * sr);
    const g = e.g ?? 1;
    const len = Math.min(e.sig.length, out.length - off);
    for (let i = 0; i < len; i++) out[off + i] = (out[off + i] as number) + (e.sig[i] as number) * g;
  }
  return out;
}

/**
 * Blase in einer Flüssigkeit (nach van den Doel): gedämpfter Sinus, dessen Tonhöhe beim Aufsteigen
 * steigt. `rise` > 0 steigt (Gießen, Plopp), < 0 fällt (Einschmelzen, „rückwärts"). Flüssiges Metall ist
 * zäh: `viscosity` > 1 dämpft stärker.
 */
export function bubble(f0: number, rng: Rng, o: { rise?: number; viscosity?: number; sr?: number } = {}): Mono {
  const sr = o.sr ?? SR;
  const d = (0.043 * f0 + 0.0014 * Math.pow(f0, 1.5)) * (o.viscosity ?? 1);
  const dur = Math.min(0.6, 6.9 / d);
  const n = samples(dur, sr);
  const out = new Float32Array(n);
  const rise = o.rise ?? 0.1;
  let ph = rng.next();
  const na = Math.max(1, samples(0.0008, sr));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.exp(-d * t) * (i < na ? i / na : 1);
    out[i] = env * Math.sin(2 * Math.PI * ph);
    ph += (f0 * (1 + rise * d * t)) / sr;
    ph -= Math.floor(ph);
  }
  return out;
}

/** Zufallszeitpunkte mit mittlerer Dichte (Poisson) in [0, durS). */
export function poissonTimes(rng: Rng, ratePerS: number, durS: number): number[] {
  const ts: number[] = [];
  for (let t = -Math.log(1 - rng.next()) / ratePerS; t < durS; t += -Math.log(1 - rng.next()) / ratePerS) ts.push(t);
  return ts;
}

/** Log-uniformer Wert (Frequenzen). */
export function logRange(rng: Rng, lo: number, hi: number): number {
  return lo * Math.pow(hi / lo, rng.next());
}

/**
 * Pip der Werkstimme: kurzer, klarer Ton mit leicht metallischem FM-Anschlag und Comb-Resonanz
 * (faction.md §8.1). `freq` darf gleiten (Luft).
 */
export function pip(freq: Param, o: { durS: number; t60: number; metal?: number; comb?: number; sr?: number }): Mono {
  const sr = o.sr ?? SR;
  const dur = o.durS;
  const env = decay(o.t60, dur, 0.002, sr);
  const f0 = paramAt(freq, 0, sr);
  const tone = mul(fm({ carrier: freq, ratio: 2.01, index: mul(decay(o.t60 * 0.35, dur, 0.001, sr), o.metal ?? 0.8), durS: dur, sr }), env);
  const clink = mul(fm({ carrier: f0 * 2.76, ratio: 1.414, index: 3, durS: 0.02, sr }), decay(0.015, 0.02, 0.0002, sr));
  const dry = mixMono([{ sig: tone }, { sig: clink, db: -14 }], dur, sr);
  const res = comb(dry, { freq: f0, feedback: 0.55, damp: 0.25, mix: o.comb ?? 0.35, sr });
  return highpass(res, Math.min(300, f0 * 0.5), 0.7, 2);
}

/** Flow-Grundton: harmonischer Summton (A2) mit Schwebung, Obertöne gedämpft. Zeitvariable Tonhöhe erlaubt. */
export function flowHum(freq: Param, durS: number, rng: Rng, o: { beatHz?: number; bright?: number; sr?: number } = {}): Mono {
  const sr = o.sr ?? SR;
  const n = samples(durS, sr);
  const out = new Float32Array(n);
  const harm = [1, 0.55, 0.42, 0.22, 0.2, 0.1, 0.09, 0.05, 0.045, 0.03];
  const beat = o.beatHz ?? 0.5;
  const bright = o.bright ?? 1;
  const phases = harm.map(() => [rng.next(), rng.next()]);
  const ph = harm.map((_, k) => [...(phases[k] as number[])]);
  for (let i = 0; i < n; i++) {
    const f = paramAt(freq, i, sr);
    let v = 0;
    for (let k = 0; k < harm.length; k++) {
      const a = (harm[k] as number) * Math.pow(bright, k);
      const pk = ph[k] as number[];
      v += a * (Math.sin(2 * Math.PI * (pk[0] as number)) + 0.6 * Math.sin(2 * Math.PI * (pk[1] as number)));
      pk[0] = ((pk[0] as number) + (f * (k + 1)) / sr) % 1;
      pk[1] = ((pk[1] as number) + (f * (k + 1) + beat) / sr) % 1;
    }
    out[i] = v;
  }
  return lowpass(out, 1800, 0.7, 1);
}
