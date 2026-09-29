// Quittungs-Pip Luft (faction.md §8.1): gleitender Pip, schneller Aufwärts-Glide ≈ 1,1 → 1,75 kHz
// mit leichtem Abfall am Ende (wie ein Flügelprofil im Wind). N× = Tech-Stufe.
import { defineSfx, envelope } from '../../../tools/sfx/src/index.ts';
import { pip } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:ack_pip_air',
  category: 'ack',
  description: 'Pip Luft: gleitend (1,1 → 1,75 kHz)',
  variants: 1,
  tags: ['varkan', 'ack', 'pip', 'MS14'],
  render({ sr }) {
    const dur = 0.17;
    const glide = envelope([[0, 1100], [0.08, 1750, 0.6], [dur, 1650, 'lin']], dur, sr);
    return pip(glide, { durS: dur, t60: 0.13, metal: 0.5, comb: 0.2, sr });
  },
});
