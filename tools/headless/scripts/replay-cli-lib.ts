import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadSimBin, REPO_DIR } from './lib.ts';
import type { ReplayAssets } from '../src/replay/verify.ts';
export const invocationDirectory = process.env['INIT_CWD'] ?? process.cwd();
export const inputPath = (path: string): string => resolve(invocationDirectory, path);
export const fileBytes = (path: string): Uint8Array => new Uint8Array(readFileSync(path));
export function replayAssets(extraMap?: string): ReplayAssets {
  const directory = resolve(REPO_DIR, 'content/maps'), maps: Record<string, Uint8Array> = {};
  for (const name of readdirSync(directory).filter((n) => n.endsWith('.rtsmap')).sort()) maps[name] = fileBytes(resolve(directory, name));
  if (extraMap !== undefined) maps[extraMap] = fileBytes(inputPath(extraMap));
  return { simBin: loadSimBin(), maps };
}
export function goldenReplayFiles(): string[] {
  const dir = resolve(REPO_DIR, 'test/golden-replays');
  return readdirSync(dir).filter((n) => n.endsWith('.rtsreplay')).sort().map((n) => resolve(dir, n));
}
export function uintArgument(value: string | undefined, name: string): number {
  if (value === undefined || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${name}: nichtnegative Ganzzahl erwartet`);
  return Number(value);
}
