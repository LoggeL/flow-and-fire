/**
 * Riegel I (core:str_t1_pd) – Punktverteidigung T1, 1×1.
 *
 * Roster: „Gefaster Gusssockel, Glocke mit waagerechtem Rohr.“ – dieselbe Glocke wie die Punze (faction.md §5.2
 * Punktverteidigung), auf einem Sockel, der den Footprint füllt. Direktfeuer-Monopol: Glocke + waagerechtes Rohr.
 * Teamfarbe: Randband des Sockeldachs + Glocke; Kupferkranz unter der Glocke, Glut nur an der Mündung und als
 * schmaler Lüftungsschlitz am Sockelheck (Glutnaht, Kampfeinheit), 1 Keramik-Tech-Kerbe hinten auf dem Randband
 * (Strukturen: Kerben längs, quer gestapelt – bei T2/T3 passen 2–3 Querstreifen nicht auf das schmale Randband).
 *
 * Aufbau (y = Boden, +Z = Schussrichtung in Ruhe):
 *   hull   – Gusssockel (45°-Fasen), dunkler Fuß, Teamfarben-Randband (quadratischer Rahmen), Kupferkranz
 *   turret – Glocke (Schürze team + Band + Kuppel team), dreht um +Y          (PartStream 1)
 *   barrel – Blende + Rohr + Kupfermündung, kippt (Pitch)                        (PartStream 2)
 * Die Glocke sitzt 0,08 WU hinter der Mitte, damit das Rohr innerhalb der Footprint-Kante (≤ 105 %) endet.
 */
import { beveledBox, box, cylinder, defineModel, frustum, mirrorX, quad, sphere, stripes, tube } from '@faf/modelkit';

const TOP = 0.26; // Sockeldach
const BZ = -0.08; // Glockenmitte (z)
const BELL_Y = TOP + 0.03;
const BARREL_Y = BELL_Y + 0.19;

export default defineModel({
  id: 'core:str_t1_pd',
  parts: [
    {
      name: 'hull',
      shapes: [
        // dunkler Fuß (volle Kante) + gefaster Gusssockel darüber
        beveledBox({ size: [0.96, 0.08, 0.96], at: [0, 0.04, 0], bevel: { top: 0.03 }, mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({ size: [0.9, TOP, 0.9], at: [0, TOP / 2, 0], bevel: { top: 0.09 }, mat: 'body', tag: 'hull' }),
        // Randband des Dachs (Teamfarbe): quadratischer Rahmen (Rohr mit 4 Segmenten = achsparalleles Quadrat)
        tube({ outer: 0.36 * Math.SQRT2, inner: 0.25 * Math.SQRT2, height: 0.03, segments: 4, at: [0, TOP + 0.015, 0], mat: 'team', maxLod: 0, tag: 'hull' }),
        box({ size: [0.72, 0.03, 0.72], at: [0, TOP + 0.015, 0], mat: 'team', minLod: 1, tag: 'hull' }),
        // Kupferkranz (Drehkranz der Glocke)
        cylinder({ radius: 0.24, height: 0.03, at: [0, TOP + 0.015, BZ], segments: 8, caps: 'top', mat: 'copper', maxLod: 1 }),
        // Glutnaht: Lüftungsschlitz am Sockelheck (auf der 45°-Fase)
        quad({ size: [0.36, 0.05], at: [0, TOP - 0.045, -0.405], rot: [-45, 0, 0], mat: 'glow', maxLod: 0 }),
        // Kupferleitungen längs der Seitenfasen (Flow), Ø 0,12
        mirrorX(cylinder({ radius: 0.06, height: 0.62, axis: 'z', at: [0.41, TOP - 0.035, -0.03], segments: 6, caps: 'top', mat: 'copper', maxLod: 1, tag: 'barrel' })),
        // 1 Tech-Kerbe (Keramik, quer gestapelt wie die Icon-Kerben) auf dem hinteren Randband
        stripes({ count: 1, width: 0.11, rot: [0, 90, 0], at: [0, TOP + 0.034, -0.305] }),
      ],
    },
    {
      name: 'turret',
      pivot: [0, BELL_Y, BZ],
      anim: 'yaw',
      shapes: [
        // Glocke wie Punze (r 0,31): Schürze + Band + flache Kuppel
        frustum({ radius: 0.31, radiusTop: 0.29, height: 0.1, at: [0, BELL_Y + 0.05, BZ], segments: 8, caps: 'bottom', mat: 'team', tag: 'bell' }),
        cylinder({ radius: 0.3, height: 0.025, at: [0, BELL_Y + 0.1125, BZ], segments: 8, caps: false, mat: 'body', maxLod: 0 }),
        sphere({ radius: 0.29, hemi: true, segments: 8, rings: 3, scale: [1, 0.7, 1], at: [0, BELL_Y + 0.125 + 0.1015, BZ], mat: 'team', tag: 'bell' }),
      ],
    },
    {
      name: 'barrel',
      parent: 'turret',
      pivot: [0, BARREL_Y, BZ + 0.24],
      anim: 'pitch',
      shapes: [
        beveledBox({ size: [0.26, 0.16, 0.14], at: [0, BARREL_Y, BZ + 0.26], bevel: { topFront: 0.05 }, mat: 'body' }),
        // Rohr Ø 0,17 waagerecht, endet bei z ≈ 0,58 (Footprint-Kante 0,5 + 8 % Überstand)
        cylinder({ radius: 0.085, height: 0.4, axis: 'z', at: [0, BARREL_Y, 0.31], segments: 6, caps: 'top', mat: 'dark', keep: true, tag: 'barrel' }),
        cylinder({ radius: 0.105, height: 0.1, axis: 'z', at: [0, BARREL_Y, 0.5], segments: 6, mat: 'copper', tag: 'barrel' }),
        cylinder({ radius: 0.06, height: 0.01, axis: 'z', at: [0, BARREL_Y, 0.555], segments: 6, caps: 'top', mat: 'glow', maxLod: 0 }),
      ],
    },
  ],
  notes: 'Glocke identisch zur Punze (lnd_t1_tank), 0,08 WU nach hinten versetzt, damit das Rohr im Footprint bleibt.',
});
