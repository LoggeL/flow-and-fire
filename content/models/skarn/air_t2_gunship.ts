/**
 * Hummel (f2:air_t2_gunship) – Skarn-Kampfschweber T2 (Maßstab 1,3 wird beim Export eingebacken).
 *
 * Roster: „Keine Flügel: Schwirrscheibe (opak, dunkel gestreift) über dem Rumpf, Granatlinse unten.“ Parts buzzdisc
 * [team] (yaw), carapace [team], lens [sinew] (yaw, Bauchlinse); 2 Tech-Streifen (Quarz).
 * faction.md §5.2 (Gunship): keine Flügel, `buzzdisc` über dem Rumpf + Linse unten; verboten: Flügel.
 * Die Linse hängt waagerecht unter dem Bug (Winkel-Code: waagerecht = direkt) und ragt über den Scheibenrand
 * hinaus, so dass sie auch von oben die Richtung zeigt. Abgrenzung zu Varkans Krähe: Sechseckscheibe statt Ringdüse,
 * Granatlinse statt Glocke mit Rohr, Schwarzchitin-Keil statt Gondel.
 *
 * Aufbau (Basismaß vor Maßstab, y = Boden, +Z = Bug): Scheibe Ø 1,04 WU (→ 1,35 WU), Länge 1,25 WU (→ 1,63 WU).
 *   hull  – dicker, kurzer Sechskant-Rumpf (Rückenplatte team, Bauch Unterseite), Sehnenmast zur Scheibe,
 *           2 Quarz-Tech-Streifen
 *   rotor – Schwirrscheibe: flache Sechseckscheibe (team) mit drei dunklen Speichen und Sehnennabe, anim `spin`
 *                                                                                                 (PartStream 1)
 *   lens  – Hals + gestreckte Granatlinse unter dem Bug, anim `yawpitch`                          (PartStream 2)
 */
import { bipyramid, box, defineModel, disc, radial, stripes, strut, sweep, type Vec2, type Vec3 } from '@faf/modelkit';

const BODY_Y = 0.4;
const TOP: Vec2[] = [
  [1, 0],
  [0.5, 1],
  [-0.5, 1],
  [-1, 0],
];
const BOTTOM: Vec2[] = [
  [-1, 0],
  [-0.45, -0.8],
  [0.45, -0.8],
  [1, 0],
];
// Rumpf: kurz und dick (Hummel), konstantes Stück hinten für die zwei Streifen (z −0,4 … −0,12)
const KEEL: Vec3[] = [
  [0, BODY_Y, -0.56],
  [0, BODY_Y, -0.4],
  [0, BODY_Y, -0.12],
  [0, BODY_Y, 0.2],
  [0, BODY_Y - 0.02, 0.44],
];
const KEEL_R: [number, number][] = [
  [0.1, 0.08],
  [0.27, 0.19],
  [0.27, 0.19],
  [0.29, 0.21],
  [0.07, 0.06],
];
const BODY_TOP = BODY_Y + 0.19;
const DISC_Y = BODY_TOP + 0.11;
const DISC_Z = -0.06;
const LENS_Y = BODY_Y - 0.26;
const LENS_Z = 0.3;

export default defineModel({
  id: 'f2:air_t2_gunship',
  parts: [
    {
      name: 'hull',
      shapes: [
        sweep({ path: KEEL, radius: KEEL_R, profile: TOP, mat: 'team', keep: true, tag: 'carapace' }),
        sweep({ path: KEEL, radius: KEEL_R, profile: BOTTOM, mat: 'underside', keep: true, maxLod: 1, tag: 'carapace' }),
        // Sehnenmast (Vierkant) vom Rücken zur Scheibe
        strut({ from: [0, BODY_TOP - 0.04, DISC_Z], to: [0, DISC_Y - 0.02, DISC_Z], radius: 0.09, radiusEnd: 0.07, caps: false, mat: 'sinew', keep: true, tag: 'buzzdisc' }),
        // 2 Tech-Streifen (Quarz) auf dem flachen Rücken im hinteren Drittel
        stripes({ count: 2, width: 0.24, at: [0, BODY_TOP + 0.005, -0.18], mat: 'quartz', maxLod: 1 }),
      ],
    },
    {
      name: 'rotor',
      pivot: [0, DISC_Y, DISC_Z],
      anim: 'spin',
      shapes: [
        // Schwirrscheibe: opake Sechseckscheibe (team), drei dunkle Speichen, Sehnennabe
        disc({ radius: 0.52, height: 0.06, bevel: 0.02, segments: 6, at: [0, DISC_Y, DISC_Z], mat: 'team', keep: true, tag: 'buzzdisc' }),
        radial(box({ size: [0.38, 0.012, 0.08], at: [0.27, 0, 0], mat: 'underside' }), { count: 3, startDeg: 30, at: [0, DISC_Y + 0.036, DISC_Z], maxLod: 1, tag: 'buzzdisc' }),
        disc({ radius: 0.1, height: 0.05, bevel: 0.015, segments: 6, at: [0, DISC_Y + 0.05, DISC_Z], mat: 'sinew', maxLod: 1, tag: 'buzzdisc' }),
      ],
    },
    {
      name: 'lens',
      pivot: [0, BODY_Y - 0.14, 0.16],
      anim: 'yawpitch',
      shapes: [
        // Hals unter dem Bug + Granatlinse waagerecht, ragt über Bugspitze und Scheibenrand
        strut({ from: [0, BODY_Y - 0.1, 0.12], to: [0, LENS_Y + 0.04, 0.22], radius: 0.09, caps: false, mat: 'sinew', maxLod: 1, tag: 'neck' }),
        bipyramid({ radius: 0.13, length: 0.74, front: 0.62, sides: 4, at: [0, LENS_Y, LENS_Z], mat: 'garnet', keep: true, tag: 'lens' }),
      ],
    },
  ],
  notes: 'Luftgruppe Skarn: Schwirrscheibe (spin) über dem Rumpf, Bauchlinse (yawpitch); keine Flügel.',
});
