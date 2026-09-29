// Flow-Grundton (faction.md §8.2): leiser tonaler Summton auf A2 (110 Hz) mit Obertönen unter Fabriken,
// Engineers und Kraftwerken. Harmonische Reihe mit gedämpften Obertönen, zweite Stimme um 0,5 Hz
// verstimmt (langsame Schwebung wie ein großer Trafo/Hochofen), leises Strömungsrauschen um 220 Hz.
// Alle Frequenzen sind Vielfache von 0,25 Hz → exakt periodisch über 4 s, nahtlos ohne Crossfade.
// Der Stall-Sound (eco_flow_stall) nutzt dasselbe Timbre (flowHum).
import { bandpass, defineSfx, highpass, mixMono, mul } from '../../../tools/sfx/src/index.ts';
import { flowHum, period, plfo, pnoise, secondHalf } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:eco_flow_hum_loop',
  category: 'eco',
  description: 'Flow-Grundton A2 (Loop): tonaler Summton unter Fabriken, Engineers und Kraftwerken',
  variants: 1,
  loop: { lengthS: 4.0, crossfadeS: 0 },
  post: { dcBlock: false },
  tags: ['varkan', 'eco', 'flow', 'loop', 'MS9'],
  render({ rng, sr }) {
    const p = period(4.0, sr);
    const hum = mul(flowHum(110, 2 * p.L, rng.fork('hum'), { beatHz: 0.5, sr }), plfo(p, 1, 0.08, 0.92, 'sine', 0.25));
    const flow = mul(bandpass(pnoise(p, 'pink', rng.fork('flow')), 220, 2.5), plfo(p, 2, 0.3, 0.7, 'sine', 0.1));
    const mix = mixMono([
      { sig: hum, db: 0 },
      { sig: flow, db: -20 },
    ]);
    return secondHalf(p, highpass(mix, 45, 0.7, 2));
  },
});
