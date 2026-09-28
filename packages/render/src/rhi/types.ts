/**
 * Render Hardware Interface (PLAN §3.7): a slim, WebGPU-shaped device abstraction.
 *
 * Nothing in this file references WebGL types. Resources are plain numeric handles so a later
 * WebGPU backend can implement the same interface. Shaders are GLSL ES 3.00 in MS1; a WebGPU
 * backend would add WGSL sources to {@link PipelineDesc}.
 */

declare const handleBrand: unique symbol;
type Handle<K extends string> = number & { readonly [handleBrand]: K };

export type BufH = Handle<'buffer'>;
export type TexH = Handle<'texture'>;
export type PipeH = Handle<'pipeline'>;
export type BindGroupH = Handle<'bindGroup'>;

// ---------------------------------------------------------------------------------------------
// Buffers
// ---------------------------------------------------------------------------------------------

export type BufferUsage = 'vertex' | 'index' | 'uniform';

export interface BufferDesc {
  readonly label?: string;
  readonly usage: BufferUsage;
  /** Size in bytes. */
  readonly size: number;
  /** Rewritten often (instance rings, per-frame UBOs) → DYNAMIC_DRAW-like hint. */
  readonly dynamic?: boolean;
  /**
   * Called after the device was restored (context loss) and the buffer was re-created empty.
   * Must re-upload the content via `writeBuffer`. Buffers rewritten every frame may omit it.
   */
  readonly restore?: (h: BufH) => void;
}

// ---------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------

export type TextureFormat = 'rgba8' | 'r8' | 'rg8' | 'r16ui' | 'r32ui' | 'r32f' | 'rgba16f';

export interface TexDesc {
  readonly label?: string;
  readonly width: number;
  readonly height: number;
  readonly format: TextureFormat;
  readonly filter?: 'nearest' | 'linear';
  readonly wrap?: 'clamp' | 'repeat';
  /** See {@link BufferDesc.restore}. */
  readonly restore?: (h: TexH) => void;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------------------------
// Vertex formats (integer attributes are first-class, PLAN §3.7 "inkl. Integer-Attribute")
// ---------------------------------------------------------------------------------------------

export type ScalarType = 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'f32';

/**
 * How the shader sees an attribute:
 * - `int`   → integer input (`uint`/`uvecN` for unsigned, `int`/`ivecN` for signed scalars), no conversion
 * - `norm`  → float input, normalized (unorm for unsigned, snorm for signed scalars)
 * - `float` → float input, value converted as-is (e.g. u8 255 → 255.0)
 */
export type AttrMode = 'int' | 'norm' | 'float';

export interface VertexFormat {
  readonly scalar: ScalarType;
  readonly count: 1 | 2 | 3 | 4;
  readonly mode: AttrMode;
}

/** Shorthand constructor for {@link VertexFormat}. */
export function vf(scalar: ScalarType, count: 1 | 2 | 3 | 4, mode: AttrMode): VertexFormat {
  return { scalar, count, mode };
}

/** Byte size of one scalar. */
export function scalarSize(s: ScalarType): number {
  switch (s) {
    case 'u8':
    case 'i8':
      return 1;
    case 'u16':
    case 'i16':
      return 2;
    case 'u32':
    case 'i32':
    case 'f32':
      return 4;
  }
}

export interface VertexAttribute {
  /** Shader input location (`layout(location = N) in …`). */
  readonly location: number;
  readonly format: VertexFormat;
  /** Byte offset inside one element of the stream. */
  readonly offset: number;
}

export type StepMode = 'vertex' | 'instance';

/** Layout of one vertex stream (WebGPU: GPUVertexBufferLayout). */
export interface VertexStreamLayout {
  readonly stepMode: StepMode;
  /** Bytes between consecutive elements. */
  readonly stride: number;
  readonly attributes: readonly VertexAttribute[];
}

// ---------------------------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------------------------

export type Primitive = 'triangles' | 'triangle-strip' | 'lines' | 'line-strip' | 'points';
export type CompareFunc = 'never' | 'less' | 'lequal' | 'equal' | 'greater' | 'gequal' | 'always';
export type BlendMode = 'none' | 'alpha' | 'premultiplied' | 'additive';

export interface UniformBlockBinding {
  /** Name of the std140 uniform block in the shader. */
  readonly name: string;
  /** Binding slot used by bind groups. */
  readonly slot: number;
}

export interface SamplerBinding {
  /** Name of the sampler uniform in the shader. */
  readonly name: string;
  /** Texture unit used by bind groups. */
  readonly unit: number;
}

export interface PipelineDesc {
  readonly label?: string;
  /** GLSL ES 3.00 vertex shader. */
  readonly vertex: string;
  /** GLSL ES 3.00 fragment shader. */
  readonly fragment: string;
  /** Stream layouts; index i corresponds to `setVertexStreams()[i]`. May be empty (gl_VertexID-only). */
  readonly streams: readonly VertexStreamLayout[];
  readonly uniformBlocks?: readonly UniformBlockBinding[];
  readonly samplers?: readonly SamplerBinding[];
  readonly primitive?: Primitive;
  readonly cullMode?: 'none' | 'back' | 'front';
  /** Default: counter-clockwise front faces. */
  readonly frontFace?: 'ccw' | 'cw';
  readonly depthTest?: boolean;
  readonly depthWrite?: boolean;
  readonly depthCompare?: CompareFunc;
  readonly blend?: BlendMode;
}

// ---------------------------------------------------------------------------------------------
// Bind groups
// ---------------------------------------------------------------------------------------------

export interface BufferBinding {
  readonly slot: number;
  readonly buffer: BufH;
  /** Byte offset; must respect the device's `uniformOffsetAlignment`. Default 0. */
  readonly offset?: number;
  /** Byte size; default: whole buffer from `offset`. */
  readonly size?: number;
}

export interface TextureBinding {
  readonly unit: number;
  readonly texture: TexH;
}

export interface BindGroupDesc {
  readonly label?: string;
  readonly buffers?: readonly BufferBinding[];
  readonly textures?: readonly TextureBinding[];
}

// ---------------------------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------------------------

export interface PassDesc {
  readonly label?: string;
  /** Clear color (linear 0..1); omitted → load. */
  readonly clearColor?: readonly [number, number, number, number];
  /** Clear depth value; omitted → load. */
  readonly clearDepth?: number;
  /** Viewport in device pixels; default: full drawing buffer. */
  readonly viewport?: Rect;
}

/** Binding of one vertex stream for the current pipeline (stride/stepMode come from its layout). */
export interface VertexStreamBinding {
  buffer: BufH;
  /** Byte offset of element 0 inside the buffer. */
  offset: number;
}

export type IndexFormat = 'uint16' | 'uint32';

export interface PassEncoder {
  setPipeline(p: PipeH): void;
  setBindGroup(g: BindGroupH): void;
  /**
   * Binds the vertex streams of the current pipeline. The array (and its entries) may be reused by
   * the caller after the call; the encoder copies what it needs.
   */
  setVertexStreams(streams: readonly VertexStreamBinding[]): void;
  setIndexBuffer(buffer: BufH, format: IndexFormat, offset?: number): void;
  drawIndexedInstanced(indexCount: number, instanceCount: number, firstIndex?: number): void;
  drawInstanced(vertexCount: number, instanceCount: number, firstVertex?: number): void;
  /**
   * Several indexed instanced draws in one call (WEBGL_multi_draw). `undefined` when unsupported.
   * All draws share the bound streams (there is no base instance in WebGL2).
   */
  readonly multiDrawIndexedInstanced:
    | ((counts: Int32Array, byteOffsets: Int32Array, instanceCounts: Int32Array, drawCount: number) => void)
    | undefined;
  end(): void;
}

// ---------------------------------------------------------------------------------------------
// Device
// ---------------------------------------------------------------------------------------------

export interface DeviceCaps {
  readonly backend: 'webgl2';
  readonly multiDraw: boolean;
  readonly timerQuery: boolean;
  readonly maxUniformBlockSize: number;
  readonly uniformOffsetAlignment: number;
  readonly maxVertexAttribs: number;
  readonly maxTextureSize: number;
  readonly renderer: string;
}

export interface DeviceCounters {
  drawCalls: number;
  instances: number;
  /** Bytes written via writeBuffer/writeTexture since the last `beginFrame`. */
  uploadBytes: number;
}

export interface GpuDevice {
  readonly caps: DeviceCaps;
  /** Per-frame counters, reset by `beginFrame`. */
  readonly counters: DeviceCounters;

  createBuffer(d: BufferDesc): BufH;
  /**
   * Writes `src` into the buffer at byte offset `dstOffset`. `srcOffset` and `size` are counted in
   * elements of `src` (WebGPU semantics) so callers never need `subarray()`.
   */
  writeBuffer(h: BufH, dstOffset: number, src: ArrayBufferView, srcOffset?: number, size?: number): void;
  destroyBuffer(h: BufH): void;

  createTexture(d: TexDesc): TexH;
  writeTexture(h: TexH, r: Rect, src: ArrayBufferView): void;
  destroyTexture(h: TexH): void;

  /** Compiles and links; throws an Error containing the info log on failure. */
  createPipeline(d: PipelineDesc): PipeH;
  destroyPipeline(h: PipeH): void;

  createBindGroup(d: BindGroupDesc): BindGroupH;
  destroyBindGroup(h: BindGroupH): void;

  beginPass(d: PassDesc): PassEncoder;

  /** Starts GPU timing (if supported) and resets counters. */
  beginFrame(): void;
  /** Ends GPU timing for this frame. */
  endFrame(): void;
  /** Latest resolved GPU frame time in ms (a few frames old), `undefined` if unavailable. */
  gpuTimeMs(): number | undefined;

  /** Drawing buffer size in device pixels. */
  drawingBufferSize(): { readonly width: number; readonly height: number };

  /** True between `webglcontextlost` and a completed restore. All calls are no-ops meanwhile. */
  isLost(): boolean;
  /** Listener after every resource was re-created and its restore callback ran. Returns an unsubscribe. */
  onRestored(cb: () => void): () => void;
  onLost(cb: () => void): () => void;

  /** Drains the backend error queue (debug aid; forces a GPU sync, do not call per frame). */
  checkErrors(): string[];

  destroy(): void;
}
