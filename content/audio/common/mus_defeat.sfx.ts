// Musik-Stinger „Niederlage" („Lot gebrochen"): tiefe Glocke (E2) mit zwei leiser werdenden Nachschlägen
// wie eine Totenglocke, darüber ein langsam anschwellender, dunkler Moll-Cluster (E-Moll + Sekunde + kleine Sexte)
// aus verstimmten Sägezähnen, nachglühendes Knistern, großer Hall, verhallend. Stereo.
import {
  BELL_PARTIALS,
  type Mono,
  type Stereo,
  clang,
  crackle,
  defineSfx,
  envelope,
  fade,
  highpass,
  lfo,
  lowpass,
  midiHz,
  mix,
  mixMono,
  mul,
  osc,
  pan,
  reverb,
  scaleDecay,
} from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'common:mus_defeat',
  category: 'music',
  description: 'Niederlage-Stinger: tiefe Glocke mit Nachschlägen, dunkler Moll-Cluster, verhallend (≈ 9 s)',
  variants: 1,
  tags: ['musik', 'stinger', 'MS9'],
  render({ rng }) {
    const dur = 8.2;
    const bellF = midiHz(40);
    const bell = (k: number): Mono =>
      clang({ f0: bellF, rng: rng.fork(`bell${k}`), durS: 6, decayScale: 1.6, strike: 0.5, partials: scaleDecay(BELL_PARTIALS, 1), pitchDrop: 0.004 });
    const padNote = (note: number, i: number): Stereo => {
      const f = midiHz(note);
      const d = dur - 0.4;
      const saws = mixMono([
        { sig: osc('saw', lfo(0.13 + i * 0.03, f * 0.002, f * 0.997, d), d) },
        { sig: osc('saw', lfo(0.11 + i * 0.02, f * 0.002, f * 1.004, d), d) },
      ]);
      const amp = envelope([[0, 0], [1.8, 1, 1.5], [3.5, 0.85, 'lin'], [d, 0, 1.8]], d);
      const toned = lowpass(saws, envelope([[0, 250], [1.8, 900, 'lin'], [d, 300, 'exp']], d), 0.8, 2);
      return pan(mul(toned, amp), -0.6 + 1.2 * ((i * 0.37) % 1));
    };
    const cluster = [28, 40, 43, 47, 42, 48, 52];
    const embers = mul(
      highpass(crackle(dur, rng.fork('ember'), { density: envelope([[0, 0], [1.5, 40, 'lin'], [dur, 5, 'exp']], dur), grainS: 0.0005 }), 1800, 0.7, 1),
      envelope([[0, 0], [1.5, 1, 'lin'], [dur, 0.1, 'exp']], dur),
    );
    const dry = mix([
      { sig: pan(bell(0), -0.05), db: 0 },
      { sig: pan(bell(1), 0.1), at: 2.6, db: -5 },
      { sig: pan(bell(2), -0.1), at: 5.0, db: -10 },
      ...cluster.map((n, i) => ({ sig: padNote(n, i), at: 0.25, db: n < 35 ? -18 : -21 })),
      { sig: pan(embers, 0.3), db: -26 },
    ]) as Stereo;
    const wet = reverb(dry, { roomSize: 0.9, damping: 0.55, wet: 0.35, dry: 1, width: 1, predelayS: 0.03, tailS: 1.8 });
    const len = Math.min(wet[0].length, Math.round(9.8 * 48000));
    return [
      fade(highpass(wet[0].slice(0, len), 28, 0.7, 2), 0.001, 2.2),
      fade(highpass(wet[1].slice(0, len), 28, 0.7, 2), 0.001, 2.2),
    ];
  },
});
