// Einschlag: Bombe (Dohle, Elster). Schwerer Erdwurf: tiefer Wumm, Erdstoß, Grollen, grober Kies und
// herabfallende Erdklumpen. Tiefer und länger als imp_shell_ground.
import { boom, crack, defineSfx, highpass, mixMono, room, shape, thump } from '../../../tools/sfx/src/index.ts';
import { debris, finish, gravel, rumble } from './lib_blast.ts';

export default defineSfx({
  id: 'common:imp_bomb',
  category: 'impact',
  description: 'Bombeneinschlag: schwerer Erdwurf',
  variants: 3,
  tags: ['einschlag', 'MS14'],
  render({ rng }) {
    const p = rng.jitter(0.06);
    const dur = 1.5;
    const m = mixMono(
      [
        { sig: crack({ rng: rng.fork('crack'), durS: 0.1, freq: 800 * p, q: 0.7, t60: 0.04, drive: 6 }), db: -2 },
        { sig: boom({ from: 95 * p, to: 32 * p, sweepS: 0.1, t60: 0.55, durS: 1.0, drive: 3 }), db: 0 },
        { sig: thump({ rng: rng.fork('thump'), durS: 0.9, t60: 0.5, lpFrom: 1600, lpTo: 110, color: 'brown' }), db: -1 },
        { sig: rumble(rng.fork('rumble'), dur, 160, 1.1), db: -8 },
        { sig: gravel({ rng: rng.fork('kies'), durS: dur, fromS: 0.08, toS: 1.2, density: 700, lp: 2800, hp: 250, grainS: 0.002 }), db: -9 },
        { sig: debris({ rng: rng.fork('klumpen'), durS: dur, fromS: 0.25, toS: 1.3, count: 14, fLo: 250, fHi: 700, t60: 0.03, lp: 1500, bounce: 0.2 }), db: -14 },
      ],
      dur,
    );
    return finish(room(highpass(shape(m, { kind: 'tanh', drive: 1.3 }), 28, 0.7, 2), { t60: 0.5, wet: 0.12, seed: 216 }), dur, 0.35);
  },
});
