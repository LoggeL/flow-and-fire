// Schild-Treffer (Schürze, Schirm II/III). SOUNDLIST: „glasiges Summen mit Ripple (FM, kurze Hüllkurve)".
// Varkan-Schilde sind Druckfelder aus dem Kessel: FM-Summen mit abklingender Welligkeit (Ripple-AM,
// 38→12 Hz), gläserner Stabklang, weicher Stoß und ein Hauch Glutzischen. 4 Varianten mit
// verschiedenen FM-Verhältnissen (unterschiedliche Klangfarbe, gleiche Familie).
import { decay, defineSfx, envelope, fm, highpass, lowpass, mixMono, modal, mul, room, scaleDecay, sizzle, thump } from '../../../tools/sfx/src/index.ts';
import { GLASS_PARTIALS, finish } from '../common/lib_blast.ts';

const RATIOS = [1.414, 2.0, 1.333, 2.76] as const;

export default defineSfx({
  id: 'varkan:shd_hit',
  category: 'shield',
  description: 'Treffer auf Schild: glasiges Summen mit Ripple',
  variants: 4,
  tags: ['varkan', 'schild', 'MS14'],
  render({ rng, variant }) {
    const p = rng.jitter(0.06);
    const dur = 0.8;
    const d = 0.7;
    const t = new Float32Array(Math.round(d * 48000)).map((_, i) => i / 48000);
    let rph = 0;
    const ripple = t.map((ti) => {
      const hz = 12 + 26 * Math.exp(-ti / 0.18);
      rph += hz / 48000;
      return 1 + 0.55 * Math.sin(2 * Math.PI * rph);
    });
    const hum = mul(mul(fm({ carrier: 520 * p, ratio: RATIOS[variant % RATIOS.length]!, index: envelope([[0, 4.5], [0.3, 0.4, 'exp']], d), durS: d }), decay(0.42 * rng.jitter(0.15), d, 0.003)), ripple);
    const glass = modal(1700 * p * rng.jitter(0.05), scaleDecay(GLASS_PARTIALS, 0.6), { durS: 0.5, rng: rng.fork('glas'), jitter: 0.02 });
    const m = mixMono(
      [
        { sig: hum, db: 0 },
        { sig: glass, db: -8 },
        { sig: thump({ rng: rng.fork('stoss'), durS: 0.15, t60: 0.06, lpFrom: 2000, lpTo: 300 }), db: -12 },
        { sig: sizzle({ rng: rng.fork('glut'), durS: 0.5, t60: 0.35, hp: 5000, density: 300, hiss: 0.5 }), db: -22 },
      ],
      dur,
    );
    return finish(room(lowpass(highpass(m, 150, 0.7, 2), 9000, 0.7, 1), { t60: 0.4, wet: 0.15, seed: 331 }), dur, 0.15);
  },
});
