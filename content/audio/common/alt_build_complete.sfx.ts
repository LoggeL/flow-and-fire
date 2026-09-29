// Alert „Bau fertig" (Queue/Gebäude): Zweiton-Gong + STEIGENDE große Terz (C6 → E6) als kurze, helle
// Anschläge. Positives Gegenstück zu den fallenden Stall-Glissandi; knapp, weil er oft kommt (Intervall 5 s).
import { defineSfx, midiHz, mixMono } from '../../../tools/sfx/src/index.ts';
import { PATTERN_AT, alertGong, chime, finish } from './alt_gong.sfx.ts';

export default defineSfx({
  id: 'common:alt_build_complete',
  category: 'alert',
  description: 'Alert: Bau fertig – Zweiton-Gong + steigende Terz',
  variants: 1,
  cooldownMs: 5000,
  priority: 96,
  tags: ['alert', 'P8', 'MS9'],
  render() {
    return finish(
      mixMono([
        { sig: alertGong(), db: -1 },
        { sig: chime(midiHz(84), 0.45), db: -1, at: PATTERN_AT + 0.02 },
        { sig: chime(midiHz(88), 0.6), db: 0, at: PATTERN_AT + 0.17 },
      ]),
      1.5,
    );
  },
});
