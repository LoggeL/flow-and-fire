/**
 * Fixed-capacity vertex buffer with a CPU staging copy (beams, trails, shields, lab units).
 *
 * The caller fills the typed views of the staging buffer and calls {@link DynamicInstanceBuffer.upload}
 * with the element count – exactly one `writeBuffer` per upload. After a context loss the device
 * re-creates the GPU buffer and the restore callback re-uploads the last uploaded range from staging.
 */
import type { BufH, GpuDevice } from '@faf/render';

export interface DynamicInstanceBufferDesc {
  readonly label?: string;
  /** Bytes per element (multiple of 4 recommended for aligned f32/i32 views). */
  readonly stride: number;
  /** Maximum element count. */
  readonly capacity: number;
}

export class DynamicInstanceBuffer {
  readonly buffer: BufH;
  readonly stride: number;
  readonly capacity: number;
  /** Staging memory (capacity × stride bytes, rounded up to 4). */
  readonly data: ArrayBuffer;
  readonly f32: Float32Array;
  readonly i32: Int32Array;
  readonly u32: Uint32Array;
  readonly i16: Int16Array;
  readonly u16: Uint16Array;
  readonly i8: Int8Array;
  readonly u8: Uint8Array;
  /** Element count of the last upload. */
  count = 0;
  /** Number of uploads (and restores) so far. */
  uploads = 0;
  private destroyed = false;

  constructor(
    private readonly dev: GpuDevice,
    desc: DynamicInstanceBufferDesc,
  ) {
    if (!Number.isInteger(desc.stride) || desc.stride <= 0) throw new Error(`DynamicInstanceBuffer: invalid stride ${desc.stride}`);
    if (!Number.isInteger(desc.capacity) || desc.capacity <= 0) {
      throw new Error(`DynamicInstanceBuffer: invalid capacity ${desc.capacity}`);
    }
    this.stride = desc.stride;
    this.capacity = desc.capacity;
    const bytes = Math.ceil((desc.stride * desc.capacity) / 4) * 4;
    this.data = new ArrayBuffer(bytes);
    this.f32 = new Float32Array(this.data);
    this.i32 = new Int32Array(this.data);
    this.u32 = new Uint32Array(this.data);
    this.i16 = new Int16Array(this.data);
    this.u16 = new Uint16Array(this.data);
    this.i8 = new Int8Array(this.data);
    this.u8 = new Uint8Array(this.data);
    this.buffer = dev.createBuffer({
      label: desc.label ?? 'fx.instances',
      usage: 'vertex',
      size: bytes,
      dynamic: true,
      restore: (h) => this.writeRange(h),
    });
  }

  /** Uploads elements [0, count) from staging with a single writeBuffer. Returns the uploaded bytes. */
  upload(count: number): number {
    if (this.destroyed) throw new Error('DynamicInstanceBuffer: upload after destroy');
    if (!Number.isInteger(count) || count < 0 || count > this.capacity) {
      throw new RangeError(`DynamicInstanceBuffer: count ${count} outside [0, ${this.capacity}]`);
    }
    this.count = count;
    return this.writeRange(this.buffer);
  }

  private writeRange(h: BufH): number {
    const n = this.count * this.stride;
    if (n === 0) return 0;
    this.dev.writeBuffer(h, 0, this.u8, 0, n);
    this.uploads++;
    return n;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.dev.destroyBuffer(this.buffer);
  }
}
