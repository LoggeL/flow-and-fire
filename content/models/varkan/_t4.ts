/**
 * Gemeinsame Bausteine der Varkan-Experimentals (T4, docs/design/experimentals.md §5). Kein Modell (Dateiname mit `_`).
 *
 * Keramik-Klammer: Das Modell-Gegenstück zur Icon-Klammer (content/icons/grammar.ts `bracketMarkup`). Statt 1–3
 * Tech-Streifen tragen Experimentals zwei keramikweiße Winkelleisten „[ ]“ links und rechts auf dem Deck bzw. Sockel.
 * Mindestbreite 0,3 WU (bei 40 px Bildschirmlänge eines 12-WU-Koloss ≈ 1 px pro 0,3 WU → im LOD0 lesbar, ab LOD1
 * entfällt sie mit den Kleinteilen, das Icon übernimmt).
 */
import { box, group, type Shape } from '@faf/modelkit';

export interface BracketOpts {
  /** Abstand der Längsleisten von der Mittelachse (x), WU. */
  readonly x: number;
  /** Oberkante der Fläche, auf der die Klammer liegt (y), WU. */
  readonly y: number;
  /** Mitte der Klammer entlang z. */
  readonly z?: number;
  /** Länge der Längsleisten (z), WU. */
  readonly len: number;
  /** Länge der Querschenkel nach innen (x), WU. */
  readonly arm?: number;
  /** Leistenbreite, WU (Standard 0,3). */
  readonly w?: number;
  /** Leistenhöhe, WU (Standard 0,08). */
  readonly h?: number;
  readonly maxLod?: 0 | 1 | 2;
}

/** Zwei Winkelleisten „[“ und „]“ aus Keramik (Material `accent`), symmetrisch zu x = 0. */
export function ceramicBracket(o: BracketOpts): Shape {
  const w = o.w ?? 0.3;
  const h = o.h ?? 0.08;
  const arm = o.arm ?? Math.max(w * 2.5, o.len * 0.14);
  const z = o.z ?? 0;
  const y = o.y + h / 2;
  const out: Shape[] = [];
  for (const s of [1, -1]) {
    const x = s * o.x;
    out.push(box({ size: [w, h, o.len], at: [x, y, z], mat: 'accent', tag: 'bracket' }));
    for (const e of [1, -1]) {
      out.push(box({ size: [arm, h, w], at: [x - s * (arm / 2 - w / 2), y, z + e * (o.len / 2 - w / 2)], mat: 'accent', tag: 'bracket' }));
    }
  }
  return group(out, { maxLod: o.maxLod ?? 1, keep: false });
}
