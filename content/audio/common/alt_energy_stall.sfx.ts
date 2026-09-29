// Alert „Energie knapp": Zweiton-Gong + fallendes Glissando im SUMMTON-Timbre (Säge/Rechteck wie der
// Flow-Grundton), das STOTTERT (unregelmäßige Aussetzer) und am Ende nach unten kippt. Spiegelt den
// Energy-Stall des Flow-Grundtons (faction.md §8.2), nur deutlich lauter und kürzer.
import { defineSfx, envelope, lowpass, midiHz, mixMono, mul, osc, shape, sweep } from '../../../tools/sfx/src/index.ts';
import { PATTERN_AT, alertGong, finish } from './alt_gong.sfx.ts';

export default defineSfx({
  id: 'common:alt_energy_stall',
  category: 'alert',
  description: 'Alert: Energie knapp – Zweiton-Gong + fallendes, stotterndes Summton-Glissando',
  variants: 1,
  cooldownMs: 20000,
  priority: 98,
  tags: ['alert', 'P8', 'MS9', 'eco'],
  render() {
    const dur = 1.05;
    const f = sweep(midiHz(81), midiHz(62), 0.85, dur, 1.6);
    const hum = mixMono([
      { sig: osc('saw', f, dur), db: 0 },
      { sig: osc('square', (t: number) => (f[Math.min(f.length - 1, Math.round(t * 48000))] as number) * 0.501, dur), db: -8 },
    ]);
    const toned = shape(lowpass(hum, 2600, 0.9, 2), { kind: 'tanh', drive: 1.5 });
    // Stotter-Gate: feste, unregelmäßige An/Aus-Folge (s), gleichbleibend für Wiedererkennung.
    const gaps: readonly [number, number][] = [
      [0.0, 0.16], [0.19, 0.3], [0.33, 0.37], [0.42, 0.55], [0.58, 0.62], [0.66, 0.7], [0.75, 1.0],
    ];
    const pts: [number, number, 'lin'][] = [[0, 0, 'lin']];
    for (const [a, b] of gaps) {
      pts.push([a + 0.004, 0, 'lin'], [a + 0.01, 1, 'lin'], [b - 0.006, 1, 'lin'], [b, 0, 'lin']);
    }
    const gate = envelope(pts, dur);
    const fadeOut = envelope([[0, 1], [0.7, 1], [1.0, 0.25, 'lin']], dur);
    return finish(
      mixMono([
        { sig: alertGong(), db: 0 },
        { sig: mul(mul(toned, gate), fadeOut), db: -4, at: PATTERN_AT + 0.03 },
      ]),
      1.9,
    );
  },
});
