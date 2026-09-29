/**
 * Myzel (f2:exp_str_eco) – Experimenteller Geflechtknoten, Eco-Plage (T4, Post-MVP).
 *
 * Roster/experimentals.md §7: achteckige Kruste mit gezackter, teamfarbener Oberkante über den ganzen 10 × 10-Footprint;
 * darauf drei konzentrische Netzringe (Herzkern, pulsieren im Herzschlag), in der Mitte eine hohe Druse, vier kleinere
 * im inneren Ring; sechs dunkle Wurzelplatten laufen sternförmig über den Rand hinaus (nur Optik, im Footprint).
 * Maße 10 × 10 × 6 WU. **Monopol:** Ringgeflecht (drei glühende Netzringe, niedrig und breit).
 * **Pflichtpaare:** Myzel ↔ Druse III (Kristallcluster ohne Ring), Myzel ↔ Egel III (doppelter Ring um einen Spot, 2 × 2).
 * **Tech-Marker:** zwei quarzweiße Klammer-Winkel an den vorderen Krustenecken.
 * Glut ist erlaubt (ECONOMIC): Ringgrate und Drusen. Die Netzringe sind Sehnenbänder mit glühendem Grat, damit der
 * Herzkern trotz der großen Fläche kein Glutteppich wird.
 *
 * Gebaut in Spielmaß (Roster ohne `kitbash.scale`). Die Registry liest die Roster-Vorgaben auch aus
 * `experimentals[]`; Name, Rolle, Klasse, Tech, Footprint und Icon stehen zusätzlich im Modell (identisch zum Roster).
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite): nur `hull` (Gebäude, keine animierten Parts; das Pulsieren der
 * Ringe ist View-Emissive über `flowGlow`).
 */
import { crystal, crystalCluster, defineModel, extrude, glyphStrip, group, prism, strut, sweep, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';

const CRUST_H = 0.85; // Oberkante der Kruste
const APOTHEM = 4.5; // Kruste: Achteck, Kanten auf ±4,5 (Wurzeln reichen bis an den Footprint-Rand 5,0)
const R8 = APOTHEM / Math.cos(Math.PI / 8); // Umkreisradius des Achtecks
const EDGE = 2 * R8 * Math.sin(Math.PI / 8);

/** Ecke k des Achtecks (Kanten achsparallel: Ecken bei 22,5° + k·45°, Winkel von +Z nach +X). */
const corner = (k: number, r = R8): Vec3 => {
  const a = ((22.5 + 45 * k) * Math.PI) / 180;
  return [Math.sin(a) * r, 0, Math.cos(a) * r];
};

/**
 * Gezackte Oberkante: je Achteckkante ein teamfarbener Sägezahn-Kamm (extrudiertes Profil, Zacken unregelmäßig),
 * leicht nach außen geneigt. Die Kanten liegen bei Winkel k·45° (von +Z nach +X).
 */
const TEETH: readonly (readonly Vec2[])[] = [
  [
    [-0.5, 0],
    [0.5, 0],
    [0.5, 0.42],
    [0.27, 0.22],
    [0.05, 0.62],
    [-0.2, 0.3],
    [-0.5, 0.5],
  ],
  [
    [-0.5, 0],
    [0.5, 0],
    [0.5, 0.55],
    [0.22, 0.28],
    [-0.02, 0.48],
    [-0.28, 0.2],
    [-0.5, 0.4],
  ],
];
function rimCrest(k: number): Shape {
  const deg = 45 * k;
  const a = (deg * Math.PI) / 180;
  const r = APOTHEM - 0.38;
  const profile = TEETH[k % 2]!.map(([u, v]): Vec2 => [u * EDGE * 0.98, v]);
  const place = { depth: 0.72, axis: 'z' as const, at: [Math.sin(a) * r, CRUST_H - 0.05, Math.cos(a) * r] as Vec3, rot: [0, deg, 0] as Vec3, mat: 'team', keep: true, tag: 'crust' };
  const flat: Vec2[] = [
    [-0.5 * EDGE * 0.98, 0],
    [0.5 * EDGE * 0.98, 0],
    [0.5 * EDGE * 0.98, 0.45],
    [-0.5 * EDGE * 0.98, 0.45],
  ];
  return group([extrude({ ...place, profile, maxLod: 0 }), extrude({ ...place, profile: flat, minLod: 1, maxLod: 1 })]);
}

// Netzringe: flaches Sehnenband (Sechseck) mit glühendem Grat (Decal-Strich je Kante), abwechselnd um 30° verdreht
const RINGS: readonly (readonly [number, number])[] = [
  [1.75, 30],
  [2.75, 0],
  [3.7, 30],
];
const RING_Y = CRUST_H + 0.02;
const BAND: Vec2[] = [
  [1, 0],
  [0.55, 1],
  [-0.55, 1],
  [-1, 0],
];
/** Ecke k eines Sechsecks mit Umkreis r, gedreht um rot Grad (Winkel von +Z nach +X). */
const hexPt = (r: number, rot: number, k: number, y: number): Vec3 => {
  const a = ((rot + 60 * k) * Math.PI) / 180;
  return [Math.sin(a) * r, y, Math.cos(a) * r];
};
function webring([r, rot]: readonly [number, number]): Shape[] {
  const mid = (k: number): Vec3 => {
    const p = hexPt(r, rot, k, RING_Y);
    const q = hexPt(r, rot, k + 1, RING_Y);
    return [(p[0] + q[0]) / 2, RING_Y, (p[2] + q[2]) / 2];
  };
  // geschlossener Pfad, Naht in der Kantenmitte (gleiche Tangente an Anfang und Ende)
  const path: Vec3[] = [mid(0), ...[1, 2, 3, 4, 5, 6].map((k) => hexPt(r, rot, k, RING_Y)), mid(0)];
  const ridge: Vec3[] = [0, 1, 2, 3, 4, 5, 6].map((k) => hexPt(r, rot, k, RING_Y + 0.22));
  const edge = r; // Kantenlänge des Sechsecks = Umkreisradius
  return [
    sweep({ path, radius: [[0.3, 0.22]], profile: BAND, caps: false, mat: 'sinew', keep: true, maxLod: 1, tag: 'webring' }),
    glyphStrip({ path: ridge, width: 0.2, pattern: [edge - 0.001, -0.001], widths: [1], lift: 0.004, mat: 'glow', keep: true, tag: 'webring' }),
  ];
}
// Speichen: sechs Sehnenstränge verbinden die Ringe zum Geflecht
const SPOKES: Shape[] = [0, 60, 120, 180, 240, 300].map((deg) => {
  const a = ((deg + 30) * Math.PI) / 180;
  return strut({ from: [Math.sin(a) * 1.1, RING_Y + 0.08, Math.cos(a) * 1.1], to: [Math.sin(a) * 3.8, RING_Y + 0.08, Math.cos(a) * 3.8], radius: 0.16, sides: 3, caps: false, mat: 'sinew', maxLod: 0, tag: 'webring' });
});

// Drusen: eine hohe in der Mitte (Spitze auf 6 WU), vier kleinere auf dem inneren Ring
const MOUND_TOP = CRUST_H + 0.7;
const CENTER: Shape[] = [
  prism({ sides: 6, radius: 1.05, height: 0.7, at: [0, CRUST_H + 0.35, 0], mat: 'crust', keep: true, tag: 'crust' }),
  // Herzdruse: ein hoher Glutkristall, flankiert von zwei dunklen Granatkristallen (hält den Herzkern-Anteil klein)
  crystalCluster({ count: 1, radius: 0.56, height: 3.85, sides: 6, at: [0, MOUND_TOP, 0], mat: 'glow', keep: true, tag: 'druse' }),
  crystal({ radius: 0.4, height: 2.0, sides: 6, at: [0.62, MOUND_TOP + 1.2, 0.18], rot: [8, 0, -20], mat: 'garnet', keep: true, maxLod: 1, tag: 'druse' }),
  crystal({ radius: 0.36, height: 1.6, sides: 6, at: [-0.55, MOUND_TOP + 1.0, -0.3], rot: [-12, 0, 18], mat: 'garnet', keep: true, maxLod: 1, tag: 'druse' }),
];
const SMALL: Shape[] = [45, 135, 225, 315].flatMap((deg, i) => {
  const a = (deg * Math.PI) / 180;
  const at: Vec3 = [Math.sin(a) * 1.75, RING_Y + 0.05, Math.cos(a) * 1.75];
  return [
    crystalCluster({ count: 2, radius: 0.3, height: 1.3, spread: 0.3, lean: 22, seed: 3 + i, sides: 4, at, mat: 'glow', keep: true, maxLod: 0, tag: 'druse' }),
    crystalCluster({ count: 1, radius: 0.34, height: 1.25, sides: 4, at, mat: 'glow', keep: true, minLod: 1 }),
  ];
});

// Wurzelplatten: sechs flache Sehnen-Keile sternförmig unter der Kruste hervor über den Rand
const ROOT_PROFILE: Vec2[] = [
  [1, 0],
  [0.4, 0.8],
  [-0.4, 0.8],
  [-1, 0],
  [0, -0.4],
];
const ROOTS: Shape[] = [30, 90, 150, 210, 270, 330].flatMap((deg) => {
  const a = (deg * Math.PI) / 180;
  const dir = (r: number, y: number): Vec3 => [Math.sin(a) * r, y, Math.cos(a) * r];
  // Spitze bis an den Footprint-Rand (|x|, |z| ≤ 5)
  const reach = Math.min(5 / Math.max(Math.abs(Math.sin(a)), Math.abs(Math.cos(a))), 5.75) - 0.05;
  const path = [dir(3.3, 0.55), dir(APOTHEM + 0.15, 0.26), dir(reach, 0.05)];
  const radius: [number, number][] = [
    [1.05, 0.3],
    [0.78, 0.22],
    [0.12, 0.04],
  ];
  return [
    sweep({ path, radius, profile: ROOT_PROFILE, mat: 'sinew', keep: true, maxLod: 0, tag: 'carapace' }),
    sweep({ path: [path[0]!, path[2]!], radius: [radius[0]!, radius[2]!], profile: ROOT_PROFILE, mat: 'sinew', keep: true, minLod: 1 }),
  ];
});

/** Klammer-Winkel (Quarz) an einer vorderen Krustenecke: flaches L auf der Krustenoberseite. */
function bracket(side: 1 | -1): Shape {
  const w = 0.28;
  const profile: Vec2[] = [
    [0, 0],
    [0, 0.9],
    [-side * 0.75, 0.9],
    [-side * 0.75, 0.9 - w],
    [-side * w, 0.9 - w],
    [-side * w, 0],
  ];
  const c = corner(side === 1 ? 0 : 7, R8 - 0.95);
  return extrude({
    profile: side === 1 ? profile : profile.slice().reverse(),
    depth: 0.05,
    axis: 'y',
    at: [c[0], CRUST_H + 0.03, c[2] - 0.35],
    rot: [0, side * 22.5, 0],
    mat: 'quartz',
    keep: true,
    maxLod: 1,
    tag: 'techmarker',
  });
}

export default defineModel({
  id: 'f2:exp_str_eco',
  name: 'Myzel',
  role: 'Experimenteller Geflechtknoten',
  class: 'struct',
  tech: 4,
  footprint: [10, 10],
  icon: 'struct_mass_t4',
  parts: [
    {
      name: 'hull',
      shapes: [
        // Kruste: Achteck-Prisma (Krustengrau), Kanten achsparallel
        prism({ sides: 8, radius: R8, height: CRUST_H, at: [0, CRUST_H / 2, 0], mat: 'crust', keep: true, tag: 'crust' }),
        // LOD2: teamfarbener Krustendeckel statt der Zackenkämme
        prism({ sides: 8, radius: R8 - 0.05, height: 0.16, at: [0, CRUST_H + 0.02, 0], mat: 'team', minLod: 2 }),
        ...[0, 1, 2, 3, 4, 5, 6, 7].map(rimCrest),
        ...RINGS.flatMap((r) => webring(r)),
        ...SPOKES,
        ...CENTER,
        ...SMALL,
        ...ROOTS,
        bracket(1),
        bracket(-1),
      ],
    },
  ],
  notes:
    'Plage (T4), Eco: nur hull (Gebäude). Netzringe = Sehnenband + Glutgrat, Drusen Glut (ECONOMIC). ' +
    'Nicht in roster.units[] (experimentals[]), deshalb Name/Rolle/Klasse/Tech/Footprint/Icon im Modell.',
});
