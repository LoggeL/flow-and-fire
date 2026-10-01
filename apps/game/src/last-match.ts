import type { LastMatch } from '@faf/hud';

export const LAST_MATCH_KEY = 'faf.lastMatch.v1';
const VERDICTS = ['victory', 'defeat', 'draw'] as const;

/** Summary of the most recent finished skirmish; invalid or foreign data yields null. */
export function loadLastMatch(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Omit<LastMatch, 'hasReplay'> | null {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(LAST_MATCH_KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return null;
    const v = raw as Record<string, unknown>;
    if (typeof v['mapName'] !== 'string' || typeof v['opponent'] !== 'string' || !VERDICTS.includes(v['verdict'] as never)
      || typeof v['durationS'] !== 'number' || !Number.isFinite(v['durationS']) || v['durationS'] < 0) return null;
    return { mapName: v['mapName'], opponent: v['opponent'], verdict: v['verdict'] as LastMatch['verdict'], durationS: v['durationS'] };
  } catch { return null; }
}
export function saveLastMatch(match: Omit<LastMatch, 'hasReplay'>, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try { storage?.setItem(LAST_MATCH_KEY, JSON.stringify(match)); } catch { /* Private mode: the summary stays session-only. */ }
}
