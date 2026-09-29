/**
 * Render Hardware Interface (PLAN §3.7): a slim, WebGPU-shaped device abstraction.
 *
 * Nothing in this file references WebGL types. Resources are plain numeric handles so a later
 * WebGPU backend can implement the same interface. Shaders are GLSL ES 3.00; a WebGPU
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

/**
 * Texture formats (PLAN §3.7, SPK4 needs):
 * - color: `rgba8`, `r8`, `rg8` (normalized), `rgba16f`/`rgba32f`/`r32f` (float),
 *   `r16ui`/`r32ui`/`rgba16ui`/`rgba32ui` and `r32i`/`rgba32i` (integer, sampled with `usampler`/`isampler`)
 * - depth: `depth24` (DEPTH_COMPONENT24) and `depth32f`, optionally with a compare function
 *   (`sampler2DShadow` / `sampler2DArrayShadow`).
 *
 * Renderable as color attachment: `rgba8`, `r8`, `rg8`, all integer formats; `rgba16f`/`rgba32f`/`r32f` only
 * when {@link DeviceCaps.colorBufferFloat} is true (EXT_color_buffer_float).
 */
export type TextureFormat =
  | 'rgba8'
  | 'r8'
  | 'rg8'
  | 'r16ui'
  | 'r32ui'
  | 'r32i'
  | 'rgba16ui'
  | 'rgba32ui'
  | 'rgba32i'
  | 'r32f'
  | 'rgba16f'
  | 'rgba32f'
  | 'depth24'
  | 'depth32f';

export type TextureDimension = '2d' | '2d-array';

export interface TexDesc {
  readonly label?: string;
  readonly width: number;
  readonly height: number;
  readonly format: TextureFormat;
  /** Default '2d'. A '2d-array' texture has {@link layers} layers (`sampler2DArray`). */
  readonly dimension?: TextureDimension;
  /** Layer count of a '2d-array' texture (≥ 1). Ignored for '2d'. */
  readonly layers?: number;
  /** Mip levels (default 1). Fill level 0 and call `generateMipmaps`, or write every level. */
  readonly mipLevels?: number;
  /** Minification/magnification filter. Non-filterable formats (integer, 32-bit float) always use nearest. */
  readonly filter?: 'nearest' | 'linear';
  readonly wrap?: 'clamp' | 'repeat';
  /** Depth formats only: enables TEXTURE_COMPARE_MODE with this function (shadow samplers, PCF with 'linear'). */
  readonly compare?: CompareFunc;
  /** See {@link BufferDesc.restore}. Render targets usually omit it (their content is re-rendered). */
  readonly restore?: (h: TexH) => void;
}

/** Component count of a texture format (depth formats: 1). */
export function textureChannels(f: TextureFormat): 1 | 2 | 4 {
  switch (f) {
    case 'r8':
    case 'r16ui':
    case 'r32ui':
    case 'r32i':
    case 'r32f':
    case 'depth24':
    case 'depth32f':
      return 1;
    case 'rg8':
      return 2;
    case 'rgba8':
    case 'rgba16ui':
    case 'rgba32ui':
    case 'rgba32i':
    case 'rgba16f':
    case 'rgba32f':
      return 4;
  }
}

/** Sampling/readback class of a texture format. */
export type TextureKind = 'unorm' | 'uint' | 'sint' | 'float' | 'depth';

export function textureKind(f: TextureFormat): TextureKind {
  switch (f) {
    case 'rgba8':
    case 'r8':
    case 'rg8':
      return 'unorm';
    case 'r16ui':
    case 'r32ui':
    case 'rgba16ui':
    case 'rgba32ui':
      return 'uint';
    case 'r32i':
    case 'rgba32i':
      return 'sint';
    case 'r32f':
    case 'rgba16f':
    case 'rgba32f':
      return 'float';
    case 'depth24':
    case 'depth32f':
      return 'depth';
  }
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
  /** Polygon offset (shadow maps): `depth += slopeScale * dz + constant * r`. Omitted = off. */
  readonly depthBias?: { readonly constant: number; readonly slopeScale: number };
  /** false = color writes disabled (depth-only passes). Default true. */
  readonly colorWrite?: boolean;
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

/** One render-target attachment of an offscreen pass. */
export interface PassAttachment {
  readonly texture: TexH;
  /** Layer of a '2d-array' texture (default 0). */
  readonly layer?: number;
  /** Mip level (default 0). */
  readonly mipLevel?: number;
}

export interface PassDesc {
  readonly label?: string;
  /**
   * Clear color; omitted → load. Offscreen: applied to every color attachment (float formats as given,
   * integer formats truncated to integers, e.g. `[-1, 0, 0, 0]` for an r32i target).
   */
  readonly clearColor?: readonly [number, number, number, number];
  /** Clear depth value; omitted → load. */
  readonly clearDepth?: number;
  /** Viewport in device pixels; default: the full drawing buffer or the attachment size. */
  readonly viewport?: Rect;
  /**
   * Offscreen color targets (MRT: `layout(location = i) out` ↔ attachment i). With neither color nor
   * depth attachments the pass renders into the canvas.
   */
  readonly colorAttachments?: readonly PassAttachment[];
  /** Offscreen depth target (`depth24`/`depth32f`), e.g. a shadow cascade. */
  readonly depthAttachment?: PassAttachment;
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
  /** EXT_color_buffer_float: `rgba16f`/`rgba32f`/`r32f` are renderable (HDR targets). */
  readonly colorBufferFloat: boolean;
  /** EXT_float_blend: blending into 32-bit float targets. */
  readonly floatBlend: boolean;
  /** OES_texture_float_linear: linear filtering of 32-bit float textures. */
  readonly textureFloatLinear: boolean;
  readonly maxUniformBlockSize: number;
  readonly uniformOffsetAlignment: number;
  readonly maxVertexAttribs: number;
  readonly maxTextureSize: number;
  readonly maxArrayTextureLayers: number;
  readonly maxColorAttachments: number;
  readonly maxDrawBuffers: number;
  readonly maxSamples: number;
  readonly maxVertexTextureUnits: number;
  readonly maxTextureUnits: number;
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
  /**
   * Uploads a rectangle of one layer/mip level. `src` holds `r.width × r.height` texels, tightly packed,
   * with the component type of the format (u8 for rgba8/r8/rg8, u16 for r16ui/rgba16ui, u32/i32 for the
   * 32-bit integer formats, f32 for r32f/rgba32f, u16 half floats or f32 for rgba16f).
   */
  writeTexture(h: TexH, r: Rect, src: ArrayBufferView, layer?: number, mipLevel?: number): void;
  /** Regenerates mip levels 1..n from level 0 (filterable color formats). */
  generateMipmaps(h: TexH): void;
  /**
   * Synchronous readback of a color texture (tests/debug only – stalls the GPU). `out` receives
   * `r.width × r.height × channels(format)` values, rows bottom-up as stored (row y = texel row y):
   * Uint8Array for rgba8/r8/rg8, Uint32Array for unsigned integer, Int32Array for signed integer and
   * Float32Array for float formats. Depth formats cannot be read back (WebGL2).
   */
  readTexture(h: TexH, r: Rect, out: ArrayBufferView, layer?: number): void;
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
