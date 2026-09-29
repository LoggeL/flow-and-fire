// Trommelsieb (T3-Flugabwehr), Waffe core:wpn_aa_drum_t3 (Trommel-Flak, 105 Schaden, 0,5 s).
// Schnelles Rasseln (90/s, sehr hoch) plus der Trommel-Rotor: das Magazin dreht sich mit hörbaren, tieferen
// Rasten (Guss-Klacks ≈ 600 Hz, 22/s, auslaufend) und einem kurzen Rotor-Brummen. Knall heller und härter als
// beim Sieb, einzelner Schuss statt Zwilling.
import { crack, decay, defineSfx, highpass, lowpass, mixMono, mul, osc, room, shape, sweep } from '../../../tools/sfx/src/index.ts';
import { addAt, castClack, rattle } from './wpn_kit.ts';

export default defineSfx({
  id: 'varkan:wpn_aa_drum_t3_fire',
  category: 'weapon',
  description: 'Trommelsieb (T3-Flugabwehr): schnelles hohes Rasseln + Trommel-Rotor mit Rasten',
  variants: 3,
  tags: ['varkan', 'flugabwehr', 'core:wpn_aa_drum_t3', 'MS14'],
  render({ rng }) {
    const p = rng.jitter(0.04);
    const dur = 0.7;
    // Trommel-Rasten: Klacks, deren Abstand wächst (Rotor läuft aus).
    const rotor = new Float32Array(Math.round(0.6 * 48000));
    const r = rng.fork('rotor');
    let t = 0.02;
    let step = 1 / 24;
    for (let k = 0; k < 8; k++) {
      addAt(rotor, castClack(620 * p * r.jitter(0.03), r, 0.08, 0.06), t, Math.pow(0.84, k));
      t += step * r.jitter(0.08);
      step *= 1.12;
    }
    const hum = mul(lowpass(osc('square', sweep(95 * p, 60 * p, 0.35, 0.4), 0.4), 500, 0.8, 1), decay(0.35, 0.4, 0.01));
    const layers = mixMono(
      [
        { sig: crack({ rng: rng.fork('crack'), durS: 0.06, freq: 3000 * p, q: 0.9, t60: 0.02, drive: 6 }), db: 0 },
        { sig: rattle({ rng: rng.fork('rattle'), count: 16, rate: 90 * p, jitter: 0.2, fLo: 3200 * p, fHi: 7500 * p, fall: 0.87, t60: 0.01 }), db: -6, at: 0.008 },
        { sig: rotor, db: -9 },
        { sig: hum, db: -18 },
      ],
      dur,
    );
    return room(highpass(shape(layers, { kind: 'tanh', drive: 1.8 }), 200, 0.7, 2), { t60: 0.25, wet: 0.09, seed: 133 });
  },
});
