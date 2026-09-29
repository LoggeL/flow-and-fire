// Alert-Präfix „Zweiton-Gong" (P8): fallende Quarte E6 → B5, helles, kurzes Glockenspektrum.
// Unterscheidbarkeit zu Waffen (Gesamtprüfung): Die Direktfeuer-Waffen der Varkan sind Glockenhämmer
// (Kirchenglocken-Spektrum mit Summton und Moll-Terz, 330–700 Hz, mit Knall). Der Gong nutzt deshalb ein
// anderes Glockenspektrum (Klangstab/Röhrenglocke: Grundton, Oktave, 2,76 und 5,40, ohne Summton), liegt
// eine Oktave höher, hat keinen Rausch-Anschlag und eine langsame Schwebung (Vibraphon-artig, „Signal").
// Steht vor jeder Ansage der Hüttenstimme und eröffnet jeden Alert-Signalton. Die übrigen Alerts importieren
// die Bausteine unten, damit der Gong überall bitgleich klingt (Wiedererkennung) und nur das Muster danach wechselt.
// Muster-Regel (Unterscheidbarkeit): Anzahl/Rhythmus der Schläge, Tonhöhenverlauf und Timbre sind je Alert eigen.
import {
  type Mono,
  type Partial,
  decay,
  defineSfx,
  envelope,
  fade,
  fit,
  lowpass,
  midiHz,
  mixMono,
  modal,
  mul,
  osc,
  scaleDecay,
  shape,
} from '../../../tools/sfx/src/index.ts';

/** Zeitpunkt, ab dem das Alert-Muster nach dem Gong beginnt (s). */
export const PATTERN_AT = 0.6;

/** Klangstab-/Röhrenglocken-Spektrum des Gongs (harmonischer Kern + Stab-Moden 2,76/5,40, kein Summton). */
export const GONG_PARTIALS: readonly Partial[] = [
  { ratio: 1.0, amp: 1.0, t60: 1.6, beatHz: 3.2 },
  { ratio: 2.0, amp: 0.28, t60: 1.0 },
  { ratio: 2.756, amp: 0.42, t60: 0.7 },
  { ratio: 4.0, amp: 0.08, t60: 0.4 },
  { ratio: 5.404, amp: 0.16, t60: 0.28 },
  { ratio: 8.933, amp: 0.05, t60: 0.12 },
];

/** Ein Gong-Schlag (helles Klangstab-Spektrum, Nachklang auf 55 % gekürzt). Deterministisch, ohne Zufall. */
export function gongStrike(note: number, durS = 1.0): Mono {
  return modal(midiHz(note), scaleDecay(GONG_PARTIALS, 0.55), { durS, attackS: 0.003 });
}

/** Der gemeinsame Zweiton-Gong: E6, 220 ms später B5 (fallende Quarte). */
export function alertGong(durS = 1.25): Mono {
  return mixMono(
    [
      { sig: gongStrike(88, durS), db: 0 },
      { sig: gongStrike(83, durS - 0.22), db: 0, at: 0.22 },
    ],
    durS,
  );
}

/** Kurzer Signal-Puls (Warnton): Wellenform + Tiefpass + weiche Sättigung, Hüllkurve mit Halteteil. */
export function pulse(freq: number, durS: number, o: { wave?: 'triangle' | 'square' | 'saw' | 'sine'; lp?: number; hold?: number; drive?: number } = {}): Mono {
  const a = 0.006;
  const hold = o.hold ?? durS * 0.55;
  const env = envelope([[0, 0], [a, 1, 'lin'], [a + hold, 0.8, 'lin'], [durS, 0, 'exp']], durS);
  let s = osc(o.wave ?? 'triangle', freq, durS);
  if (o.lp) s = lowpass(s, o.lp, 0.7, 2);
  if (o.drive) s = shape(s, { kind: 'tanh', drive: o.drive });
  return mul(s, env);
}

/** Auf feste Länge bringen und sanft ausblenden (Alerts haben eine harte Obergrenze). */
export function finish(sig: Mono, durS: number, fadeS = 0.15): Mono {
  return fade(fit(sig, durS), 0.001, fadeS, 'cos');
}

/** Kurzer, heller Anschlag (Glas/Metall), z. B. für Bestätigungs-Töne. */
export function chime(freq: number, t60 = 0.5, durS = t60 * 1.2): Mono {
  const body = modal(freq, [
    { ratio: 1, amp: 1, t60 },
    { ratio: 2, amp: 0.35, t60: t60 * 0.6 },
    { ratio: 3.01, amp: 0.18, t60: t60 * 0.4 },
    { ratio: 4.2, amp: 0.08, t60: t60 * 0.25 },
  ], { durS, attackS: 0.002 });
  return mixMono([{ sig: body }, { sig: mul(osc('sine', freq * 5.4, 0.02), decay(0.015, 0.02)), db: -14 }], durS);
}

export default defineSfx({
  id: 'common:alt_gong',
  category: 'alert',
  description: 'Alert-Präfix: Zweiton-Gong (fallende Quarte E6→B5, helles Klangstab-Spektrum) vor Sprachzeilen',
  variants: 1,
  cooldownMs: 0,
  tags: ['alert', 'P8', 'MS9', 'gong'],
  render() {
    return finish(alertGong(1.2), 1.2, 0.3);
  },
});
