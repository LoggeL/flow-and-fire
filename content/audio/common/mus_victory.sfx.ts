// Musik-Stinger „Sieg": Blechbläser-ähnliche FM-Kadenz in C-Dur (Auftakt G-G → C … F → G → C) mit
// Pauken-Wumm und einer hellen Glocke auf dem Schlussakkord. Stereo (Stimmen im Panorama verteilt), Hall.
// Alles synthetisch: 2-Operator-FM (Verhältnis 1:1, Index folgt der Hüllkurve = „Blech wird heller, je lauter").
import {
  BELL_PARTIALS,
  type Layer,
  type Mono,
  type Stereo,
  bandpass,
  boom,
  defineSfx,
  envelope,
  fm,
  highpass,
  lfo,
  lowpass,
  midiHz,
  mix,
  mixMono,
  modal,
  mul,
  noise,
  pan,
  reverb,
  scaleDecay,
  Rng,
} from '../../../tools/sfx/src/index.ts';

export interface BrassOptions {
  /** Anblas-Schärfe (FM-Index-Spitze), Standard 3,5. */
  bite?: number;
  /** Ausklang in s (Standard 0,12). */
  releaseS?: number;
  /** Vibrato-Tiefe (relativ, Standard 0,004). */
  vib?: number;
  rng?: Rng;
}

/** Ein Blech-Ton: zwei leicht verstimmte FM-Stimmen, heller Anblas, Atemrauschen, Tiefpass. */
export function brass(note: number, durS: number, o: BrassOptions = {}): Mono {
  const f = midiHz(note);
  const rel = o.releaseS ?? 0.12;
  const total = durS + rel;
  const bite = o.bite ?? 3.5;
  const idx = envelope([[0, 0.3], [0.045, bite, 'lin'], [0.18, bite * 0.6, 'exp'], [durS, bite * 0.45, 'lin'], [total, 0.2, 'lin']], total);
  const amp = envelope([[0, 0], [0.03, 1, 'lin'], [0.15, 0.82, 'exp'], [durS, 0.78, 'lin'], [total, 0, 'exp']], total);
  const vib = (d: number): Float32Array => {
    const v = lfo(5.1 + d, f * (o.vib ?? 0.004), f * (1 + d * 0.0017), total);
    // Vibrato setzt erst nach 0,25 s ein.
    for (let i = 0; i < v.length; i++) {
      const k = Math.min(1, Math.max(0, (i / 48000 - 0.25) / 0.3));
      v[i] = f * (1 + d * 0.0017) + ((v[i] as number) - f * (1 + d * 0.0017)) * k;
    }
    return v;
  };
  const a = fm({ carrier: vib(1), ratio: 1, index: idx, durS: total });
  const b = fm({ carrier: vib(-1), ratio: 1, index: idx, durS: total });
  const breath = o.rng ? bandpass(noise('pink', total, o.rng), f * 2, 2) : new Float32Array(a.length);
  const body = mixMono([{ sig: a }, { sig: b }, { sig: breath, db: -26 }]);
  const cut = envelope([[0, 700], [0.05, Math.min(9000, f * 9), 'lin'], [0.3, Math.min(6000, f * 6), 'exp'], [total, Math.min(3000, f * 4), 'lin']], total);
  return mul(lowpass(body, cut, 0.7, 1), amp);
}

/** Akkord: mehrere Blech-Töne, im Panorama verteilt. */
export function brassChord(notes: readonly number[], durS: number, rng: Rng, o: BrassOptions = {}): Stereo {
  const layers: Layer[] = notes.map((n, i) => ({
    sig: pan(brass(n, durS, { ...o, rng: rng.fork(`b${n}`) }), notes.length > 1 ? -0.55 + (1.1 * i) / (notes.length - 1) : 0),
    db: n < 48 ? -2 : 0,
  }));
  return mix(layers) as Stereo;
}

export default defineSfx({
  id: 'common:mus_victory',
  category: 'music',
  description: 'Sieg-Stinger: FM-Blech-Kadenz in C-Dur mit Pauke und Glocke (≈ 7 s)',
  variants: 1,
  tags: ['musik', 'stinger', 'MS9'],
  render({ rng }) {
    const C = [48, 55, 60, 64, 67, 72];
    const F = [41, 53, 57, 60, 65, 69];
    const G = [43, 50, 55, 59, 62, 71];
    const Cfin = [36, 48, 55, 60, 64, 67, 72, 76];
    const timp = (from: number, to: number): Stereo => pan(boom({ from, to, sweepS: 0.05, t60: 1.1, durS: 1.3, drive: 1.6 }), 0);
    const bell = modal(midiHz(84), scaleDecay(BELL_PARTIALS, 0.9), { durS: 3.5, rng: rng.fork('bell'), jitter: 0 });
    const dry = mix([
      { sig: pan(brass(67, 0.13, { rng: rng.fork('p1'), releaseS: 0.06 }), 0.1), at: 0.0, db: -1 },
      { sig: pan(brass(67, 0.13, { rng: rng.fork('p2'), releaseS: 0.06 }), 0.1), at: 0.2, db: -1 },
      { sig: brassChord(C, 0.95, rng.fork('c1')), at: 0.4 },
      { sig: timp(110, 64), at: 0.4, db: -4 },
      { sig: brassChord(F, 0.48, rng.fork('f')), at: 1.45, db: -1 },
      { sig: brassChord(G, 0.48, rng.fork('g')), at: 2.0, db: -1 },
      { sig: pan(brass(74, 0.48, { rng: rng.fork('g2') }), 0.3), at: 2.0, db: -4 },
      { sig: brassChord(Cfin, 2.6, rng.fork('c2'), { releaseS: 0.9, vib: 0.006 }), at: 2.55, db: 1 },
      { sig: timp(98, 60), at: 2.55, db: -2 },
      { sig: pan(bell, 0.25), at: 2.56, db: -6 },
    ]) as Stereo;
    const wet = reverb(dry, { roomSize: 0.82, damping: 0.45, wet: 0.28, dry: 1, width: 1, predelayS: 0.02, tailS: 2.2 });
    return [highpass(wet[0], 35, 0.7, 2), highpass(wet[1], 35, 0.7, 2)];
  },
});
