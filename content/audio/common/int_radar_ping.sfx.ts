// Radar-Ping des Horchers (nur Z0/Z1, selten): leiser Sonar-Ping mit Nachhall. Sinus mit schwacher
// Oberwelle und minimalem Abwärtsgleiten, weiches Anschwellen, zwei gedämpfte Echos (Delay) und ein
// weiter, dunkler Raum. Fraktionsneutral, eine Fraktion kann ihn als <fraktion>:int_radar_ping ersetzen.
import { decay, defineSfx, delay, highpass, makeIR, convolve, mixMono, mul, osc, sweep, type Mono } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'common:int_radar_ping',
  category: 'intel',
  description: 'Radar-Ping: leiser Sonar-Ping mit Nachhall (Horcher-Sweep)',
  variants: 2,
  tags: ['intel', 'radar', 'MS14'],
  render({ rng, sr, variant }) {
    const dur = 0.9;
    const f = (variant === 0 ? 1320 : 1180) * rng.jitter(0.01);
    const env = decay(0.55, dur, 0.004, sr);
    const pitch = sweep(f * 1.012, f, 0.08, dur, 'exp', sr);
    const ping = mul(osc('sine', pitch, dur), env);
    const over = mul(osc('sine', mul(pitch, 2.005), dur), decay(0.2, dur, 0.004, sr));
    const dry = mixMono([{ sig: ping }, { sig: over, db: -18 }], 1.5);
    const echo = delay(dry, { timeS: 0.21, feedback: 0.3, mix: 0.45, dampHz: 2200 });
    const ir = makeIR({ t60: 1.1, predelayS: 0.02, brightHz: 3500, darkHz: 700, seed: 33 + variant }) as Mono;
    const wet = convolve(echo.slice(0, dry.length), ir, 0.28, 1) as Mono;
    return highpass(wet.slice(0, Math.round(1.5 * sr)), 300, 0.7, 2);
  },
});
