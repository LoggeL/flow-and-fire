/**
 * Tiefenstich (core:exp_str_eco) – Varkan-Experimental: Tiefenzapfwerk, Endgame-Eco (T4, Post-MVP PM3 / E17).
 * In Spielgröße modelliert (Maßstab 1,0), Footprint 12×12. Feature-IDs/Mechaniken: E17, E1–E4, K14, XM7, XM8, XM9
 * (docs/design/experimentals.md §4.5).
 *
 * Roster: „Bohrwerk auf 12×12: drei konzentrische Kränze (Zapfstellen-Grammatik, zwei drehen gegenläufig) um einen
 * Bohrturm mit glühendem Pumpenkopf (Glutkern), vier Eckschlote (Energy). Liest sich als „Raute + Flamme“ in
 * Riesengröße. Keramik-Klammer am Sockel.“
 * Flow-Einheit (ECONOMIC): Glutkern erlaubt und gewollt (3–6 %) – die Glutsäule im Bohrturm ist der hellste Punkt
 * der ganzen Basis. Paarprobe gegen Zapfstelle III (2×2, Doppelkranz) und Glutkessel III (liegender Kessel, 3 Schlote).
 *
 * Form: Bohrturm als sich verjüngender Vierbein-Derrick mit zwei Kupfer-Rahmen, darin die Glutsäule; oben der
 * rautenförmige Pumpenkopf (zwei Kegel, Glutgürtel) – die „Raute“; die „Flamme“ sind Glutsäule und Schlotkronen.
 * Vier Eckschlote mit Kupferleitungen zum Turmfuß, zwei Pumpenhäuser an den Stirnseiten.
 *
 * Aufbau (y = Boden):
 *   hull    – Sockel mit Randband (team), Achteck-Podest, innerer Kranz (statisch) mit Glut im Bohrloch, Bohrturm
 *             (4 Beine, 2 Rahmen, Plattform), Glutsäule, vier Eckschlote mit Glutkrone, Kupferleitungen,
 *             Pumpenhäuser, Keramik-Klammer
 *   ring_a  – äußerer Kranz (team) mit Zahnkranz, spin                                         (PartStream 1)
 *   ring_b  – mittlerer Kranz (Kupfer), spin gegenläufig                                       (PartStream 2)
 *   head    – Pumpenkopf (Raute aus zwei Kegeln, Glutgürtel, team), spin                        (PartStream 3)
 */
import { beveledBox, box, cone, cylinder, defineModel, frustum, prism, quad, radial, tube, type Shape } from '@faf/modelkit';
import { ceramicBracket } from './_t4.ts';

const TOP = 0.7; // Sockeloberkante
const P = TOP + 0.3; // Podest oben
const TOWER_H = 8.3; // Turmhöhe über dem Podest
const LEG_R0 = 2.45; // Beinradius unten (diagonal)
const LEG_R1 = 0.85; // Beinradius oben
const STACK_XZ = 4.6;
const RAD = Math.PI / 180;
const legR = (h: number): number => LEG_R0 - ((LEG_R0 - LEG_R1) * h) / TOWER_H;
const LEAN = Math.atan((LEG_R0 - LEG_R1) / TOWER_H) / RAD;
const HEAD_Y = P + TOWER_H + 0.35; // Unterkante Pumpenkopf

function stack(x: number, z: number): Shape[] {
  return [
    frustum({ radius: 1.0, radiusTop: 0.72, height: 1.2, at: [x, TOP + 0.6, z], segments: 10, caps: false, mat: 'body', keep: true, maxLod: 1, tag: 'stack' }),
    cylinder({ radius: 0.64, height: 4.0, at: [x, TOP + 3.2, z], segments: 10, caps: false, mat: 'body', keep: true, tag: 'stack' }),
    cylinder({ radius: 0.72, height: 0.3, at: [x, TOP + 2.2, z], segments: 10, caps: false, mat: 'copper', maxLod: 0, tag: 'stack' }),
    // Kragen + Glutkrone
    frustum({ radius: 0.64, radiusTop: 0.88, height: 0.4, at: [x, TOP + 5.35, z], segments: 10, caps: false, mat: 'body', keep: true, maxLod: 1, tag: 'stack' }),
    cylinder({ radius: 0.62, height: 0.1, at: [x, TOP + 5.25, z], segments: 10, caps: 'top', mat: 'glow', keep: true, tag: 'stack' }),
  ];
}

export default defineModel({
  id: 'core:exp_str_eco',
  lodDistances: [120, 400],
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [11.95, 0.25, 11.95], at: [0, 0.125, 0], bevel: { top: 0.1 }, mat: 'dark', maxLod: 1, tag: 'hull' }),
        beveledBox({ size: [11.6, TOP - 0.25, 11.6], at: [0, 0.25 + (TOP - 0.25) / 2, 0], bevel: { top: 0.3 }, mat: 'body', keep: true, tag: 'hull' }),
        tube({ outer: 5.5 * Math.SQRT2, inner: 4.95 * Math.SQRT2, height: 0.04, segments: 4, at: [0, TOP + 0.02, 0], mat: 'team', maxLod: 1, tag: 'hull' }),
        box({ size: [10.6, 0.04, 10.6], at: [0, TOP + 0.02, 0], mat: 'team', minLod: 2, tag: 'hull' }),
        prism({ sides: 8, radius: 5.0, height: P - TOP, at: [0, (TOP + P) / 2, 0], rot: [0, 22.5, 0], mat: 'body', keep: true, maxLod: 1, tag: 'hull' }),
        // innerer Kranz (statisch) um das Bohrloch, Glut im Loch
        tube({ outer: 2.2, inner: 1.5, height: 0.6, segments: 12, at: [0, P + 0.3, 0], mat: 'dark', keep: true, maxLod: 1, tag: 'ring' }),
        cylinder({ radius: 1.5, height: 0.04, at: [0, P + 0.1, 0], segments: 14, caps: 'top', mat: 'glow', keep: true }),
        // Bohrturm: vier nach innen geneigte Beine, zwei Kupfer-Rahmen, Plattform
        radial(box({ size: [0.55, TOWER_H / Math.cos(LEAN * RAD) + 0.2, 0.55], at: [(LEG_R0 + LEG_R1) / 2, P + TOWER_H / 2, 0], rot: [0, 0, LEAN], mat: 'body', tag: 'mast' }), {
          count: 4,
          startDeg: 45,
          keep: true,
        }),
        tube({ outer: (legR(3.0) + 0.3) * Math.SQRT2, inner: (legR(3.0) - 0.05) * Math.SQRT2, height: 0.3, segments: 4, at: [0, P + 3.0, 0], mat: 'copper', keep: true, maxLod: 1, tag: 'mast' }),
        tube({ outer: (legR(6.0) + 0.3) * Math.SQRT2, inner: (legR(6.0) - 0.05) * Math.SQRT2, height: 0.3, segments: 4, at: [0, P + 6.0, 0], mat: 'copper', maxLod: 0, tag: 'mast' }),
        beveledBox({ size: [2.6, 0.45, 2.6], at: [0, P + TOWER_H + 0.1, 0], bevel: { top: 0.12 }, mat: 'body', keep: true, tag: 'mast' }),
        // Glutsäule vom Bohrloch bis unter die Plattform
        cylinder({ radius: 0.55, height: TOWER_H - 0.4, at: [0, P + (TOWER_H - 0.4) / 2, 0], segments: 10, caps: false, mat: 'glow', keep: true, tag: 'mast' }),
        // vier Eckschlote (Energy) + Kupferleitungen vom Turmfuß
        ...stack(STACK_XZ, STACK_XZ),
        ...stack(-STACK_XZ, STACK_XZ),
        ...stack(STACK_XZ, -STACK_XZ),
        ...stack(-STACK_XZ, -STACK_XZ),
        radial(cylinder({ radius: 0.24, height: 3.9, axis: 'x', at: [4.15, 0, 0], segments: 6, mat: 'copper', tag: 'boom' }), { count: 4, startDeg: 45, at: [0, P + 1.35, 0], maxLod: 0 }),
        // Pumpenhäuser an den Stirnseiten (vorn/hinten) mit Glutschlitz
        ...[1, -1].map((s) => beveledBox({ size: [1.8, 0.9, 0.9], at: [0, TOP + 0.45, s * 5.15], bevel: { top: 0.25 }, mat: 'body', maxLod: 1, tag: 'hull' })),
        quad({ size: [1.0, 0.1], rot: [90, 0, 0], at: [0, TOP + 0.5, 5.605], mat: 'glow', maxLod: 0 }),
        ceramicBracket({ x: 5.3, y: TOP + 0.04, z: 0, len: 6.0, w: 0.4, arm: 1.2, maxLod: 0 }),
      ],
    },
    {
      name: 'ring_a',
      pivot: [0, P, 0],
      anim: 'spin',
      shapes: [
        tube({ outer: 4.6, inner: 3.85, height: 0.6, segments: 16, at: [0, P + 0.3, 0], mat: 'team', keep: true, tag: 'ring' }),
        radial(box({ size: [0.5, 0.26, 0.8], at: [4.72, 0, 0], mat: 'body' }), { count: 8, at: [0, P + 0.3, 0], maxLod: 0 }),
      ],
    },
    {
      name: 'ring_b',
      pivot: [0, P, 0],
      anim: 'spin',
      shapes: [tube({ outer: 3.45, inner: 2.85, height: 0.9, segments: 16, at: [0, P + 0.45, 0], mat: 'copper', keep: true, tag: 'ring' })],
    },
    {
      name: 'head',
      pivot: [0, HEAD_Y, 0],
      anim: 'spin',
      shapes: [
        // Raute: unterer Kegel (Eisen), Glutgürtel, oberer Kegel (team), Kupferspitze
        frustum({ radius: 0.7, radiusTop: 1.75, height: 1.3, at: [0, HEAD_Y + 0.65, 0], segments: 12, caps: 'bottom', mat: 'body', keep: true, tag: 'boiler' }),
        cylinder({ radius: 1.8, height: 0.3, at: [0, HEAD_Y + 1.45, 0], segments: 12, caps: false, mat: 'glow', keep: true, tag: 'boiler' }),
        frustum({ radius: 1.75, radiusTop: 0.45, height: 1.8, at: [0, HEAD_Y + 2.5, 0], segments: 12, caps: 'top', mat: 'team', keep: true, tag: 'boiler' }),
        cone({ radius: 0.45, height: 0.6, at: [0, HEAD_Y + 3.7, 0], segments: 8, mat: 'copper', maxLod: 1, tag: 'boiler' }),
        radial(box({ size: [0.9, 0.9, 0.18], at: [1.35, 0, 0], mat: 'body' }), { count: 4, at: [0, HEAD_Y + 2.1, 0], maxLod: 0 }),
      ],
    },
  ],
  notes: 'T4 in Spielgröße. Drei Spin-Parts (Kränze gegenläufig, Pumpenkopf); Glutkern in Bohrloch, Säule, Pumpenkopf-Gürtel und Schlotkronen.',
});
