// Alert „Feind-Vogt gesichtet": Zweiton-Gong + LANGSAMER, TIEFER Doppelton (E4 → B♭3, Tritonus abwärts)
// als dunkler, leicht knurrender FM-Blechton. Bedrohlich, ohne wie „angegriffen" zu pulsen.
import { defineSfx, envelope, fm, lfo, lowpass, midiHz, mixMono, mul, shape } from '../../../tools/sfx/src/index.ts';
import { PATTERN_AT, alertGong, finish } from './alt_gong.sfx.ts';

const growl = (note: number, durS: number): Float32Array => {
  const f = midiHz(note);
  const idx = envelope([[0, 0.8], [0.08, 4.5, 'lin'], [0.3, 2.8, 'exp'], [durS, 2.2, 'lin']], durS);
  const amp = envelope([[0, 0], [0.04, 1, 'lin'], [durS - 0.15, 0.8, 'lin'], [durS, 0, 'lin']], durS);
  const tone = fm({ carrier: lfo(5.5, f * 0.006, f, durS), ratio: 1, index: idx, feedback: 0.35, durS });
  const low = fm({ carrier: f * 0.5, ratio: 1, index: 1.2, durS });
  return mul(shape(lowpass(mixMono([{ sig: tone }, { sig: low, db: -6 }]), 2400, 0.8, 2), { kind: 'tanh', drive: 1.8 }), amp);
};

export default defineSfx({
  id: 'common:alt_enemy_commander_spotted',
  category: 'alert',
  description: 'Alert: Feind-Vogt gesichtet – Zweiton-Gong + langsamer tiefer Doppelton (Tritonus abwärts)',
  variants: 1,
  cooldownMs: 30000,
  priority: 99,
  tags: ['alert', 'P8', 'MS9'],
  render() {
    return finish(
      mixMono([
        { sig: alertGong(), db: 0 },
        { sig: growl(64, 0.5), db: -3, at: PATTERN_AT + 0.12 },
        { sig: growl(58, 0.75), db: -3, at: PATTERN_AT + 0.72 },
      ]),
      2.4,
      0.3,
    );
  },
});
