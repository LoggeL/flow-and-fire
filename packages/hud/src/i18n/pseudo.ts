/**
 * Pseudo localisation (P12): accents every ASCII letter, pads the text by ≥ 30 % and wraps it in
 * brackets, so truncation and hard-coded strings are visible in layout checks. `{placeholders}`
 * stay intact so parameters still substitute.
 */
const ACCENTED: Readonly<Record<string, string>> = {
  a: 'á', b: 'ƀ', c: 'ç', d: 'ď', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'í', j: 'ĵ', k: 'ķ', l: 'ľ', m: 'ɱ',
  n: 'ñ', o: 'ó', p: 'þ', q: 'ǫ', r: 'ŕ', s: 'š', t: 'ţ', u: 'ú', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Á', B: 'Ɓ', C: 'Ç', D: 'Ď', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Í', J: 'Ĵ', K: 'Ķ', L: 'Ľ', M: 'Ṁ',
  N: 'Ñ', O: 'Ó', P: 'Þ', Q: 'Ǫ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Ú', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};

export const PSEUDO_EXPANSION = 0.3;

/** Visible length without placeholders (what the expansion is measured against). */
export function visibleLength(s: string): number {
  return s.replace(/\{[^{}]+\}/g, '').length;
}

export function pseudo(s: string): string {
  if (s.length === 0) return s;
  let out = '';
  for (const part of s.split(/(\{[^{}]+\})/)) {
    if (part.startsWith('{') && part.endsWith('}')) {
      out += part;
      continue;
    }
    for (const ch of part) out += ACCENTED[ch] ?? ch;
  }
  const pad = Math.max(1, Math.ceil(visibleLength(s) * PSEUDO_EXPANSION));
  return `[${out}${'~'.repeat(pad)}]`;
}
