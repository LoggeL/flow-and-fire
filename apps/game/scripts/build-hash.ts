import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Identify the entire checkout, including the contents of newly added files. */
export function resolveBuildHash(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  for (const name of ['FAF_BUILD_HASH', 'IRONFLOW_BUILD_HASH']) {
    const override = env[name];
    if (override !== undefined && /^[A-Za-z0-9_-]{1,64}$/.test(override)) return override;
  }
  const git = (directory: string, args: string[]): Buffer => execFileSync('git', args, {
    cwd: directory, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024,
  });
  try {
    const root = git(cwd, ['rev-parse', '--show-toplevel']).toString().trim();
    const head = git(root, ['rev-parse', '--short=12', 'HEAD']).toString().trim();
    if (!/^[0-9a-f]{4,40}$/.test(head)) return 'dev';
    const diff = git(root, ['diff', 'HEAD', '--binary']);
    const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '--full-name', '-z'])
      .toString().split('\0').filter(Boolean).sort();
    if (diff.length === 0 && untracked.length === 0) return head;
    const hash = createHash('sha256').update(diff);
    for (const file of untracked) {
      hash.update(`\0${file}\0`);
      try { hash.update(readFileSync(resolve(root, file))); }
      catch { /* A vanished or unreadable file still contributes its name. */ }
    }
    return `${head}-d${hash.digest('hex').slice(0, 8)}`;
  } catch {
    return 'dev';
  }
}
