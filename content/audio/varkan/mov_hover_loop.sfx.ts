// Hover-Antrieb als Loop (vorbereitet, post-MVP: kein Hover-Fahrzeug im MVP-Roster).
//   Luftpolster  breites Rauschen, Tiefpass ~1,4 kHz, langsam schwankend (Schürze schleift über Grund/Wasser)
//   Gebläse      Blattfolge-Ton ~130 Hz mit Obertönen (Pulswelle), leichtes Eiern
//   Schürze      leises Flattern (AM-Rauschen ~23 Hz)
import { bandpass, defineSfx, highpass, lfo, lowpass, mixMono, mul, noise, osc } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:mov_hover_loop',
  category: 'unit',
  description: 'Hover-Antrieb (Loop, post-MVP): Luftpolster-Rauschen + Gebläse-Brummen',
  variants: 1,
  loop: { lengthS: 2.0, crossfadeS: 0.3 },
  tags: ['varkan', 'bewegung', 'loop', 'post-MVP'],
  render({ rng, durationS }) {
    const dur = durationS ?? 2.3;
    const cushion = mul(lowpass(noise('pink', dur, rng.fork('cushion')), lfo(0.4, 300, 1400, dur), 0.7, 2), lfo(0.6, 0.15, 0.85, dur));
    const f = 130 * rng.jitter(0.05);
    const fan = lowpass(osc('pulse', lfo(1.7, 1.5, f, dur), dur, { pw: 0.3 }), 1100, 0.9, 2);
    const flutter = mul(bandpass(noise('white', dur, rng.fork('flutter')), 1800, 1.2), lfo(23, 0.4, 0.6, dur, 'triangle'));
    const rumble = lowpass(noise('brown', dur, rng.fork('rumble')), 120, 0.7, 2);
    return highpass(
      mixMono(
        [
          { sig: cushion, db: 0 },
          { sig: fan, db: -10 },
          { sig: flutter, db: -20 },
          { sig: rumble, db: -8 },
        ],
        dur,
      ),
      35,
      0.7,
      2,
    );
  },
});
