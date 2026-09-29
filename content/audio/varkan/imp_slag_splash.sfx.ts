// Einschlag: Artillerie der Varkan (Kelle, Pfanne, Tiegel, Hochofen). faction.md §8.2: „Einschlag als
// Knirschen und Zischen der Schlacke". Schichten: Schwapp (Flüssigkeit klatscht), dumpfer Stoß,
// Knirschen der erstarrenden Kruste (grobes Knistern), Dampf-Zischen, Glutknistern, einzelne Blasen.
import { bandpass, boom, crackle, decay, defineSfx, envelope, highpass, lowpass, mixMono, mul, noise, osc, room, shape, sizzle, sweep } from '../../../tools/sfx/src/index.ts';
import { expRange, finish, steam } from '../common/lib_blast.ts';

export default defineSfx({
  id: 'varkan:imp_slag_splash',
  category: 'impact',
  description: 'Artillerie-Einschlag: Schwapp, Knirschen und Zischen der Schlacke',
  variants: 4,
  tags: ['varkan', 'einschlag', 'artillerie', 'MS9'],
  render({ rng }) {
    const p = rng.jitter(0.07);
    const dur = 1.5;
    const sd = 0.3;
    const splat = shape(bandpass(mul(noise('pink', sd, rng.fork('splat')), decay(0.12, sd, 0.002)), sweep(1800 * p, 380 * p, 0.1, sd), 0.8), { kind: 'tanh', drive: 3 });
    const cd = 0.5;
    const crunchDen = envelope([[0, 0], [0.01, 4200, 'lin'], [0.3 * rng.jitter(0.2), 60, 'exp'], [cd, 0, 'lin']], cd);
    const crunch = bandpass(crackle(cd, rng.fork('crunch'), { density: crunchDen, grainS: 0.0015, spread: 1.5 }), 1400 * p, 0.6);
    const crust = lowpass(crackle(cd, rng.fork('crust'), { density: crunchDen, grainS: 0.003, spread: 1.2 }), 1200, 0.7, 2);
    const layers = [
      { sig: splat, db: -2 },
      { sig: boom({ from: 140 * p, to: 55 * p, sweepS: 0.05, t60: 0.2, durS: 0.35, drive: 2.5 }), db: -4 },
      { sig: crunch, db: -4, at: 0.015 },
      { sig: crust, db: -9, at: 0.02 },
      { sig: steam({ rng: rng.fork('dampf'), durS: 1.4, attackS: 0.06, t60: 1.1 * rng.jitter(0.15), hp: 3000, flutter: 0.5 }), db: -9, at: 0.04 },
      { sig: sizzle({ rng: rng.fork('glut'), durS: 1.3, t60: 1.0, hp: 4000, density: 250, hiss: 0.3 }), db: -15, at: 0.08 },
    ];
    // Blasen: kurze Sinus-Blips mit steigender Tonhöhe (platzende Schlackeblasen).
    const nb = 5 + Math.floor(rng.next() * 5);
    for (let i = 0; i < nb; i++) {
      const r = rng.fork(`blase${i}`);
      const f = expRange(r, 250, 700);
      const bd = r.range(0.02, 0.045);
      const b = mul(osc('sine', sweep(f, f * 1.5, bd, bd), bd), envelope([[0, 0], [0.002, 1, 'lin'], [bd, 0, 'exp']], bd));
      layers.push({ sig: b, db: -16 - r.range(0, 6), at: r.range(0.12, 1.0) });
    }
    return finish(room(highpass(mixMono(layers, dur), 60, 0.7, 2), { t60: 0.35, wet: 0.1, seed: 311 }), dur, 0.35);
  },
});
