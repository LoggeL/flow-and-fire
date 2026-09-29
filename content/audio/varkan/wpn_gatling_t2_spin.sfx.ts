// Zange (T2-Bot), Waffe core:wpn_gatling_t2: Anlauf und Auslauf des Laufbündels, dazu Heißlauf-Zischen.
// Variante 0 = Anlauf (vor wpn_gatling_t2_loop), Variante 1 = Auslauf (danach). Die Laufzeit wählt die Variante
// explizit über den Index (nicht zufällig).
// Schichten: Rasten-Klacks des Laufbündels (Rate 4 → 24/s bzw. zurück), Motor-Surren (Säge 60 → 220 Hz, Tiefpass),
// Heißlauf-Zischen (im Auslauf deutlich, im Anlauf leise), kleiner Raum.
import { defineSfx, envelope, fade, fit, highpass, lowpass, mixMono, mul, noise, osc, room, samples, shape, sweep } from '../../../tools/sfx/src/index.ts';
import { addAt, castClack } from './wpn_kit.ts';

export default defineSfx({
  id: 'varkan:wpn_gatling_t2_spin',
  category: 'weapon',
  description: 'Zange (T2-Bot): Gatling-Anlauf (v0) und -Auslauf (v1) mit Heißlauf-Zischen',
  variants: 2,
  tags: ['varkan', 'direktfeuer', 'core:wpn_gatling_t2', 'MS14', 'v0=anlauf', 'v1=auslauf'],
  render({ rng, variant, sr }) {
    const up = variant === 0;
    const dur = up ? 0.72 : 0.9;
    const rot = up ? sweep(4, 24, 0.65, dur, 1.6) : sweep(24, 3, 0.8, dur, 0.6);
    const clicks = new Float32Array(samples(dur, sr));
    const r = rng.fork('clicks');
    for (let t = 0.005; t < dur - 0.03; ) {
      const i = Math.min(rot.length - 1, samples(t, sr));
      const rate = rot[i] as number;
      const g = up ? 0.4 + 0.6 * (t / dur) : 1 - 0.75 * (t / dur);
      addAt(clicks, castClack(1350 * r.jitter(0.04), r, 0.05, 0.04), t, g * r.range(0.8, 1), sr);
      t += 1 / rate;
    }
    const motorF = mul(rot, 9.2);
    const menv = up ? envelope([[0, 0.2], [0.6, 1, 'lin'], [dur, 0.8, 'lin']], dur) : envelope([[0, 1], [dur, 0.0005, 'exp']], dur);
    const motor = mul(lowpass(osc('saw', motorF, dur), 1200, 0.9, 1), menv);
    const henv = up ? envelope([[0, 0], [0.5, 0.3, 'lin'], [dur, 0.4, 'lin']], dur) : envelope([[0, 0.25], [0.35, 1, 'lin'], [dur, 0.0005, 'exp']], dur);
    const hiss = mul(highpass(noise('pink', dur, rng.fork('hiss')), 3200, 0.7, 2), henv);
    const layers = mixMono(
      [
        { sig: clicks, db: 0 },
        { sig: motor, db: -12 },
        { sig: hiss, db: up ? -14 : -7 },
      ],
      dur,
    );
    const wet = room(highpass(shape(layers, { kind: 'tanh', drive: 1.5 }), 120, 0.7, 2), { t60: 0.25, wet: 0.1, seed: 181 });
    // Anlauf endet in den Feuerstoß-Loop: kurz ausblenden statt Raum-Nachklang; beide ≤ 1,0 s.
    return fade(fit(wet, up ? dur + 0.04 : 0.98), 0, up ? 0.05 : 0.08);
  },
});
