// Bot-Schritt (Stichel, Zange, Reißnadel, Engineers): hohler Guss-Tritt + hydraulisches Zischen (faction.md §8.2).
//   Tritt    kurzer Plattenklang 190–260 Hz, durch Comb-Filter „hohl" (Hohlguss-Bein), dazu dumpfer Bodenstoß
//   Kies     ein paar Knister-Körner beim Aufsetzen
//   Zischen  Bandpass-Rauschen mit fallendem Filter 20–40 ms nach dem Aufsetzen (Druckausgleich des Beins)
// Transiente bei t = 0, damit der Sound exakt auf den Fußkontakt der Animation fällt.
import {
  PLATE_PARTIALS,
  bandpass,
  comb,
  crackle,
  decay,
  defineSfx,
  envelope,
  highpass,
  mixMono,
  modal,
  mul,
  noise,
  scaleDecay,
  sweep,
  thump,
} from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:mov_bot_step',
  category: 'unit',
  description: 'Bot-Schritt: hohler Guss-Tritt mit hydraulischem Zischen',
  variants: 8,
  tags: ['varkan', 'bewegung', 'MS9'],
  render({ rng }) {
    const dur = 0.38;
    const p = rng.jitter(0.08);
    const body = modal(220 * p, scaleDecay(PLATE_PARTIALS, 0.16 * rng.jitter(0.15)), { durS: 0.15, rng: rng.fork('body'), jitter: 0.02 });
    const hollow = comb(body, { freq: 310 * p * rng.jitter(0.05), feedback: 0.55, damp: 0.35, mix: 0.6, tailS: 0.05 });
    const ground = thump({ rng: rng.fork('ground'), durS: 0.12, t60: 0.08, lpFrom: 1400, lpTo: 180 });
    const grit = highpass(crackle(0.06, rng.fork('grit'), { density: 350, grainS: 0.0003 }), 2500, 0.7, 1);
    const hissDur = 0.2 * rng.jitter(0.15);
    const hissEnv = envelope([[0, 0], [0.012, 1, 'lin'], [hissDur * 0.4, 0.55, 'exp'], [hissDur, 0, 'exp']], hissDur);
    const hiss = mul(bandpass(noise('white', hissDur, rng.fork('hiss')), sweep(5200 * rng.jitter(0.1), 2300, hissDur, hissDur), 1.6), hissEnv);
    return highpass(
      mixMono(
        [
          { sig: hollow, db: 0 },
          { sig: ground, db: -5 },
          { sig: mul(grit, decay(0.05, 0.06)), db: -18 },
          { sig: hiss, db: -14 + rng.range(-2, 2), at: 0.02 + rng.range(0, 0.02) },
        ],
        dur,
      ),
      60,
      0.7,
      2,
    );
  },
});
