/**
 * Riff I (f3:str_t1_pd) – Punktverteidigung T1, 1×1.
 *
 * Roster: „Kissen-Sockel, darüber schwebend Perle mit waagerechter Lanze.“ faction.md §5.2: dieselbe Perle mit Lanze
 * wie der Kauri (Direktfeuer-Monopol: Perle + waagerechte Lanze), auf dem Sockel schwebend. §3.2 Gebäude: flacher
 * Kissen-Sockel (gerundete Ecken, keine Fasen, 100 % Footprint), das Rollen-Element schwebt 0,2–0,4 WU über dem Sockel.
 * Paartest Riff↔Seelilie: runde Perle + waagerechte Lanze gegen senkrechten Stachelkranz ohne Perle.
 * Teamfarbe (§4.2 Strukturen): Emaille-Rand des Kissens + Perle. Lanze in Perlglanz mit goldenem Schaft (wie Kauri), Jade-Lichtnaht an der
 * Lanzenwurzel, 1 Tech-Streifen (Tiefjade) hinten auf dem Rand. Kein Goldkern (Kampfbau).
 *
 * Aufbau (y = Boden, +Z = Schussrichtung in Ruhe):
 *   hull   – Kissen-Sockel (Perlmutt-Flanke, Emaille-Rand, Perlmutt-Deck), Perlmutt-Wiege unter der Perle, 1 Streifen
 *   turret – schwebende Perle (Team), dreht um +Y                                       (PartStream 1)
 *   lance  – Perlglanz-Lanze mit Goldschaft und Jade-Lichtnaht an der Wurzel, kippt (Pitch) (PartStream 2)
 *
 * Außerdem liegen hier die Sockel-Helfer der Sael-Verteidigungsbauten (`kissen`, `roundedRect`, `inGame`); die übrigen
 * Modelle dieser Gruppe importieren sie (keine eigene `_`-Datei, um das Kit/die Registry nicht anzufassen).
 */
import {
  cone,
  cylinder,
  defineModel,
  ellipsoid,
  group,
  loftShape,
  sphere,
  stripes,
  type Ring,
  type Shape,
  type Vec2,
  type Vec3,
} from '@faf/modelkit';

// -----------------------------------------------------------------------------------------------------------------
// Sockel-Helfer (Kissen, Maßstabs-Ausgleich)

/**
 * Umriss eines Rechtecks mit gerundeten Ecken (Halbmaße hx/hz, Eckradius rc, k Punkte je Ecke), nach Winkel von +X
 * nach +Z sortiert (Konvention von `loftShape`). k = 2 ergibt ein Achteck mit abgeschrägten Ecken (LOD1/2).
 */
export function roundedRect(hx: number, hz: number, rc: number, k: number): Vec2[] {
  const pts: Vec2[] = [];
  const r = Math.max(1e-4, Math.min(rc, hx, hz));
  const corners: Vec2[] = [
    [hx - r, hz - r],
    [-(hx - r), hz - r],
    [-(hx - r), -(hz - r)],
    [hx - r, -(hz - r)],
  ];
  corners.forEach(([cx, cz], c) => {
    for (let j = 0; j < k; j++) {
      const a = ((90 * c + (90 * j) / (k - 1)) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  });
  return pts;
}

export interface KissenOpts {
  /** Kantenlänge [x, z] des Sockels (≈ 0,96–0,98 × Footprint). */
  readonly size: Vec2;
  /** Höhe der Sockelkante. */
  readonly height: number;
  /** Radius der gerundeten Oberkante. */
  readonly bevel: number;
  /** Eckradius von oben. */
  readonly corner: number;
  /** Breite des flachen Emaille-Bands (Teamfarbe) zwischen gerundeter Kante und Perlmutt-Deck. */
  readonly rim: number;
  /** Höhe des Perlmutt-Decks über der Sockelkante (0 = flaches Deck bündig im Band, spart 24 Tris). */
  readonly deck?: number;
  /** Material des Rands (Standard `enamel`). */
  readonly rimMat?: string;
  /** Material der senkrechten Flanke (Standard `rind`: unten dunkel wie die Muschelaußenseite, faction.md §3.1). */
  readonly flankMat?: string;
  /** Stufen der gerundeten Oberkante in LOD0 (Standard 2; 1 spart 24 Tris). */
  readonly round?: 1 | 2;
}

/**
 * Kissen-Sockel der Sael-Gebäude (faction.md §3.2): dunkle Flanke (Schalenrinde), gerundete Perlmutt-Oberkante, flaches Emaille-Band
 * (Teamfarbe) als Rand, leicht gewölbtes Perlmutt-Deck. Alle Teile teilen sich die Glättungsgruppe `kissen` (weiche
 * Nähte). Tris: LOD0 ≈ 130 bzw. 106 mit `round: 1` (12 Punkte je Ring), LOD1 ≈ 70, LOD2 ≈ 28 (8 Punkte).
 */
export function kissen(o: KissenOpts): Shape[] {
  const hx = o.size[0] / 2;
  const hz = o.size[1] / 2;
  const { height: H, bevel: b, corner: rc, rim } = o;
  const deck = o.deck ?? 0.03;
  const rimMat = o.rimMat ?? 'enamel';
  const flankMat = o.flankMat ?? 'rind';
  const ring = (y: number, inset: number, k: number): Ring => ({ y, pts: roundedRect(hx - inset, hz - inset, Math.max(0.02, rc - inset), k) });
  const c45 = 1 - Math.SQRT1_2;
  const sg = { smoothGroup: 'kissen', keep: true, tag: 'shell' } as const;
  const open = { bottom: false, top: false };
  const inset = b + rim;
  return [
    // LOD0: 12 Punkte, gerundete Kante in zwei Schritten
    loftShape({ rings: [ring(0, 0, 3), ring(H - b, 0, 3)], caps: open, mat: flankMat, maxLod: 0, ...sg }),
    loftShape({
      rings: o.round === 1 ? [ring(H - b, 0, 3), ring(H, b, 3)] : [ring(H - b, 0, 3), ring(H - b * c45, b * c45, 3), ring(H, b, 3)],
      caps: open,
      mat: 'nacre',
      maxLod: 0,
      ...sg,
    }),
    loftShape({ rings: [ring(H, b, 3), ring(H, inset, 3)], caps: open, mat: rimMat, maxLod: 0, ...sg }),
    loftShape({ rings: deck > 0 ? [ring(H, inset, 3), ring(H + deck, inset + deck * 1.5, 3)] : [ring(H, inset, 3)], caps: { bottom: false, top: true }, mat: 'nacre', maxLod: 0, ...sg }),
    // LOD1: 8 Punkte, eine Kantenstufe
    loftShape({ rings: [ring(0, 0, 2), ring(H - b, 0, 2)], caps: open, mat: flankMat, minLod: 1, maxLod: 1, ...sg }),
    loftShape({ rings: [ring(H - b, 0, 2), ring(H, b, 2)], caps: open, mat: 'nacre', minLod: 1, maxLod: 1, ...sg }),
    loftShape({ rings: [ring(H, b, 2), ring(H, inset, 2)], caps: open, mat: rimMat, minLod: 1, maxLod: 1, ...sg }),
    loftShape({ rings: deck > 0 ? [ring(H, inset, 2), ring(H + deck, inset + deck * 1.5, 2)] : [ring(H, inset, 2)], caps: { bottom: false, top: true }, mat: 'nacre', minLod: 1, maxLod: 1, ...sg }),
    // LOD2: 8 Punkte, gerade Flanke, Emaille-Deckel, Perlmutt-Deck als Deckel darüber
    loftShape({ rings: [ring(0, 0, 2), ring(H, 0, 2)], caps: open, mat: flankMat, minLod: 2, ...sg }),
    loftShape({ rings: [ring(H, 0, 2)], caps: { bottom: false, top: true }, mat: rimMat, minLod: 2, ...sg }),
    loftShape({ rings: [ring(H + Math.max(deck, 0.004), inset, 2)], caps: { bottom: false, top: true }, mat: 'nacre', minLod: 2, ...sg }),
  ];
}

/**
 * Maßstabs-Ausgleich: Modelle mit Roster-Maßstab (xz, y) lassen sich damit in Spielmaßen (WU) bauen – runde Teile
 * bleiben rund, Winkel stimmen nach dem Export. `wrap` hüllt Shapes in eine Gruppe mit dem Kehrwert des Maßstabs,
 * `pv` rechnet Spielmaße in Modellraum-Pivots um.
 */
export function inGame(xz: number, y: number): { wrap: (shapes: readonly Shape[]) => Shape[]; pv: (p: Vec3) => Vec3 } {
  return {
    wrap: (shapes) => [group(shapes, { scale: [1 / xz, 1 / y, 1 / xz] })],
    pv: (p) => [p[0] / xz, p[1] / y, p[2] / xz],
  };
}

// -----------------------------------------------------------------------------------------------------------------
// Riff I

const H = 0.16; // Sockelkante
const TOP = H + 0.03; // Deck
const ORB_R = 0.225; // Perle Ø 0,45 wie Kauri
const ORB_Z = -0.12;
const ORB_Y = TOP + 0.12 + 0.09 + ORB_R; // Wiege 0,12 hoch, Perle schwebt 0,09 darüber (0,21 über dem Deck)
const LANCE_L = 0.54;
const LANCE_Z0 = ORB_Z + ORB_R * 0.6; // Wurzel in der Perle

export default defineModel({
  id: 'f3:str_t1_pd',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        ...kissen({ size: [0.96, 0.96], height: H, bevel: 0.07, corner: 0.2, rim: 0.045 }),
        // Perlmutt-Wiege unter der schwebenden Perle (flache Halbschale)
        ellipsoid({ radii: [0.22, 0.12, 0.22], half: true, segments: 8, rings: 2, at: [0, TOP + 0.06, ORB_Z], mat: 'nacre', tag: 'shell' }),
        // 1 Tech-Streifen (Tiefjade) hinten auf dem Deck, quer gestapelt wie die Icon-Kerben
        stripes({ count: 1, width: 0.12, rot: [0, 90, 0], at: [0, TOP + 0.005, -0.27] }),
      ],
    },
    {
      name: 'turret',
      pivot: [0, ORB_Y, ORB_Z],
      anim: 'yaw',
      smooth: true,
      shapes: [sphere({ radius: ORB_R, segments: 10, rings: 5, at: [0, ORB_Y, ORB_Z], mat: 'enamel', keep: true, tag: 'orb' })],
    },
    {
      name: 'lance',
      parent: 'turret',
      pivot: [0, ORB_Y, ORB_Z],
      anim: 'pitch',
      smooth: true,
      shapes: [
        // Lanze wie beim Kauri: Perlglanz-Kegel Ø 0,17, waagerecht, Spitze knapp vor der Sockelkante
        cone({ radius: 0.085, height: LANCE_L, segments: 6, axis: 'z', at: [0, ORB_Y, LANCE_Z0 + LANCE_L / 2], mat: 'lustre', keep: true, tag: 'lance' }),
        // goldener Schaft an der Lanzenwurzel, dahinter die Jade-Lichtnaht an der Perle
        cylinder({ radius: 0.105, height: 0.14, segments: 6, axis: 'z', at: [0, ORB_Y, ORB_Z + ORB_R + 0.05], mat: 'gold', keep: true, tag: 'lance' }),
        cylinder({ radius: 0.1, height: 0.025, axis: 'z', segments: 6, caps: false, at: [0, ORB_Y, ORB_Z + ORB_R * 0.93], mat: 'seam', maxLod: 0, tag: 'seam' }),
      ],
    },
  ],
  notes: 'v_pd: Perlen-Yaw + Lanzen-Pitch (2 animierte Parts). Sockel-Helfer kissen/inGame für die Sael-Verteidigungsbauten.',
});
