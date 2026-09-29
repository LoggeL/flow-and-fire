// Reißnadel (T3-Scharfschützen-Bot), Waffe core:wpn_scriber_rail_t3 (Langrohr-Präzisionskanone, 1 000 Schaden).
// Scharfer, sehr kurzer Knall (hell, hart gesättigt), danach singt das lange Rohr: ein Rauschstoß regt einen
// Kammfilter auf der Rohr-Resonanz (≈ 760 Hz, Rückkopplung 0,975) an, darüber schwache Rohr-Moden (fast harmonisch,
// wie ein angeschlagenes Rohr). Kaum Wumm: die Waffe ist präzise, nicht schwer. Hochpass 150 Hz.
import { boom, comb, crack, defineSfx, highpass, mixMono, modal, mul, noise, decay, normPeak, room, shape, sweep } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:wpn_scriber_rail_t3_fire',
  category: 'weapon',
  description: 'Reißnadel (T3): Langrohr, scharfer Knall + singender Metallton der Rohr-Resonanz',
  variants: 3,
  tags: ['varkan', 'direktfeuer', 'core:wpn_scriber_rail_t3', 'MS14'],
  render({ rng }) {
    const p = rng.jitter(0.03);
    const dur = 1.9;
    const f = 760 * p;
    const snap = crack({ rng: rng.fork('snap'), durS: 0.05, freq: 3800 * p, q: 0.8, t60: 0.012, drive: 8 });
    // Rohr-Resonanz: kurzer Rauschstoß durch einen Kammfilter, Tonhöhe sackt minimal ab (Rohr kühlt).
    const excite = mul(noise('white', 0.03, rng.fork('ex')), decay(0.02, 0.03, 0.0002));
    const sing = comb(excite, { freq: sweep(f * 1.012, f, 0.4, 1.7), feedback: 0.975, damp: 0.12, tailS: 1.6 });
    const tube = modal(f, [
      { ratio: 1, amp: 0.6, t60: 1.1 },
      { ratio: 2.01, amp: 0.5, t60: 0.8 },
      { ratio: 3.03, amp: 0.35, t60: 0.6 },
      { ratio: 4.07, amp: 0.25, t60: 0.4 },
      { ratio: 5.6, amp: 0.15, t60: 0.25 },
    ], { durS: 1.7, rng: rng.fork('tube'), jitter: 0.006 });
    const layers = mixMono(
      [
        { sig: snap, db: 0 },
        { sig: crack({ rng: rng.fork('blast'), durS: 0.1, freq: 1600 * p, q: 0.6, t60: 0.035, drive: 4 }), db: -5 },
        { sig: normPeak(sing), db: -9, at: 0.002 },
        { sig: normPeak(tube), db: -14, at: 0.002 },
        { sig: boom({ from: 210 * p, to: 95 * p, sweepS: 0.04, t60: 0.14, durS: 0.25, drive: 3 }), db: -12 },
      ],
      dur,
    );
    return room(highpass(shape(layers, { kind: 'tanh', drive: 1.5 }), 150, 0.7, 2), { t60: 0.6, wet: 0.15, seed: 171, brightHz: 8000 });
  },
});
