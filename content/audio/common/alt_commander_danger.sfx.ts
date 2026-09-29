// Alert „Kommandant in Gefahr“ (P8, Hüttenstimme folgt als Sprachzeile). Synthetischer Signalton:
// Zweiton-Gong (fallende Quarte, Glockenspektrum hell und kurz) + drei schnelle Warn-Pulse.
// Alle Alerts teilen den Gong (Wiedererkennung), unterscheiden sich im Muster danach.
import { BELL_PARTIALS, decay, defineSfx, midiHz, mixMono, modal, mul, osc, scaleDecay } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'common:alt_commander_danger',
  category: 'alert',
  description: 'Alert: Kommandant in Gefahr – Zweiton-Gong + drei Warn-Pulse',
  variants: 1,
  cooldownMs: 8000,
  tags: ['alert', 'P8', 'MS9'],
  render({ rng }) {
    const gong = (note: number): Float32Array => modal(midiHz(note), scaleDecay(BELL_PARTIALS, 0.35), { durS: 1.4, rng, jitter: 0 });
    const pulse = (): Float32Array => {
      const d = 0.09;
      return mul(osc('triangle', midiHz(81), d), decay(0.08, d, 0.004));
    };
    return mixMono([
      { sig: gong(76), db: 0 }, // E5
      { sig: gong(71), db: 0, at: 0.22 }, // B4
      { sig: pulse(), db: -3, at: 0.75 },
      { sig: pulse(), db: -3, at: 0.87 },
      { sig: pulse(), db: -3, at: 0.99 },
    ]);
  },
});
