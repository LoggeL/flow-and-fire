import { listLogFiles, readLogFile, LOG_DIR_NAME, type DirectoryHandleLike } from '../opfs.ts';
import { convertCommandLog, type ConvertOptions, type ConvertResult } from './convert.ts';
export async function listRecordedLogs(root: DirectoryHandleLike): Promise<string[]> {
  try { return await listLogFiles(await root.getDirectoryHandle(LOG_DIR_NAME, { create: false })); }
  catch (error) { if (error instanceof Error && error.name === 'NotFoundError') return []; throw error; }
}
export async function exportRecordedLogAsReplay(root: DirectoryHandleLike, name: string, options: ConvertOptions): Promise<ConvertResult> {
  return convertCommandLog(await readLogFile(root, name), options);
}
