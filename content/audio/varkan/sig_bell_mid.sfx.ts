// Signatur-Glocke „Freisprechung" (Fabrik-Upgrade fertig, faction.md §8.2): mittlerer Schlag auf A3
// (220 Hz, Oktave über dem Flow-Grundton). Voller als die kleine Glocke, mit hörbarem Summton und langer
// Schwebung, aber ohne den Nachhall der tiefen Lotbruch-Glocke.
import { BELL_PARTIALS, clang, defineSfx, highpass, lowpass, midiHz, mixMono, room } from '../../../tools/sfx/src/index.ts';
import { finish } from '../common/lib_blast.ts';

export default defineSfx({
  id: 'varkan:sig_bell_mid',
  category: 'signature',
  maxDurationS: 5.0,
  description: 'Signatur-Glocke mittel (Freisprechung): Schlag auf A3 mit Summton und Schwebung',
  variants: 1,
  tags: ['varkan', 'signatur', 'glocke', 'MS9'],
  render({ rng }) {
    const f0 = midiHz(57); // A3 = 220 Hz
    const dur = 4.8;
    const bell = clang({ f0, rng: rng.fork('bell'), durS: dur, decayScale: 1.35, partials: BELL_PARTIALS, strike: 0.28, pitchDrop: 0.003 });
    // Weicher Klöppel: kurzer, tiefer Anschlag-Stoß aus der Glockenwand.
    const thud = clang({ f0: f0 * 0.5, rng: rng.fork('thud'), durS: 0.4, decayScale: 0.08, strike: 0.02 });
    const mix = mixMono([{ sig: lowpass(bell, 6000, 0.7, 1) }, { sig: thud, db: -14 }], dur);
    return finish(highpass(room(mix, { t60: 1.2, wet: 0.16, seed: 41 }), 70, 0.7, 2), 4.95, 0.4);
  },
});
