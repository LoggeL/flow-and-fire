// Alert „Werk freigesprochen" (Fabrik-Upgrade fertig): Zweiton-Gong + STEIGENDE Quinte (G5 → D6) als
// Blech-artiger FM-Ton mit Halteteil, danach eine kleine hohe Glocke. Feierlicher und länger als „Bau fertig".
import { BELL_PARTIALS, defineSfx, envelope, fm, lowpass, midiHz, mixMono, modal, mul, scaleDecay } from '../../../tools/sfx/src/index.ts';
import { PATTERN_AT, alertGong, finish } from './alt_gong.sfx.ts';

const horn = (note: number, durS: number): Float32Array => {
  const f = midiHz(note);
  const idx = envelope([[0, 0.5], [0.05, 3.2, 'lin'], [0.2, 1.8, 'exp'], [durS, 1.2, 'lin']], durS);
  const amp = envelope([[0, 0], [0.025, 1, 'lin'], [durS - 0.12, 0.75, 'lin'], [durS, 0, 'lin']], durS);
  return lowpass(mul(fm({ carrier: f, ratio: 1, index: idx, durS }), amp), 4200, 0.7, 1);
};

export default defineSfx({
  id: 'common:alt_factory_upgraded',
  category: 'alert',
  description: 'Alert: Werk freigesprochen – Zweiton-Gong + steigende Quinte + kleine Glocke',
  variants: 1,
  cooldownMs: 5000,
  priority: 96,
  tags: ['alert', 'P8', 'MS9'],
  render() {
    const bell = modal(midiHz(91), scaleDecay(BELL_PARTIALS, 0.45), { durS: 1.0 });
    return finish(
      mixMono([
        { sig: alertGong(), db: -1 },
        { sig: horn(79, 0.2), db: -3, at: PATTERN_AT + 0.02 },
        { sig: horn(86, 0.42), db: -3, at: PATTERN_AT + 0.24 },
        { sig: bell, db: -5, at: PATTERN_AT + 0.62 },
      ]),
      2.0,
      0.35,
    );
  },
});
