// Alert „Kommandant in Gefahr“ (P8, Hüttenstimme folgt als Sprachzeile). Synthetischer Signalton:
// Zweiton-Gong aus alt_gong (fallende Quarte, Klangstab-Spektrum hell und kurz) + drei schnelle Warn-Pulse.
// Alle Alerts teilen den Gong (Wiedererkennung), unterscheiden sich im Muster danach.
import { decay, defineSfx, midiHz, mixMono, mul, osc } from '../../../tools/sfx/src/index.ts';
import { alertGong } from './alt_gong.sfx.ts';

export default defineSfx({
  id: 'common:alt_commander_danger',
  category: 'alert',
  description: 'Alert: Kommandant in Gefahr – Zweiton-Gong + drei Warn-Pulse',
  variants: 1,
  cooldownMs: 8000,
  tags: ['alert', 'P8', 'MS9'],
  render() {
    const pulse = (): Float32Array => {
      const d = 0.09;
      return mul(osc('triangle', midiHz(81), d), decay(0.08, d, 0.004));
    };
    return mixMono([
      { sig: alertGong(1.4), db: 0 }, // gemeinsamer Zweiton-Gong E6 → B5
      { sig: pulse(), db: -3, at: 0.75 },
      { sig: pulse(), db: -3, at: 0.87 },
      { sig: pulse(), db: -3, at: 0.99 },
    ]);
  },
});
