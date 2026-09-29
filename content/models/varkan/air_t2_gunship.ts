/**
 * Krähe (core:air_t2_gunship) – Varkan-Kampfschweber T2 (Maßstab 1,3 wird beim Export eingebacken).
 *
 * Roster: „Keine Flügel: Ringdüse als Scheibe, darunter Glocke mit Rohr.“ Parts ductfan [team] (yaw), hull,
 * bell (yaw), barrel; 2 Tech-Streifen.
 * Rollen-Monopol Gunship (faction.md §5.2): keine Flügel, `ductfan` + Glocke unten (Scheibenform); verboten: Flügel.
 * Die Glocke mit waagerechtem Rohr ist die Direktfeuer-Signatur (die Krähe ist DIRECTFIRE), sie hängt unter dem
 * Rumpf; das Rohr ragt über den Ringrand hinaus und zeigt so auch von oben die Richtung.
 *
 * Aufbau (Basismaß vor Maßstab, y = Boden, +Z = Bug): Ringdüse Ø 1,0 WU (→ 1,3 WU), Länge 1,48 WU (→ 1,92 WU).
 *   hull   – Ringdüse (Kragen in Teamfarbe + gusseiserne Außenschürze), 2 Tragstreben, Rumpfgondel mit 45°-Fasen,
 *            Sichtschlitz, Heckstummel mit Bannerplatte, 2 Keramik-Tech-Streifen und Glutschlitz
 *   rotor  – Rotor in der Ringdüse: Kupfernabe + 3 breite Blätter (team), anim `spin` um +Y; entfällt in LOD2 (PartStream 1)
 *   turret – Glocke unter der Gondel (Schürze + hängende Kuppel, team), anim `yaw`             (PartStream 2)
 *   barrel – Blende + waagerechtes Rohr + Kupfermündung + Mündungsglut, anim `pitch`         (PartStream 3)
 */
import { beveledBox, box, cylinder, defineModel, frustum, quad, radial, sphere, stripes, tube } from '@faf/modelkit';

const RING_Y = 0.47; // Mitte des Ringkragens
const RING_OUT = 0.5;
const RING_IN = 0.38;
const POD_Y = 0.3;
const POD_TOP = POD_Y + 0.1;
const BELL_Y = 0.2; // Oberkante der Glocke (Pivot)
const BARREL_Y = 0.1;

export default defineModel({
  id: 'core:air_t2_gunship',
  parts: [
    {
      name: 'hull',
      shapes: [
        // Ringdüse: Kragen (team, gesamte Oberseite) + Außenschürze aus Guss darunter
        tube({ outer: RING_OUT, inner: RING_IN, height: 0.09, segments: 10, at: [0, RING_Y, 0], mat: 'team', keep: true, tag: 'ductfan' }),
        frustum({ radius: RING_OUT - 0.01, radiusTop: RING_OUT, height: 0.08, segments: 10, caps: false, at: [0, RING_Y - 0.085, 0], mat: 'body', maxLod: 0, tag: 'ductfan' }),
        // 2 Tragstreben quer (links/rechts) von der Gondel zum Ring – Kupfer: Leitungen zum Rotor (Flow)
        box({ size: [0.84, 0.07, 0.14], at: [0, POD_TOP + 0.01, 0.02], mat: 'copper', keep: true, tag: 'boom' }),
        // Rumpfgondel: Gusskörper mit 45°-Fasen, vorn steil gefast, läuft als Heckstummel hinter den Ring
        beveledBox({
          size: [0.3, 0.2, 1.0],
          at: [0, POD_Y, -0.22],
          bevel: { top: 0.06, topFront: 0.09, topBack: 0.05 },
          mat: 'body',
          keep: true,
          tag: 'hull',
        }),
        // Heckstummel: Bannerplatte (team) + 2 Tech-Streifen (Keramik) + Glutschlitz am Heck
        box({ size: [0.16, 0.012, 0.22], at: [0, POD_TOP + 0.006, -0.46], mat: 'team', maxLod: 1 }),
        stripes({ count: 2, width: 0.16, at: [0, POD_TOP + 0.016, -0.42] }),
        quad({ size: [0.14, 0.03], rot: [-90, 0, 0], at: [0, POD_Y - 0.02, -0.724], mat: 'glow', maxLod: 1 }),
        // Sichtschlitz vorn (Glas, schmales Band über der Bugfase)
        quad({ size: [0.16, 0.04], rot: [45, 0, 0], at: [0, POD_Y + 0.06, 0.26], mat: 'glass', maxLod: 0 }),
      ],
    },
    {
      name: 'rotor',
      pivot: [0, RING_Y, 0],
      anim: 'spin',
      shapes: [
        cylinder({ radius: 0.08, height: 0.08, segments: 6, at: [0, RING_Y + 0.005, 0], caps: 'top', mat: 'copper', maxLod: 1, tag: 'ductfan' }),
        radial(box({ size: [0.3, 0.02, 0.13], at: [0.22, 0, 0], rot: [12, 0, 0], mat: 'team' }), { count: 3, startDeg: 30, at: [0, RING_Y + 0.01, 0], maxLod: 1 }),
      ],
    },
    {
      name: 'turret',
      pivot: [0, BELL_Y, 0.02],
      anim: 'yaw',
      shapes: [
        // Glocke hängend: Schürze (team) + Kuppel nach unten (team)
        frustum({ radius: 0.25, radiusTop: 0.24, height: 0.06, segments: 8, caps: false, at: [0, BELL_Y - 0.03, 0.02], rot: [180, 0, 0], mat: 'team', tag: 'bell' }),
        sphere({ radius: 0.25, hemi: true, segments: 8, rings: 2, scale: [1, 0.55, 1], rot: [180, 0, 0], at: [0, BELL_Y - 0.06 - 0.069, 0.02], mat: 'team', tag: 'bell' }),
      ],
    },
    {
      name: 'barrel',
      parent: 'turret',
      pivot: [0, BARREL_Y, 0.25],
      anim: 'pitch',
      shapes: [
        box({ size: [0.2, 0.12, 0.12], at: [0, BARREL_Y, 0.27], mat: 'body' }),
        // Rohr Ø 0,14 WU (→ 0,18 WU), waagerecht, ragt über den Ringrand (Richtung von oben)
        cylinder({ radius: 0.07, height: 0.5, segments: 6, axis: 'z', at: [0, BARREL_Y, 0.49], caps: 'top', mat: 'dark', keep: true, tag: 'barrel' }),
        cylinder({ radius: 0.088, height: 0.1, segments: 6, axis: 'z', at: [0, BARREL_Y, 0.71], caps: false, mat: 'copper', keep: true, tag: 'barrel' }),
        quad({ size: [0.1, 0.1], rot: [90, 0, 0], at: [0, BARREL_Y, 0.745], mat: 'glow', maxLod: 0 }),
      ],
    },
  ],
  notes: 'Luftgruppe Varkan: Ringdüse mit spin-Rotor, hängende Glocke (yaw) + Rohr (pitch); keine Flügel.',
});
