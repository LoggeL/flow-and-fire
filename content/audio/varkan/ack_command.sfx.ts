// Quittung Vogt (faction.md §8.1): die menschliche Operator-Stimme kommt über den Uplink, davor steht ein
// warmer Zweiklang (große Terz abwärts, gedämpfte Säge/Dreieck) mit Uplink-Charakter: Bandpass
// 300–3 400 Hz, dezentes Knistern, leichtes Bitcrush. Keine Pips (der Vogt ist keine Werkstimme).
import { bandpass, bitcrush, crackle, decay, defineSfx, envelope, highpass, lowpass, mixMono, mul, noise, osc } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:ack_command',
  category: 'ack',
  description: 'Quittung Vogt: warmer Zweiklang mit Uplink-Knistern (300–3 400 Hz)',
  variants: 2,
  tags: ['varkan', 'ack', 'vogt', 'MS9'],
  render({ rng, sr, variant }) {
    const dur = 0.55;
    const [f1, f2] = variant === 0 ? [659.3, 523.3] : [587.3, 466.2]; // E5→C5 bzw. D5→B♭4
    const note = (f: number, d: number): Float32Array => {
      const env = envelope([[0, 0], [0.012, 1, 'lin'], [d * 0.45, 0.7, 'lin'], [d, 0, 1.5]], d, sr);
      const body = mixMono([{ sig: lowpass(osc('saw', f, d), 1800, 0.7, 1), db: -6 }, { sig: osc('triangle', f, d) }, { sig: osc('sine', f * 2, d), db: -14 }]);
      return mul(body, env);
    };
    const tones = mixMono(
      [
        { sig: note(f1, 0.2), db: 0 },
        { sig: note(f2, 0.3), db: -1, at: 0.16 },
      ],
      dur,
    );
    const hissEnv = envelope([[0, 0], [0.01, 1, 'lin'], [0.45, 0.6, 'lin'], [dur, 0, 'lin']], dur, sr);
    const hiss = mul(noise('pink', dur, rng.fork('hiss')), hissEnv);
    const crk = mul(crackle(dur, rng.fork('crk'), { density: 60, grainS: 0.0005, spread: 2.2 }), hissEnv);
    const keyClick = mul(noise('white', 0.01, rng.fork('key')), decay(0.006, 0.01, 0.0001, sr));
    const m = mixMono(
      [
        { sig: tones, db: 0 },
        { sig: hiss, db: -34 },
        { sig: crk, db: -16 },
        { sig: keyClick, db: -14 },
      ],
      dur,
    );
    const radio = bitcrush(m, 10, 2);
    return highpass(bandpass(lowpass(radio, 3400, 0.7, 2), 1000, 0.35), 300, 0.7, 2);
  },
});
