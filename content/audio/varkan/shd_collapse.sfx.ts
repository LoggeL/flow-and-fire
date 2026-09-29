// Schild bricht zusammen. SOUNDLIST: „absteigendes Zerspringen + Entladung". Der auslösende Treffer
// entlädt knisternd, das Feld gleitet mit wachsender FM-Rauheit von ~900 auf ~110 Hz ab, gläserne
// Splitter regnen, am Ende ein dumpfes Entladungs-Wumm und der Kessel lässt Druck ab (Dampf).
import { bandpass, boom, crack, crackle, defineSfx, envelope, fm, highpass, mixMono, mul, noise, room, sweep } from '../../../tools/sfx/src/index.ts';
import { debris, finish, steam } from '../common/lib_blast.ts';

export default defineSfx({
  id: 'varkan:shd_collapse',
  category: 'shield',
  description: 'Schild bricht: absteigendes Zerspringen + Entladung',
  variants: 2,
  tags: ['varkan', 'schild', 'MS14'],
  render({ rng, variant }) {
    const p = rng.jitter(0.05);
    const dur = 2.0;
    const gd = 1.6;
    // Varianten: Glissando-Lage, -Tempo und FM-Verhältnis je eigen (v1 höher, schneller, rauer).
    const gTop = variant === 0 ? 900 : 1300;
    const gS = variant === 0 ? 1.2 : 0.9;
    const gliss = mul(
      fm({ carrier: sweep(gTop * p, (variant === 0 ? 110 : 160) * p, gS, gd), ratio: variant === 0 ? 1.414 : 1.618, index: sweep(1, variant === 0 ? 8 : 11, gS, gd, 'lin'), feedback: variant === 0 ? 0.3 : 0.45, durS: gd }),
      envelope([[0, 0], [0.02, 1, 'lin'], [gS, 0.25, 'exp'], [gd, 0.001, 'exp']], gd),
    );
    const zd = 0.5;
    const zapDen = envelope([[0, 7000], [zd, 0, 'exp']], zd);
    const zap = mixMono([
      { sig: highpass(crackle(zd, rng.fork('zap'), { density: zapDen, grainS: 0.0002, spread: 1.8 }), 1500, 0.7, 2), db: 0 },
      { sig: mul(bandpass(noise('white', 0.3, rng.fork('zisch')), sweep(6000, 800, 0.25, 0.3), 2), envelope([[0, 1], [0.3, 0, 'exp']], 0.3)), db: -4 },
    ]);
    const tE = (variant === 0 ? 1.15 : 0.85) * rng.jitter(0.05);
    const m = mixMono(
      [
        { sig: crack({ rng: rng.fork('crack'), durS: 0.05, freq: 3000 * p, q: 0.8, t60: 0.015, drive: 6 }), db: -2 },
        { sig: zap, db: -5 },
        { sig: gliss, db: -3 },
        { sig: debris({ rng: rng.fork('splitter'), durS: 1.4, fromS: 0.05, toS: 1.2, count: 30, fLo: 2500, fHi: 7000, t60: 0.05, bounce: 0.2, fallDb: 10, skew: 1.1 }), db: -9 },
        { sig: boom({ from: 120 * p, to: 40 * p, sweepS: 0.08, t60: 0.4, durS: 0.7, drive: 2.5 }), db: -4, at: tE },
        { sig: mul(zap, 0.6), db: -10, at: tE },
        { sig: steam({ rng: rng.fork('dampf'), durS: 0.8, attackS: 0.04, t60: 0.7, hp: 2800, flutter: 0.5 }), db: -12, at: tE + 0.03 },
      ],
      dur,
    );
    return finish(room(highpass(m, 60, 0.7, 2), { t60: 0.6, wet: 0.16, seed: 332 }), dur, 0.25);
  },
});
