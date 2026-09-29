/**
 * Tiefenstich (core:exp_str_eco) – Varkan-Experimental: Tiefenzapfwerk, Endgame-Eco (T4, Post-MVP PM3 / E17).
 * In Spielgröße modelliert (Maßstab 1,0), Footprint 12×12.
 *
 * Roster: „Bohrwerk auf 12×12: drei konzentrische Kränze (Zapfstellen-Grammatik, zwei drehen gegenläufig) um einen
 * Bohrturm mit glühendem Pumpenkopf (Glutkern), vier Eckschlote (Energy). Liest sich als „Raute + Flamme“ in
 * Riesengröße. Keramik-Klammer am Sockel.“
 * Flow-Einheit (ECONOMIC): Glutkern erlaubt und gewollt (3–6 %) – die Glutsäule im Bohrturm ist der hellste Punkt
 * der ganzen Basis. Paarprobe gegen Zapfstelle III (2×2, Doppelkranz) und Glutkessel III (liegender Kessel, 3 Schlote).
 *
 * Aufbau (y = Boden):
 *   hull    – Sockel mit Randband (team), innerer Kranz (statisch), Bohrturm (4 Streben + Plattform), Glutsäule,
 *             vier Eckschlote mit Glutkrone, Kupferleitungen zu den Schloten, Keramik-Klammer
 *   ring_a  – äußerer Kranz (team), spin                                                      (PartStream 1)
 *   ring_b  – mittlerer Kranz (Kupfer), spin gegenläufig                                      (PartStream 2)
 *   head    – Pumpenkopf (Kessel mit Glutbändern) oben im Turm, spin                           (PartStream 3)
 */
import { beveledBox, box, cylinder, defineModel, frustum, mirrorX, quad, radial, tube, type Shape } from '@faf/modelkit';
import { ceramicBracket } from './_t4.ts';

const TOP = 0.7;
const TOWER_H = 8.2;
const STACK_XZ = 4.55;

function stack(x: number, z: number): Shape[] {
  return [
    cylinder({ radius: 0.62, height: 4.6, at: [x, TOP + 2.3, z], segments: 10, caps: false, mat: 'body', keep: true, tag: 'stack' }),
    cylinder({ radius: 0.7, height: 0.3, at: [x, TOP + 0.9, z], segments: 10, caps: false, mat: 'copper', maxLod: 1, tag: 'stack' }),
    cylinder({ radius: 0.5, height: 0.08, at: [x, TOP + 4.62, z], segments: 10, caps: 'top', mat: 'glow', keep: true, maxLod: 1, tag: 'stack' }),
  ];
}

export default defineModel({
  id: 'core:exp_str_eco',
  lodDistances: [120, 400],
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [11.9, 0.2, 11.9], at: [0, 0.1, 0], bevel: { top: 0.08 }, mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({ size: [11.6, TOP, 11.6], at: [0, TOP / 2, 0], bevel: { top: 0.3 }, mat: 'body', keep: true, tag: 'hull' }),
        tube({ outer: 5.5 * Math.SQRT2, inner: 4.95 * Math.SQRT2, height: 0.04, segments: 4, at: [0, TOP + 0.02, 0], mat: 'team', maxLod: 1, tag: 'hull' }),
        box({ size: [10.6, 0.04, 10.6], at: [0, TOP + 0.02, 0], mat: 'team', minLod: 2, tag: 'hull' }),
        // innerer Kranz (statisch) um das Bohrloch, Glut im Loch
        tube({ outer: 2.3, inner: 1.6, height: 0.5, segments: 14, at: [0, TOP + 0.25, 0], mat: 'dark', keep: true, tag: 'ring' }),
        cylinder({ radius: 1.6, height: 0.04, at: [0, TOP + 0.05, 0], segments: 14, caps: 'top', mat: 'glow', maxLod: 1 }),
        // Bohrturm: vier schräge Streben zur Plattform, Glutsäule in der Mitte
        radial(box({ size: [0.45, TOWER_H + 0.4, 0.45], at: [1.5, TOP + TOWER_H / 2, 0], rot: [0, 0, 11], mat: 'body', tag: 'mast' }), { count: 4, startDeg: 45, keep: true }),
        beveledBox({ size: [2.2, 0.4, 2.2], at: [0, TOP + TOWER_H, 0], bevel: { top: 0.1 }, mat: 'body', keep: true, tag: 'mast' }),
        cylinder({ radius: 0.55, height: TOWER_H - 1.8, at: [0, TOP + (TOWER_H - 1.8) / 2, 0], segments: 10, caps: false, mat: 'glow', keep: true, tag: 'mast' }),
        // vier Eckschlote (Energy) + Kupferleitungen vom Turmfuß
        ...stack(STACK_XZ, STACK_XZ),
        ...stack(-STACK_XZ, STACK_XZ),
        ...stack(STACK_XZ, -STACK_XZ),
        ...stack(-STACK_XZ, -STACK_XZ),
        radial(box({ size: [3.6, 0.3, 0.36], at: [3.9, 0, 0], mat: 'copper', tag: 'boom' }), { count: 4, startDeg: 45, at: [0, TOP + 0.95, 0], maxLod: 1 }),
        mirrorX(quad({ size: [0.14, 3.0], at: [5.55, TOP + 0.006, 0], mat: 'accent', maxLod: 0 })),
        ceramicBracket({ x: 5.3, y: TOP + 0.04, z: 0, len: 6.0, w: 0.4, arm: 1.2 }),
      ],
    },
    {
      name: 'ring_a',
      pivot: [0, TOP, 0],
      anim: 'spin',
      shapes: [
        tube({ outer: 4.3, inner: 3.6, height: 0.55, segments: 16, at: [0, TOP + 0.3, 0], mat: 'team', keep: true, tag: 'ring' }),
        radial(box({ size: [0.5, 0.2, 0.9], at: [4.5, 0, 0], mat: 'body' }), { count: 8, at: [0, TOP + 0.3, 0], maxLod: 0 }),
      ],
    },
    {
      name: 'ring_b',
      pivot: [0, TOP, 0],
      anim: 'spin',
      shapes: [tube({ outer: 3.2, inner: 2.7, height: 0.8, segments: 16, at: [0, TOP + 0.4, 0], mat: 'copper', keep: true, tag: 'ring' })],
    },
    {
      name: 'head',
      pivot: [0, TOP + TOWER_H, 0],
      anim: 'spin',
      shapes: [
        cylinder({ radius: 1.3, height: 1.7, at: [0, TOP + TOWER_H + 1.05, 0], segments: 12, caps: false, mat: 'body', keep: true, tag: 'boiler' }),
        frustum({ radius: 1.3, radiusTop: 0.7, height: 0.6, at: [0, TOP + TOWER_H + 2.2, 0], segments: 12, caps: 'top', mat: 'team', keep: true, tag: 'boiler' }),
        cylinder({ radius: 1.34, height: 0.22, at: [0, TOP + TOWER_H + 0.7, 0], segments: 12, caps: false, mat: 'glow', maxLod: 1, tag: 'boiler' }),
        cylinder({ radius: 1.34, height: 0.22, at: [0, TOP + TOWER_H + 1.4, 0], segments: 12, caps: false, mat: 'glow', maxLod: 1, tag: 'boiler' }),
      ],
    },
  ],
  notes: 'T4 in Spielgröße. Drei Spin-Parts (Kränze gegenläufig, Pumpenkopf); Glutkern in Bohrloch, Säule, Pumpenkopf und Schlotkronen.',
});
