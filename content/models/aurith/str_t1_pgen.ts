/**
 * Resonator I (f4:str_t1_pgen) – Aurith-Kraftwerk T1; Grundform der Resonator-Familie (II/III importieren
 * `pgenParts`).
 *
 * Roster: „Dreipass-Sockel mit einem stehenden Kristall (Zahl der Kristalle = Tech, Höhe ≥ 1,5 × Sockel-Ø); keine
 * Pfeifen.“ faction.md §5.2 Resonator: 1–3 stehende Kristalle; Paartests Stimmstock↔Resonator (niedriger Reif gegen
 * hohe Spitze), Resonator↔Lichtkammer (Spitze gegen flache Linsen).
 * Resonanzkern §3.5: blauweißer Kern mit Amber-Rand – jeder Kristall wächst aus einer bauchigen Bernstein-Knospe
 * (weich), nur der obere Teil leuchtet; Glyphenband läuft die Knospe hinauf.
 *
 * Aufbau (y = Boden, +Z = vorn): nur `hull` (Kraftwerke bewegen sich nicht)
 *   Dreipass-Sockel 2×2 (team/Bernstein), je Tech-Stufe eine Kristall-Säule (Bernstein-Knospe + Resonanzkristall),
 *   Tonpunkte Perlglas hinten. II/III: Maßstab 3,0 / 4,0 aus dem Roster (Neubau 6×6 / 8×8), Säulen nach außen geneigt.
 */
import { crystal, defineModel, glyphStrip, group, sweep, type PartDef, type Shape, type Vec3 } from '@faf/modelkit';
import { dreipass, MEX_SOCKET, socketY, tonpunkte } from './str_t1_mex.ts';

const SOCKET = MEX_SOCKET;

/** Eine Kristall-Säule im lokalen Raum (Fuß bei y = 0). */
function spire(k: number): Shape[] {
  const bud: Vec3[] = [
    [0, -0.06, 0],
    [0, 0.34 * k, 0],
    [0, 0.7 * k, 0],
    [0, 0.94 * k, 0],
  ];
  const R = [0.19, 0.25, 0.22, 0.14].map((r) => r * Math.sqrt(k));
  // Flächenmitte der Sechskant-Knospe vorn links (60°), knapp über der Fläche
  const fx = Math.cos(Math.PI / 3);
  const fz = Math.sin(Math.PI / 3);
  const apo = Math.cos(Math.PI / 6);
  return [
    // Bernstein-Knospe: bauchig, oben geschlossen, weich (LOD2: Dreikant)
    sweep({ path: bud, radius: R, sides: 6, caps: 'end', up: [0, 0, 1], mat: 'amber', smooth: true, keep: true, maxLod: 1, tag: 'crystal' }),
    sweep({ path: [bud[0]!, bud[2]!, bud[3]!], radius: [R[0]!, R[2]!, R[3]!], sides: 3, caps: 'end', up: [0, 0, 1], mat: 'amber', smooth: true, keep: true, minLod: 2, tag: 'crystal' }),
    // Resonanzkristall wächst oben aus der Knospe (LOD1 vier-, LOD2 dreikantig)
    ...([
      [6, { maxLod: 0 as const }],
      [4, { minLod: 1 as const, maxLod: 1 as const }],
      [3, { minLod: 2 as const }],
    ] as const).map(([sides, lod]) =>
      crystal({ radius: 0.12 * Math.sqrt(k), height: 0.62 * k, tip: 0.3 * k, sides, at: [0, 0.94 * k - 0.1 + (0.62 * k + 0.3 * k) / 2, 0], mat: 'phase', keep: true, tag: 'crystal', ...lod }),
    ),
    // Glyphenband vorn die Knospe hinauf
    glyphStrip({
      path: bud.slice(1).map((p, i): Vec3 => [fx * R[i + 1]! * apo, p[1], fz * R[i + 1]! * apo]),
      normal: [fx, 0.15, fz],
      width: 0.06,
      pattern: [0.16, -0.05, 0.06, -0.05, 0.2, -0.08],
      mat: 'glyph',
      maxLod: 0,
      tag: 'glyphs',
    }),
  ];
}

export function pgenParts(tech: 1 | 2 | 3): PartDef[] {
  const shapes: Shape[] = [...dreipass(SOCKET), ...tonpunkte(tech, -0.7, (x, z) => socketY(SOCKET, x, z))];
  if (tech === 1) {
    shapes.push(group(spire(1), { at: [0, socketY(SOCKET, 0, 0), 0] }));
  } else if (tech === 2) {
    for (const s of [1, -1]) {
      const x = 0.3 * s;
      shapes.push(group(spire(0.9), { at: [x, socketY(SOCKET, x, 0.05) - 0.02, 0.05], rot: [0, 0, -9 * s] }));
    }
  } else {
    // Dreieck um 105° gedreht, weit gestellt und gestuft (Orgelprospekt, die vordere Säule am höchsten): aus der
    // Spielkamera (Azimut 0°) wie aus der Silhouetten-/Schrägansicht (30–35°) stehen alle drei Spitzen frei über dem
    // Sockel (Zahl = Tech). Bei 90/210/330° und gleicher Höhe verdeckte die vordere Säule eine hintere.
    for (const [a, k] of [
      [105, 0.92],
      [225, 0.64],
      [345, 0.78],
    ] as const) {
      const r = (a * Math.PI) / 180;
      const x = 0.6 * Math.cos(r);
      const z = 0.6 * Math.sin(r) - 0.03;
      // nach außen geneigt: Kippung um die Tangente
      shapes.push(group(spire(k), { at: [x, socketY(SOCKET, x, z) - 0.02, z], rot: [9 * Math.sin(r), 0, -9 * Math.cos(r)] }));
    }
  }
  return [{ name: 'hull', shapes }];
}

export default defineModel({
  id: 'f4:str_t1_pgen',
  parts: pgenParts(1),
  notes: 'Grundform v_pgen: ein Kristall; II/III Neubau mit 2/3 Kristallen (Roster-Maßstab 3,0/4,0).',
});
