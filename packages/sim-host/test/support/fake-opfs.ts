import type { DirectoryHandleLike, FileHandleLike, SyncAccessHandleLike } from '../../src/index.ts';

/** In-memory file with the semantics of an OPFS sync access handle. */
export class FakeFile implements FileHandleLike {
  data = new Uint8Array(0);
  size = 0;
  open = false;
  flushes = 0;
  failWrites = false;

  async createSyncAccessHandle(): Promise<SyncAccessHandleLike> {
    if (this.open) throw new Error('NoModificationAllowedError: file is locked');
    this.open = true;
    return this.handle();
  }

  private handle(): SyncAccessHandleLike {
    const file: FakeFile = this as FakeFile;
    return {
      write(buffer: Uint8Array, options?: { at?: number }): number {
        if (!file.open) throw new Error('InvalidStateError: handle closed');
        if (file.failWrites) throw new Error('QuotaExceededError');
        const at = options?.at ?? file.size;
        const end = at + buffer.length;
        if (end > file.data.length) {
          const nd = new Uint8Array(Math.max(end, file.data.length * 2, 1024));
          nd.set(file.data.subarray(0, file.size));
          file.data = nd;
        }
        file.data.set(buffer, at);
        if (end > file.size) file.size = end;
        return buffer.length;
      },
      truncate(size: number): void {
        if (size < file.size) file.data.fill(0, size, file.size);
        file.size = size;
      },
      flush(): void {
        file.flushes++;
      },
      close(): void {
        file.open = false;
      },
    };
  }

  bytes(): Uint8Array {
    return this.data.slice(0, this.size);
  }
}

export class FakeDir implements DirectoryHandleLike {
  readonly dirs = new Map<string, FakeDir>();
  readonly files = new Map<string, FakeFile>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike> {
    let d = this.dirs.get(name);
    if (d === undefined) {
      if (options?.create !== true) throw new Error('NotFoundError');
      d = new FakeDir();
      this.dirs.set(name, d);
    }
    return d;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike> {
    let f = this.files.get(name);
    if (f === undefined) {
      if (options?.create !== true) throw new Error('NotFoundError');
      f = new FakeFile();
      this.files.set(name, f);
    }
    return f;
  }

  async removeEntry(name: string): Promise<void> {
    const f = this.files.get(name);
    if (f === undefined) throw new Error('NotFoundError');
    if (f.open) throw new Error('NoModificationAllowedError');
    this.files.delete(name);
  }

  async *keys(): AsyncIterable<string> {
    for (const k of [...this.files.keys(), ...this.dirs.keys()]) yield k;
  }
}
