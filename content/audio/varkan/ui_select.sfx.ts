// Auswahl von Einheiten (faction.md §8.2): Relais-Klack + kurzer Blasebalg-Hauch. Stereo, fast mittig.
import { PLATE_PARTIALS, bandpass, decay, defineSfx, envelope, highpass, mixMono, modal, mul, noise, pan, scaleDecay, width } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:ui_select',
  category: 'ui',
  description: 'Auswahl: Relais-Klack und kurzer Blasebalg-Hauch',
  variants: 3,
  tags: ['varkan', 'ui', 'MS5'],
  render({ rng, sr }) {
    const dur = 0.26;
    const p = rng.jitter(0.04);
    const clack = modal(1250 * p, scaleDecay(PLATE_PARTIALS, 0.05), { durS: 0.06, rng: rng.fork('clack'), jitter: 0.02 });
    const click = mul(highpass(noise('white', 0.012, rng.fork('click')), 3500, 0.7, 2), decay(0.006, 0.012, 0.0001, sr));
    const breathLen = 0.17;
    const breath = mul(
      bandpass(noise('pink', breathLen, rng.fork('breath')), envelope([[0, 700 * p], [breathLen, 1100 * p, 'exp']], breathLen, sr), 1.2),
      envelope([[0, 0], [0.035, 1, 'lin'], [breathLen, 0, 1.8]], breathLen, sr),
    );
    const m = mixMono(
      [
        { sig: clack, db: 0 },
        { sig: click, db: -6 },
        { sig: breath, db: -11, at: 0.012 },
      ],
      dur,
    );
    return width(pan(highpass(m, 250, 0.7, 2), rng.range(-0.06, 0.06)), 1.25);
  },
});
