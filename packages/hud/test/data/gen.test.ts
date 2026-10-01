import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHORT_MAX, cleanAdjacencyDe, generate, symbolId } from '../../scripts/gen-data.ts';
import { ICON_IDS } from '../../src/data/icons.gen.ts';

const PKG = resolve(import.meta.dirname, '../..');

describe('gen-data', () => {
  it('generated files are up to date and the generator is idempotent', () => {
    const a = generate();
    const b = generate();
    expect(a.map((f) => f.content)).toEqual(b.map((f) => f.content));
    for (const f of a) expect(readFileSync(f.path, 'utf8'), f.path).toBe(f.content);
  });

  it('output is deterministic text: LF only, no timestamps, trailing newline', () => {
    for (const f of generate()) {
      expect(f.content.includes('\r'), f.path).toBe(false);
      expect(f.content.endsWith('\n'), f.path).toBe(true);
      expect(f.content, f.path).not.toMatch(/20\d\d-\d\d-\d\dT|Generated (at|on)/);
    }
  });

  it('`gen --check` (with a literal --) exits 0', () => {
    const tsx = resolve(PKG, 'node_modules/.bin/tsx');
    const r = spawnSync(tsx, ['scripts/gen-data.ts', '--', '--check'], { cwd: PKG, encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/4 files up to date/);
  });

  it('rejects unknown arguments', () => {
    const tsx = resolve(PKG, 'node_modules/.bin/tsx');
    const r = spawnSync(tsx, ['scripts/gen-data.ts', '--bogus'], { cwd: PKG, encoding: 'utf8' });
    expect(r.status).toBe(2);
  });

  it('helpers', () => {
    expect(SHORT_MAX).toBe(10);
    expect(symbolId('land_direct_t1')).toBe('si-land_direct_t1');
    expect(symbolId('wall.ghost')).toBe('si-wall--ghost');
    expect(cleanAdjacencyDe('A (FA-Relation, max. 4) B (FA-Relation): C')).toBe('A (max. 4) B: C');
  });

  it('mask CSS has one rule per base icon', () => {
    const css = generate().find((f) => f.path.endsWith('icons-mask.gen.css'))!.content;
    for (const id of ICON_IDS) expect(css, id).toContain(`.si-mask-${id} { --si-mask: url("data:image/svg+xml,`);
    // Data URLs are standalone images: no CSS variables inside.
    for (const url of css.match(/url\("data:[^"]+"\)/g) ?? []) expect(url).not.toContain('var(');
    expect(css.match(/\.si-mask-[a-z0-9_]+ \{/g)).toHaveLength(ICON_IDS.length);
  });
});
