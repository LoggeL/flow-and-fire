// Alert „Masse knapp": Zweiton-Gong + fallendes Glissando im HOLZ-Timbre (Marimba-artige Modalsynthese,
// Obertöne ≈ 4× und 10×), am Ende ein einzelner hohler Klopfer („leer"). Gegenstück zu „Energie knapp"
// (gleicher Verlauf, anderes Timbre: Holz = Masse, Summton = Energie).
import { defineSfx, midiHz, mixMono, modal } from '../../../tools/sfx/src/index.ts';
import { PATTERN_AT, alertGong, finish } from './alt_gong.sfx.ts';

const wood = (note: number, t60 = 0.16): Float32Array =>
  modal(
    midiHz(note),
    [
      { ratio: 1, amp: 1, t60 },
      { ratio: 3.93, amp: 0.45, t60: t60 * 0.35 },
      { ratio: 9.2, amp: 0.18, t60: t60 * 0.15 },
    ],
    { durS: t60 * 1.3, attackS: 0.0015 },
  );

export default defineSfx({
  id: 'common:alt_mass_stall',
  category: 'alert',
  description: 'Alert: Masse knapp – Zweiton-Gong + fallendes Holz-Glissando',
  variants: 1,
  cooldownMs: 20000,
  priority: 97,
  tags: ['alert', 'P8', 'MS9', 'eco'],
  render() {
    const notes = [84, 83, 81, 79, 77, 76, 74, 72, 71];
    const layers = notes.map((n, i) => ({ sig: wood(n), db: -i * 0.6, at: PATTERN_AT + 0.04 + i * 0.058 }));
    const end = PATTERN_AT + 0.04 + notes.length * 0.058 + 0.14;
    return finish(
      mixMono([
        { sig: alertGong(), db: 0 },
        ...layers,
        { sig: wood(64, 0.3), db: -1, at: end },
        { sig: wood(52, 0.3), db: -6, at: end },
      ]),
      1.95,
    );
  },
});
