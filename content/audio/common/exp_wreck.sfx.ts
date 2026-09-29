// Wrack (zusätzlich zur SOUNDLIST, Auftrag „Wrack"): ein Wrack zerbirst oder sackt zusammen, z. B. wenn
// es unter Beschuss zerfällt. Materialneutral (common): dumpfer Blech-Crunch, Plattenklang, Nachrutschen
// (Schaben), ein paar Brocken. Deutlich leiser und kürzer als eine Explosion (Ziel −20 statt −17 LUFS).
import { PLATE_PARTIALS, bandpass, boom, clang, crackle, defineSfx, envelope, highpass, lowpass, mixMono, mul, noise, room, sweep } from '../../../tools/sfx/src/index.ts';
import { debris, finish } from './lib_blast.ts';

export default defineSfx({
  id: 'common:exp_wreck',
  category: 'explosion',
  targetLufs: -20,
  description: 'Wrack zerbirst/sackt zusammen: dumpfer Blech-Crunch, Nachrutschen, Brocken',
  variants: 3,
  tags: ['explosion', 'wrack', 'MS14'],
  render({ rng }) {
    const p = rng.jitter(0.08);
    const dur = 1.5;
    const crunchD = 0.25;
    const crunch = bandpass(crackle(crunchD, rng.fork('crunch'), { density: envelope([[0, 5000], [crunchD, 0, 'lin']], crunchD), grainS: 0.002, spread: 1.5 }), 900 * p, 0.7);
    const sd = 0.6;
    const scrape = mul(bandpass(noise('pink', sd, rng.fork('scrape')), sweep(900 * p, 380 * p, sd, sd), 3), envelope([[0, 0], [0.08, 1, 'lin'], [sd, 0, 'lin']], sd));
    const m = mixMono(
      [
        { sig: boom({ from: 110 * p, to: 45 * p, sweepS: 0.05, t60: 0.22, durS: 0.4, drive: 2.5 }), db: 0 },
        { sig: crunch, db: -3 },
        { sig: lowpass(clang({ f0: 180 * p, rng: rng.fork('clang'), durS: 0.8, decayScale: 0.5, partials: PLATE_PARTIALS, strike: 0.2 }), 1800, 0.7, 2), db: -6, at: 0.01 },
        { sig: scrape, db: -12, at: 0.12 * rng.jitter(0.3) },
        { sig: debris({ rng: rng.fork('brocken'), durS: dur, fromS: 0.1, toS: 1.1, count: 8, fLo: 300, fHi: 1400, t60: 0.05, bounce: 0.4, lp: 3000 }), db: -13 },
      ],
      dur,
    );
    return finish(room(highpass(m, 35, 0.7, 2), { t60: 0.45, wet: 0.12, seed: 218 }), dur, 0.3);
  },
});
