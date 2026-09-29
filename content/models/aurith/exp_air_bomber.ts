/**
 * Heupferd (f4:exp_air_bomber) – Experimenteller Bomber der Aurith (T4, Post-MVP) mit starker Flugabwehr.
 *
 * experimentals.md §4.3 / roster.json `experimentals[2].kitbash`: „Breiter Fächer (Muschel von oben) mit Spannweite
 * 12 WU und Länge 8 WU, darunter ein zweiter, kleinerer Amber-Fächer als Deckflügel, mittig ein kurzer Kiel und eine
 * große Bauch-Linse (Bombenkammer). Auf der Fächeroberseite vier Gruppen gestufter senkrechter Pfeifen
 * (Flugabwehr), zwei teamfarbene Flügelrippen strahlen vom Kiel zur Fächerkante. Breit ≥ lang wie jeder
 * Aurith-Bomber; keine Pfeilung, keine Gabel, keine Reifen. Teamfarbe ≥ 45 % der Draufsicht (Fächer).“
 *
 * Form: Der Fächer ist eine flache, weich gewölbte Muschel mit gerader Hinterkante und gewellter Vorderkante
 * (Rippen-Buckel), der Amber-Deckflügel schaut hinten als zweiter Fächer heraus (Heuschrecken-Hinterflügel). Die
 * Flügelrippen sind Bernstein-Kanten statt Teamfarbe: auf dem teamfarbenen Fächer wären sie unsichtbar. Primär
 * Bomber (Fächer + Bauch-Linse), sekundär Flugabwehr (Pfeifen, Hybrid-Regel §3.2).
 * Pflichtpaare: Heupferd ↔ Maikäfer (Fächer in zwei Größen, dazu Pfeifen), Heupferd ↔ Schwärmer (Fächer gegen Pfeilblatt
 * mit Gondeln).
 *
 * Luft: auf y = 0 gebaut (Flughöhe setzt der Renderer). T4 stehen nicht in `roster.units`: Name, Klasse, Tech,
 * Footprint und Icon stehen im Modell, Maßstab 1.
 *
 * Aufbau (y = Boden, +Z = vorn, +X = linke Seite):
 *   hull     – Fächer (Team), Deckflügel (Bernstein), Mittelkiel als Rückgrat auf dem Fächer (Bernstein, mit Kopf),
 *              Unterkiel und Bauch-Linse (Pechglas, Bombenkammer),
 *              zwei Flügelrippen (Bernstein-Kante), Glyphenbänder
 *   pipes_fl / pipes_fr / pipes_bl / pipes_br – vier Pfeifengruppen (Flugabwehr), je drei gestufte senkrechte Pfeifen
 *              auf einer drehbaren Nabe (yaw)
 */
import {
  cylinder,
  defineModel,
  ellipsoid,
  glyphStrip,
  lens,
  loftShape,
  sweep,
  type PartDef,
  type Ring,
  type Shape,
  type Vec2,
  type Vec3,
} from '@faf/modelkit';

const SPAN = 5.45; // halbe Spannweite (mit Rippen-Buckeln ≈ 5,95)
const FRONT = 3.2; // Vorderkante (Mitte) vor dem Ursprung
const BACK = 2.1; // gerade Hinterkante
const FAN_Y = 1.3; // Unterkante des Fächers
const FAN_H = 1.4; // Wölbung des Fächers
const WAVE = 0.09; // Rippen-Buckel der Vorderkante
/** Ringe der Muschel: Umrissfaktor und Höhe (Anteil von FAN_H), außen → innen. */
const RINGS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 0.12],
  [0.8, 0.52],
  [0.52, 0.86],
  [0.2, 1],
];

/**
 * Umriss des Fächers von oben, Punkte nach Winkel θ (x = cos θ, z = sin θ) um den Ursprung: vorn ein weiter Bogen mit
 * vier Rippen-Buckeln je Seite (Muschel), hinten eine gerade Kante. Breit (11,9) ≥ lang (≈ 5,3 + Kopf).
 */
function outline(n: number, f: number, wave: number, sx = 1, sz = 1, dz = 0): Vec2[] {
  const pts: Vec2[] = [];
  for (let j = 0; j < n; j++) {
    const th = ((j + 0.5) / n) * Math.PI * 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    let x: number;
    let z: number;
    if (s >= 0) {
      const w = 1 + wave * Math.cos(8 * th);
      x = SPAN * c * w;
      z = FRONT * s * w;
    } else {
      x = SPAN * c;
      z = Math.max(-BACK, BACK * 1.6 * s);
    }
    pts.push([x * sx * f, z * sz * f + dz]);
  }
  return pts;
}

/** Höhe der Fächer-Oberseite beim normierten Radius ρ (0 = Mitte, 1 = Kante). */
function surf(rho: number): number {
  for (let i = 1; i < RINGS.length; i++) {
    const [f0, h0] = RINGS[i - 1]!;
    const [f1, h1] = RINGS[i]!;
    if (rho >= f1) return FAN_Y + FAN_H * (h1 + ((h0 - h1) * (rho - f1)) / Math.max(1e-6, f0 - f1));
  }
  return FAN_Y + FAN_H;
}
const rhoOf = (x: number, z: number): number => Math.hypot(x / SPAN, z / (z >= 0 ? FRONT : BACK * 1.6));

/** Flache Muschel mit Rippen-Buckeln (Loft aus gleich vielen Punkten je Ring), Unterseite eben. */
function shell(n: number, wave: number, y0: number, h: number, sx: number, sz: number, dz: number, mat: string, lod: 0 | 1 | 2, tag: string): Shape {
  const rings: Ring[] = (lod === 2 ? [RINGS[0]!, RINGS[1]!, RINGS[3]!] : RINGS).map(([f, k]) => ({ y: y0 + h * k, pts: outline(n, f, wave, sx, sz, dz) }));
  return loftShape({ rings, caps: { bottom: true, top: true }, mat, keep: true, minLod: lod, maxLod: lod, smooth: 22, tag });
}

/** Pfeifengruppe als eigener Part: Nabe + drei gestufte senkrechte Pfeifen quer zur Flugrichtung, auf der Wölbung. */
function pipeGroup(name: string, x: number, z: number): PartDef {
  const y0 = surf(rhoOf(x, z)) + 0.05;
  const list: [number, number][] = [
    [-0.36, 1.2],
    [0, 0.92],
    [0.36, 0.64],
  ];
  const sgn = Math.sign(x);
  return {
    name,
    pivot: [x, y0, z],
    anim: 'yaw',
    shapes: [
      cylinder({ radius: 0.55, height: 0.3, segments: 8, caps: 'top', at: [x, y0, z], mat: 'pitch', keep: true, tag: 'pipe' }),
      ...list.map(([dx, h]) =>
        cylinder({ radius: 0.16, height: h, segments: 6, caps: 'top', at: [x + sgn * dx, y0 + h / 2, z], mat: 'pitch', keep: true, maxLod: 1, tag: 'pipe' }),
      ),
      cylinder({ radius: 0.26, height: 1.0, segments: 4, caps: 'top', at: [x, y0 + 0.5, z], mat: 'pitch', keep: true, minLod: 2, tag: 'pipe' }),
    ],
  };
}

/** Flügelrippe (Bernstein-Kante auf dem Teamfächer): Dreikant-Grat vom Kiel zur Fächerkante, folgt der Wölbung. */
function rib(s: 1 | -1, lod: 'near' | 'far'): Shape {
  const a = (32 * Math.PI) / 180;
  const pts: Vec3[] = [];
  const k = lod === 'near' ? 6 : 2;
  for (let i = 0; i <= k; i++) {
    const f = 0.16 + (0.8 * i) / k;
    pts.push([s * SPAN * f * Math.cos(a), surf(f) + 0.02, FRONT * f * Math.sin(a)]);
  }
  return sweep({
    path: pts,
    radius: pts.map((_, i): [number, number] => [0.22 - (0.1 * i) / k, 0.2 - (0.1 * i) / k]),
    sides: 3,
    caps: true,
    mat: 'amberedge',
    keep: true,
    smooth: false,
    ...(lod === 'near' ? { maxLod: 1 } : { minLod: 2 }),
    tag: 'fin',
  } as const);
}

/**
 * Mittelkiel als Rückgrat (Heuschrecken-Leib): liegt als ovaler, weich gerundeter Bernstein-Strang **auf** der
 * Fächerwölbung, von der Hinterleibspitze hinter dem Deckflügel bis zum Kopf vor der Vorderkante. So bleibt der Kiel
 * aus der Spielkamera sichtbar (vorher lag er ganz unter dem Teamfächer) und gibt dem Fächer eine Längsachse.
 */
const SPINE_Z = [-4.05, -3.1, -1.6, 0, 1.5, 2.7, 3.35] as const;
const SPINE_R: readonly [number, number][] = [
  [0.34, 0.26],
  [0.62, 0.42],
  [0.86, 0.58],
  [0.9, 0.62],
  [0.8, 0.55],
  [0.62, 0.45],
  [0.5, 0.4],
];
const spineY = (z: number): number => surf(Math.min(1, rhoOf(0, z))) + 0.12;
const SPINE_PATH: Vec3[] = SPINE_Z.map((z): Vec3 => [0, spineY(z), z]);

function spine(lod: 'near' | 'far'): Shape {
  const idx = lod === 'near' ? [0, 1, 2, 3, 4, 5, 6] : [0, 2, 3, 4, 6];
  return sweep({
    path: idx.map((i) => SPINE_PATH[i]!),
    radius: idx.map((i) => SPINE_R[i]!),
    sides: lod === 'near' ? 8 : 5,
    caps: true,
    mat: 'amber',
    keep: true,
    smooth: 70,
    ...(lod === 'near' ? { maxLod: 1 } : { minLod: 2 }),
    tag: 'keel',
  } as const);
}

/** Glyphenbänder längs der Rückgrat-Flanken (Notenlinien vom Kopf zum Hinterleib). */
function glyphs(s: 1 | -1) {
  const pts = [1, 2, 3, 4, 5].map((i): Vec3 => {
    const [rx, ry] = SPINE_R[i]!;
    const p = SPINE_PATH[i]!;
    return [s * rx * 0.62, p[1] + ry * 0.74, p[2]];
  });
  return glyphStrip({
    path: pts,
    normal: [s * 0.6, 1, 0],
    width: 0.12,
    pattern: [0.7, -0.2, 0.3, -0.2, 0.9, -0.3],
    mat: 'glyph',
    maxLod: 0,
    tag: 'glyphs',
  });
}

export default defineModel({
  id: 'f4:exp_air_bomber',
  name: 'Heupferd',
  role: 'Experimenteller Bomber',
  class: 'air',
  tech: 4,
  footprint: [6, 6],
  icon: 'air_bomb_t4',
  parts: [
    {
      name: 'hull',
      smooth: true,
      shapes: [
        // Fächer oben (Teamfarbe): gewölbte Muschel 11,9 × 5,3 WU mit Rippen-Buckeln
        shell(40, WAVE, FAN_Y, FAN_H, 1, 1, 0, 'team', 0, 'shell'),
        shell(24, WAVE * 0.6, FAN_Y, FAN_H, 1, 1, 0, 'team', 1, 'shell'),
        shell(14, 0, FAN_Y, FAN_H, 1, 1, 0, 'team', 2, 'shell'),
        // Deckflügel darunter (Bernstein): schmaler, schaut hinten 1,3 WU heraus (Heuschrecken-Hinterflügel)
        shell(22, 0, FAN_Y - 0.3, 0.55, 0.78, 1.0, -1.35, 'amber', 0, 'shell'),
        shell(14, 0, FAN_Y - 0.3, 0.55, 0.78, 1.0, -1.35, 'amber', 1, 'shell'),
        shell(10, 0, FAN_Y - 0.3, 0.55, 0.78, 1.0, -1.35, 'amber', 2, 'shell'),
        // Mittelkiel (Bernstein) als Rückgrat auf der Fächerwölbung: Hinterleib hinter dem Deckflügel, Kopf vorn
        spine('near'),
        spine('far'),
        ellipsoid({ radii: [0.74, 0.62, 0.82], segments: 8, rings: 4, at: [0, spineY(3.35) + 0.05, 3.72], mat: 'amberedge', keep: true, tag: 'keel' }),
        // Unterkiel (Pechglas) zwischen Fächer und Bombenkammer: schließt die Bauchlinie
        ellipsoid({ radii: [0.8, 0.5, 3.4], segments: 8, rings: 3, at: [0, 1.1, 0.1], mat: 'pitch', keep: true, maxLod: 1, tag: 'keel' }),
        // Bauch-Linse (Bombenkammer, Pechglas)
        lens({ radius: 1.6, thickness: 1.0, length: 3.2, segments: 12, at: [0, 0.5, -0.1], mat: 'pitch', keep: true, tag: 'lens' }),
        // zwei Flügelrippen (Bernstein-Kante, auf dem Teamfächer sonst unsichtbar)
        rib(1, 'near'),
        rib(-1, 'near'),
        rib(1, 'far'),
        rib(-1, 'far'),
        glyphs(1),
        glyphs(-1),
      ],
    },
    pipeGroup('pipes_fl', 2.1, 1.25),
    pipeGroup('pipes_fr', -2.1, 1.25),
    pipeGroup('pipes_bl', 3.7, -0.6),
    pipeGroup('pipes_br', -3.7, -0.6),
  ],
  notes:
    'v_exp_air_bomber: T4 nicht in roster.units → Name/Klasse/Tech/Footprint/Icon im Modell. Vier Pfeifengruppen je eigener Yaw-Part (4 animierte Parts = T4-Grenze; Roster: 2 × pipe).',
});
