// Vogt (Kommandant), Waffe core:wpn_reeve_cannon (100 Schaden, 1,0 s Nachladen).
// Glockenhammer mittlerer Lage (f0 ≈ 465 Hz, zwischen Punze und Meißel), etwas mehr Nachklang als T1, dazu das
// Uplink-Knistern des Operators (Bandpass 300–3 400 Hz, gebitcrushtes Funk-Rauschen, faction.md §8.1): der Vogt
// ist die einzige Einheit, die über den Funk „mitschießt“.
//
// Schichten: Glockenhammer (wpn_kit.bellCannonLayers, Tech „reeve") · Uplink: Funk-Squelch 20–140 ms nach dem
// Schuss (Bandpass-Rauschen, 6-Bit-Crush, Knistern) · Bus wie die Kanonen-Familie (Hochpass 90 Hz, Raum 0,5 s).
import { bandpass, bitcrush, crackle, defineSfx, envelope, mixMono, mul, noise, normPeak } from '../../../tools/sfx/src/index.ts';
import { CANNON, bellCannonLayers, cannonBus } from './wpn_kit.ts';

export default defineSfx({
  id: 'varkan:wpn_reeve_cannon_fire',
  category: 'weapon',
  description: 'Vogt (Kommandant): Glockenhammer mittlerer Lage mit Uplink-Knistern',
  variants: 4,
  tags: ['varkan', 'direktfeuer', 'core:wpn_reeve_cannon', 'core:cmd_commander', 'MS5'],
  render({ rng }) {
    const p = rng.jitter(0.03);
    const c = CANNON.reeve;
    const bell = bellCannonLayers(rng.fork('bell'), c, p);
    // Uplink-Knistern: kurzer Funk-Squelch, bandbegrenzt und grob quantisiert.
    const ud = 0.22;
    const r = rng.fork('uplink');
    const env = envelope([[0, 0], [0.012, 1, 'lin'], [0.06 + r.range(0, 0.03), 0.5, 'lin'], [ud, 0, 'exp']], ud);
    const hiss = bandpass(bandpass(noise('white', ud, r.fork('n')), 1400 * r.jitter(0.1), 0.8), 1100, 0.6);
    const crk = bandpass(crackle(ud, r.fork('c'), { density: 900, grainS: 0.0006, spread: 1.6 }), 1800, 0.5);
    const uplink = bitcrush(normPeak(mul(mixMono([{ sig: normPeak(hiss), db: -4 }, { sig: normPeak(crk), db: 0 }]), env)), 6, 3);
    const layers = mixMono([{ sig: bell }, { sig: bandpass(uplink, 1300, 0.45), db: -11, at: 0.03 + r.range(0, 0.02) }], c.durS);
    return cannonBus(layers, c, 103);
  },
});
