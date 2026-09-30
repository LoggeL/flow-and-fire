/** German messages for load/save failures (FormatError codes, HTTP, file reading). */
import { FormatError } from '@faf/formats';
import { FORMAT_ERROR_TEXT } from '../app/strings.ts';

/** A failed HTTP request of a bundled map (message contains the status code). */
export class HttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string) {
    super(`HTTP ${status}: ${url} ${status === 404 ? 'nicht gefunden' : 'nicht abrufbar'}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

/** German one-line description of any load/save error (never throws). */
export function describeError(e: unknown): string {
  if (e instanceof FormatError) {
    const text = FORMAT_ERROR_TEXT[e.code] ?? 'ungültige Kartendatei';
    const where = e.chunkId !== null ? ` in Chunk ${e.chunkId}` : '';
    return `${text}${where} (${e.message})`;
  }
  if (e instanceof HttpError) return e.message;
  if (e instanceof TypeError && /fetch|network/i.test(e.message)) return `Netzwerkfehler (${e.message})`;
  if (e instanceof Error) return e.message;
  return String(e);
}
