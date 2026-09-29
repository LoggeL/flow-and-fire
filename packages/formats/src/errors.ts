/**
 * Error type of all binary format readers/writers (container, .rtsmap). Carries a machine-readable
 * code, the 4CC of the chunk the problem was found in (null = file header / whole file) and the
 * byte offset in the input (-1 = not position related, e.g. a semantic validation of a value).
 */

export type FormatErrorCode =
  | 'truncated'
  | 'bad-magic'
  | 'bad-container-version'
  | 'bad-format-version'
  | 'bad-reserved'
  | 'bad-chunk-id'
  | 'bad-length'
  | 'bad-crc'
  | 'bad-padding'
  | 'trailing-bytes'
  | 'missing-chunk'
  | 'duplicate-chunk'
  | 'chunk-order'
  | 'bad-json'
  | 'non-canonical'
  | 'bad-value';

export class FormatError extends Error {
  readonly code: FormatErrorCode;
  readonly chunkId: string | null;
  readonly offset: number;

  constructor(code: FormatErrorCode, detail: string, chunkId: string | null = null, offset = -1) {
    const where = (chunkId !== null ? ` in chunk '${chunkId}'` : '') + (offset >= 0 ? ` at byte ${offset}` : '');
    super(`${code}${where}: ${detail}`);
    this.name = 'FormatError';
    this.code = code;
    this.chunkId = chunkId;
    this.offset = offset;
  }
}
