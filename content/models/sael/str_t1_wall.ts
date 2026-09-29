/**
 * Deich (f3:str_t1_wall) – Mauer, 1×1.
 *
 * Roster: „Niedrige, gerundete Wulstkette; nur der Kamm teamfarben (≈ 10 %, Maske).“ faction.md §5.2 Deich,
 * §4.2: bewusst ruhig, Teamfarbe nur auf dem gerundeten Kamm. §3.2: keine Fasen, keine rechten Winkel – jedes
 * Segment ist ein Perlmutt-Wulst mit gerundeten Ecken, der den Footprint unten füllt; aneinandergereiht entsteht eine
 * durchgehende Wulstkette mit sanften Sätteln zwischen den Kämmen. Kein Tech-Streifen (Deich trägt keine, §3.4).
 *
 * Budget Mauer 64 / 40 / 24: ein Loft mit 12 Punkten je Ring (LOD0), 8 Punkten (LOD1/2), Kamm als Emaille-Deckel.
 *
 * Aufbau (y = Boden): hull – Wulst (Schalenrinde-Fuß, Perlmutt-Flanke) + Kamm (Emaille).
 */
import { defineModel, loftShape, type Ring } from '@faf/modelkit';
import { roundedRect } from './str_t1_pd.ts';

const HALF = 0.5;
const RC = 0.26;
const TOP = 0.46;
const CREST = 0.335; // Einzug des Kamms: Kamm ≈ 0,33 × 0,33 WU
const ring = (y: number, inset: number, k: number): Ring => ({ y, pts: roundedRect(HALF - inset, HALF - inset, Math.max(0.03, RC - inset), k) });
const sg = { smoothGroup: 'wulst', keep: true, tag: 'shell' } as const;
const open = { bottom: false, top: false };
const crest = { bottom: false, top: true };

export default defineModel({
  id: 'f3:str_t1_wall',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        // LOD0: 12 Punkte, gerundete Flanke in zwei Stufen
        loftShape({ rings: [ring(0, 0, 3), ring(0.26, 0.02, 3), ring(TOP, CREST, 3)], caps: open, mat: 'nacre', maxLod: 0, ...sg }),
        loftShape({ rings: [ring(TOP, CREST, 3)], caps: crest, mat: 'enamel', maxLod: 0, ...sg }),
        // LOD1: 8 Punkte, zwei Stufen
        loftShape({ rings: [ring(0, 0, 2), ring(0.26, 0.02, 2), ring(TOP, CREST, 2)], caps: open, mat: 'nacre', minLod: 1, maxLod: 1, ...sg }),
        // LOD2: 8 Punkte, eine Stufe
        loftShape({ rings: [ring(0, 0, 2), ring(TOP, CREST, 2)], caps: open, mat: 'nacre', minLod: 2, ...sg }),
        // Kamm (Emaille, Teamfarbe) in LOD1/2
        loftShape({ rings: [ring(TOP, CREST, 2)], caps: crest, mat: 'enamel', minLod: 1, ...sg }),
      ],
    },
  ],
  notes: 'v_wall: Wulst mit Emaille-Kamm; Kettenbild entsteht aus den Sätteln zwischen benachbarten Segmenten.',
});
