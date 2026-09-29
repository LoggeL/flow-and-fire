// Schwerer Bot-Schritt (Vogt, Fallhammer): schwerer Guss-Tritt + Hydraulik (faction.md §8.2).
//   Stampf   fallender Sinus 105→42 Hz, asymmetrisch gesättigt (Masse), dazu Erdstoß
//   Guss     tiefer Plattenklang 110–140 Hz + hohler Comb-Klang, Nachklirren der Beinplatten
//   Hydraulik Servo-Stöhnen (Säge 70→52 Hz, Tiefpass) + langes Druck-Zischen mit fallendem Filter
// Transiente bei t = 0 (Fußkontakt).
import {
  PLATE_PARTIALS,
  bandpass,
  boom,
  comb,
  defineSfx,
  envelope,
  highpass,
  lowpass,
  mixMono,
  modal,
  mul,
  noise,
  osc,
  scaleDecay,
  sweep,
  thump,
  tick,
} from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:mov_bot_heavy_step',
  category: 'unit',
  description: 'Schwerer Bot-Schritt: Guss-Stampfer mit Hydraulik-Stöhnen und Druck-Zischen',
  variants: 6,
  tags: ['varkan', 'bewegung', 'MS5'],
  render({ rng, variant }) {
    const dur = 0.58;
    // Varianten: Tonhöhe des Stampfers fest gestaffelt (±12 %), Härte und Länge des Aufsetzens je eigen.
    const p = [0.9, 1.0, 1.1, 0.95, 1.05, 1.15][variant % 6]! * rng.jitter(0.02);
    const stomp = boom({ from: 105 * p, to: 42 * p, sweepS: [0.07, 0.05, 0.09, 0.06, 0.08, 0.1][variant % 6]!, t60: [0.22, 0.18, 0.26, 0.2, 0.24, 0.16][variant % 6]!, durS: 0.3, drive: 2.6 + 0.3 * (variant % 4) });
    const earth = thump({ rng: rng.fork('earth'), durS: 0.25, t60: 0.16, lpFrom: 900, lpTo: 90, color: 'brown' });
    const plate = modal(125 * p * rng.jitter(0.08), scaleDecay(PLATE_PARTIALS, 0.3 * rng.jitter(0.25)), { durS: 0.25, rng: rng.fork('plate'), jitter: 0.02 });
    const hollow = comb(plate, { freq: 170 * p, feedback: 0.6, damp: 0.4, mix: 0.5, tailS: 0.08 });
    const rattle = tick(rng.range(700, 1000), rng.fork('rattle'), 0.05);
    const groanDur = 0.34;
    const groan = mul(
      lowpass(osc('saw', sweep(70 * p, 52 * p, groanDur, groanDur, 'lin'), groanDur), 420, 1.4, 2),
      envelope([[0, 0], [0.05, 1, 'lin'], [0.2, 0.7, 'lin'], [groanDur, 0, 'lin']], groanDur),
    );
    const hissDur = 0.36 * rng.jitter(0.1);
    const hiss = mul(
      bandpass(noise('white', hissDur, rng.fork('hiss')), sweep(4200 * rng.jitter(0.1), 1500, hissDur, hissDur), 1.3),
      envelope([[0, 0], [0.02, 1, 'lin'], [hissDur * 0.5, 0.5, 'exp'], [hissDur, 0, 'exp']], hissDur),
    );
    return highpass(
      mixMono(
        [
          { sig: stomp, db: 0 },
          { sig: earth, db: -5 },
          { sig: hollow, db: -4 + rng.range(-2.5, 2.5) },
          { sig: rattle, db: -18, at: 0.05 + rng.range(0, 0.03) },
          { sig: groan, db: -16, at: 0.03 },
          { sig: hiss, db: -12 + rng.range(-2, 2), at: 0.06 + rng.range(0, 0.03) },
        ],
        dur,
      ),
      32,
      0.7,
      2,
    );
  },
});
