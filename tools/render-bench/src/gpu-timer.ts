/**
 * Per-frame GPU time via EXT_disjoint_timer_query_webgl2 (where the browser exposes it).
 *
 * The RHI device times frames itself but only reports the latest resolved value; the benchmark needs
 * one sample per frame index (and per segment: shadows / scene / post, consecutive queries – nesting is
 * not allowed). {@link hideTimerQueryFromDevice} therefore hides the extension from the
 * device (own-property shadowing of `getExtension` on the context instance – no proxy, no per-call
 * overhead) and this timer owns the TIME_ELAPSED queries: one query per segment from a small pool,
 * results collected asynchronously (a few frames later) and keyed by frame index; disjoint results
 * are dropped.
 */

const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;
const TIMER_EXT = 'EXT_disjoint_timer_query_webgl2';
const POOL = 24;

/**
 * Makes `gl.getExtension(TIMER_EXT)` return null for everyone but the returned accessor, so the RHI
 * device does not start its own TIME_ELAPSED query (only one may be active at a time).
 */
export function hideTimerQueryFromDevice(gl: WebGL2RenderingContext): () => object | null {
  const original = gl.getExtension.bind(gl);
  const ext = original(TIMER_EXT) as object | null;
  const patched = ((name: string) => (name === TIMER_EXT ? null : original(name))) as typeof gl.getExtension;
  Object.defineProperty(gl, 'getExtension', { value: patched, configurable: true, writable: true });
  return () => ext;
}

interface Pending {
  query: WebGLQuery;
  frame: number;
  segment: number;
}

export class GpuTimer {
  readonly available: boolean;
  private readonly free: WebGLQuery[] = [];
  private readonly pending: Pending[] = [];
  private active: Pending | null = null;
  /** Frames skipped because the pool was exhausted (GPU far behind). */
  skipped = 0;
  /** Results dropped because of GPU_DISJOINT. */
  disjoint = 0;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    ext: object | null,
  ) {
    this.available = ext !== null;
  }

  /** Starts timing segment `segment` of `frame` (ends a running segment first). */
  begin(frame: number, segment = 0): void {
    if (!this.available) return;
    if (this.active !== null) this.end();
    if (this.pending.length >= POOL) {
      this.skipped++;
      return;
    }
    const q = this.free.pop() ?? this.gl.createQuery();
    if (q === null) return;
    this.gl.beginQuery(TIME_ELAPSED_EXT, q);
    this.active = { query: q, frame, segment };
  }

  end(): void {
    const a = this.active;
    if (a === null) return;
    this.gl.endQuery(TIME_ELAPSED_EXT);
    this.pending.push(a);
    this.active = null;
  }

  /** Collects finished queries in order; calls `sink(frame, segment, ms)` for each valid result. */
  poll(sink: (frame: number, segment: number, ms: number) => void): void {
    const gl = this.gl;
    while (this.pending.length > 0) {
      const p = this.pending[0]!;
      if (gl.getQueryParameter(p.query, gl.QUERY_RESULT_AVAILABLE) !== true) break;
      const disjoint = gl.getParameter(GPU_DISJOINT_EXT) === true;
      const ns: unknown = gl.getQueryParameter(p.query, gl.QUERY_RESULT);
      this.pending.shift();
      this.free.push(p.query);
      if (disjoint) {
        this.disjoint++;
        continue;
      }
      if (typeof ns === 'number') sink(p.frame, p.segment, ns / 1e6);
    }
  }

  /** Queries still in flight. */
  get inFlight(): number {
    return this.pending.length;
  }

  dispose(): void {
    for (const q of this.free) this.gl.deleteQuery(q);
    for (const p of this.pending) this.gl.deleteQuery(p.query);
    this.free.length = 0;
    this.pending.length = 0;
  }
}
