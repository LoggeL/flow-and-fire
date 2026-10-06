import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

/**
 * P12 guard: no hard-coded UI strings in packages/hud/src/**\/*.tsx. Flags JSX text containing letters,
 * string literals with letters in JSX child expressions ({'Text'}, {cond ? 'Ja' : 'Nein'}, {ok && 'Text'},
 * {'a' + b}, template literals) and in aria-label / aria-description / aria-roledescription / aria-valuetext /
 * title / placeholder / alt. The only escape hatch is a comment `i18n-ignore: <reason>` on the same or
 * the previous line (in JSX: {/* i18n-ignore: … *\/}).
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../src');
const TEXT_ATTRS = new Set(['aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'title', 'placeholder', 'alt']);
const LETTER = /\p{L}/u;
const IGNORE = /i18n-ignore:\s*[^\s*]/;

export interface Violation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function listTsx(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTsx(p));
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out.sort();
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join('');
  if (ts.isParenthesizedExpression(node)) return literalText(node.expression);
  if (ts.isConditionalExpression(node)) {
    const a = literalText(node.whenTrue);
    const b = literalText(node.whenFalse);
    return [a, b].filter((x) => x !== null).join(' ') || null;
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.PlusToken) {
      return [literalText(node.left), literalText(node.right)].filter((x) => x !== null).join('') || null;
    }
    // `cond && 'Text'` renders the right side; `a || 'Text'` / `a ?? 'Text'` may render either side.
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return literalText(node.right);
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      return [literalText(node.left), literalText(node.right)].filter((x) => x !== null).join(' ') || null;
    }
  }
  return null;
}

/** Scans one TSX source text; `file` is only used for reporting. */
export function scanSource(file: string, text: string): Violation[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = text.split('\n');
  const out: Violation[] = [];
  const ignored = (pos: number): boolean => {
    const line = sf.getLineAndCharacterOfPosition(pos).line;
    return IGNORE.test(lines[line] ?? '') || IGNORE.test(lines[line - 1] ?? '');
  };
  const report = (node: ts.Node, snippet: string): void => {
    // JSX text starts right after the previous tag/brace; report the line of its first visible character.
    const pos = node.getStart(sf) + (ts.isJsxText(node) ? node.text.search(/\S/) : 0);
    if (ignored(pos)) return;
    out.push({ file, line: sf.getLineAndCharacterOfPosition(pos).line + 1, text: snippet.trim().slice(0, 60) });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      if (LETTER.test(node.text)) report(node, node.text);
    } else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      // Child expression rendered as text: {'Gefecht starten'}, {cond ? 'Ja' : 'Nein'}.
      const lit = literalText(node.expression);
      if (lit !== null && LETTER.test(lit)) report(node, lit);
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      const init = node.initializer;
      if (TEXT_ATTRS.has(name) && init) {
        const lit = ts.isJsxExpression(init) ? (init.expression ? literalText(init.expression) : null) : literalText(init);
        if (lit !== null && LETTER.test(lit)) report(node, `${name}=${lit}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe('i18n scanner', () => {
  test('flags JSX text, literal child expressions and literal text attributes, honours i18n-ignore with a reason', () => {
    const src = [
      'export const A = () => (',
      '  <div title="Hallo" aria-label={"Karte"} placeholder={`Suche ${1}`}>',
      '    Gefecht',
      '    {/* i18n-ignore: brand name stays */}',
      '    Flow & Fire',
      '    {/* i18n-ignore: */}',
      '    Ohne Grund',
      '    <b alt={x ? "ja" : "nein"}>{"literal in braces"}</b>',
      '    <i title={t("ui.common.back")} aria-label={label}>{"×"} 1 / 2 · 58</i>',
      '    <>{ok ? "Ja" : "Nein"}{busy && "Lädt"}{name ?? "Unbekannt"}{`Stufe ${n}`}{"+" + 1}{cond ? t("ui.a") : null}</>',
      '    {/* i18n-ignore: debug id */}',
      '    {"core:cube"}',
      '  </div>',
      ');',
    ].join('\n');
    const v = scanSource('fixture.tsx', src);
    expect(v.map((x) => x.line)).toEqual([2, 2, 2, 3, 7, 8, 8, 10, 10, 10, 10]);
    expect(v.map((x) => x.text)).toEqual([
      'title=Hallo',
      'aria-label=Karte',
      'placeholder=Suche',
      'Gefecht',
      'Ohne Grund',
      'alt=ja nein',
      'literal in braces',
      'Ja Nein',
      'Lädt',
      'Unbekannt',
      'Stufe',
    ]);
  });

  test('packages/hud/src/**/*.tsx has no hard-coded UI strings', () => {
    const files = listTsx(SRC);
    expect(files.length).toBeGreaterThan(10);
    const violations = files.flatMap((f) => scanSource(relative(SRC, f), readFileSync(f, 'utf8')));
    expect(violations).toEqual([]);
  });
});
