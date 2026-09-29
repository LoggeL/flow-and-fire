// Ungültige Aktion (Platzierung, Ressourcen, Ziel): tiefer Doppel-Buzz. Zwei kurze, gedämpfte
// Rechteck-Brummer (~150 Hz, zweiter etwas tiefer), mit Tiefpass entschärft, damit er nicht nervt.
import { decay, defineSfx, envelope, highpass, lowpass, mixMono, mul, osc, pan, width } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'common:ui_error',
  category: 'ui',
  description: 'Fehler: tiefer Doppel-Buzz',
  variants: 2,
  tags: ['ui', 'MS6'],
  render({ rng, sr, variant }) {
    const f = (variant === 0 ? 155 : 147) * rng.jitter(0.01);
    const buzz = (fr: number, d: number): Float32Array => {
      const env = envelope([[0, 0], [0.006, 1, 'lin'], [d - 0.03, 0.8, 'lin'], [d, 0, 'lin']], d, sr);
      const sq = lowpass(osc('square', fr, d), 1400, 0.8, 2);
      const sub = osc('sine', fr, d);
      return mul(mixMono([{ sig: sq }, { sig: sub, db: -6 }]), mul(env, decay(0.4, d, 0.001, sr)));
    };
    const m = mixMono(
      [
        { sig: buzz(f, 0.1), db: 0 },
        { sig: buzz(f * 0.94, 0.12), db: -1, at: 0.145 },
      ],
      0.3,
    );
    return width(pan(highpass(m, 90, 0.7, 2), 0), 1);
  },
});
