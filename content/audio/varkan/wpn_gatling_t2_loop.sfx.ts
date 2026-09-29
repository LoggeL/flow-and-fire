// Zange (T2-Bot), Waffe core:wpn_gatling_t2 (Glut-Gatling) als Feuerstoß-Loop, solange sie feuert. Davor und danach
// spielt varkan:wpn_gatling_t2_spin (Anlauf/Auslauf).
// 16 Schüsse pro Sekunde, exakt 16 im 1,0-s-Loop, damit die Naht im Takt liegt. Jeder Schuss: kurzer Knall, Guss-
// Klack des Laufs (Tonhöhe je Schuss leicht anders), kleiner Luftstoß. Darunter das Surren des Laufbündels und
// leises Glut-Zischen. Ein Limiter im Render senkt den Crest-Faktor, damit der Loop unter −1 dBTP bleibt (Loops werden
// integriert normiert und von der Pipeline nicht limitiert).
import { crack, defineSfx, highpass, lfo, limiter, lowpass, mixMono, noise, normPeak, osc, samples, shape, sizzle, thump } from '../../../tools/sfx/src/index.ts';
import { addAt, castClack } from './wpn_kit.ts';

const RATE = 16;

export default defineSfx({
  id: 'varkan:wpn_gatling_t2_loop',
  category: 'weapon',
  description: 'Zange (T2-Bot): Glut-Gatling, Feuerstoß-Loop mit 16 Schuss/s',
  variants: 1,
  loop: { lengthS: 1.0, crossfadeS: 0.12 },
  tags: ['varkan', 'direktfeuer', 'loop', 'core:wpn_gatling_t2', 'MS14'],
  render({ rng, durationS, sr }) {
    const dur = durationS ?? 1.12;
    const shots = new Float32Array(samples(dur, sr));
    const r = rng.fork('shots');
    for (let k = 0; k * (1 / RATE) < dur; k++) {
      const t = k / RATE + r.range(-0.002, 0.002);
      const q = r.jitter(0.05);
      const shot = mixMono([
        { sig: crack({ rng: r.fork(`c${k}`), durS: 0.04, freq: 2300 * q, q: 0.9, t60: 0.014, drive: 5 }), db: 0 },
        { sig: castClack(980 * q, r.fork(`k${k}`), 0.06, 0.05), db: -6 },
        { sig: thump({ rng: r.fork(`t${k}`), durS: 0.07, t60: 0.04, lpFrom: 2600, lpTo: 400 }), db: -6 },
      ]);
      addAt(shots, shot, Math.max(0, t), r.range(0.8, 1), sr);
    }
    const whir = lowpass(osc('saw', lfo(RATE / 6, 4, 150, dur), dur), 900, 0.9, 1);
    const air = lowpass(noise('pink', dur, rng.fork('air')), 1800, 0.7, 1);
    const layers = mixMono(
      [
        { sig: shots, db: 0 },
        { sig: whir, db: -28 },
        { sig: air, db: -28 },
        { sig: sizzle({ rng: rng.fork('ember'), durS: dur, t60: 60, hp: 3500, density: 300, hiss: 0.5 }), db: -30 },
      ],
      dur,
    );
    // Crest-Faktor senken: Peak auf 1, dann Look-ahead-Limiter 6 dB darunter (die Pipeline limitiert Loops nicht).
    const glued = limiter(normPeak(shape(layers, { kind: 'tanh', drive: 1.6 })), { ceilingDb: -6, releaseMs: 18 }) as Float32Array;
    return lowpass(highpass(glued, 130, 0.7, 2), 7500, 0.7, 1);
  },
});
