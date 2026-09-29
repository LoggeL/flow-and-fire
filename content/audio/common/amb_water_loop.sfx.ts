// Ambience „Ufer" (Karten mit Wasser, Kamera nahe am Ufer; Loop 20 s, stereo): leise Brandung.
//   Welle   rosa Rauschen je Kanal, Tiefpass öffnet 300 → 1800 Hz beim Anrollen, Brechen ≈ 1,6 s, langsames Auslaufen
//   Schaum  hohes Rauschen + feines Blubber-Knistern nach dem Brechen, zieht sich zurück
//   Grund   leises, tiefes Wogen (braunes Rauschen, Tiefpass 250 Hz)
// Wellenabstand 5–7 s, jede Welle leicht anders im Panorama.
import {
  type Stereo,
  crackle,
  defineSfx,
  envelope,
  highpass,
  lowpass,
  mix,
  mixMono,
  mul,
  noise,
  type Rng,
} from '../../../tools/sfx/src/index.ts';

function wave(r: Rng, panPos: number, size: number): Stereo {
  const d = 5.2;
  const crash = 1.6 * r.jitter(0.1);
  const amp = envelope([[0, 0], [crash, 1, 2.2], [crash + 0.4, 0.8, 'lin'], [d, 0, 'exp']], d);
  const cut = envelope([[0, 300], [crash, 1800 * size, 'exp'], [d, 500, 'exp']], d);
  const foamEnv = envelope([[0, 0], [crash - 0.1, 0, 'lin'], [crash + 0.25, 1, 'lin'], [d, 0, 'exp']], d);
  const ch = (label: string, g: number): Float32Array => {
    const rr = r.fork(label);
    const body = mul(lowpass(noise('pink', d, rr.fork('b')), cut, 0.7, 2), amp);
    const foam = mul(highpass(noise('pink', d, rr.fork('f')), 2800, 0.7, 1), foamEnv);
    const fizz = mul(highpass(crackle(d, rr.fork('c'), { density: 900, grainS: 0.0002 }), 3500, 0.7, 1), foamEnv);
    return mixMono([
      { sig: body, db: 20 * Math.log10(g) },
      { sig: foam, db: -12 + 20 * Math.log10(g) },
      { sig: fizz, db: -22 + 20 * Math.log10(g) },
    ]);
  };
  return [ch('L', 0.75 - 0.25 * panPos), ch('R', 0.75 + 0.25 * panPos)];
}

export default defineSfx({
  id: 'common:amb_water_loop',
  category: 'ambience',
  description: 'Ambience Ufer (Loop 20 s): leise Brandung mit Schaum im Wellenabstand 5–7 s',
  variants: 1,
  loop: { lengthS: 20, crossfadeS: 3 },
  tags: ['ambience', 'loop', 'MS14'],
  render({ rng, durationS }) {
    const dur = durationS ?? 23;
    const r = rng.fork('waves');
    const waves: { sig: Stereo; at: number; db: number }[] = [];
    for (let t = -2 + r.range(0, 1); t < dur; t += r.range(5, 7)) {
      const w = wave(r.fork(`w${t}`), r.range(-0.8, 0.8), r.range(0.75, 1.1));
      if (t >= 0) waves.push({ sig: w, at: t, db: r.range(-3, 0) });
      else {
        // Welle, die vor dem Loop-Anfang begonnen hat: nur ihren Rest einlegen.
        const off = Math.round(-t * 48000);
        waves.push({ sig: [w[0].slice(off), w[1].slice(off)], at: 0, db: r.range(-3, 0) });
      }
    }
    const bed: Stereo = [
      mul(lowpass(noise('brown', dur, rng.fork('bl')), 250, 0.7, 2), envelope([[0, 0.8]], dur)),
      lowpass(noise('brown', dur, rng.fork('br')), 250, 0.7, 2),
    ];
    const out = mix([{ sig: bed, db: -18 }, ...waves], dur) as Stereo;
    return [highpass(out[0], 30, 0.7, 2), highpass(out[1], 30, 0.7, 2)];
  },
});
