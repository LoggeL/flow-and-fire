// Gunship-Antrieb (Krähe) als Loop: „Gunships wummern mit der Ringdüse" (faction.md §8.2).
//   Wummern  tiefer Ton ~48 Hz, im Takt der Ringdüse (~11 Hz) amplitudenmoduliert und leicht gesättigt
//   Puls     Rauschstöße im selben Takt, Bandpass 300 Hz (Luftstöße aus der Düse)
//   Fauchen  Blasebalg-Rauschen um 900 Hz, langsam atmend (Familienklang der Flieger)
//   Glut     spärliches Knistern
import { bandpass, crackle, defineSfx, highpass, lfo, lowpass, mixMono, mul, noise, osc, shape } from '../../../tools/sfx/src/index.ts';

export default defineSfx({
  id: 'varkan:mov_gunship_loop',
  category: 'unit',
  description: 'Gunship-Antrieb (Loop): Ringdüse wummert im 11-Hz-Takt über Blasebalg-Fauchen',
  variants: 1,
  loop: { lengthS: 2.0, crossfadeS: 0.3 },
  tags: ['varkan', 'bewegung', 'luft', 'loop', 'MS14'],
  render({ rng, durationS }) {
    const dur = durationS ?? 2.3;
    // Ringdüsen-Takt: 11 Hz, leicht schwankend; Hüllkurve = gleichgerichteter, geschärfter Sinus.
    const beat = lfo(0.35, 0.4, 11, dur);
    let ph = 0;
    const throb = new Float32Array(beat.length);
    for (let i = 0; i < beat.length; i++) {
      ph += (beat[i] as number) / 48000;
      throb[i] = Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * ph), 2.2);
    }
    const f0 = 48 * rng.jitter(0.04);
    const wumm = shape(mul(lowpass(mixMono([{ sig: osc('saw', f0, dur) }, { sig: osc('sine', f0 * 0.5, dur), db: -3 }]), 220, 1.2, 2), throb.map((v) => 0.25 + 0.75 * v)), {
      kind: 'asym',
      drive: 2.2,
    });
    const puffs = mul(bandpass(noise('pink', dur, rng.fork('puff')), 320, 1.1), throb);
    const breath = lfo(1.1, 0.25, 0.75, dur);
    const roar = mul(bandpass(noise('pink', dur, rng.fork('roar')), lfo(1.1, 250, 900, dur), 0.9), breath);
    const ember = highpass(crackle(dur, rng.fork('ember'), { density: 60, grainS: 0.0003 }), 3000, 0.7, 1);
    return highpass(
      mixMono(
        [
          { sig: wumm, db: 0 },
          { sig: puffs, db: -6 },
          { sig: roar, db: -9 },
          { sig: ember, db: -24 },
        ],
        dur,
      ),
      30,
      0.7,
      2,
    );
  },
});
