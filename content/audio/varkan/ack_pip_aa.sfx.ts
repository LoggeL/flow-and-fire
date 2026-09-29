// Quittungs-Pip Flugabwehr (faction.md §8.1): hohe Lage ≈ 2,6 kHz, kurz und spitz (N× = Tech-Stufe).
import { defineSfx } from '../../../tools/sfx/src/index.ts';
import { pip } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:ack_pip_aa',
  category: 'ack',
  description: 'Pip Flugabwehr: hoch (2,6 kHz); N× = Tech-Stufe',
  variants: 1,
  tags: ['varkan', 'ack', 'pip', 'MS9'],
  render({ sr }) {
    return pip(2600, { durS: 0.1, t60: 0.06, metal: 0.6, comb: 0.4, sr });
  },
});
