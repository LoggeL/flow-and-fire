// Rüttelsieb (T2-Flugabwehr), Waffe core:wpn_flak_t2 (Splitterflak, 0,5 s); Alias core:wpn_grate_flak_t2
// (Rost II, Turm).
// Splitterflak: ein dumpfer Ausstoß (gedämpfter Knall, kurzer Luftstoß) und danach ein langes, schnelles Rasseln
// in hoher Lage – das Rüttelsieb schüttelt die Splitterladung nach. Tiefer im Anschlag als das Sieb, aber das
// Rasseln bleibt hoch (Band-Regel AA hoch).
import { boom, crack, defineSfx, highpass, lowpass, mixMono, room, shape, thump } from '../../../tools/sfx/src/index.ts';
import { rattle } from './wpn_kit.ts';

export default defineSfx({
  id: 'varkan:wpn_flak_t2_fire',
  category: 'weapon',
  description: 'Rüttelsieb (T2-Flugabwehr): Splitterflak, dumpfer Ausstoß + langes hohes Rasseln',
  variants: 4,
  tags: ['varkan', 'flugabwehr', 'core:wpn_flak_t2', 'core:wpn_grate_flak_t2', 'MS9'],
  render({ rng }) {
    const p = rng.jitter(0.045);
    const dur = 0.7;
    const layers = mixMono(
      [
        { sig: lowpass(crack({ rng: rng.fork('crack'), durS: 0.08, freq: 1300 * p, q: 0.6, t60: 0.03, drive: 4 }), 2400, 0.7, 1), db: -1 },
        { sig: thump({ rng: rng.fork('push'), durS: 0.25, t60: 0.13, lpFrom: 1600, lpTo: 220 }), db: -3 },
        { sig: boom({ from: 150 * p, to: 80 * p, sweepS: 0.04, t60: 0.12, durS: 0.2, drive: 3 }), db: -8 },
        { sig: rattle({ rng: rng.fork('rattle'), count: 14, rate: 48 * p, jitter: 0.35, fLo: 2200 * p, fHi: 6000 * p, fall: 0.86, t60: 0.018 }), db: -6, at: 0.03 },
      ],
      dur,
    );
    return room(highpass(shape(layers, { kind: 'tanh', drive: 1.7 }), 120, 0.7, 2), { t60: 0.3, wet: 0.1, seed: 132 });
  },
});
