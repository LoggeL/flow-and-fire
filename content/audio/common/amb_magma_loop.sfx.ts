// Ambience „Magma" (Kessa; Karten mit Lava-/Vulkan-Props, Loop 20 s, stereo): fernes Grollen und Blubbern.
//   Grollen   braunes Rauschen, Tiefpass 75 Hz, langsam schwellend, L/R dekorreliert
//   Blubbern  Blasen als Sinus-„Blopp" mit steigender Tonhöhe (60–160 Hz ×2), zufällig verteilt und gepannt,
//             dazu seltene große Blasen mit Rausch-Anteil
//   Schlote   seltenes Zischen mit Knistern (Glut), leise
//   Ferne     Tiefpass 2,4 kHz + großer, dunkler Hall
import {
  type Mono,
  type Stereo,
  decay,
  defineSfx,
  highpass,
  lowpass,
  mix,
  mixMono,
  mul,
  noise,
  osc,
  pan,
  reverb,
  sizzle,
  sweep,
} from '../../../tools/sfx/src/index.ts';
import { smoothRand } from './amb_wind_loop.sfx.ts';

export default defineSfx({
  id: 'common:amb_magma_loop',
  category: 'ambience',
  description: 'Ambience Magma (Loop 20 s): fernes Grollen, Magma-Blubbern, gelegentliches Zischen',
  variants: 1,
  loop: { lengthS: 20, crossfadeS: 3 },
  tags: ['ambience', 'loop', 'MS14'],
  render({ rng, durationS }) {
    const dur = durationS ?? 23;
    const rumble = (label: string): Mono => {
      const r = rng.fork(label);
      const sw = smoothRand(r.fork('sw'), dur, 0.18).map((v) => 0.35 + 0.65 * v);
      return mul(lowpass(noise('brown', dur, r.fork('n')), 75, 0.9, 2), sw);
    };
    const blop = (f: number, t60: number): Mono => {
      const d = t60 * 1.2;
      return mul(osc('sine', sweep(f, f * 2.2, t60 * 0.6, d, 'exp'), d), decay(t60, d, 0.004));
    };
    const r = rng.fork('bubbles');
    const events: { sig: Stereo; at: number; db: number }[] = [];
    for (let t = r.range(0, 0.4); t < dur - 0.5; t += r.range(0.15, 0.9)) {
      const big = r.next() < 0.15;
      const f = big ? r.range(45, 70) : r.range(70, 160);
      const t60 = big ? r.range(0.25, 0.4) : r.range(0.08, 0.2);
      let s = blop(f, t60);
      if (big) s = mixMono([{ sig: s }, { sig: mul(lowpass(noise('pink', t60, r.fork(`bn${t}`)), 400, 0.7, 1), decay(t60 * 0.6, t60)), db: -10 }]);
      events.push({ sig: pan(s, r.range(-0.8, 0.8)), at: t, db: big ? -2 : r.range(-12, -4) });
    }
    const vr = rng.fork('vents');
    for (let t = vr.range(1, 4); t < dur - 2; t += vr.range(4, 8)) {
      events.push({ sig: pan(sizzle({ rng: vr.fork(`v${t}`), durS: 2, t60: 1.6, hp: 2000, density: 120, hiss: 0.7 }), vr.range(-0.7, 0.7)), at: t, db: -16 });
    }
    const dry = mix([{ sig: [rumble('L'), rumble('R')] as Stereo, db: 0 }, ...events], dur) as Stereo;
    const far: Stereo = [lowpass(dry[0], 2400, 0.7, 1), lowpass(dry[1], 2400, 0.7, 1)];
    const wet = reverb(far, { roomSize: 0.85, damping: 0.7, wet: 0.35, dry: 1, width: 1, predelayS: 0.04, tailS: 0 });
    return [highpass(wet[0].slice(0, far[0].length), 25, 0.7, 2), highpass(wet[1].slice(0, far[1].length), 25, 0.7, 2)];
  },
});
