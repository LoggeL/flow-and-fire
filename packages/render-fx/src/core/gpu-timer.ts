/**
 * GPU time per frame segment via EXT_disjoint_timer_query_webgl2 (ported from
 * tools/render-bench/src/gpu-timer.ts and extended to named segments).
 *
 * Only one TIME_ELAPSED query may be active at a time, and the RHI device starts its own frame
 * query when it sees the extension. {@link hideTimerQueryFromDevice} therefore hides the extension
 * from everyone but the returned accessor (call it BEFORE `createWebGL2Device`), and
 * {@link GpuSpanTimer} owns the queries: consecutive (never nested) segments per frame, results
 * collected asynchronously a few frames later, disjoint results dropped.
 */

const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;
const QUERY_RESULT = 0x8866;
const QUERY_RESULT_AVAILABLE = 0x8867;
export const TIMER_QUERY_EXT = 'EXT_disjoint_timer_query_webgl2';

/** The subset of WebGL2 the timer needs (a fake implements it in tests). */
export interface TimerGl {
  createQuery(): WebGLQuery | null;
  deleteQuery(q: WebGLQuery | null): void;
  beginQuery(target: number, q: WebGLQuery): void;
  endQuery(target: number): void;
  getQueryParameter(q: WebGLQuery, pname: number): unknown;
  getParameter(pname: number): unknown;
  isContextLost(): boolean;
}

/**
 * Makes `gl.getExtension(TIMER_QUERY_EXT)` return null for everyone but the returned accessor, so the
 * RHI device does not start its own TIME_ELAPSED query. The accessor re-enables the extension on each
 * call (needed again after a context restore).
 */
export function hideTimerQueryFromDevice(gl: WebGL2RenderingContext): () => object | null {
  const original = gl.getExtension.bind(gl);
  const patched = ((name: string) => (name === TIMER_QUERY_EXT ? null : original(name))) as typeof gl.getExtension;
  Object.defineProperty(gl, 'getExtension', { value: patched, configurable: true, writable: true });
  return () => original(TIMER_QUERY_EXT) as object | null;
}

interface Pending {
  query: WebGLQuery | null;
  frame: number;
  segment: number;
}

/** Called for every resolved segment: frame index, segment index, GPU milliseconds. */
export type GpuSpanSink = (frame: number, segment: number, ms: number) => void;

export class GpuSpanTimer {
  readonly available: boolean;
  readonly segments: readonly string[];
  /** Latest resolved GPU time per segment in ms (NaN until the first result). */
  readonly latestMs: Float64Array;
  /** Frame index the latest value of each segment belongs to (-1 = none). */
  readonly latestFrame: Int32Array;
  /** Frames (segments) skipped because the query pool was exhausted. */
  skipped = 0;
  /** Results dropped because of GPU_DISJOINT. */
  disjoint = 0;
  /** Current frame index (incremented by `beginFrame`). */
  frame = -1;

  private readonly pool: Pending[] = [];
  private readonly pending: Pending[] = [];
  private active: Pending | null = null;
  private readonly poolSize: number;

  /**
   * @param ext the extension object or the accessor from {@link hideTimerQueryFromDevice}; null = unavailable.
   * @param segments segment names in encode order (e.g. shadow, opaque, shields, particles, beams, post).
   * @param poolSize maximum queries in flight (default 8 frames × segment count).
   */
  constructor(
    private readonly gl: TimerGl,
    private readonly ext: object | (() => object | null) | null,
    segments: readonly string[],
    poolSize = Math.max(8, segments.length * 8),
  ) {
    if (segments.length === 0) throw new Error('GpuSpanTimer: at least one segment required');
    this.available = (typeof ext === 'function' ? ext() : ext) !== null;
    this.segments = segments.slice();
    this.latestMs = new Float64Array(segments.length).fill(Number.NaN);
    this.latestFrame = new Int32Array(segments.length).fill(-1);
    this.poolSize = poolSize;
  }

  /** Index of a segment name (-1 if unknown). */
  segmentIndex(name: string): number {
    return this.segments.indexOf(name);
  }

  /** Starts a new frame (ends a still running segment). */
  beginFrame(): void {
    this.end();
    this.frame++;
  }

  /** Ends the running segment and starts timing segment `segment` (index) of the current frame. */
  begin(segment: number): void {
    if (!this.available) return;
    this.end();
    if (segment < 0 || segment >= this.segments.length) throw new RangeError(`GpuSpanTimer: unknown segment ${segment}`);
    if (this.gl.isContextLost()) return;
    if (this.pending.length >= this.poolSize) {
      this.skipped++;
      return;
    }
    const p = this.pool.pop() ?? { query: null, frame: 0, segment: 0 };
    if (p.query === null) p.query = this.gl.createQuery();
    if (p.query === null) {
      this.pool.push(p);
      return;
    }
    p.frame = this.frame;
    p.segment = segment;
    this.gl.beginQuery(TIME_ELAPSED_EXT, p.query);
    this.active = p;
  }

  /** {@link begin} by name (linear lookup over a handful of names, no allocation). */
  beginNamed(name: string): void {
    const i = this.segmentIndex(name);
    if (i < 0) throw new RangeError(`GpuSpanTimer: unknown segment ${name}`);
    this.begin(i);
  }

  /** Ends the running segment (no-op if none). */
  end(): void {
    const a = this.active;
    if (a === null) return;
    this.active = null;
    if (this.gl.isContextLost()) {
      this.pool.push(a);
      return;
    }
    this.gl.endQuery(TIME_ELAPSED_EXT);
    this.pending.push(a);
  }

  /** Ends the running segment of the frame. */
  endFrame(): void {
    this.end();
  }

  /**
   * Collects finished queries in submission order, updates {@link latestMs} and calls `sink` for each
   * valid result. Call once per frame (after `endFrame`).
   */
  poll(sink?: GpuSpanSink): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    while (this.pending.length > 0) {
      const p = this.pending[0]!;
      if (gl.getQueryParameter(p.query!, QUERY_RESULT_AVAILABLE) !== true) break;
      const disjoint = gl.getParameter(GPU_DISJOINT_EXT) === true;
      const ns: unknown = gl.getQueryParameter(p.query!, QUERY_RESULT);
      this.pending.shift();
      this.pool.push(p);
      if (disjoint) {
        this.disjoint++;
        continue;
      }
      if (typeof ns !== 'number') continue;
      const ms = ns / 1e6;
      this.latestMs[p.segment] = ms;
      this.latestFrame[p.segment] = p.frame;
      sink?.(p.frame, p.segment, ms);
    }
  }

  /** Sum of the latest values of all segments that belong to the same (newest complete) frame; NaN if none. */
  latestTotalMs(): number {
    let frame = -1;
    for (let i = 0; i < this.latestFrame.length; i++) frame = Math.max(frame, this.latestFrame[i]!);
    if (frame < 0) return Number.NaN;
    let sum = 0;
    for (let i = 0; i < this.latestMs.length; i++) if (this.latestFrame[i] === frame) sum += this.latestMs[i]!;
    return sum;
  }

  /** Queries still in flight. */
  get inFlight(): number {
    return this.pending.length;
  }

  /**
   * Forgets every query (call on context loss: the query objects died with the context) and
   * re-enables the extension through the accessor (call again after restore).
   */
  reset(): void {
    this.active = null;
    for (const p of this.pending) p.query = null;
    for (const p of this.pool) p.query = null;
    this.pool.push(...this.pending);
    this.pending.length = 0;
    if (typeof this.ext === 'function' && !this.gl.isContextLost()) this.ext();
  }

  dispose(): void {
    const lost = this.gl.isContextLost();
    if (this.active !== null && !lost) this.gl.endQuery(TIME_ELAPSED_EXT);
    this.active = null;
    for (const p of [...this.pool, ...this.pending]) {
      if (p.query !== null && !lost) this.gl.deleteQuery(p.query);
      p.query = null;
    }
    this.pool.length = 0;
    this.pending.length = 0;
  }
}
