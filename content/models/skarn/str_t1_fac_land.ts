/**
 * Landnest I (f2:str_t1_fac_land) – Skarn-Landfabrik T1 auf 8×8; Grundform aller Nester (`nestParts`, auch für die
 * Luftnester).
 *
 * Roster: „Nestmaul (V-Portal, offene Spitze = Ausgang) mit Rampe auf gezackter Kruste; Nestkern glüht.“
 * faction.md §5.2 Fabrik: Nestmaul (V-Portal, offene Spitze = Ausgang), Land mit Rampe, Luft mit Landenetz (Netzring
 * flach), Nestmaul = Herzkern. Strukturen: Teamfarbe auf der Krustenoberkante, bei Nestern zusätzlich die
 * Maulplatten (20–30 % der Draufsicht). In-Place-Upgrades (II/III) wachsen nur in der Höhe (Roster y 1,2 / 1,4) und
 * bekommen Brutspule (II), zweiten Nestkern und Seitenplatten (III).
 *
 * Aufbau (y = Boden, +Z = Ausgang), alles statisch (hull):
 *   Kruste (Krustengrau, gezackte Teamkante; Land: vorn gekappt für die Rampe, Kamm dort versenkt), Nestmaul aus zwei
 *   schrägen Keilplatten (Team), die von den hinteren Ecken zur offenen Spitze vorn zusammenlaufen (von oben ein V),
 *   Nackenpanzer (Chitin) schließt das V hinten, dunkler Schlundboden, Nestkern (Druse, Glutkern) im Schlund,
 *   Tech-Streifen (Quarz) rechts neben dem Maul; Land: Chitin-Rampe vorn; Luft: flaches Landenetz (Sehne) vor dem
 *   Maul; II/III: Brutspule quer auf dem Nackenpanzer (Sehne, Team-Randscheiben, Glutachse); III: zweiter Nestkern,
 *   Seitenplatten (Chitin) an den hinteren Diagonalflanken der Kruste.
 */
import {
  cylinder,
  defineModel,
  extrude,
  flipX,
  plate,
  stripes,
  strut,
  sweep,
  wedge,
  type PartDef,
  type Shape,
  type Vec2,
  type Vec3,
} from '@faf/modelkit';
import { crust, druse, webRing } from './str_t1_mex.ts';

const H = 0.35; // Krustenhöhe
const RAMP_Z = 2.4; // Vorderkante der Kruste beim Landnest (davor die Rampe)

/** Grundriss Landnest: Achteck, vorn bei z = RAMP_Z gekappt (Winkel aufsteigend von +X nach +Z). */
const LAND_OUTLINE: Vec2[] = [
  [3.95, -2.75],
  [3.95, 1.6],
  [3.15, RAMP_Z],
  [-3.15, RAMP_Z],
  [-3.95, 1.6],
  [-3.95, -2.75],
  [-2.75, -3.95],
  [2.75, -3.95],
];

/** Querschnitt einer Maulplatte (u = nach innen, v = oben): Innenlippe hängt über den Schlund, Grat, Außenschulter. */
const JAW: Vec2[] = [
  [-0.55, 0],
  [0.45, 0],
  [0.8, 1.25],
  [0.25, 2.05],
  [-0.3, 1.4],
];
/** Linke Maulplatte (+X): hinten hoch, vorn zur Fangspitze verjüngt. */
const JAW_PATH: Vec3[] = [
  [2.85, H, -3.25],
  [2.0, H, -0.8],
  [1.2, H, 1.75],
];
const JAW_R: [number, number][] = [
  [1, 1.1],
  [0.95, 1.0],
  [0.55, 0.5],
];

/** Nackenpanzer: flacher Keil quer über dem hinteren Ende des V (u = hinten/vorn, v = oben). */
const NAPE: Vec2[] = [
  [1, 0],
  [0.45, 0.85],
  [-0.2, 1],
  [-0.8, 0.55],
  [-1, 0],
];
const NAPE_Y = H;
const SPOOL: Vec3 = [0, H + 1.3, -3.15];

export function nestParts(tech: 1 | 2 | 3, kind: 'land' | 'air'): PartDef[] {
  const hull: Shape[] = [];
  if (kind === 'land') {
    hull.push(
      ...crust({ radius: 4.27, outline: LAND_OUTLINE, height: H, crest: { lo: 0.14, hi: 0.7, width: 0.28 }, crestGapZ: 1.9, crestMids: false, crestMaxLod: 1, seed: 61 }),
      // Rampe (Chitin): von der Krustenkante bis zum Boden, mit Sehnen-Kanten
      wedge({ size: [3.0, H, 1.6], at: [0, H / 2, RAMP_Z + 0.75], mat: 'chitin', keep: true, tag: 'carapace' }),
      ...[1.5, -1.5].map((x) =>
        strut({ from: [x, H + 0.02, RAMP_Z - 0.3], to: [x, 0.03, RAMP_Z + 1.55], radius: 0.1, sides: 3, caps: false, mat: 'sinew', maxLod: 0, tag: 'carapace' }),
      ),
    );
  } else {
    hull.push(
      ...crust({ radius: 4.27, height: H, crest: { lo: 0.14, hi: 0.7, width: 0.28 }, crestMids: false, crestMaxLod: 1, seed: 67 }),
      // Landenetz (Sehne): flacher Sechseck-Ring vor dem Maul mit drei Speichen
      webRing({ radius: 1.05, width: 0.26, height: 0.12, y: H + 0.04, at: [0, 0, 2.55], mat: 'sinew', section: 'tri', maxLod: 0 }),
      webRing({ radius: 1.05, width: 0.26, height: 0.1, y: H, at: [0, 0, 2.55], mat: 'sinew', section: 'ridge', minLod: 1 }),
      ...[0, 60, 120].map((a) => {
        const t = (a * Math.PI) / 180;
        const d: Vec3 = [0.98 * Math.cos(t), 0, 0.98 * Math.sin(t)];
        return strut({ from: [d[0], H + 0.04, 2.55 + d[2]], to: [-d[0], H + 0.04, 2.55 - d[2]], radius: 0.07, sides: 3, caps: false, mat: 'sinew', maxLod: 0, tag: 'webring' });
      }),
    );
  }
  // Maulplatten (Team); LOD1/2 als gerader, verjüngter Keil aus zwei Querschnitten
  const jaw = sweep({ path: JAW_PATH, radius: JAW_R, profile: JAW, mat: 'team', keep: true, maxLod: 0, tag: 'gate' });
  const jawLo = sweep({ path: [JAW_PATH[0]!, JAW_PATH[2]!], radius: [JAW_R[0]!, JAW_R[2]!], profile: JAW, mat: 'team', keep: true, minLod: 1, tag: 'gate' });
  const nape = {
    path: [
      [-2.7, NAPE_Y, -3.2],
      [0, NAPE_Y, -3.2],
      [2.7, NAPE_Y, -3.2],
    ] as Vec3[],
    radius: [
      [0.7, 0.9],
      [0.8, 1.2],
      [0.7, 0.9],
    ] as [number, number][],
    profile: NAPE,
    mat: 'chitin',
    keep: true,
    tag: 'carapace',
  };
  hull.push(
    jaw,
    flipX(jaw),
    jawLo,
    flipX(jawLo),
    // Nackenpanzer quer über dem hinteren Ende des V (Chitin); LOD1 aus zwei Querschnitten, LOD2 ohne
    sweep({ ...nape, maxLod: 0 }),
    sweep({ ...nape, path: [nape.path[0]!, nape.path[2]!], radius: [[0.8, 1.1], [0.8, 1.1]], minLod: 1, maxLod: 1 }),
    // Schlundboden (dunkel) zwischen den Maulplatten
    extrude({
      profile: [
        [2.3, -2.6],
        [1.55, 1.9],
        [-1.55, 1.9],
        [-2.3, -2.6],
      ],
      depth: 0.03,
      axis: 'y',
      at: [0, H + 0.015, 0],
      mat: 'underside',
      maxLod: 0,
      tag: 'gate',
    }),
    stripes({ count: tech, width: 0.55, at: [-3.25, H + 0.004, -0.2], mat: 'quartz', maxLod: 1 }),
  );
  // Nestkern(e) im Schlund
  const cores: Vec3[] = tech === 3 ? [[0.75, H, -1.9], [-0.75, H, -1.5]] : [[0, H, -1.9]];
  cores.forEach((at, i) =>
    hull.push(
      ...druse({ at, radius: 0.36, height: 1.35, spread: 0.44, lean: 26, count: i === 0 ? 3 : 2, seed: 71 + i * 6, outer: 'garnet', sides: tech === 3 ? 5 : 6, outerSides: 4, maxLod: i === 0 ? 2 : 1 }),
    ),
  );
  if (tech >= 2) {
    // Brutspule quer auf dem Nackenpanzer: Sehnen-Wickel, Team-Randscheiben, Glutachse
    hull.push(
      cylinder({ radius: 0.36, height: 2.0, axis: 'x', segments: 6, caps: false, at: SPOOL, mat: 'sinew', maxLod: 0, tag: 'spool' }),
      cylinder({ radius: 0.62, height: 0.2, axis: 'x', segments: 6, at: [1.05, SPOOL[1], SPOOL[2]], mat: 'team', keep: true, maxLod: 0, tag: 'spool' }),
      cylinder({ radius: 0.62, height: 0.2, axis: 'x', segments: 6, at: [-1.05, SPOOL[1], SPOOL[2]], mat: 'team', keep: true, maxLod: 0, tag: 'spool' }),
      cylinder({ radius: 0.16, height: 2.5, axis: 'x', segments: 3, caps: false, at: SPOOL, mat: 'glow', keep: true, maxLod: 0, tag: 'spool' }),
      // LOD1/2: ein Team-Block
      cylinder({ radius: 0.55, height: 2.3, axis: 'x', segments: 6, at: SPOOL, mat: 'team', keep: true, minLod: 1, tag: 'spool' }),
    );
  }
  if (tech === 3) {
    // Seitenplatten: zwei Chitinschilde lehnen an den hinteren Diagonalflanken der Kruste
    for (const a of [225, 315]) {
      const t = (a * Math.PI) / 180;
      hull.push(
        plate({
          size: [1.7, 0.7],
          thickness: 0.1,
          arch: 0.08,
          point: 0.3,
          segments: [1, 1],
          at: [4.45 * Math.cos(t), 0.26, 4.45 * Math.sin(t)],
          rot: [-50, 270 - a, 0],
          mat: 'chitin',
          maxLod: 0,
          tag: 'carapace',
        }),
      );
    }
  }
  return [{ name: 'hull', shapes: hull }];
}

export default defineModel({
  id: 'f2:str_t1_fac_land',
  parts: nestParts(1, 'land'),
  notes: 'Grundform v_fac_land/v_fac_air (nestParts): Nestmaul als V aus zwei Maulplatten, Rampe bzw. Landenetz.',
});
