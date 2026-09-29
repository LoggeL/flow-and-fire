// Alert „Einheit angegriffen": Zweiton-Gong + EIN tiefer Puls (A3, gesättigtes Rechteck, gedämpft).
// Familie „Angriff": tiefe Pulse; die Anzahl trägt die Schwere (1 = Einheit, 2 = Basis, 3 schnelle hohe = Vogt).
import { defineSfx, midiHz, mixMono } from '../../../tools/sfx/src/index.ts';
import { PATTERN_AT, alertGong, finish, pulse } from './alt_gong.sfx.ts';

export default defineSfx({
  id: 'common:alt_unit_attacked',
  category: 'alert',
  description: 'Alert: Einheit angegriffen – Zweiton-Gong + ein tiefer Puls',
  variants: 1,
  cooldownMs: 10000,
  priority: 97,
  tags: ['alert', 'P8', 'MS9'],
  render() {
    const p = pulse(midiHz(57), 0.26, { wave: 'square', lp: 1800, drive: 1.6 });
    const sub = pulse(midiHz(45), 0.26, { wave: 'sine' });
    return finish(
      mixMono([
        { sig: alertGong(), db: 0 },
        { sig: p, db: -2, at: PATTERN_AT + 0.05 },
        { sig: sub, db: -10, at: PATTERN_AT + 0.05 },
      ]),
      1.5,
    );
  },
});
