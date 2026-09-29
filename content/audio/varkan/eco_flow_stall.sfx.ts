// Energy-Stall (faction.md §8.2, K2): der Flow-Grundton kippt um eine kleine Sekunde (Halbton) nach unten
// und stottert knapp eine Sekunde lang, dann sackt er weiter ab und verlischt. So ist der Stall hörbar,
// ohne aufs HUD zu schauen. Gleiches Timbre wie eco_flow_hum_loop (flowHum), dazu ein Relais-Klacken
// beim Kippen und Aussetzer mit unregelmäßigem Takt (je Variante anders).
import { decay, defineSfx, envelope, highpass, mixMono, mul, semis, tick } from '../../../tools/sfx/src/index.ts';
import { flowHum } from './foundry_kit.ts';

export default defineSfx({
  id: 'varkan:eco_flow_stall',
  category: 'eco',
  description: 'Energy-Stall: Grundton kippt einen Halbton nach unten und stottert',
  variants: 2,
  tags: ['varkan', 'eco', 'flow', 'stall', 'MS9'],
  render({ rng, sr }) {
    const dur = 1.45;
    const f = 110;
    // Tonhöhe: 110 Hz → Halbton tiefer (0,12 s) → leichtes Absacken → am Ende weiter fallend.
    const pitch = envelope([[0, f], [0.1, f], [0.22, f / semis(1), 'exp'], [1.0, f / semis(1.4), 'lin'], [dur, f / semis(4), 'exp']], dur, sr);
    const hum = flowHum(pitch, dur, rng.fork('hum'), { beatHz: 0.9, bright: 1.05, sr });
    // Stottern: Aussetzer in unregelmäßigem Takt (≈ 11–16 Hz), Tiefe wächst, danach Verlöschen.
    const gate = new Float32Array(hum.length);
    const r = rng.fork('stutter');
    let t = 0.22;
    const segs: [number, number][] = [];
    while (t < 1.05) {
      const on = r.range(0.035, 0.075);
      const off = r.range(0.02, 0.045) * (t > 0.6 ? 1.4 : 1);
      segs.push([t + on, t + on + off]);
      t += on + off;
    }
    for (let i = 0; i < gate.length; i++) {
      const ts = i / sr;
      let g = 1;
      for (const [a, b] of segs) {
        if (ts >= a && ts < b) {
          const depth = Math.min(0.92, 0.55 + (ts - 0.22) * 0.6);
          // weiche Flanken (3 ms), damit es nicht knackt
          const edge = Math.min(1, (ts - a) / 0.003, (b - ts) / 0.003);
          g = 1 - depth * edge;
        }
      }
      gate[i] = g;
    }
    const amp = envelope([[0, 0], [0.03, 1, 'lin'], [1.0, 0.85, 'lin'], [dur, 0, 0.6]], dur, sr);
    const relay = mul(tick(620 * rng.jitter(0.05), rng.fork('relay'), 0.04), decay(0.05, 0.08, 0.0003, sr));
    const m = mixMono(
      [
        { sig: mul(mul(hum, gate), amp), db: 0 },
        { sig: relay, db: -16, at: 0.1 },
      ],
      dur,
    );
    return highpass(m, 45, 0.7, 2);
  },
});
