/**
 * Replays from the command logs kept in the OPFS (PLAN §3.11 "es bleiben die letzten N Spiele
 * erhalten, Export als Download"): list the stored logs and convert one into a .rtsreplay — for
 * the replay browser/download of MS11 and for the crash case (tab killed mid-game: the log has no
 * END entry, maybe a torn tail, and becomes a Truncated replay up to its last valid tick).
 *
 * Reading uses `FileSystemFileHandle.getFile()`, which works in every context (window or worker)
 * while another context may still hold the sync access handle of a running game's log.
 */

import { LOG_DIR_NAME, LOG_FILE_SUFFIX, listLogFiles, readLogFile, type DirectoryHandleLike } from '../opfs.ts';
import { convertCommandLog, type ConvertOptions, type ConvertResult } from './convert.ts';

/** File suffix of exported replays. */
export const REPLAY_FILE_SUFFIX = '.rtsreplay';

/** Names of the command logs stored under `<root>/faf-logs/`, oldest first ([] if none). */
export async function listRecordedLogs(root: DirectoryHandleLike): Promise<string[]> {
  let dir: DirectoryHandleLike;
  try {
    dir = await root.getDirectoryHandle(LOG_DIR_NAME, { create: false });
  } catch {
    return [];
  }
  return listLogFiles(dir);
}

/** Download name of the replay of a stored log (`log-….faflog` → `log-….rtsreplay`). */
export function replayFileNameForLog(logName: string): string {
  const base = logName.endsWith(LOG_FILE_SUFFIX) ? logName.slice(0, logName.length - LOG_FILE_SUFFIX.length) : logName;
  return base + REPLAY_FILE_SUFFIX;
}

/**
 * Reads the stored log `name` and converts it (convertCommandLog). Rejects if the file cannot be
 * read or is not a command log (CommandLogError).
 */
export async function exportRecordedLogAsReplay(root: DirectoryHandleLike, name: string, options: ConvertOptions = {}): Promise<ConvertResult> {
  const bytes = await readLogFile(root, name);
  return convertCommandLog(bytes, options);
}
