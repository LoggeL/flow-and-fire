// Gebäude-Einsturz (zusätzlich zur SOUNDLIST, Auftrag „Gebäude-Einsturz"): folgt bei großen Gebäuden auf
// exp_medium/exp_large bzw. beim Zusammensacken des Gebäude-Wracks. Stahl stöhnt und knackt, dann
// schlagen 4–6 schwere Teile nacheinander auf (dumpfer Gussklang + Erdstoß), dazu Grollen, Trümmer und
// Staub. Leiser als die Explosion selbst (Ziel −20 statt −17 LUFS), damit er sie nicht überdeckt.
import { PLATE_PARTIALS, bandpass, boom, clang, defineSfx, envelope, highpass, lfo, lowpass, mixMono, mul, noise, osc, room, sweep, thump, tick } from '../../../tools/sfx/src/index.ts';
import { debris, expRange, finish, gravel, rumble } from '../common/lib_blast.ts';

export default defineSfx({
  id: 'varkan:exp_structure_collapse',
  category: 'explosion',
  targetLufs: -20,
  description: 'Gebäude-Einsturz: Stahl-Stöhnen, schwere Aufschläge, Grollen und Staub',
  variants: 2,
  tags: ['varkan', 'explosion', 'struktur', 'einsturz', 'MS14'],
  render({ rng }) {
    const p = rng.jitter(0.06);
    const dur = 4.0;
    const layers: { sig: Float32Array; db: number; at?: number }[] = [];
    // Stöhnen: zwei verstimmte Sägezähne, langsam fallend und schwankend, schmalbandig.
    for (let k = 0; k < 2; k++) {
      const gd = 1.5;
      const r = rng.fork(`stoehnen${k}`);
      const f = mul(sweep(expRange(r, 70, 110) * p, expRange(r, 45, 65) * p, gd, gd), lfo(r.range(2.5, 5), 0.025, 1, gd, 'sine', r.next()));
      const g = mul(bandpass(osc('saw', f, gd), r.range(350, 650), 3), envelope([[0, 0], [0.3, 1, 'lin'], [gd, 0, 'lin']], gd));
      layers.push({ sig: g, db: -12 - k * 3, at: r.range(0, 0.15) });
    }
    // Knacken der Träger.
    for (let i = 0; i < 5; i++) {
      const r = rng.fork(`knack${i}`);
      layers.push({ sig: tick(expRange(r, 350, 900), r, 0.08), db: -10 - r.range(0, 8), at: r.range(0.05, 0.8) });
    }
    // Schwere Aufschläge in zunehmendem Abstand.
    const n = 4 + Math.floor(rng.next() * 3);
    let t = rng.range(0.55, 0.75);
    for (let i = 0; i < n && t < 3.0; i++) {
      const r = rng.fork(`fall${i}`);
      const q = r.jitter(0.12);
      const hit = mixMono(
        [
          { sig: boom({ from: 100 * q, to: 38 * q, sweepS: 0.08, t60: 0.35, durS: 0.6, drive: 2.5 }), db: 0 },
          { sig: thump({ rng: r.fork('t'), durS: 0.5, t60: 0.3, lpFrom: 1400, lpTo: 150, color: 'brown' }), db: -2 },
          { sig: lowpass(clang({ f0: expRange(r, 140, 300), rng: r.fork('c'), durS: 0.6, decayScale: 0.6, partials: PLATE_PARTIALS, strike: 0.2 }), 1600, 0.7, 2), db: -7 },
        ],
        0.8,
      );
      layers.push({ sig: hit, db: -i * 1.8 - r.range(0, 2), at: t });
      t += r.range(0.25, 0.55) * (1 + i * 0.15);
    }
    const dustD = 3.4;
    const dust = mul(bandpass(noise('pink', dustD, rng.fork('staub')), 1800, 0.6), envelope([[0, 0], [0.6, 1, 'lin'], [dustD, 0, 'lin']], dustD));
    layers.push(
      { sig: rumble(rng.fork('grollen'), 3.4, 150, 2.6, 0.4), db: -6, at: 0.5 },
      { sig: debris({ rng: rng.fork('truemmer'), durS: 3.4, fromS: 0.05, toS: 3.1, count: 30, fLo: 500, fHi: 2600, t60: 0.045, bounce: 0.5, fallDb: 12, skew: 1.2, lp: 4000 }), db: -13, at: 0.6 },
      { sig: gravel({ rng: rng.fork('kies'), durS: 3.4, fromS: 0.05, toS: 3.0, density: 450, lp: 2500, hp: 300, grainS: 0.0018 }), db: -17, at: 0.6 },
      { sig: dust, db: -24, at: 0.6 },
    );
    return finish(room(highpass(mixMono(layers, dur), 28, 0.7, 2), { t60: 1.0, wet: 0.18, seed: 326, darkHz: 800 }), dur, 0.6);
  },
});
