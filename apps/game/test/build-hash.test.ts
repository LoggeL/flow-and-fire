import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveBuildHash } from '../scripts/build-hash.ts';

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

function checkout(): { root: string; app: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'faf-build-hash-'));
  directories.push(root);
  const app = join(root, 'apps/game');
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, 'tracked.ts'), 'export const base = 1;\n');
  writeFileSync(join(root, 'workspace.ts'), 'export const workspace = 1;\n');
  const git = (args: string[]): string => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  git(['init']);
  git(['add', '.']);
  git(['-c', 'user.name=Build Test', '-c', 'user.email=build-test@example.invalid',
    '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
  return { root, app, head: git(['rev-parse', '--short=12', 'HEAD']) };
}

describe('immutable build identity', () => {
  it('uses the commit for a clean tree and hashes untracked UI contents from a nested app', () => {
    const { root, app, head } = checkout();
    expect(resolveBuildHash(app, {})).toBe(head);
    const file = join(app, 'LiveHud.tsx');
    writeFileSync(file, 'export const layout = "dock";\n');
    const dock = resolveBuildHash(app, {});
    expect(dock).toMatch(new RegExp(`^${head}-d[0-9a-f]{8}$`));
    expect(resolveBuildHash(root, {})).toBe(dock);
    writeFileSync(file, 'export const layout = "minimal";\n');
    const minimal = resolveBuildHash(app, {});
    expect(minimal).not.toBe(dock);
    expect(resolveBuildHash(app, {})).toBe(minimal);
  });

  it('includes untracked sibling packages and tracked changes outside the app', () => {
    const { root, app } = checkout();
    const before = resolveBuildHash(app, {});
    const sibling = join(root, 'packages/client');
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'rig.ts'), 'export const pose = 1;\n');
    const added = resolveBuildHash(app, {});
    expect(added).not.toBe(before);
    writeFileSync(join(sibling, 'rig.ts'), 'export const pose = 2;\n');
    const edited = resolveBuildHash(app, {});
    expect(edited).not.toBe(added);
    writeFileSync(join(root, 'workspace.ts'), 'export const workspace = 2;\n');
    expect(resolveBuildHash(app, {})).not.toBe(edited);
    expect(resolveBuildHash(root, {})).toBe(resolveBuildHash(app, {}));
  });

  it('preserves validated explicit build overrides and rejects invalid ones', () => {
    const { app, head } = checkout();
    expect(resolveBuildHash(app, { FAF_BUILD_HASH: 'release_2', IRONFLOW_BUILD_HASH: 'older' })).toBe('release_2');
    expect(resolveBuildHash(app, { IRONFLOW_BUILD_HASH: 'older' })).toBe('older');
    expect(resolveBuildHash(app, { FAF_BUILD_HASH: '../escape' })).toBe(head);
  });
});
