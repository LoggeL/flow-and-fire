/**
 * Prior (f3:cmd_commander) – Sael-Kommandant. **Referenzmodell für Sael-Autoren.**
 *
 * Roster: „Schwebender Kegelrock (Höhe ≥ 2,4 WU, Rockbreite ≥ 2,0 WU) mit drei teamfarbenen Bahnen, Brustschale,
 * größte Perle als Kopf; goldene Halo-Sichel hinter dem Kopf (stärkster Goldkern der Armee), Lanze mittig waagerecht
 * vor der Brust; kein Waffen-/Bauarm-Schema, keine Beine.“
 * faction.md §3.2/§5.2: Rund = Körper, Spitz = Waffe; keine Fasen, keine rechten Winkel; Schwebeteller überragt den
 * Rock um 8–12 % (Schattensaum); Teamfarbe ≥ 35 % der Draufsicht (drei Rockbahnen, Brustschale, Perle); Gold bis
 * 20 %; Goldkern nur an der Halo-Sichel; Jade-Lichtnaht ≤ 2 % am Tellerrand hinten.
 *
 * Kit-Muster für Sael: `smooth: true` pro Part (weiche Normalen), Schweben über die Roster-Schwebehöhe (das Modell
 * steht mit dem Teller auf y = 0, der Build hebt es um `hover` = 0,25 WU an), `disc` (Schwebeteller), `sweep` mit
 * Tortenstück-Profil (Rockbahnen bündig in der Rockfläche), `ellipsoid` mit `half` (Brustschale), `torusArc`
 * (asymmetrische Sichel mit Spitze), `glyphStrip` als Lichtnaht. Der Rock besteht aus sechs offenen `sweep`-Bahnen
 * (`open: true`, Bogenprofil) mit gemeinsamer `smoothGroup`: ein glatter Rock, Teamfarbe bündig in der Fläche,
 * keine verdeckten Innenwände.
 *
 * Aufbau (y = Boden vor dem Anheben, +Z = vorn, +X = linke Seite):
 *   hull  – Schwebeteller (Tiefjade), Kegelrock aus sechs Bahnen (3 × Team, 3 × Perlmutt), Torso, Brustschale (Team),
 *           Lichtnaht
 *   head  – Kopfperle (Team) mit Halo-Sichel (Goldkern); dreht um +Y            (PartStream 1, yaw)
 *   lance – goldene Lanze mittig vor der Brust, kippt (Pitch)                   (PartStream 2)
 */
import { arcPoints, cone, defineModel, disc, ellipsoid, glyphStrip, sphere, sweep, torusArc, type Vec2, type Vec3 } from '@faf/modelkit';

const PAD_R = 1.1; // Schwebeteller: 10 % über den Rocksaum hinaus
const PAD_H = 0.12;
const SKIRT_Y0 = PAD_H;
const SKIRT_Y1 = 1.34;
const HEM_R = 1.0; // Rockbreite 2,0 WU
const WAIST_R = 0.3;
const TORSO_Y = 1.62;
const HEAD_Y = 2.38;
const LANCE_Y = 1.64;

/** Bogenprofil einer Rockbahn (60°) um den Winkel `mid` (Grad, von +X nach +Z). */
function sector(mid: number, points: number): Vec2[] {
  const half = 30;
  const pts: Vec2[] = [];
  for (let i = 0; i < points; i++) {
    const a = ((mid - half + (2 * half * i) / (points - 1)) * Math.PI) / 180;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  return pts;
}

/** Kegelrock aus sechs Bahnen; Teambahnen vorn (90°) und hinten seitlich (210°, 330°). */
function skirt(points: number, lod: { readonly maxLod?: 0 | 1 | 2; readonly minLod?: 0 | 1 | 2 }) {
  return [30, 90, 150, 210, 270, 330].map((mid) =>
    sweep({
      ...lod,
      path: [
        [0, SKIRT_Y0, 0],
        [0, SKIRT_Y1, 0],
      ],
      radius: [
        [HEM_R, HEM_R],
        [WAIST_R, WAIST_R],
      ],
      profile: sector(mid, points),
      open: true, // einseitige Bahn: unten liegt der Teller, oben schließt der Torso, innen sieht niemand hin
      smoothGroup: 'skirt', // gemeinsame Normalen über die Bahngrenzen: ein glatter Rock
      mat: mid === 90 || mid === 210 || mid === 330 ? 'enamel' : 'nacre',
      keep: true,
      tag: 'shell',
    }),
  );
}

const SEAM: Vec3[] = arcPoints(PAD_R - 0.1, 200, 340, 6, 'y', [0, PAD_H + 0.001, 0]);

export default defineModel({
  id: 'f3:cmd_commander',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        // Schwebeteller mit gerundetem Rand (Schattensaum)
        disc({ radius: PAD_R, height: PAD_H, bevel: PAD_H / 2, segments: 10, at: [0, PAD_H / 2, 0], mat: 'jade', keep: true, tag: 'hoverpad' }),
        ...skirt(4, { maxLod: 0 }),
        ...skirt(3, { minLod: 1 }),
        // Torso: stehendes Ellipsoid über dem Rockansatz
        ellipsoid({ radii: [0.44, 0.5, 0.38], segments: 10, rings: 4, at: [0, TORSO_Y, 0], mat: 'nacre', keep: true, tag: 'shell' }),
        // Brustschale (Emaille, Teamfarbe): Halbschale nach vorn gewölbt
        ellipsoid({ radii: [0.34, 0.14, 0.32], half: true, axis: 'z', segments: 10, rings: 2, at: [0, TORSO_Y + 0.04, 0.3], mat: 'enamel', keep: true, tag: 'shell' }),
        // Jade-Lichtnaht am hinteren Tellerrand (≤ 2 %)
        glyphStrip({ path: SEAM, width: 0.06, pattern: [0.24, -0.14], widths: [1], mat: 'seam', maxLod: 0, tag: 'seam' }),
      ],
    },
    {
      name: 'head',
      pivot: [0, TORSO_Y + 0.4, 0],
      anim: 'yaw',
      smooth: true,
      shapes: [
        // Kopfperle: größte Perle der Armee (Teamfarbe)
        sphere({ radius: 0.3, segments: 10, rings: 4, at: [0, HEAD_Y, 0], mat: 'enamel', keep: true, tag: 'orb' }),
        // Halo-Sichel hinter dem Kopf: asymmetrisch (rechts offen, links spitz), stärkster Goldkern
        torusArc({
          radius: 0.54,
          tube: 0.13,
          arc: 200,
          startDeg: 160,
          segments: 7,
          sides: 4,
          flatten: 0.8,
          taper: 0.2,
          axis: 'z',
          at: [0, HEAD_Y, -0.24],
          mat: 'light',
          keep: true,
          tag: 'sickle',
        }),
      ],
    },
    {
      name: 'lance',
      parent: 'head',
      pivot: [0, LANCE_Y, 0.34],
      anim: 'pitch',
      smooth: true,
      shapes: [
        // Lanze: spitzer Goldkegel, waagerecht mittig vor der Brust
        cone({ radius: 0.1, height: 1.24, segments: 6, axis: 'z', at: [0, LANCE_Y, 0.36 + 0.62], mat: 'gold', keep: true, tag: 'lance' }),
      ],
    },
  ],
  notes: 'v_cmd: Kopfperle-Yaw mit Halo, Lanzen-Pitch (2 animierte Parts, faction.md §3.3). Schwebehöhe aus dem Roster.',
});
