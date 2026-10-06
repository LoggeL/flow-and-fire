import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const STYLES = join(HERE, '../../src/styles');
const MOCKUP = join(HERE, '../../../../docs/design/ui-mockups/assets');

const read = (p: string): string => readFileSync(p, 'utf8');

interface Decl {
  readonly context: string;
  readonly prop: string;
  readonly value: string;
}

/** Minimal CSS reader: declarations with their block context (e.g. "@media (…) > :root"). */
function declarations(css: string): Decl[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack: string[] = [];
  const out: Decl[] = [];
  let buf = '';
  for (const ch of src) {
    if (ch === '{') {
      stack.push(buf.trim().replace(/\s+/g, ' '));
      buf = '';
    } else if (ch === '}' || ch === ';') {
      const text = buf.trim();
      const i = text.indexOf(':');
      if (stack.length > 0 && i > 0) {
        out.push({ context: stack.join(' > '), prop: text.slice(0, i).trim(), value: text.slice(i + 1).trim().replace(/\s+/g, ' ') });
      }
      buf = '';
      if (ch === '}') stack.pop();
    } else {
      buf += ch;
    }
  }
  return out;
}

const key = (d: Decl): string => `${d.context} | ${d.prop} | ${d.value}`;

describe('tokens.css', () => {
  test('is a 1:1 copy of the mockup tokens (every rule, custom property and value)', () => {
    const mine = declarations(read(join(STYLES, 'tokens.css'))).map(key);
    const mock = declarations(read(join(MOCKUP, 'tokens.css'))).map(key);
    expect(mock.length).toBeGreaterThan(130);
    expect(mine).toEqual(mock);
  });

  test('covers the documented tokens (ui.md §3)', () => {
    const props = new Set(declarations(read(join(STYLES, 'tokens.css'))).map((d) => d.prop));
    for (const p of ['--ember-500', '--text-lo', '--fs-micro', '--cell', '--hud-card-w', '--chamfer-m', '--z-tooltip', '--pulse', '--cvd-rot']) {
      expect(props.has(p), p).toBe(true);
    }
  });
});

describe('base.css', () => {
  test('ports every ff-* class of the mockup ff.css', () => {
    const classes = new Set(read(join(MOCKUP, 'ff.css')).match(/\.ff-[\w-]+/g));
    const base = read(join(STYLES, 'base.css'));
    const missing = [...classes].filter((c) => !new RegExp(`\\${c}(?![\\w-])`).test(base));
    expect(missing).toEqual([]);
  });

  test('keeps the mockup declarations of the ported rules', () => {
    const base = new Set(declarations(read(join(STYLES, 'base.css'))).map(key));
    const mock = declarations(read(join(MOCKUP, 'ff.css')))
      // generalised in base.css (bar warn/crit apply to every bar kind)
      .filter((d) => !d.context.startsWith('.ff-bar--hp.is-'));
    const missing = mock.map(key).filter((k) => !base.has(k));
    expect(missing).toEqual([]);
  });

  test('has the added states and settings hooks', () => {
    const base = read(join(STYLES, 'base.css'));
    for (const sel of [
      ':root[data-motion="reduce"]',
      ':root[data-motion="full"]',
      ':root[data-teams="house"]',
      '.ff-switch:disabled',
      '.ff-check.is-mixed',
      '.ff-seg.is-disabled',
      '.ff-range:disabled',
      '.ff-btn.is-pressed',
      '.ff-bar.is-crit > i',
    ]) {
      expect(base.includes(sel), sel).toBe(true);
    }
  });
});

describe('fonts.css', () => {
  const css = read(join(STYLES, 'fonts.css'));
  test('IBM Plex Sans Condensed 400/500/600/700 + Mono 400/600, font-display block', () => {
    const faces = [...css.matchAll(/@font-face \{([\s\S]*?)\}/g)].map((m) => m[1] as string);
    expect(faces.length).toBe(12);
    const got = faces.map((f) => `${/font-family: "([^"]+)"/.exec(f)?.[1]} ${/font-weight: (\d+)/.exec(f)?.[1]}`);
    for (const w of [400, 500, 600, 700]) expect(got).toContain(`IBM Plex Sans Condensed ${w}`);
    for (const w of [400, 600]) expect(got).toContain(`IBM Plex Mono ${w}`);
    for (const f of faces) expect(f).toContain('font-display: block;');
  });

  test('every referenced font file exists', () => {
    const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1] as string);
    expect(urls.length).toBe(24);
    for (const u of urls) expect(existsSync(resolve(STYLES, u)), u).toBe(true);
  });
});

describe('index.css', () => {
  test('imports fonts, tokens and base in order', () => {
    const imports = [...read(join(STYLES, 'index.css')).matchAll(/@import "([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(['./fonts.css', './tokens.css', './base.css']);
  });
});
