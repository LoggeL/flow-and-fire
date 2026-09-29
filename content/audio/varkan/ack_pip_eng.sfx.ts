// Quittungs-Pip Engineers (faction.md §8.1): aufsteigender Zweiklang, Quarte B5 → E6
// (≈ 988 → 1319 Hz). Eine Datei; bei N > 1 wiederholt die Engine den Zweiklang.
import { defineSfx, mixMono } from '../../../tools/sfx/src/index.ts';
import { pip } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:ack_pip_eng',
  category: 'ack',
  description: 'Pip Engineers: aufsteigender Zweiklang (Quarte)',
  variants: 1,
  tags: ['varkan', 'ack', 'pip', 'MS9'],
  render({ sr }) {
    return mixMono(
      [
        { sig: pip(988, { durS: 0.1, t60: 0.06, metal: 0.8, comb: 0.35, sr }), db: -1 },
        { sig: pip(1319, { durS: 0.12, t60: 0.075, metal: 0.8, comb: 0.35, sr }), db: 0, at: 0.075 },
      ],
      0.22,
    );
  },
});
