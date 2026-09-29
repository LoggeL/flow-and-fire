// Neuer Radar-/Sichtkontakt (gedrosselt): kurzer Blip. Zwei sehr kurze Sinus-Impulse (zweiter eine
// Quarte höher) mit leichtem FM-Glanz, trocken, hoch. Klar vom Radar-Ping unterscheidbar (kurz, ohne Hall).
import { decay, defineSfx, fm, highpass, mixMono, mul, sweep } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'common:int_contact_new',
  category: 'intel',
  description: 'Neuer Kontakt: kurzer Doppel-Blip',
  variants: 2,
  tags: ['intel', 'MS9'],
  render({ rng, sr, variant }) {
    const f = (variant === 0 ? 1900 : 1760) * rng.jitter(0.01);
    const blip = (fr: number, d: number): Float32Array =>
      mul(fm({ carrier: sweep(fr * 0.97, fr, 0.01, d, 'exp', sr), ratio: 2, index: 0.6, durS: d, sr }), decay(d * 0.9, d, 0.002, sr));
    const m = mixMono(
      [
        { sig: blip(f, 0.05), db: 0 },
        { sig: blip(f * 1.335, 0.07), db: -2, at: 0.065 },
      ],
      0.2,
    );
    return highpass(m, 400, 0.7, 2);
  },
});
