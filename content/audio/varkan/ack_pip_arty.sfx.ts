// Quittungs-Pip Artillerie (faction.md §8.1): tiefe Lage ≈ 500 Hz, runder und etwas länger als der
// Direktfeuer-Pip, bleibt aber unter 70 ms Kernlänge (N× = Tech-Stufe).
import { defineSfx } from '../../../tools/sfx/src/index.ts';
import { pip } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:ack_pip_arty',
  category: 'ack',
  description: 'Pip Artillerie: tief (500 Hz); N× = Tech-Stufe',
  variants: 1,
  tags: ['varkan', 'ack', 'pip', 'MS9'],
  render({ sr }) {
    return pip(500, { durS: 0.13, t60: 0.085, metal: 1.3, comb: 0.3, sr });
  },
});
