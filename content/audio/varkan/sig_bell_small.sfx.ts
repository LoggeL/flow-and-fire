// Signatur-Glocke „Bau fertig" (faction.md §8.2): einzelner Glockenschlag, leise und hoch. Folgt auf
// varkan:bld_complete (Abkühl-Knacken). Die drei Signatur-Glocken bilden eine Familie auf A, dem Ton des
// Flow-Grundtons (A2 = 110 Hz): klein A5, mittel A3, tief A2. Anders als der Glockenhammer der Direktfeuer-
// Waffen gibt es keinen Knall und kein Zischen, nur den weich angeschlagenen, frei ausklingenden Guss.
import { BELL_PARTIALS, clang, defineSfx, highpass, lowpass, midiHz, mixMono, room } from '../../../tools/sfx/src/index.ts';
import { finish } from '../common/lib_blast.ts';

export default defineSfx({
  id: 'varkan:sig_bell_small',
  category: 'signature',
  maxDurationS: 3.0,
  description: 'Signatur-Glocke klein (Bau fertig): einzelner hoher, leiser Schlag, frei ausklingend',
  variants: 2,
  tags: ['varkan', 'signatur', 'glocke', 'MS5'],
  render({ rng, variant }) {
    const f0 = midiHz(81) * (variant === 0 ? 1 : 1.012) * rng.jitter(0.004); // A5 ≈ 880 Hz
    const dur = 2.8;
    const bell = clang({ f0, rng: rng.fork('bell'), durS: dur, decayScale: 0.9 + 0.15 * variant, partials: BELL_PARTIALS, strike: 0.18, pitchDrop: 0.002 });
    // Zweiter, eine Oktave tieferer, sehr leiser Mitschwinger gibt dem kleinen Schlag Körper.
    const body = clang({ f0: f0 / 2, rng: rng.fork('body'), durS: dur, decayScale: 0.5, partials: BELL_PARTIALS, strike: 0.05 });
    const mix = mixMono([{ sig: lowpass(bell, 7000, 0.7, 1) }, { sig: body, db: -18 }], dur);
    return finish(highpass(room(mix, { t60: 0.9, wet: 0.14, seed: 31 + variant }), 180, 0.7, 2), 2.95, 0.4);
  },
});
