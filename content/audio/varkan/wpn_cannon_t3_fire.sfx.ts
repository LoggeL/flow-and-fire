// Fallhammer (T3-Bot), Waffe core:wpn_cannon_t3 (Doppel-Glocke, schwer, 2 × 60 Schaden).
// Schwere Doppel-Glocke: f0 ≈ 330 Hz, zwei Anschläge im Abstand von 38 ms, langer Nachklang (decayScale 0,36),
// tiefster Wumm der Kanonen-Familie, etwas größerer Raum. Nicht lauter als T1/T2, nur tiefer und länger.
import { defineSfx } from '../../../tools/sfx/src/index.ts';
import { CANNON, bellCannonLayers, cannonBus } from './wpn_kit.ts';

export default defineSfx({
  id: 'varkan:wpn_cannon_t3_fire',
  category: 'weapon',
  description: 'Fallhammer (T3-Bot): schwere Doppel-Glocke, f0 ≈ 330 Hz, langer Nachklang',
  variants: 4,
  tags: ['varkan', 'direktfeuer', 'core:wpn_cannon_t3', 'MS14'],
  render({ rng }) {
    const p = rng.jitter(0.025);
    const c = CANNON.t3;
    return cannonBus(bellCannonLayers(rng, c, p), c, 104, 70);
  },
});
