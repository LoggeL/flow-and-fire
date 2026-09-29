// Einschlag: MG-/Gatling-/Luftkanonen-Kugel trifft eine Einheit. Helles Ping mit Splittern, sehr kurz,
// damit Salven nicht verschmieren. 6 Varianten; jede dritte hat einen Abpraller-Pfiff („piuu").
import { crack, decay, defineSfx, envelope, highpass, mixMono, modal, mul, osc, room, sweep, tick } from '../../../tools/sfx/src/index.ts';
import { debris, finish } from './lib_blast.ts';

export default defineSfx({
  id: 'common:imp_bullet_metal',
  category: 'impact',
  description: 'MG/Gatling/Luftkanone trifft Einheit: helles Ping mit Splittern',
  variants: 6,
  tags: ['einschlag', 'MS9'],
  render({ rng, variant }) {
    const p = rng.jitter(0.12);
    const dur = 0.3;
    const ping = modal(
      2600 * p,
      [
        { ratio: 1, amp: 1, t60: 0.09 },
        { ratio: 2.32, amp: 0.6, t60: 0.06 },
        { ratio: 3.8, amp: 0.4, t60: 0.04 },
        { ratio: 5.1, amp: 0.25, t60: 0.03 },
      ],
      { durS: 0.28, rng: rng.fork('ping'), jitter: 0.04, pitch: sweep(1.02, 1, 0.01, 0.28) },
    );
    const layers = [
      { sig: crack({ rng: rng.fork('crack'), durS: 0.03, freq: 4200 * p, q: 0.8, t60: 0.006, drive: 4 }), db: -2 },
      { sig: mul(ping, decay(0.12, 0.28, 0.0002)), db: -3 },
      { sig: tick(700 * p, rng.fork('body'), 0.02), db: -12 },
      { sig: debris({ rng: rng.fork('sparks'), durS: dur, fromS: 0.005, toS: 0.12, count: 4, fLo: 4000, fHi: 8000, t60: 0.012, bounce: 0 }), db: -16 },
    ];
    if (variant % 3 === 2) {
      const d = 0.25;
      const ric = mul(osc('sine', sweep(3400 * p, 1500 * p, 0.2, d), d), envelope([[0, 0], [0.012, 1, 'lin'], [0.22, 0.001, 'exp']], d));
      layers.push({ sig: ric, db: -9 });
    }
    return finish(room(highpass(mixMono(layers, dur), 250, 0.7, 2), { t60: 0.2, wet: 0.08, seed: 213 }), dur, 0.05);
  },
});
