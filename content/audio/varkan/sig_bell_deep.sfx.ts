// Signatur-Glocke „Lotbruch" (Tod des Vogts, faction.md §8.2): tiefer Schlag auf A2 (110 Hz = Flow-
// Grundton, Summton 55 Hz) mit dreifachem Nachhall. Der Nachhall ist das Echo der Gießhalle: drei
// Wiederholungen im Abstand von ~1,1 s, jeweils leiser, dunkler und etwas breiter verwischt. Ab MS9 spielt
// varkan:exp_commander ohne eigene Glocke laufen (Sog, Druckwelle, Knistern); diese Glocke liegt darüber.
import { BELL_PARTIALS, clang, defineSfx, highpass, lowpass, midiHz, mixMono, room } from '../../../tools/sfx/src/index.ts';
import { finish } from '../common/lib_blast.ts';

export default defineSfx({
  id: 'varkan:sig_bell_deep',
  category: 'signature',
  maxDurationS: 7.0,
  description: 'Signatur-Glocke tief (Lotbruch): Schlag auf A2 mit dreifachem Hallen-Echo',
  variants: 1,
  tags: ['varkan', 'signatur', 'glocke', 'lotbruch', 'MS9'],
  render({ rng }) {
    const f0 = midiHz(45); // A2 = 110 Hz
    const dur = 6.9;
    const strike = clang({ f0, rng: rng.fork('bell'), durS: dur, decayScale: 1.0, partials: BELL_PARTIALS, strike: 0.4, pitchDrop: 0.004 });
    const dry = lowpass(strike, 5000, 0.7, 1);
    // Drei Echos: je −7 dB, Tiefpass sinkt, Hall wird länger (Gießhallen-Wand, 180 m hin und zurück).
    const echoes = [1.1, 2.25, 3.45].map((at, k) => ({
      sig: room(lowpass(strike, 2600 / (k + 1), 0.7, 2), { t60: 1.2 + 0.5 * k, wet: 0.5, seed: 50 + k }),
      db: -7 * (k + 1),
      at,
    }));
    const mix = mixMono([{ sig: dry }, ...echoes], dur);
    return finish(highpass(room(mix, { t60: 1.6, wet: 0.18, seed: 49 }), 40, 0.7, 2), 6.95, 0.4);
  },
});
