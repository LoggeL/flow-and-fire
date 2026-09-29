/**
 * Mauer (core:str_t1_wall) – Mauerstück 1×1 (Drag-Linie).
 *
 * Roster: „Niedriger Quader, nur die Oberkante teamfarben (≈ 10 %).“ Gusseisenblock mit 45°-Oberfasen, eine flache
 * Teamfarben-Kappe auf der Oberkante. Keine Tech-Streifen (faction.md §3.4), kein Kupfer, keine Glut (bewusst ruhig).
 * Budget-Klasse wall: 64 / 40 / 24 Tris. Die Kante füllt den Footprint vollständig, damit Ketten lückenlos stehen.
 */
import { beveledBox, box, defineModel, tube } from '@faf/modelkit';

const H = 0.46;

export default defineModel({
  id: 'core:str_t1_wall',
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [1.0, H, 1.0], at: [0, H / 2, 0], bevel: { top: 0.14 }, mat: 'body', tag: 'hull' }),
        // Teamfarben-Oberkante: schmaler Rahmen an der Kante der Deckfläche (≈ 10 % der Draufsicht, faction.md §4.2)
        tube({ outer: 0.31 * Math.SQRT2, inner: 0.26 * Math.SQRT2, height: 0.03, segments: 4, at: [0, H + 0.015, 0], mat: 'team', keep: true, maxLod: 0, tag: 'hull' }),
        // LOD1/2: kleine Kappe gleicher Fläche (Budget 40 / 24)
        box({ size: [0.34, 0.03, 0.34], at: [0, H + 0.015, 0], mat: 'team', keep: true, minLod: 1, tag: 'hull' }),
      ],
    },
  ],
});
