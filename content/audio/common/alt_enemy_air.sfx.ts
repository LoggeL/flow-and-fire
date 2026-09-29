// Alert „feindliche Luft gesichtet": Zweiton-Gong + SCHNELLES HOHES TRILLERN (B6/D7, 18 Anschläge/s),
// das kurz ansteigt. Höchste Lage aller Alerts (Luft = oben), sofort von den tiefen Angriffs-Pulsen trennbar.
import { decay, defineSfx, midiHz, mixMono, mul, osc } from '../../../tools/sfx/src/index.ts';
import { PATTERN_AT, alertGong, finish } from './alt_gong.sfx.ts';

const blip = (freq: number, durS: number): Float32Array =>
  mixMono([
    { sig: mul(osc('sine', freq, durS), decay(durS * 1.4, durS, 0.002)), db: 0 },
    { sig: mul(osc('triangle', freq * 2, durS), decay(durS * 0.8, durS, 0.002)), db: -12 },
  ]);

export default defineSfx({
  id: 'common:alt_enemy_air',
  category: 'alert',
  description: 'Alert: feindliche Luft – Zweiton-Gong + schnelles hohes Trillern',
  variants: 1,
  cooldownMs: 30000,
  priority: 98,
  tags: ['alert', 'P8', 'MS14'],
  render() {
    const step = 1 / 18;
    const n = 11;
    const layers = Array.from({ length: n }, (_, i) => ({
      sig: blip(midiHz((i % 2 === 0 ? 95 : 98) + (i >= n - 3 ? 2 : 0)), step * 0.95),
      db: i === 0 ? -2 : 0,
      at: PATTERN_AT + 0.02 + i * step,
    }));
    return finish(mixMono([{ sig: alertGong(), db: 0 }, ...layers]), 1.45);
  },
});
