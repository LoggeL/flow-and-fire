/**
 * Schirm II (core:str_t2_shield) – Schildgenerator T2, 6×6.
 *
 * Roster: „Mast mit waagerechtem Ring (Ø ≥ 0,8 × Footprint-Kante), Generator-Kessel am Fuß.“ Schild-Monopol
 * (faction.md §5.2): `mast` + waagerechter `ring` als höchster Punkt, keine Platte. Paartest Horcher↔Schirm.
 * Kein Flow-Gebäude ⇒ kein Glutkern, nur schmale Glutnähte am Kessel.
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull – Fuß, flacher Gusssockel 6×6 mit Teamfarben-Randband, stehender Generator-Kessel mit Kupferbändern und
 *          Glutschlitzen, Kupferleitungen zu den Ecken, Mast, 2 Tech-Kerben
 *   ring – Emitter-Ring (Team, Ø 5,0 ≈ 0,83 × Kante) mit Nabe und Speichenkreuz; dreht um +Y (PartStream 1)
 */
import { beveledBox, box, cylinder, defineModel, frustum, mirrorX, quad, stripes, torus } from '@faf/modelkit';

const TOP = 0.36; // Sockeldach
const BOILER_R = 0.95;
const BOILER_H = 1.0;
const MAST_TOP = 3.3;
const RING_R = 2.5;

export default defineModel({
  id: 'core:str_t2_shield',
  parts: [
    {
      name: 'hull',
      shapes: [
        beveledBox({ size: [5.96, 0.12, 5.96], at: [0, 0.06, 0], bevel: { top: 0.05 }, mat: 'dark', maxLod: 0, tag: 'hull' }),
        beveledBox({ size: [5.76, TOP, 5.76], at: [0, TOP / 2, 0], bevel: { top: 0.14 }, mat: 'body', tag: 'hull' }),
        // Randband (Teamfarbe) = Team-Platte + eingelegtes Eisendeck (24 Tris statt 32 für einen Rahmen)
        box({ size: [5.44, 0.04, 5.44], at: [0, TOP + 0.02, 0], mat: 'team', tag: 'hull' }),
        box({ size: [4.6, 0.04, 4.6], at: [0, TOP + 0.03, 0], mat: 'body', tag: 'hull' }),
        // Kupferleitungen diagonal vom Kessel in die Ecken (Flow-Anschluss)
        mirrorX([
          cylinder({ radius: 0.12, height: 1.9, axis: 'z', at: [1.25, TOP + 0.08, 1.25], rot: [0, 45, 0], segments: 6, caps: false, mat: 'copper', maxLod: 1, tag: 'barrel' }),
          cylinder({ radius: 0.12, height: 1.9, axis: 'z', at: [1.25, TOP + 0.08, -1.25], rot: [0, -45, 0], segments: 6, caps: false, mat: 'copper', maxLod: 1, tag: 'barrel' }),
        ]),
        // stehender Generator-Kessel (rund = Technik) mit Kupferband und flachem Deckel
        cylinder({ radius: BOILER_R, height: BOILER_H, at: [0, TOP + BOILER_H / 2, 0], segments: 8, caps: false, mat: 'body', tag: 'boiler' }),
        cylinder({ radius: BOILER_R + 0.04, height: 0.16, at: [0, TOP + 0.62, 0], segments: 8, caps: false, mat: 'copper', tag: 'boiler' }),
        frustum({ radius: BOILER_R, radiusTop: 0.5, height: 0.34, at: [0, TOP + BOILER_H + 0.17, 0], segments: 8, caps: 'top', mat: 'body', tag: 'boiler' }),
        // Glutnähte: zwei schmale Lüftungsschlitze am Kessel (vorn/hinten)
        quad({ size: [0.5, 0.06], at: [0, TOP + 0.3, BOILER_R * 0.93 + 0.01], rot: [90, 0, 0], mat: 'glow', maxLod: 0 }),
        quad({ size: [0.5, 0.06], at: [0, TOP + 0.3, -BOILER_R * 0.93 - 0.01], rot: [-90, 0, 0], mat: 'glow', maxLod: 0 }),
        // Mast
        cylinder({ radius: 0.24, height: MAST_TOP - (TOP + BOILER_H + 0.34), at: [0, (MAST_TOP + TOP + BOILER_H + 0.34) / 2, 0], segments: 6, caps: false, mat: 'dark', keep: true, tag: 'mast' }),
        // 2 Tech-Kerben hinten auf dem Randband
        stripes({ count: 2, width: 0.3, stripe: 0.2, gap: 0.2, rot: [0, 90, 0], at: [0, TOP + 0.044, -2.51] }),
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
