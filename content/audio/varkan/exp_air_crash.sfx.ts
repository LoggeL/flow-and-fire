// Flugzeug abgeschossen. Absturzpfeifen (fallender Ton + Rauschband, lauter werdend) über einem
// stotternden Blasebalg-Antrieb, dann der Aufschlag: Knall, Wumm, Gussbruch, Rutschen/Schaben,
// Trümmer und kurzes Glutzischen. Der Aufschlagzeitpunkt variiert je Variante (0,85–1,2 s).
import { bandpass, boom, crack, defineSfx, envelope, highpass, lfo, mixMono, mul, noise, osc, room, shape, sweep, thump } from '../../../tools/sfx/src/index.ts';
import { debris, finish, flutter, ironBreak, steam } from '../common/lib_blast.ts';

export default defineSfx({
  id: 'varkan:exp_air_crash',
  category: 'explosion',
  description: 'Flugzeug abgeschossen: Absturzpfeifen + Aufschlag',
  variants: 3,
  tags: ['varkan', 'explosion', 'luft', 'MS14'],
  render({ rng }) {
    const p = rng.jitter(0.08);
    const dur = 2.5;
    const T = rng.range(0.85, 1.2);
    const approach = envelope([[0, 0], [0.08, 0.25, 'lin'], [T - 0.01, 1, 1.8], [T, 0, 'lin']], T);
    const fall = sweep(1500 * p, 420 * p, T, T, 'exp');
    const whistle = mixMono([
      { sig: osc('sine', mul(fall, lfo(7, 0.012, 1, T)), T), db: -4 },
      { sig: bandpass(noise('white', T, rng.fork('pfeif')), fall, 7), db: 0 },
    ]);
    const sputter = mul(bandpass(noise('pink', T, rng.fork('antrieb')), 800 * p, 1.2), flutter(rng.fork('stotter'), T, 16, 1.4));
    const sd = 0.7;
    const scrape = mul(bandpass(noise('pink', sd, rng.fork('schaben')), sweep(1300 * p, 480 * p, sd, sd), 2.5), envelope([[0, 0], [0.04, 1, 'lin'], [sd, 0, 'lin']], sd));
    const m = mixMono(
      [
        { sig: mul(whistle, approach), db: -8 },
        { sig: mul(sputter, approach), db: -16 },
        { sig: crack({ rng: rng.fork('crack'), durS: 0.1, freq: 1000 * p, q: 0.7, t60: 0.04, drive: 6 }), db: -2, at: T },
        { sig: boom({ from: 120 * p, to: 35 * p, sweepS: 0.1, t60: 0.5, durS: 0.9, drive: 3 }), db: 0, at: T },
        { sig: thump({ rng: rng.fork('thump'), durS: 0.7, t60: 0.4, lpFrom: 2200, lpTo: 160 }), db: -2, at: T },
        { sig: ironBreak({ rng: rng.fork('guss'), count: 6, fLo: 300, fHi: 1200, spreadS: 0.1, t60: 0.14, durS: 0.5 }), db: -4, at: T + 0.004 },
        { sig: scrape, db: -13, at: T + 0.05 },
        { sig: debris({ rng: rng.fork('truemmer'), durS: dur - T, fromS: 0.05, toS: dur - T - 0.1, count: 18, fLo: 700, fHi: 3000, t60: 0.035, bounce: 0.5, fallDb: 14 }), db: -12, at: T },
        { sig: steam({ rng: rng.fork('glut'), durS: dur - T, attackS: 0.05, t60: 0.9, hp: 3200, flutter: 0.6 }), db: -16, at: T + 0.05 },
      ],
      dur,
    );
    return finish(room(highpass(shape(m, { kind: 'tanh', drive: 1.3 }), 30, 0.7, 2), { t60: 0.5, wet: 0.12, seed: 325 }), dur, 0.3);
  },
});
