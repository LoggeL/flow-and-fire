// Gemeinsame Bausteine der Varkan-Waffen (content/audio/varkan/wpn_*.sfx.ts). Keine Sound-Definition:
// die Pipeline hasht diese Datei als Hilfsdatei mit, Änderungen rendern alle Sounds neu.
//
// Audio-Charakter (faction.md §8.2 „Gießhalle und Funk“): gegossenes Eisen, Glut, Industrie.
//   Direktfeuer  = Glockenhammer, höhere Tech tiefer + längerer Nachklang (nicht lauter)
//   Artillerie   = Schwapp (flüssige Schlacke) + Wumm (Mörser), Tiefband
//   Raketen      = Fauchen mit Knistern der Glut-Treibladung
//   Flugabwehr   = trockenes Rasseln (Ratsche, Sieb) in hoher Lage
import {
  type Mono,
  type NoiseColor,
  bandpass,
  boom,
  clang,
  crack,
  crackle,
  decay,
  envelope,
  highpass,
  lowpass,
  mixMono,
  modal,
  mul,
  noise,
  normPeak,
  osc,
  PLATE_PARTIALS,
  room,
  samples,
  scaleDecay,
  shape,
  sizzle,
  sweep,
  thump,
  tick,
  type Rng,
} from '../../../tools/sfx/src/index.ts';

/** Addiert `src` mit Gain `g` ab Zeitpunkt `atS` in `dst` (in place). */
export function addAt(dst: Mono, src: Mono, atS: number, g = 1, sr = 48000): void {
  const off = samples(atS, sr);
  const n = Math.min(src.length, dst.length - off);
  for (let i = 0; i < n; i++) dst[off + i] = (dst[off + i] as number) + (src[i] as number) * g;
}

// ---------------------------------------------------------------------------------------------------
// Glockenkanonen-Familie (Direktfeuer)
// ---------------------------------------------------------------------------------------------------

export interface CannonTech {
  /** Grundton der Glocke (Hz). */
  f0: number;
  /** Nachklang-Skalierung der Glockenpartials (T1 0,14 … T3 0,36). */
  decayScale: number;
  boomFrom: number;
  boomTo: number;
  boomT60: number;
  /** Anschläge (Sekunden-Offsets): Doppel-Glocke = zwei Schläge im Abstand von 35–40 ms. */
  strikes: readonly number[];
  /** Mittenfrequenz des Mündungsknalls (Hz). */
  crackFreq: number;
  roomT60: number;
  roomWet: number;
  /** Gesamtlänge des Renders (s). */
  durS: number;
  /** Pegel von Knall und Wumm relativ zur Glocke (dB): höhere Tech = weniger Knall, mehr Wumm. */
  crackDb: number;
  boomDb: number;
  /** Tiefpass auf dem Bus (Hz, 0 = aus): höhere Tech klingt dunkler. */
  lp: number;
}

/** Tech-Stufen. Die T1-Werte sind die des Referenz-Sounds `varkan:wpn_cannon_t1_fire` (der sein eigenes Rezept behält). */
export const CANNON: Record<'t1' | 'reeve' | 't2' | 't3', CannonTech> = {
  t1: { f0: 520, decayScale: 0.14, boomFrom: 190, boomTo: 75, boomT60: 0.18, strikes: [0], crackFreq: 1900, roomT60: 0.45, roomWet: 0.16, durS: 1.1, crackDb: 0, boomDb: -7, lp: 0 },
  reeve: { f0: 465, decayScale: 0.19, boomFrom: 180, boomTo: 66, boomT60: 0.22, strikes: [0], crackFreq: 1750, roomT60: 0.5, roomWet: 0.16, durS: 1.3, crackDb: -0.5, boomDb: -6.5, lp: 9000 },
  t2: { f0: 420, decayScale: 0.24, boomFrom: 170, boomTo: 62, boomT60: 0.24, strikes: [0, 0.035], crackFreq: 1650, roomT60: 0.55, roomWet: 0.18, durS: 1.6, crackDb: -2, boomDb: -5.5, lp: 6500 },
  t3: { f0: 330, decayScale: 0.36, boomFrom: 150, boomTo: 50, boomT60: 0.3, strikes: [0, 0.038], crackFreq: 1450, roomT60: 0.7, roomWet: 0.2, durS: 1.9, crackDb: -3.5, boomDb: -4.5, lp: 4800 },
};

/**
 * Glockenhammer nach dem Rezept des Referenz-Sounds (Knall + Glocke + Wumm + Luftstoß + Verschluss-Tick +
 * Glut-Zischen), für Doppel-Glocken mit mehreren Anschlägen. Ohne Raum und Bus (siehe `cannonBus`).
 */
export function bellCannonLayers(rng: Rng, c: CannonTech, p: number): Mono {
  const dur = c.durS;
  const out = new Float32Array(samples(dur, 48000));
  c.strikes.forEach((at, k) => {
    const r = rng.fork(`strike${k}`);
    // Zweiter Schlag der Doppel-Glocke: minimal tiefer, etwas leiser, eigener Knall.
    const g = k === 0 ? 1 : 0.72;
    const pk = k === 0 ? 1 : 0.985 * r.jitter(0.004);
    const cr = crack({ rng: r.fork('crack'), durS: 0.1, freq: c.crackFreq * p * r.jitter(0.03), q: 0.7, t60: 0.035, drive: 4 });
    addAt(out, k === 0 ? cr : lowpass(cr, c.crackFreq * 1.2, 0.7, 1), at, g * 10 ** (c.crackDb / 20));
    addAt(out, clang({ f0: c.f0 * p * pk * r.jitter(0.012), rng: r.fork('bell'), durS: dur - at - 0.01, decayScale: c.decayScale * r.jitter(0.1), strike: 0.6 }), at + 0.002, 0.89 * g);
  });
  const tail = mixMono(
    [
      { sig: boom({ from: c.boomFrom * p, to: c.boomTo * p, sweepS: 0.06, t60: c.boomT60 * rng.jitter(0.1), durS: 0.5, drive: 3 }), db: c.boomDb },
      { sig: thump({ rng: rng.fork('thump'), durS: 0.55, t60: 0.27, lpFrom: 2600, lpTo: 280 }), db: -6 },
      { sig: tick(2350 * p * (c.f0 / 520) ** 0.5, rng.fork('clank'), 0.03), db: -14, at: 0.05 + (c.strikes.at(-1) ?? 0) + rng.range(0, 0.015) },
      { sig: sizzle({ rng: rng.fork('ember'), durS: 0.8, t60: 0.55, hp: 3500, density: 250, hiss: 0.6 }), db: -22, at: 0.02 },
    ],
    dur,
  );
  addAt(out, tail, 0);
  return out;
}

/** Bus der Direktfeuer-Familie: tanh-Kleber, Hochpass 90 Hz (Tiefband bleibt Artillerie), trockener Raum. */
export function cannonBus(sig: Mono, c: Pick<CannonTech, 'roomT60' | 'roomWet' | 'lp'>, seed = 101, hp = 90): Mono {
  const hpd = highpass(shape(sig, { kind: 'tanh', drive: 1.4 }), hp, 0.7, 2);
  const glued = c.lp > 0 ? lowpass(hpd, c.lp, 0.6, 1) : hpd;
  return room(glued, { t60: c.roomT60, wet: c.roomWet, seed });
}

// ---------------------------------------------------------------------------------------------------
// Flüssiges Metall: Schwapp, Blasen
// ---------------------------------------------------------------------------------------------------

export interface BubbleOptions {
  rng: Rng;
  durS: number;
  /** Blasen pro Sekunde am Anfang (fällt linear auf 0 bis `durS`). */
  rate: number;
  fLo: number;
  fHi: number;
  /** Tonhöhenanstieg jeder Blase (Faktor, Minnaert-Blasen steigen). */
  rise?: number;
  /** Abklingzeit einer Blase (s). */
  t60?: number;
}

/** Blubbern flüssiger Schlacke: viele kurze, ansteigende Sinus-Chirps (Minnaert-Resonanzen). */
export function bubbles(o: BubbleOptions): Mono {
  const sr = 48000;
  const out = new Float32Array(samples(o.durS, sr));
  const r = o.rng;
  for (let t = r.range(0, 0.01); t < o.durS; ) {
    const dens = o.rate * Math.max(0.05, 1 - t / o.durS);
    const f = o.fLo * Math.pow(o.fHi / o.fLo, r.next());
    const t60 = (o.t60 ?? 0.05) * r.jitter(0.4) * Math.sqrt(400 / f);
    const len = Math.min(t60, 0.12);
    const b = mul(osc('sine', sweep(f, f * (o.rise ?? 1.6) * r.jitter(0.1), len, len, 'lin'), len, { phase: 0 }), decay(t60, len, 0.001));
    addAt(out, b, t, r.range(0.25, 1) * Math.max(0.2, 1 - t / o.durS));
    t += (-Math.log(1 - r.next() * 0.999) / dens) as number;
  }
  return normPeak(out);
}

export interface SloshOptions {
  rng: Rng;
  durS: number;
  /** Formant (Bandpass-Mitte) des Schwapps: steigt beim Ausholen, fällt beim Auswurf. */
  fLow: number;
  fHigh: number;
  /** Zeit bis zum Formant-Maximum (s). */
  peakS?: number;
  /** Anteil Blubbern 0..1. */
  bubble?: number;
}

/**
 * „Schwapp“: schwere Flüssigkeit, die in einer Kelle/einem Tiegel schwappt und ausgeworfen wird. Gefiltertes
 * Rauschen mit wanderndem Formant (Schwung), darunter Blubbern, beides mit weicher Hüllkurve.
 */
export function slosh(o: SloshOptions): Mono {
  const d = o.durS;
  const pk = o.peakS ?? d * 0.3;
  const env = envelope([[0, 0], [pk * 0.8, 1, 0.6], [pk * 1.4, 0.55, 'lin'], [d, 0.0005, 'exp']], d);
  const form = envelope([[0, o.fLow], [pk, o.fHigh, 'exp'], [d, o.fLow * 0.8, 'exp']], d);
  const body = mul(bandpass(bandpass(noise('pink', d, o.rng.fork('body')), form, 1.6), form, 1.2), env);
  const low = mul(lowpass(noise('brown', d, o.rng.fork('low')), form, 0.9, 2), env);
  const bub = bubbles({ rng: o.rng.fork('bub'), durS: d, rate: 90, fLo: o.fLow * 1.2, fHi: o.fHigh * 2.2, t60: 0.05 });
  const b = o.bubble ?? 0.5;
  return normPeak(
    mixMono([
      { sig: normPeak(body), db: 0 },
      { sig: normPeak(low), db: -4 },
      { sig: mul(bub, env), db: 20 * Math.log10(Math.max(1e-3, b)) - 2 },
    ]),
  );
}

// ---------------------------------------------------------------------------------------------------
// Mörser / Artillerie-Wumm
// ---------------------------------------------------------------------------------------------------

export interface MortarOptions {
  rng: Rng;
  /** Tiefe des Wumm (Start/Ende des fallenden Sinus). */
  from: number;
  to: number;
  t60: number;
  /** Rohr-Resonanz (Hz) des Luftstoßes. */
  tube: number;
  crackFreq: number;
  durS: number;
}

/** Mörser-„Wumm“: fallender, gesättigter Tiefton, Luftstoß mit Rohr-Resonanz und gedämpftem Knall. */
export function mortarWumm(o: MortarOptions): Mono {
  const d = o.durS;
  const r = o.rng;
  const air = thump({ rng: r.fork('air'), durS: Math.min(d, o.t60 * 1.6), t60: o.t60 * 0.9, lpFrom: 1400, lpTo: 110 });
  // Rohr-„Plopp“: kurzer Rauschstoß durch eine resonante Tiefpass-Kaskade am Rohrton.
  const popLen = 0.18;
  const pop = mul(lowpass(noise('white', popLen, r.fork('pop')), sweep(o.tube * 2.2, o.tube, 0.05, popLen), 6, 1), decay(0.12, popLen, 0.001));
  return normPeak(
    mixMono(
      [
        { sig: boom({ from: o.from, to: o.to, sweepS: 0.08, t60: o.t60, durS: d, drive: 3.2 }), db: 0 },
        { sig: air, db: -3 },
        { sig: normPeak(pop), db: -6 },
        { sig: lowpass(crack({ rng: r.fork('crack'), durS: 0.09, freq: o.crackFreq, q: 0.6, t60: 0.03, drive: 3 }), o.crackFreq * 1.8, 0.7, 1), db: -7 },
      ],
      d,
    ),
  );
}

// ---------------------------------------------------------------------------------------------------
// Flugabwehr: trockenes Rasseln
// ---------------------------------------------------------------------------------------------------

export interface RattleOptions {
  rng: Rng;
  /** Anzahl der Klicks. */
  count: number;
  /** Klicks pro Sekunde (Mittel). */
  rate: number;
  /** Zeitliche Unruhe 0..1. */
  jitter?: number;
  fLo: number;
  fHi: number;
  /** Pegelabfall pro Klick (Faktor). */
  fall?: number;
  /** Nachklang eines Klicks (s). */
  t60?: number;
}

/** Trockenes Rasseln (Ratsche, Sieb): kurze Guss-Ticks + Rauschkörner in hoher Lage. */
export function rattle(o: RattleOptions): Mono {
  const sr = 48000;
  const len = o.count / o.rate + 0.08;
  const out = new Float32Array(samples(len, sr));
  const r = o.rng;
  let t = 0;
  let g = 1;
  for (let k = 0; k < o.count; k++) {
    const f = o.fLo * Math.pow(o.fHi / o.fLo, r.next());
    const t60 = (o.t60 ?? 0.014) * r.jitter(0.3);
    const grain = mul(bandpass(noise('white', 0.006, r), f * 1.3, 1.2), decay(0.004, 0.006, 0.0002));
    addAt(out, tick(f, r, t60), t, g * r.range(0.55, 1));
    addAt(out, normPeak(grain), t, g * 0.6);
    g *= o.fall ?? 0.9;
    t += (1 / o.rate) * r.jitter(o.jitter ?? 0.25);
  }
  return normPeak(out);
}

// ---------------------------------------------------------------------------------------------------
// Fauchen (Raketen, Hochofen)
// ---------------------------------------------------------------------------------------------------

export interface HissOptions {
  rng: Rng;
  durS: number;
  /** Bandpass-Mitte über die Zeit (Hz). */
  band: number | Float32Array;
  q?: number;
  /** Lautstärke-Hüllkurve. */
  env: Float32Array;
  /** Knistern pro Sekunde (Glut-Treibladung). */
  crackle?: number;
  /** Gesättigtes Grollen darunter (0..1). */
  grit?: number;
  /** Rauschfarbe des Fauchens (Standard weiß; rosa = weicher, tiefer). */
  color?: NoiseColor;
  /** Pegel des Knisterns relativ zum Fauchen (dB, Standard −5). */
  crackleDb?: number;
}

/** Fauchen einer Glut-Treibladung/Esse: gefärbtes Rauschen mit Knistern und etwas Sättigung. */
export function roar(o: HissOptions): Mono {
  const d = o.durS;
  const r = o.rng;
  const hiss = bandpass(noise(o.color ?? 'white', d, r.fork('hiss')), o.band, o.q ?? 0.9);
  const rumble = lowpass(noise('brown', d, r.fork('rumble')), 320, 0.7, 2);
  const cr = highpass(crackle(d, r.fork('crackle'), { density: o.crackle ?? 600, grainS: 0.0004, spread: 2 }), 1500, 0.7, 1);
  const mixed = mixMono([
    { sig: normPeak(hiss), db: 0 },
    { sig: normPeak(rumble), db: -8 + 20 * Math.log10(Math.max(0.05, o.grit ?? 0.5)) },
    { sig: normPeak(cr), db: o.crackleDb ?? -5 },
  ]);
  return normPeak(shape(mul(mixed, o.env), { kind: 'tanh', drive: 1.8 }));
}

/** Kurzer, dumpfer Guss-Klack (Klappe, Verschluss, Trommel-Raste): Platten-Moden, sehr kurz. */
export function castClack(f0: number, rng: Rng, decayScale = 0.12, durS = 0.12): Mono {
  return normPeak(modal(f0, scaleDecay(PLATE_PARTIALS, decayScale), { durS, rng, jitter: 0.02 }));
}
