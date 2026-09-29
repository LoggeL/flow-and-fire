// Meißel (T2-Panzer), Waffe core:wpn_cannon_t2 (Doppel-Glockenkanone, 2 × 35 Schaden).
// Alias core:wpn_bolt_cannon_t2 (Riegel II, playbackRate 0,92).
// Doppel-Glocke: zwei Anschläge im Abstand von 35 ms, f0 ≈ 420 Hz, längerer Nachklang als T1 (decayScale 0,24),
// tieferer Wumm. Höhere Tech = tiefer + länger, nicht lauter (Normierung auf −20 LUFS M-max wie T1).
import { defineSfx } from '../../../tools/sfx/src/index.ts';
import { CANNON, bellCannonLayers, cannonBus } from './wpn_kit.ts';

export default defineSfx({
  id: 'varkan:wpn_cannon_t2_fire',
  category: 'weapon',
  description: 'Meißel (T2-Panzer): Doppel-Glocke, zwei Schläge im Abstand von 35 ms, f0 ≈ 420 Hz',
  variants: 4,
  tags: ['varkan', 'direktfeuer', 'core:wpn_cannon_t2', 'core:wpn_bolt_cannon_t2', 'core:lnd_t2_tank', 'MS9'],
  render({ rng }) {
    const p = rng.jitter(0.03);
    const c = CANNON.t2;
    return cannonBus(bellCannonLayers(rng, c, p), c, 102);
  },
});
