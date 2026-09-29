// Alert „Speicher voll" (Masse wird verschwendet): Zweiton-Gong + kurzer ÜBERLAUF-Ton: ein steigender
// Füll-Sweep, der oben „überschwappt" – drei fallende, tropfende Blubber-Töne. Leichter und kürzer als die Stall-Alerts.
import { decay, defineSfx, midiHz, mixMono, mul, osc, sweep } from '../../../tools/sfx/src/index.ts';
import { PATTERN_AT, alertGong, finish } from './alt_gong.sfx.ts';

/** Tropfen: kurzer Sinus mit schneller Aufwärts-Biegung (Blubber-„Plopp"). */
const drop = (freq: number): Float32Array => {
  const d = 0.09;
  return mul(osc('sine', sweep(freq * 0.7, freq, 0.03, d, 'exp'), d), decay(0.08, d, 0.002));
};

export default defineSfx({
  id: 'common:alt_storage_full',
  category: 'alert',
  description: 'Alert: Speicher voll – Zweiton-Gong + steigender Füll-Sweep mit überschwappenden Tropfen',
  variants: 1,
  cooldownMs: 30000,
  priority: 96,
  tags: ['alert', 'P8', 'MS14', 'eco'],
  render() {
    const fillDur = 0.24;
    const fillF = sweep(midiHz(74), midiHz(86), fillDur, fillDur, 'exp');
    const fill = mul(
      mixMono([{ sig: osc('sine', fillF, fillDur) }, { sig: osc('triangle', fillF, fillDur), db: -10 }]),
      decay(0.6, fillDur, 0.01),
    );
    const t0 = PATTERN_AT + 0.03;
    return finish(
      mixMono([
        { sig: alertGong(), db: 0 },
        { sig: fill, db: -3, at: t0 },
        { sig: drop(midiHz(86)), db: -1, at: t0 + fillDur + 0.02 },
        { sig: drop(midiHz(83)), db: -3, at: t0 + fillDur + 0.12 },
        { sig: drop(midiHz(79)), db: -5, at: t0 + fillDur + 0.22 },
      ]),
      1.45,
    );
  },
});
