/**
 * Novize (f3:lnd_t1_engineer) – Sael-Engineer T1; Grundform der Engineer-Familie (Akolyth T2, Kustos T3 importieren
 * `engineerParts`).
 *
 * Roster: „Kurze breite Schale auf Schwebeteller, Rand-Band teamfarben, goldene Deckplatte; goldene Sichel vom
 * linken Heck über das Deck nach vorn rechts, Goldkern-Emitter an der Sichelspitze (umschlossen). 1 Tech-Streifen
 * Tiefjade.“
 * faction.md §5.2 Engineer: goldene Sichel + goldene Deckplatte, asymmetrisch, Anzahl der Sicheln = Tech (1/2/3,
 * verschieden groß), Schalenrand-Band in Teamfarbe (≥ 25 % der Draufsicht), an der Sichelspitze ein kleiner,
 * umschlossener Glow-Emitter (Ø ≤ 0,5 × Kauri-Perle); keine Waffenform, keine freie oder teamfarbene Perle.
 * §3.2: Schale als glattes Halb-Ellipsoid (Tropfen, Bug schmaler), Schwebeteller überragt die Schale um ≈ 10 %
 * (Schattensaum); Schwebehöhe kommt aus dem Roster (Modell steht mit dem Teller auf y = 0).
 * Pflichtpaare: Novize↔Glimmer (Sichel + Golddeck gegen Nadel), Kreuz Novize↔Lehrling (Rolle am Bauarm).
 *
 * Aufbau (y = Boden vor dem Anheben, +Z = Bug, +X = linke Seite):
 *   hull    – Schwebeteller (Tiefjade), Emaille-Schale (Teamfarbe = Rand-Band), goldene Deckplatte,
 *             Tech-Streifen (Tiefjade) auf dem hinteren Deck, Jade-Lichtnaht am Heck; T3: dritte, statische Sichel
 *   sickle  – Hauptsichel: Fuß links hinten auf dem Deck, Bogen über das Deck nach vorn rechts; dreht um +Y
 *             (PartStream 1); bei T2/T3 trägt sie den Emitter statisch
 *   emitter – Goldkern in goldener Fassung an der Sichelspitze, kippt (nur T1)                      (PartStream 2)
 *   sickle2 – kleine Sichel: Fuß rechts hinten, Bogen nach vorn links (T2/T3)                       (PartStream 2)
 */
import { arcPoints, bezier, defineModel, disc, ellipsoid, glyphStrip, sphere, stripes, sweep, torus, type PartDef, type Shape, type Vec3 } from '@faf/modelkit';

const PAD_H = 0.1;
const SHELL_Y0 = PAD_H;
const SHELL_H = 0.22;
/** Oberkante der goldenen Deckplatte. */
export const ENG_DECK = SHELL_Y0 + SHELL_H + 0.03;

interface SickleSpec {
  /** Kubische Bézier-Kurve: Fuß (auf dem Deck, Pivot), zwei Kontrollpunkte, Spitze (frei in der Luft). */
  readonly ctrl: readonly [Vec3, Vec3, Vec3, Vec3];
  /** Querschnitt-Halbachsen [breit, dick] am Fuß, in der Mitte, an der Spitze. */
  readonly r: readonly [number, number, number];
  /** Segmente entlang der Kurve und Querschnitt-Seiten (Budget). */
  readonly segs: number;
  readonly sides: number;
}

const D = ENG_DECK;
/**
 * Hauptsichel: Fuß links hinten auf dem Deck, steigt auf und schwingt, nach vorn links ausgebaucht, über das Deck
 * nach vorn rechts; die Spitze schwebt frei über dem Bug (von oben eine offene Mondsichel, kein Henkel).
 */
const S1: SickleSpec = {
  ctrl: [
    [0.27, D - 0.02, -0.24],
    [0.4, D + 0.6, 0.02],
    [0.0, D + 0.74, 0.56],
    [-0.32, D + 0.36, 0.26],
  ],
  r: [0.1, 0.1, 0.06],
  segs: 7,
  sides: 4,
};
/** Kleine Sichel (T2/T3): Fuß rechts hinten, nach hinten links ausgebaucht, Spitze über der Deckmitte. */
const S2: SickleSpec = {
  ctrl: [
    [-0.28, D - 0.02, -0.22],
    [-0.34, D + 0.42, -0.02],
    [-0.12, D + 0.5, 0.2],
    [0.08, D + 0.3, 0.12],
  ],
  r: [0.085, 0.08, 0.03],
  segs: 5,
  sides: 4,
};
/** Dritte Sichel (T3, statisch): klein, an der linken Flanke, Spitze zum Bug. */
const S3: SickleSpec = {
  ctrl: [
    [0.4, D - 0.06, 0.02],
    [0.5, D + 0.26, 0.12],
    [0.42, D + 0.32, 0.32],
    [0.26, D + 0.2, 0.42],
  ],
  r: [0.075, 0.07, 0.025],
  segs: 4,
  sides: 4,
};

function sickleTip(s: SickleSpec): Vec3 {
  return s.ctrl[3];
}

/** Goldene Sichel: glatte, offene Kurve mit flachem Oval-Querschnitt, zur Spitze verjüngt (eine LOD-Stufe). */
function sickleSweep(s: SickleSpec, segs: number, sides: number, minLod: 0 | 1 | 2, maxLod: 0 | 1 | 2): Shape {
  const pts = bezier(s.ctrl, segs);
  const radius = pts.map((_, i): [number, number] => {
    const t = i / segs;
    const r = t < 0.5 ? s.r[0] + (s.r[1] - s.r[0]) * (t / 0.5) : s.r[1] + (s.r[2] - s.r[1]) * ((t - 0.5) / 0.5);
    return [r, r * 0.62];
  });
  return sweep({ path: pts, radius, sides, caps: 'start', mat: 'gold', keep: true, minLod, maxLod, tag: 'sickle' });
}

/** Sichel mit eigenen LOD-Stufen (der Sweep-Pfad wird nicht automatisch reduziert); `lastLod` = gröbste Stufe. */
function sickleShape(s: SickleSpec, lastLod: 1 | 2 = 2): Shape[] {
  const out = [sickleSweep(s, s.segs, s.sides, 0, 0), sickleSweep(s, Math.max(3, Math.round(s.segs * 0.6)), 4, 1, 1)];
  if (lastLod === 2) out.push(sickleSweep(s, Math.max(2, Math.round(s.segs * 0.4)), 3, 2, 2));
  return out;
}

/** Emitter: Goldkern (umschlossen) in einer goldenen Fassung an der Sichelspitze. */
function emitterShapes(at: Vec3): Shape[] {
  return [
    sphere({ radius: 0.105, segments: 6, rings: 3, at, mat: 'light', keep: true, tag: 'orb' }),
    torus({ radius: 0.12, tube: 0.04, segments: 6, sides: 3, at, mat: 'gold', keep: true, maxLod: 1, tag: 'sickle' }),
  ];
}

/** Engineer-Parts für Tech 1–3 (Maßstab kommt aus dem Roster: 1,0 / 1,3 / 1,4). */
export function engineerParts(tech: 1 | 2 | 3): PartDef[] {
  // Tech-Streifen: 0,10 WU × Maßstab tief, 0,10 WU Abstand absolut ⇒ im Basismaß 0,10 / Maßstab
  const scale = tech === 1 ? 1 : tech === 2 ? 1.3 : 1.4;
  const d = 0.1 / scale;
  const hull: Shape[] = [
    // Schwebeteller: dunkler Diskus, ≈ 10 % über den Schalenumriss hinaus (Schattensaum)
    disc({ radius: 0.57, height: PAD_H, bevel: PAD_H / 2, segments: 10, scale: [1, 1, 0.94], at: [0, PAD_H / 2, 0], mat: 'jade', keep: true, tag: 'hoverpad' }),
    // Schale: kurz und breit, Tropfen (Bug schmaler); Emaille = Rand-Band um die Deckplatte
    ellipsoid({ radii: [0.52, SHELL_H, 0.5], half: true, drop: 0.22, segments: 10, rings: 2, at: [0, SHELL_Y0 + SHELL_H / 2, 0], mat: 'enamel', keep: true, tag: 'shell' }),
    // goldene Deckplatte (Klassenkennung Engineer), flach, leicht nach hinten gesetzt
    disc({ radius: 0.36, height: 0.1, bevel: 0.05, segments: 8, scale: [1, 1, 0.9], at: [0, ENG_DECK - 0.05, -0.04], mat: 'gold', keep: true, tag: 'wing' }),
    // Tech-Streifen Tiefjade im hinteren Drittel des Decks
    stripes({ count: tech, width: 0.26, stripe: d, gap: d, at: [-0.04, ENG_DECK + 0.004, -0.17], mat: 'jade' }),
    // Jade-Lichtnaht an der Heckkante des Tellers (≤ 2 %)
    glyphStrip({ path: arcPoints(0.5, 225, 315, 5, 'y', [0, PAD_H + 0.001, 0]), width: 0.05, pattern: [0.14, -0.08], widths: [1], mat: 'seam', maxLod: 0, tag: 'seam' }),
  ];
  if (tech === 3) hull.push(...sickleShape(S3, 1));
  const parts: PartDef[] = [
    { name: 'hull', smooth: true, shapes: hull },
    {
      name: 'sickle',
      pivot: S1.ctrl[0],
      anim: 'yaw',
      smooth: true,
      shapes: tech === 1 ? sickleShape(S1) : [...sickleShape(S1), ...emitterShapes(sickleTip(S1))],
    },
  ];
  if (tech === 1) {
    parts.push({ name: 'emitter', parent: 'sickle', pivot: sickleTip(S1), anim: 'pitch', smooth: true, shapes: emitterShapes(sickleTip(S1)) });
  } else {
    parts.push({ name: 'sickle2', pivot: S2.ctrl[0], anim: 'yaw', smooth: true, shapes: sickleShape(S2) });
  }
  return parts;
}

export default defineModel({
  id: 'f3:lnd_t1_engineer',
  parts: engineerParts(1),
  notes: 'Grundform v_eng: Sichel-Yaw + Emitter-Pitch (2 animierte Parts). Akolyth/Kustos importieren engineerParts().',
});
