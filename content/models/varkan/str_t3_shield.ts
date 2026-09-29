/**
 * Schirm III (core:str_t3_shield) – Schildgenerator T3, 6×6 (Roster-Maßstab xz 1,0 / y 1,17; Upgrade von Schirm II).
 *
 * Roster: „Schirm auf 6×6 (Höhe ×1,4/1,2) mit zweitem Ring und Schürze, 3 Tech-Streifen; kein Schlot.“
 * Gleiche Grundform wie Schirm II (Sockel, Generator-Kessel, Mast, waagerechter Team-Ring als höchster Punkt);
 * T3 = zweiter, kleinerer Ring (statisch, Kupfer) auf halber Masthöhe, Schürzenplatten, 3 Kerben, höher.
 *
 * Aufbau (Basis-Maße vor y ×1,17, y = Boden, +Z = vorn):
 *   hull – Fuß, Sockel mit Randband, Schürzenplatten, Kessel mit Glutschlitzen, Mast, zweiter Ring (statisch,
 *          Kupfer – ersetzt die Eckleitungen von Schirm II) mit Speichen, 3 Tech-Kerben
 *   ring – Emitter-Ring (Team, Ø 5,0) mit Nabe und Speichenkreuz; dreht um +Y (PartStream 1)
 */
import { beveledBox, box, cylinder, defineModel, frustum, mirrorX, quad, stripes, torus } from '@faf/modelkit';

const TOP = 0.36; // Sockeldach
const BOILER_R = 0.95;
const BOILER_H = 1.0;
const MAST_TOP = 3.4;
const RING_R = 2.5;
const RING2_R = 1.9;
const RING2_Y = 2.55;

export default defineModel({
  id: 'core:str_t3_shield',
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [5.96, 0.12, 5.96], at: [0, 0.06, 0], bevel: { top: 0.05 }, mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({ size: [5.76, TOP, 5.76], at: [0, TOP / 2, 0], bevel: { top: 0.14 }, mat: 'body', tag: 'hull' }),
        // Randband (Teamfarbe) = Team-Platte + eingelegtes Eisendeck (24 Tris statt 32 für einen Rahmen)
        box({ size: [5.44, 0.04, 5.44], at: [0, TOP + 0.02, 0], mat: 'team', tag: 'hull' }),
        box({ size: [4.6, 0.04, 4.6], at: [0, TOP + 0.03, 0], mat: 'body', tag: 'hull' }),
        // stehender Generator-Kessel (rund = Technik) mit Kupferband und flachem Deckel
        cylinder({ radius: BOILER_R, height: BOILER_H, at: [0, TOP + BOILER_H / 2, 0], segments: 8, caps: false, mat: 'body', tag: 'boiler' }),
        frustum({ radius: BOILER_R, radiusTop: 0.3, height: 0.4, at: [0, TOP + BOILER_H + 0.2, 0], segments: 8, caps: false, mat: 'body', tag: 'boiler' }),
        // Glutnähte: zwei schmale Lüftungsschlitze am Kessel (vorn/hinten)
        quad({ size: [0.5, 0.06], at: [0, TOP + 0.3, BOILER_R * 0.93 + 0.01], rot: [90, 0, 0], mat: 'glow', maxLod: 0 }),
        quad({ size: [0.5, 0.06], at: [0, TOP + 0.3, -BOILER_R * 0.93 - 0.01], rot: [-90, 0, 0], mat: 'glow', maxLod: 0 }),
        // Mast
        cylinder({ radius: 0.24, height: MAST_TOP - (TOP + BOILER_H + 0.34), at: [0, (MAST_TOP + TOP + BOILER_H + 0.34) / 2, 0], segments: 6, caps: false, mat: 'dark', keep: true, tag: 'mast' }),
        // Schürzenplatten links/rechts (T3-Zusatz)
        mirrorX(box({ size: [0.14, 0.34, 4.6], at: [2.93, 0.2, 0], rot: [0, 0, -12], mat: 'body', maxLod: 1, tag: 'hull' })),
        // zweiter Ring (statisch, Kupfer) auf halber Masthöhe, mit Speichenkreuz am Mast
        torus({ radius: RING2_R, tube: 0.16, segments: 8, sides: 3, at: [0, RING2_Y, 0], mat: 'copper', keep: true, tag: 'ring' }),
        box({ size: [RING2_R * 2 - 0.1, 0.12, 0.18], at: [0, RING2_Y, 0], rot: [0, 45, 0], mat: 'dark', maxLod: 1, tag: 'boom' }),
        box({ size: [RING2_R * 2 - 0.1, 0.12, 0.18], at: [0, RING2_Y, 0], rot: [0, -45, 0], mat: 'dark', maxLod: 1, tag: 'boom' }),
        // 3 Tech-Kerben hinten auf dem Randband
        stripes({ count: 3, width: 0.3, stripe: 0.2, gap: 0.2, rot: [0, 90, 0], at: [0, TOP + 0.044, -2.51] }),
      ],
    },
    {
      name: 'ring',
      pivot: [0, MAST_TOP, 0],
      anim: 'yaw',
      shapes: [
        torus({ radius: RING_R, tube: 0.2, segments: 12, sides: 4, at: [0, MAST_TOP + 0.05, 0], mat: 'team', keep: true, tag: 'ring' }),
        // Speichenkreuz (Kupfer: speist den Ring) + Nabe
        box({ size: [RING_R * 2 - 0.1, 0.14, 0.2], at: [0, MAST_TOP + 0.05, 0], mat: 'copper', maxLod: 1, tag: 'boom' }),
        box({ size: [0.2, 0.14, RING_R * 2 - 0.1], at: [0, MAST_TOP + 0.05, 0], mat: 'copper', maxLod: 1, tag: 'boom' }),
        cylinder({ radius: 0.36, height: 0.3, at: [0, MAST_TOP + 0.05, 0], segments: 6, caps: false, mat: 'copper', tag: 'ring' }),
      ],
    },
  ],
});
