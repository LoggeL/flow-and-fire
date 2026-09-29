// Quittungs-Pip Direktfeuer (faction.md §8.1): mittlere Lage ≈ 1,3 kHz, metallische Comb-Resonanz.
// Die Engine spielt den Pip N-mal im Abstand von 70 ms (N = Tech-Stufe), daher klingt er in ~60 ms ab.
import { defineSfx } from '../../../tools/sfx/src/index.ts';
import { pip } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:ack_pip_direct',
  category: 'ack',
  description: 'Pip Direktfeuer: mittel (1,3 kHz), metallisch; N× = Tech-Stufe',
  variants: 1,
  tags: ['varkan', 'ack', 'pip', 'MS5'],
  render({ sr }) {
    return pip(1300, { durS: 0.12, t60: 0.075, metal: 0.9, comb: 0.4, sr });
  },
});
