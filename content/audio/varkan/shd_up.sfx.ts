// Schild baut sich (wieder) auf. SOUNDLIST: „ansteigendes Summen, Kessel-Druck". FM-Summen steigt von
// A2 (110 Hz, Flow-Grundton) auf A4, die Welligkeit wird schneller, darunter steigt Dampfdruck (Rauschband
// öffnet nach oben). Am Ende schließt das Feld: gläserner Ping + kleiner Ventil-Klack.
import { bandpass, defineSfx, envelope, fm, highpass, mixMono, modal, mul, noise, osc, room, scaleDecay, sweep, thump, tick } from '../../../tools/sfx/src/index.ts';
import { GLASS_PARTIALS, finish } from '../common/lib_blast.ts';

export default defineSfx({
  id: 'varkan:shd_up',
  category: 'shield',
  description: 'Schild baut sich auf: ansteigendes Summen, Kessel-Druck',
  variants: 2,
  tags: ['varkan', 'schild', 'MS14'],
  render({ rng }) {
    const p = rng.jitter(0.03);
    const dur = 1.5;
    const tSeal = 1.12;
    const env = envelope([[0, 0], [tSeal - 0.02, 1, 1.5], [tSeal + 0.1, 0.5, 'lin'], [dur, 0.001, 'exp']], dur);
    const rippleRate = sweep(6, 32, tSeal, dur, 'exp');
    const ripple = osc('sine', rippleRate, dur).map((v) => 1 + 0.4 * v);
    const hum = mul(mul(fm({ carrier: sweep(110 * p, 440 * p, tSeal, dur, 'exp'), ratio: 2.0, index: sweep(1.5, 3, tSeal, dur, 'lin'), durS: dur }), env), ripple);
    const pressure = mul(bandpass(noise('white', dur, rng.fork('druck')), sweep(800, 4200, tSeal, dur, 'exp'), 1.5), envelope([[0, 0], [tSeal - 0.02, 1, 2], [tSeal + 0.05, 0.1, 'lin'], [dur, 0, 'lin']], dur));
    const ping = modal(880 * p, scaleDecay(GLASS_PARTIALS, 0.8), { durS: 0.4, rng: rng.fork('ping'), jitter: 0.01 });
    const m = mixMono(
      [
        { sig: hum, db: 0 },
        { sig: pressure, db: -11 },
        { sig: ping, db: -5, at: tSeal },
        { sig: tick(1400 * p, rng.fork('ventil'), 0.03), db: -12, at: tSeal },
        { sig: thump({ rng: rng.fork('stoss'), durS: 0.15, t60: 0.08, lpFrom: 1500, lpTo: 300 }), db: -13, at: tSeal },
      ],
      dur,
    );
    return finish(room(highpass(m, 70, 0.7, 2), { t60: 0.45, wet: 0.14, seed: 333 }), dur, 0.2);
  },
});
