/**
 * Bucket index for radius queries of the PlatoonManager (one build per think). Queries visit the
 * buckets overlapping the query square in row-major order and the items of a bucket in insertion
 * (perception) order, so float sums over the result are deterministic (ai.md §2.5). The number of
 * visited items is what the op budget is charged with (1 op per visited unit, ai.md §2.3).
 */
export interface Positioned {
  readonly x: number;
  readonly z: number;
}

export const BUCKET_WU = 32;

export class SpatialBuckets<T extends Positioned> {
  private readonly dim: number;
  private readonly buckets: T[][];
  private readonly used: number[] = [];
  private count = 0;

  constructor(sizeWu: number) {
    this.dim = Math.max(1, Math.ceil(sizeWu / BUCKET_WU));
    this.buckets = [];
    for (let i = 0; i < this.dim * this.dim; i++) this.buckets.push([]);
  }

  private b(v: number): number {
    const c = Math.floor(v / BUCKET_WU);
    return c < 0 ? 0 : c >= this.dim ? this.dim - 1 : c;
  }

  clear(): void {
    for (const i of this.used) this.buckets[i]!.length = 0;
    this.used.length = 0;
    this.count = 0;
  }

  add(item: T): void {
    const i = this.b(item.z) * this.dim + this.b(item.x);
    const list = this.buckets[i]!;
    if (list.length === 0) this.used.push(i);
    list.push(item);
    this.count++;
  }

  get size(): number {
    return this.count;
  }

  /** Number of items in the buckets overlapping the square around (x, z) with half size r. */
  countNear(x: number, z: number, r: number): number {
    let n = 0;
    for (let bz = this.b(z - r); bz <= this.b(z + r); bz++) {
      for (let bx = this.b(x - r); bx <= this.b(x + r); bx++) n += this.buckets[bz * this.dim + bx]!.length;
    }
    return n;
  }

  /** Appends the items of the overlapping buckets to `out` (not filtered by distance). */
  gather(x: number, z: number, r: number, out: T[]): T[] {
    for (let bz = this.b(z - r); bz <= this.b(z + r); bz++) {
      for (let bx = this.b(x - r); bx <= this.b(x + r); bx++) {
        const list = this.buckets[bz * this.dim + bx]!;
        for (let i = 0; i < list.length; i++) out.push(list[i]!);
      }
    }
    return out;
  }
}
