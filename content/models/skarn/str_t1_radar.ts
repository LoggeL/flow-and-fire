/**
 * Fühler I (f2:str_t1_radar) – Radar T1, 2×2.
 *
 * Roster: „Zwei hohe, geknickte Fühler als V (35° gespreizt); kein Ring.“ faction.md §5.1 Winkel-Code: hoch und
 * dünn = Intel. Zwei Vierkant-Fühler (Kitbash `antenna`, 2 Glieder, geknickt) wachsen aus einem flachen
 * Sechskant-Buckel auf der Kruste: das untere Glied steht steil, das obere knickt nach vorn-außen ab und läuft spitz
 * aus. Die Spitzen liegen 35° auseinander (je 17,5° aus der Senkrechten). Sehnen-Manschetten an Wurzel und Knie.
 * Paartest Fühler↔Kokon: offenes V ohne Ring gegen Dreibein mit waagerechtem Netzring.
 * Teamfarbe: Krustenrand + Sechskantplatte auf dem Buckel; 1 Quarz-Kerbe hinten; keine Glut. Statisch (Roster:
 * 0 animierte Parts).
 *
 * Aufbau (y = Boden, +Z = vorn): hull – Kruste, Buckel, Teamplatte, 2 Fühler, Manschetten, Kerbe.
 */
import { cylinder, defineModel, frustum, stripes } from '@faf/modelkit';
import { crust, feelerPair } from './_wehr.ts';

const K = crust({ size: [1.94, 1.94], h: 0.26, rim: 0.2, seed: 17 });
const F = K.floor;
const HUB_H = 0.24;
const HUB_TOP = F + HUB_H;

export default defineModel({
  id: 'f2:str_t1_radar',
  parts: [
    {
      name: 'hull',
      shapes: [
        ...K.shapes,
        // Buckel: flacher Sechskant-Stumpf (Chitin) mit teamfarbener Sechskantplatte
        frustum({ radius: 0.56, radiusTop: 0.4, height: HUB_H + 0.02, segments: 6, caps: 'top', at: [0, F + HUB_H / 2 - 0.01, 0], mat: 'chitin', keep: true, tag: 'carapace' }),
        cylinder({ radius: 0.36, height: 0.03, segments: 6, caps: 'top', at: [0, HUB_TOP + 0.01, 0], mat: 'team', tag: 'carapace' }),
        ...feelerPair({ base: HUB_TOP, spread: 35, height: 2.35, knee: 0.55, forward: 0.3, radius: 0.13 }),
        stripes({ count: 1, width: 0.2, rot: [0, 90, 0], at: [0, F + 0.005, -0.7] }),
      ],
    },
  ],
  notes: 'v_radar: statisch. Fühler als Kitbash-Part antenna (2 Glieder) aus _wehr.ts.',
});
