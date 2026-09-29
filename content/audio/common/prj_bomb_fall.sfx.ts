// Fallende Bombe (Dohle, Elster): klassisches Fallpfeifen, Tonhöhe fällt von ~2,2 kHz auf ~700 Hz und wird
// dabei lauter; kein Einschlag (der kommt aus common:imp_bomb). Fraktionsneutral, eine Fraktion kann es als
// <fraktion>:prj_bomb_fall überschreiben.
import { bandpass, defineSfx, envelope, highpass, mixMono, mul, noise, osc, sweep } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'common:prj_bomb_fall',
  category: 'projectile',
  description: 'Fallende Bombe: fallendes Pfeifen, schwillt an (Einschlag separat)',
  variants: 2,
  tags: ['common', 'projektil', 'bombe', 'MS14'],
  render({ rng, variant, sr }) {
    const dur = 1.45 * rng.jitter(0.03);
    const pitch = sweep((variant === 0 ? 2200 : 1750) * rng.jitter(0.04), (variant === 0 ? 700 : 480) * rng.jitter(0.05), dur, dur, variant === 0 ? 'exp' : 1.6, sr);
    // Leichtes Eiern (Leitwerk), Frequenz steigt mit der Fallgeschwindigkeit.
    const wob = sweep(4, 9, dur, dur, 'exp', sr);
    const wobble = new Float32Array(pitch.length);
    let ph = rng.next();
    for (let i = 0; i < wobble.length; i++) {
      wobble[i] = (pitch[i] as number) * (1 + 0.012 * Math.sin(2 * Math.PI * ph));
      ph += (wob[i] as number) / sr;
    }
    const env = envelope([[0, 0], [0.12, 0.25, 'lin'], [dur - 0.08, 1, 2.2], [dur, 0, 'lin']], dur, sr);
    const mix = mixMono([
      { sig: bandpass(noise('white', dur, rng.fork('air')), wobble, 16), db: 0 },
      { sig: osc('sine', wobble, dur), db: -12 },
      { sig: bandpass(noise('pink', dur, rng.fork('rush')), 600, 0.7), db: -16 },
    ]);
    return highpass(mul(mix, env), 200, 0.7, 2);
  },
});
