// REFERENZ-SOUND – Varkan T1-Panzer „Punze“, Waffe core:wpn_cannon_t1 (Glockenkanone, 28 Schaden, linear).
// Audio-Charakter (faction.md §8.2 Direktfeuer): „Glockenhammer" = kurzer metallischer Schlag über dumpfem
// Knall. Höhere Tech klingt tiefer und hallt länger nach (T2/T3: f0 ↓, decayScale ↑), wird aber nicht lauter.
// Leitbild „Gießerei bei Nachtschicht“: tief, metallisch, nah und trocken mit wenig Hall, Glut-Zischen.
//
// Schichten (Peak-normiert, relativ in dB):
//   crack  0   gesättigter Rauschburst im Band 2,9→1,1 kHz (Mündungsknall, Transiente)
//   bell  -1   Glocken-Modalsynthese f0 ≈ 520 Hz, Nachklang auf 14 % gekürzt + FM-Anschlag ("Hammer auf Glocke")
//   boom  -7   fallender Sinus 190→75 Hz, asymmetrisch gesättigt ("dumpfer Knall")
//   thump -6   rosa Rauschen durch schließenden 24-dB-Tiefpass 2,6 kHz→300 Hz (Luftstoß)
//   clank -14  Verschluss-/Rücklauf-Tick 50–65 ms nach dem Schuss
//   ember -22  Glut-Zischen mit Knistern (Schlacke-Treibladung)
//   Bus: tanh-Sättigung, Hochpass 90 Hz (24 dB/Okt.), kleiner trockener Raum (T60 0,45 s, 16 % nass, generierte IR)
import { boom, clang, crack, defineSfx, highpass, mixMono, room, shape, sizzle, thump, tick } from '../../../tools/sfx/src/index.ts';

/** Tech-abhängige Parameter der Glockenkanonen-Familie (T2/T3 und Riegel übernehmen das Rezept). */
export const CANNON_T1 = { f0: 520, decayScale: 0.14, boomFrom: 190, boomTo: 75, boomT60: 0.18 } as const;

export default defineSfx({
  id: 'varkan:wpn_cannon_t1_fire',
  category: 'weapon',
  description: 'Punze (T1-Panzer): Glockenkanone – kurzer Glockenhammer über dumpfem Knall',
  variants: 4,
  tags: ['varkan', 'direktfeuer', 'core:wpn_cannon_t1', 'core:lnd_t1_tank', 'MS5', 'referenz'],
  render({ rng }) {
    const p = rng.jitter(0.035); // Tonhöhe je Variante ±3,5 %
    const c = CANNON_T1;
    const dur = 1.1;
    const layers = mixMono(
      [
        { sig: crack({ rng: rng.fork('crack'), durS: 0.1, freq: 1900 * p, q: 0.7, t60: 0.035, drive: 4 }), db: 0 },
        { sig: clang({ f0: c.f0 * p * rng.jitter(0.015), rng: rng.fork('bell'), durS: 0.9, decayScale: c.decayScale * rng.jitter(0.1), strike: 0.6 }), db: -1, at: 0.002 },
        { sig: boom({ from: c.boomFrom * p, to: c.boomTo * p, sweepS: 0.06, t60: c.boomT60 * rng.jitter(0.1), durS: 0.4, drive: 3 }), db: -7 },
        { sig: thump({ rng: rng.fork('thump'), durS: 0.5, t60: 0.25, lpFrom: 2600, lpTo: 300 }), db: -6 },
        { sig: tick(2350 * p, rng.fork('clank'), 0.03), db: -14, at: 0.05 + rng.range(0, 0.015) },
        { sig: sizzle({ rng: rng.fork('ember'), durS: 0.7, t60: 0.5, hp: 3500, density: 250, hiss: 0.6 }), db: -22, at: 0.02 },
      ],
      dur,
    );
    // Leichte Bus-Sättigung klebt die Schichten zusammen; Hochpass lässt das Tiefband Artillerie und
    // Explosionen (Mix-Regel faction.md §8.3); danach der trockene Raum.
    const glued = highpass(shape(layers, { kind: 'tanh', drive: 1.4 }), 90, 0.7, 2);
    return room(glued, { t60: 0.45, wet: 0.16, seed: 101 });
  },
});
