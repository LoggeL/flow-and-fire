/**
 * Warte I (f3:str_t1_radar) – Radar T1, 2×2.
 *
 * Roster: „Hoher dünner Mast mit Fächer (Halbkreisplatte 1,6 × 0,8 WU, 35° gekippt), rotierend; kein Ring.“
 * faction.md §5.2 Warte: Fächer auf `mast`, hoch und dünn, verboten: Ring (Ring = Schild/Flow). Winkel-Code §5.1:
 * Mast = Intel. Paartest Warte↔Perlmutt: schräger Halbkreis-Fächer gegen waagerechten Ring.
 * Teamfarbe (§4.2 Strukturen): Emaille-Band des Kissens + Fächerfläche. Gold als Kante (Mastring, Fächerleiste,
 * Rippen), Jade-Lichtnaht am Mastfuß. Kein Goldkern (kein Flow-Gebäude).
 *
 * Aufbau (y = Boden, +Z = vorn):
 *   hull – Kissen 2×2, Perlmutt-Fußschale, schlanker Perlglanz-Mast mit Goldring, 1 Streifen
 *   fan  – Lager (Gold), Fächer (Team, 35° aus der Senkrechten nach hinten gekippt) mit Goldleiste und
 *          Rückenrippen; dreht um +Y (PartStream 1)
 *
 * Exportiert `fan()` für Warte II/III (gleicher Fächer, gleicher Neigungswinkel in Spielmaßen).
 */
import { cylinder, defineModel, ellipsoid, extrude, frustum, group, lens, strut, stripes, type Shape, type Vec2, type Vec3 } from '@faf/modelkit';
import { kissen } from './str_t1_pd.ts';

const FAN_R = 0.8; // Halbkreis 1,6 × 0,8 WU
const FAN_TILT = 35;

/** Halbkreis-Profil [x, y] (Standkante unten), `n` Bogenstücke. */
function halfDisc(r: number, n: number): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (Math.PI * i) / n;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

/**
 * Fächer in Spielmaßen: Standkante (Scharnier) liegt im Ursprung der Gruppe entlang X, Platte 35° nach hinten
 * gekippt, Vorderseite (Team) schaut nach vorn-oben. `back` = true dreht ihn um 180° (zweiter Fächer Warte III),
 * `ribs` = false lässt die Rückenrippen weg (Budget).
 */
export function fan(at: Vec3, o: { readonly back?: boolean; readonly scale?: number; readonly ribs?: boolean } = {}): Shape {
  const r = FAN_R * (o.scale ?? 1);
  const rib = (deg: number): Shape => {
    const a = (deg * Math.PI) / 180;
    return strut({ from: [0, 0.04, -0.05], to: [r * 0.92 * Math.cos(a), r * 0.92 * Math.sin(a), -0.05], radius: 0.035, sides: 3, caps: false, mat: 'gold', maxLod: 0, tag: 'fan' });
  };
  return group(
    [
      group(
        [
          extrude({ profile: halfDisc(r, 8), depth: 0.07, axis: 'z', mat: 'enamel', keep: true, smooth: 30, tag: 'fan' }),
          // Goldleiste an der Standkante, Rückenrippen (Fächerstäbe)
          cylinder({ radius: 0.05, height: 2 * r * 0.96, axis: 'x', segments: 6, caps: false, at: [0, 0.02, 0], mat: 'gold', maxLod: 1, tag: 'fan' }),
          ...(o.ribs === false ? [] : [rib(45), rib(90), rib(135)]),
        ],
        { rot: [-FAN_TILT, 0, 0] },
      ),
    ],
    { at, rot: [0, o.back === true ? 180 : 0, 0] },
  );
}

const H = 0.22;
const TOP = H + 0.04;
const MAST_TOP = 2.35;
const FAN_Y = MAST_TOP + 0.1;

export default defineModel({
  id: 'f3:str_t1_radar',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        ...kissen({ size: [1.94, 1.94], height: H, bevel: 0.1, corner: 0.42, rim: 0.1, deck: 0.04 }),
        // Perlmutt-Fußschale um den Mastfuß, Jade-Lichtnaht an ihrem Rand
        ellipsoid({ radii: [0.42, 0.2, 0.42], half: true, segments: 10, rings: 2, at: [0, TOP + 0.1, 0], mat: 'nacre', tag: 'shell' }),
        cylinder({ radius: 0.425, height: 0.03, segments: 10, caps: false, at: [0, TOP + 0.02, 0], mat: 'seam', maxLod: 0, tag: 'seam' }),
        // Mast: hoch und dünn (Perlglanz), Goldring auf 2/3 Höhe
        frustum({ radius: 0.13, radiusTop: 0.09, height: MAST_TOP - TOP - 0.15, segments: 6, caps: false, at: [0, (MAST_TOP + TOP + 0.15) / 2, 0], mat: 'lustre', keep: true, tag: 'mast' }),
        cylinder({ radius: 0.13, height: 0.1, segments: 6, caps: false, at: [0, TOP + 0.2 + (MAST_TOP - TOP) * 0.6, 0], mat: 'gold', maxLod: 1, tag: 'mast' }),
        stripes({ count: 1, width: 0.2, stripe: 0.12, rot: [0, 90, 0], at: [0, TOP + 0.005, -0.6] }),
      ],
    },
    {
      name: 'fan',
      pivot: [0, MAST_TOP, 0],
      anim: 'yaw',
      smooth: true,
      shapes: [
        // Lager: kleine Goldlinse auf der Mastspitze
        lens({ radius: 0.15, thickness: 0.12, segments: 8, rings: 2, at: [0, MAST_TOP + 0.04, 0], mat: 'gold', keep: true, tag: 'mast' }),
        fan([0, FAN_Y, 0.05]),
      ],
    },
  ],
  notes: 'v_radar: 1 animierter Part (Fächer-Yaw). Fächer 1,6 × 0,8 WU, 35° gekippt, Teamfarbe; Paartest gegen Perlmutt (Ring).',
});
