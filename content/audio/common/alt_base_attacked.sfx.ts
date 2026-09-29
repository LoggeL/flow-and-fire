// Alert „Basis/Gebäude angegriffen": Zweiton-Gong + ZWEI tiefe Pulse (G3), jeder mit einem dumpfen Guss-Klong
// darunter (Gebäude = Masse). Tiefer und schwerer als „Einheit angegriffen", gleiche Familie.
import { PLATE_PARTIALS, defineSfx, midiHz, mixMono, modal, scaleDecay } from '../../../tools/sfx/src/index.ts';
import { PATTERN_AT, alertGong, finish, pulse } from './alt_gong.sfx.ts';

export default defineSfx({
  id: 'common:alt_base_attacked',
  category: 'alert',
  description: 'Alert: Basis angegriffen – Zweiton-Gong + zwei tiefe Pulse mit Guss-Klong',
  variants: 1,
  cooldownMs: 15000,
  priority: 99,
  tags: ['alert', 'P8', 'MS9'],
  render() {
    const hit = (): Float32Array =>
      mixMono([
        { sig: pulse(midiHz(55), 0.2, { wave: 'square', lp: 1500, drive: 2 }), db: -2 },
        { sig: pulse(midiHz(43), 0.2, { wave: 'sine' }), db: -9 },
        { sig: modal(midiHz(55) * 2, scaleDecay(PLATE_PARTIALS, 0.5), { durS: 0.35 }), db: -8 },
      ]);
    return finish(
      mixMono([
        { sig: alertGong(), db: 0 },
        { sig: hit(), at: PATTERN_AT + 0.05 },
        { sig: hit(), at: PATTERN_AT + 0.33 },
      ]),
      1.9,
    );
  },
});
