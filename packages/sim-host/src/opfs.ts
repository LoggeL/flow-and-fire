/**
 * OPFS persistence of the command log (PLAN §3.11: "läuft ab MS1 fortlaufend im OPFS mit,
 * übersteht einen Crash; es bleiben die letzten N Spiele erhalten").
 *
 * Only dedicated workers get `FileSystemFileHandle.createSyncAccessHandle()`, which allows
 * synchronous appends from the tick loop. The directory/handle types are structural so tests can
 * run against an in-memory fake and so that the code type-checks without the DOM async-iterable
 * lib.
 */

import type { LogSink } from './recorder.ts';

/** Directory holding the logs inside the origin-private file system. */
export const LOG_DIR_NAME = 'faf-logs';
export const LOG_FILE_PREFIX = 'log-';
export const LOG_FILE_SUFFIX = '.faflog';
/** Logs kept (including the current game). */
export const DEFAULT_KEEP_LOGS = 5;

export interface SyncAccessHandleLike {
  write(buffer: Uint8Array, options?: { at?: number }): number;
  truncate(size: number): unknown;
  flush(): unknown;
  close(): unknown;
}
export interface FileHandleLike {
  createSyncAccessHandle(): Promise<SyncAccessHandleLike>;
}
export interface DirectoryHandleLike {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string): Promise<void>;
  keys(): AsyncIterable<string>;
}

/** Calls a maybe-async handle method and swallows a rejected promise (old Chrome made them async). */
function settle(r: unknown): void {
  if (typeof r === 'object' && r !== null && typeof (r as Promise<unknown>).then === 'function') {
    (r as Promise<unknown>).catch(() => undefined);
  }
}

/** LogSink on an OPFS sync access handle. */
export class OpfsLogSink implements LogSink {
  readonly kind = 'opfs' as const;
  readonly name: string;
  private readonly handle: SyncAccessHandleLike;
  /** Reused options object (keeps `write` allocation-free). */
  private readonly at: { at: number } = { at: 0 };
  private closed = false;

  constructor(name: string, handle: SyncAccessHandleLike) {
    this.name = name;
    this.handle = handle;
  }

  write(bytes: Uint8Array, off: number, len: number, at: number): void {
    if (this.closed) throw new Error('OPFS log sink is closed');
    if (len === 0) return;
    this.at.at = at;
    const view = off === 0 && len === bytes.length ? bytes : bytes.subarray(off, off + len);
    const n = this.handle.write(view, this.at);
    if (n !== len) throw new Error(`OPFS short write: ${n} of ${len} bytes`);
  }

  truncate(size: number): void {
    settle(this.handle.truncate(size));
  }

  flush(): void {
    if (!this.closed) settle(this.handle.flush());
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { settle(this.handle.flush()); }
    finally { settle(this.handle.close()); }
  }
}

/** The OPFS root of this context, or null if unavailable (Node, old browsers, blocked storage). */
export async function opfsRoot(): Promise<DirectoryHandleLike | null> {
  const nav = (globalThis as { navigator?: { storage?: { getDirectory?: () => Promise<unknown> } } }).navigator;
  const getDirectory = nav?.storage?.getDirectory;
  if (typeof getDirectory !== 'function') return null;
  try {
    return (await getDirectory.call(nav!.storage)) as DirectoryHandleLike;
  } catch {
    return null;
  }
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

/** File name `log-YYYYMMDDTHHMMSSmmm-<simId hex>-<suffix>.faflog` (sorts chronologically). */
export function logFileName(simId: number, date: Date, unique: number): string {
  const ts =
    pad(date.getUTCFullYear(), 4) +
    pad(date.getUTCMonth() + 1, 2) +
    pad(date.getUTCDate(), 2) +
    'T' +
    pad(date.getUTCHours(), 2) +
    pad(date.getUTCMinutes(), 2) +
    pad(date.getUTCSeconds(), 2) +
    pad(date.getUTCMilliseconds(), 3);
  return `${LOG_FILE_PREFIX}${ts}-${(simId >>> 0).toString(16).padStart(8, '0')}-${(unique >>> 0).toString(36)}${LOG_FILE_SUFFIX}`;
}

/** Log file names in `dir`, oldest first. */
export async function listLogFiles(dir: DirectoryHandleLike): Promise<string[]> {
  const names: string[] = [];
  for await (const name of dir.keys()) {
    if (name.startsWith(LOG_FILE_PREFIX) && name.endsWith(LOG_FILE_SUFFIX)) names.push(name);
  }
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return names;
}

export interface OpenOpfsLogOptions {
  readonly simId: number;
  /** Logs kept including the new one (default 5). */
  readonly keep?: number;
  /** Clock for the file name (default: now). */
  readonly date?: Date;
}

/**
 * Creates a new log file in `<root>/faf-logs/`, opens a sync access handle on it and deletes the
 * oldest logs so that at most `keep` remain. Files that are still open elsewhere (another tab)
 * cannot be removed and are skipped.
 */
export async function openOpfsLogSink(root: DirectoryHandleLike, options: OpenOpfsLogOptions): Promise<OpfsLogSink> {
  const dir = await root.getDirectoryHandle(LOG_DIR_NAME, { create: true });
  const name = logFileName(options.simId, options.date ?? new Date(), Math.floor(Math.random() * 0x7fffffff));
  const file = await dir.getFileHandle(name, { create: true });
  const handle = await file.createSyncAccessHandle();
  const sink = new OpfsLogSink(name, handle);
  const keep = Math.max(1, options.keep ?? DEFAULT_KEEP_LOGS);
  try {
    const names = await listLogFiles(dir);
    let excess = names.length - keep;
    for (let i = 0; i < names.length && excess > 0; i++) {
      const n = names[i]!;
      if (n === name) continue;
      try {
        await dir.removeEntry(n);
      } catch {
        // locked by another context: keep it
      }
      excess--;
    }
  } catch {
    // pruning is best effort; the new log is open either way
  }
  return sink;
}

/** Reads a stored log file (e.g. to recover the log of a crashed game). */
export async function readLogFile(root: DirectoryHandleLike, name: string): Promise<Uint8Array> {
  const dir = await root.getDirectoryHandle(LOG_DIR_NAME, { create: false });
  const file = (await dir.getFileHandle(name, { create: false })) as FileHandleLike & { getFile?: () => Promise<Blob> };
  if (typeof file.getFile !== 'function') throw new Error('file handle cannot be read');
  const blob = await file.getFile();
  return new Uint8Array(await blob.arrayBuffer());
}
