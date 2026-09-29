// Musik-Stinger „Spielstart": kurzer Blech-Aufgang (C4 E4 G4 → C5), dann ein Amboss-Schlag (heller,
// inharmonischer Plattenklang + Knall + Wumm) auf einem gehaltenen C-Dur-Akkord. Stereo, Hall, ≈ 3,5 s.
import {
  type Stereo,
  boom,
  crack,
  defineSfx,
  highpass,
  mix,
  mixMono,
  modal,
  pan,
  reverb,
} from '../../../tools/sfx/src/index.ts';
import { brass, brassChord } from './mus_victory.sfx.ts';

export default defineSfx({
  id: 'common:mus_match_start',
  category: 'music',
  description: 'Spielstart-Stinger: kurzer Blech-Aufgang und Amboss-Schlag auf C-Dur (≈ 3,5 s)',
  variants: 1,
  tags: ['musik', 'stinger', 'MS14'],
  render({ rng }) {
    const anvil = mixMono([
      {
        sig: modal(1180, [
          { ratio: 1, amp: 1, t60: 1.6 },
          { ratio: 2.43, amp: 0.6, t60: 1.1 },
          { ratio: 3.87, amp: 0.4, t60: 0.8 },
          { ratio: 5.31, amp: 0.25, t60: 0.5 },
          { ratio: 0.56, amp: 0.3, t60: 0.9 },
        ], { durS: 2.2, rng: rng.fork('anvil'), jitter: 0 }),
      },
      { sig: crack({ rng: rng.fork('crack'), durS: 0.08, freq: 2600, t60: 0.03, drive: 3 }), db: -2 },
      { sig: boom({ from: 140, to: 55, sweepS: 0.06, t60: 0.5, durS: 0.7, drive: 2 }), db: -5 },
    ]);
    const hit = 0.5;
    const dry = mix([
      { sig: pan(brass(60, 0.1, { rng: rng.fork('a1'), releaseS: 0.05 }), -0.3), at: 0.0, db: -3 },
      { sig: pan(brass(64, 0.1, { rng: rng.fork('a2'), releaseS: 0.05 }), -0.1), at: 0.12, db: -2 },
      { sig: pan(brass(67, 0.1, { rng: rng.fork('a3'), releaseS: 0.05 }), 0.1), at: 0.24, db: -1 },
      { sig: pan(brass(72, 0.12, { rng: rng.fork('a4'), releaseS: 0.05 }), 0.3), at: 0.36, db: 0 },
      { sig: pan(anvil, 0), at: hit, db: 0 },
      { sig: brassChord([36, 48, 55, 60, 64, 67, 72], 1.3, rng.fork('ch'), { releaseS: 0.7 }), at: hit, db: -3 },
    ]) as Stereo;
    const wet = reverb(dry, { roomSize: 0.75, damping: 0.45, wet: 0.25, dry: 1, width: 1, predelayS: 0.015, tailS: 1.5 });
    return [highpass(wet[0], 35, 0.7, 2), highpass(wet[1], 35, 0.7, 2)];
  },
});
