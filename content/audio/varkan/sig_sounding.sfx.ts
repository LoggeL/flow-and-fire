// Lotung (Spielstart, Platzhalter bis P19): der glühende Kegel fällt aus dem Orbit, schlägt ein, und der
// Vogt gießt sich (≈ 3 s). Ablauf:
//   0,00–1,15 s  Fallpfeifen: schmalbandiges Rauschen + Pfeifton, fällt von 1,6 kHz auf 420 Hz, schwillt an
//   1,15 s       Einschlag: tiefer Wumm + Erdwurf
//   1,25–3,40 s  Gießen: Blubbern flüssigen Metalls, die Blasen steigen (Form füllt sich), Glut-Zischen
//   3,40 s       mittlerer Glockenschlag (A3): der Guss ist gesetzt
import { BELL_PARTIALS, bandpass, boom, clang, crackle, defineSfx, envelope, highpass, lowpass, midiHz, mixMono, mul, noise, osc, room, sweep, thump } from '../../../tools/sfx/src/index.ts';
import { finish } from '../common/lib_blast.ts';
import { bubble, poissonTimes, scatter, type Event } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:sig_sounding',
  category: 'signature',
  maxDurationS: 5.0,
  description: 'Lotung (Spielstart): glühender Kegel fällt, Einschlag, Vogt gießt sich, Glockenschlag',
  variants: 1,
  cooldownMs: 0,
  tags: ['varkan', 'signatur', 'spielstart', 'MS14'],
  render({ rng, sr }) {
    const dur = 4.9;
    const fall = 1.15;
    // Fallpfeifen.
    const pitch = sweep(1600, 420, fall, fall + 0.05, 'exp', sr);
    const whistle = mixMono([
      { sig: osc('sine', pitch, fall + 0.05), db: -6 },
      { sig: bandpass(noise('white', fall + 0.05, rng.fork('air')), pitch, 12), db: 0 },
    ]);
    const fallEnv = envelope([[0, 0], [0.5, 0.35, 2], [fall, 1, 2], [fall + 0.05, 0, 'lin']], fall + 0.05, sr);
    const fallSig = mul(whistle, fallEnv);
    // Einschlag.
    const impact = mixMono([
      { sig: boom({ from: 110, to: 38, sweepS: 0.25, t60: 0.9, durS: 1.3, drive: 2 }), db: 0 },
      { sig: thump({ rng: rng.fork('dirt'), durS: 0.6, lpFrom: 2500, lpTo: 300 }), db: -6 },
    ]);
    // Gießen: aufsteigende Blasen, Dichte schwillt an und ab.
    const r = rng.fork('pour');
    const pourS = 2.15;
    const events: Event[] = poissonTimes(r, 55, pourS).map((t) => ({ t, sig: bubble(r.range(260, 520) * (1 + 0.6 * (t / pourS)), r, { rise: 0.12, viscosity: 1.6 }), g: r.range(0.3, 1) }));
    const pourEnv = envelope([[0, 0], [0.25, 1, 'lin'], [pourS - 0.4, 0.8, 'lin'], [pourS, 0, 'lin']], pourS, sr);
    const pour = mul(scatter(pourS, events, sr), pourEnv);
    const hiss = mul(highpass(crackle(pourS, rng.fork('glut'), { density: 220, grainS: 0.0003 }), 2500, 0.7, 1), pourEnv);
    const roar = mul(lowpass(noise('brown', pourS, rng.fork('roar')), 220, 0.7, 2), pourEnv);
    // Guss gesetzt.
    const bell = clang({ f0: midiHz(57), rng: rng.fork('bell'), durS: 1.5, decayScale: 0.7, partials: BELL_PARTIALS, strike: 0.25 });
    const mix = mixMono(
      [
        { sig: fallSig, db: -4 },
        { sig: impact, db: 0, at: fall },
        { sig: pour, db: -6, at: 1.25 },
        { sig: hiss, db: -16, at: 1.25 },
        { sig: roar, db: -10, at: 1.25 },
        { sig: lowpass(bell, 5000, 0.7, 1), db: -5, at: 3.4 },
      ],
      dur,
    );
    return finish(highpass(room(mix, { t60: 0.9, wet: 0.15, seed: 61 }), 35, 0.7, 2), 4.95, 0.4);
  },
});
