// Gemeinsame Bausteine für Einschläge (imp_*), Explosionen (exp_*) und Schilde (shd_*).
// Keine Sound-Definition (kein .sfx.ts): Hilfsdatei, die die Sounds beider Scopes importieren.
// Alle Bausteine liefern Mono mit Peak 1 (wie die Rezepte in tools/sfx/src/recipes.ts), damit die
// Schicht-Pegel in mixMono relative dB bleiben. Zufall kommt ausschließlich aus dem übergebenen Rng.
//
// Klangbild (faction.md §8.2): Treffer = gedämpfter Metall-Klong; Tod = Gusseisen bricht + Dampfzischen;
// Strukturtod = Kesselbersten mit langem Zisch-Ausklang; Lotbruch = tiefer Glockenschlag, Sog, Druckwelle.
import {
  type Mono,
  type Partial,
  PLATE_PARTIALS,
  type Rng,
  bandpass,
  crack,
  crackle,
  envelope,
  fade,
  fit,
  highpass,
  lowpass,
  mixMono,
  modal,
  mul,
  noise,
  normPeak,
  samples,
  scaleDecay,
  sweep,
  tick,
} from '../../../tools/sfx/src/index.ts';

type Layer = { sig: Mono; db?: number; at?: number };

/** Exponentially distributed value in [lo, hi] (gleichmäßig auf der Tonhöhen-Achse). */
export function expRange(r: Rng, lo: number, hi: number): number {
  return lo * Math.pow(hi / lo, r.next());
}

/** Auf feste Länge bringen und das Ende weich ausblenden (hält max. Dauer der SOUNDLIST sicher ein). */
export function finish(sig: Mono, maxS: number, fadeS = 0.25): Mono {
  const s = sig.length > samples(maxS) ? fit(sig, maxS) : sig;
  return fade(s, 0, Math.min(fadeS, (s.length / 48000) * 0.5), 'cos');
}

/** Langsame, zufällige Amplitudenmodulation 1 ± depth (Flattern von Dampf und Feuer). */
export function flutter(rng: Rng, durS: number, rateHz: number, depth: number): Float32Array {
  const n = normPeak(lowpass(noise('white', durS, rng), rateHz, 0.7, 2));
  return n.map((v) => Math.max(0, 1 + depth * v));
}

export interface IronBreakOptions {
  rng: Rng;
  /** Anzahl Bruchstücke (erstes = Hauptbruch). */
  count: number;
  fLo: number;
  fHi: number;
  /** Zeitraum, über den die Folgebrüche streuen (s). */
  spreadS: number;
  /** Nachklang der Bruchstücke (T60 der Grundmode, s). Gusseisen: kurz und stumpf. */
  t60: number;
  durS: number;
}

/**
 * „Gusseisen bricht": spröder Bruch = scharfer Knacks + kurzer, stumpfer, unharmonischer Plattenklang,
 * mehrere Bruchstücke dicht hintereinander.
 */
export function ironBreak(o: IronBreakOptions): Mono {
  const layers: Layer[] = [];
  for (let i = 0; i < o.count; i++) {
    const r = o.rng.fork(`frag${i}`);
    const f = expRange(r, o.fLo, o.fHi);
    const body = modal(f, scaleDecay(PLATE_PARTIALS, (o.t60 / 0.5) * r.jitter(0.3)), { durS: o.durS, rng: r, jitter: 0.06, pitch: sweep(1.015, 1, 0.02, o.durS) });
    const snap = crack({ rng: r.fork('snap'), durS: 0.03, freq: Math.min(9000, f * 4), q: 0.9, t60: 0.007, drive: 5 });
    const frag = normPeak(mixMono([{ sig: normPeak(body) }, { sig: snap, db: -3 }], o.durS));
    layers.push({ sig: frag, at: i === 0 ? 0 : r.range(0.004, o.spreadS), db: i === 0 ? 0 : -r.range(2, 9) });
  }
  return normPeak(mixMono(layers, o.durS + o.spreadS));
}

export interface DebrisOptions {
  rng: Rng;
  durS: number;
  fromS: number;
  toS: number;
  count: number;
  fLo: number;
  fHi: number;
  /** Nachklang eines Splitters (s). */
  t60?: number;
  /** Anteil der Splitter, die noch einmal aufspringen (0..1). */
  bounce?: number;
  /** Abfall über die Zeit in dB (spätere Teile fallen leiser). */
  fallDb?: number;
  /** Tiefpass für entfernte/dumpfe Trümmer (Hz). */
  lp?: number;
  /** Verteilung: >1 = dichter am Anfang. */
  skew?: number;
}

/** Trümmerregen: herabfallende Gussstücke (metallische Ticks) mit Aufspringen, zum Ende hin leiser. */
export function debris(o: DebrisOptions): Mono {
  const layers: Layer[] = [];
  for (let i = 0; i < o.count; i++) {
    const r = o.rng.fork(`d${i}`);
    const u = Math.pow(r.next(), o.skew ?? 1.6);
    const t = o.fromS + (o.toS - o.fromS) * u;
    const f = expRange(r, o.fLo, o.fHi);
    const k = tick(f, r, (o.t60 ?? 0.04) * r.jitter(0.4));
    const g = -r.range(0, 10) - (o.fallDb ?? 10) * u;
    layers.push({ sig: k, at: t, db: g });
    if (r.next() < (o.bounce ?? 0.4)) layers.push({ sig: k, at: t + r.range(0.05, 0.15), db: g - r.range(5, 11) });
  }
  const out = mixMono(layers, o.durS);
  return normPeak(o.lp ? lowpass(out, o.lp, 0.7, 1) : out);
}

export interface SteamOptions {
  rng: Rng;
  durS: number;
  attackS?: number;
  /** Abklingzeit auf −60 dB nach dem Anstieg (s). */
  t60: number;
  hp?: number;
  lp?: number;
  /** Flattern des Dampfstrahls 0..1. */
  flutter?: number;
  /** Optionaler Pfeifton (Kesselventil): Mittenfrequenz Hz, fällt über die Dauer um `whistleDrop`. */
  whistleHz?: number;
  whistleDrop?: number;
  whistleDb?: number;
}

/** Dampfzischen: Hochpass-Rauschen mit weichem Einsatz, Flattern und optionalem Ventil-Pfeifen. */
export function steam(o: SteamOptions): Mono {
  const a = o.attackS ?? 0.03;
  const env = envelope([[0, 0], [a, 1, 'lin'], [a + o.t60, 0.001, 'exp']], o.durS);
  let hiss = highpass(noise('white', o.durS, o.rng.fork('hiss')), o.hp ?? 2600, 0.7, 2);
  hiss = lowpass(hiss, o.lp ?? 11000, 0.7, 1);
  if (o.flutter) hiss = mul(hiss, flutter(o.rng.fork('fl'), o.durS, 22, o.flutter));
  const layers: Layer[] = [{ sig: normPeak(hiss) }];
  if (o.whistleHz) {
    const w = bandpass(noise('white', o.durS, o.rng.fork('wh')), sweep(o.whistleHz, o.whistleHz * (o.whistleDrop ?? 0.8), o.durS, o.durS), 28);
    layers.push({ sig: normPeak(w), db: o.whistleDb ?? -8 });
  }
  return normPeak(mul(mixMono(layers, o.durS), env));
}

export interface GravelOptions {
  rng: Rng;
  durS: number;
  /** Einsatz und Ende des Rieselns (s). */
  fromS: number;
  toS: number;
  /** Impulse pro Sekunde am Anfang. */
  density: number;
  lp?: number;
  hp?: number;
  /** Korngröße (s): länger = gröbere Brocken. */
  grainS?: number;
}

/** Erde/Kies/Schlacke rieselt: Knister-Impulse mit abnehmender Dichte, gefiltert. */
export function gravel(o: GravelOptions): Mono {
  const d = envelope([[0, 0], [o.fromS, 0, 'hold'], [o.fromS + 0.01, o.density, 'lin'], [o.toS, o.density * 0.02, 'exp'], [o.toS + 0.01, 0, 'lin']], o.durS);
  let c = crackle(o.durS, o.rng, { density: d, grainS: o.grainS ?? 0.0012, spread: 2 });
  c = lowpass(c, o.lp ?? 4000, 0.7, 2);
  if (o.hp) c = highpass(c, o.hp, 0.7, 1);
  return normPeak(c);
}

/** Tiefes Grollen: braunes Rauschen durch Tiefpass, weicher Einsatz, langer Abfall. */
export function rumble(rng: Rng, durS: number, lp: number, t60: number, attackS = 0.04): Mono {
  const env = envelope([[0, 0], [attackS, 1, 'lin'], [attackS + t60, 0.001, 'exp']], durS);
  return normPeak(mul(lowpass(noise('brown', durS, rng), lp, 0.7, 2), env));
}

/**
 * Unterdruck-Sog: anschwellendes Rauschen mit sich öffnendem Bandpass, dazu ein steigender Unterton.
 * Endet abrupt (danach setzt die Druckwelle ein).
 */
export function suck(rng: Rng, durS: number, fFrom: number, fTo: number): Mono {
  const env = envelope([[0, 0], [durS * 0.92, 1, 2.2], [durS, 0, 'lin']], durS);
  const air = bandpass(noise('pink', durS, rng), sweep(fFrom, fTo, durS, durS), 1.4);
  return normPeak(mul(air, env));
}

/** Eigenmoden eines frei schwingenden Stabs/Glaskörpers (unharmonisch, „glasig"). */
export const GLASS_PARTIALS: readonly Partial[] = [
  { ratio: 1.0, amp: 1.0, t60: 0.5 },
  { ratio: 2.756, amp: 0.55, t60: 0.34 },
  { ratio: 5.404, amp: 0.35, t60: 0.22 },
  { ratio: 8.933, amp: 0.18, t60: 0.14 },
];
