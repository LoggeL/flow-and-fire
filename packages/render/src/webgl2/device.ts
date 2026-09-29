/**
 * WebGL2 backend of the RHI (PLAN §3.7).
 *
 * - Every resource lives in the {@link ContextLossRegistry}; handles stay valid across context loss.
 * - VAO cache per pipeline + bound buffer set; when only stream offsets change (instance ring
 *   regions, per-visual buckets) the cached VAO is re-pointed instead of creating a new one.
 * - Integer attributes use `vertexAttribIPointer`, instance streams `vertexAttribDivisor(loc, 1)`.
 * - Redundant state changes (program, VAO, depth/blend/cull, UBO ranges, textures) are filtered.
 * - Optional: EXT_disjoint_timer_query_webgl2 (GPU frame time), WEBGL_multi_draw,
 *   EXT_color_buffer_float (HDR targets), EXT_float_blend, OES_texture_float_linear.
 * - Textures: 2D and 2D-array, mip levels, depth textures with compare mode, integer formats.
 * - Offscreen passes: framebuffers are cached per attachment set and rebuilt after a context loss.
 */
import type {
  BindGroupDesc,
  BindGroupH,
  BlendMode,
  BufferDesc,
  BufH,
  CompareFunc,
  DeviceCaps,
  DeviceCounters,
  GpuDevice,
  IndexFormat,
  PassAttachment,
  PassDesc,
  PassEncoder,
  PipeH,
  PipelineDesc,
  Primitive,
  Rect,
  ScalarType,
  TexDesc,
  TexH,
  TextureFormat,
  VertexStreamBinding,
  VertexStreamLayout,
} from '../rhi/types.ts';
import { scalarSize, textureChannels, textureKind } from '../rhi/types.ts';
import { GL, glErrorName } from './gl-const.ts';
import type { ContextEventTarget, RegisteredResource } from './registry.ts';
import { ContextLossRegistry } from './registry.ts';

/** Canvas-like object the device renders into. */
export interface DeviceCanvas extends ContextEventTarget {
  getContext(contextId: 'webgl2', options?: WebGLContextAttributes): unknown;
}

export interface WebGL2DeviceOptions {
  /** Inject an existing context (tests, shared contexts). */
  readonly context?: WebGL2RenderingContext;
  readonly attributes?: WebGLContextAttributes;
}

export interface WebGL2Device extends GpuDevice {
  readonly gl: WebGL2RenderingContext;
  readonly registry: ContextLossRegistry;
  /** Simulates a context loss via WEBGL_lose_context; false if the extension is missing. */
  debugLoseContext(): boolean;
  /** Restores a context lost via {@link debugLoseContext}. */
  debugRestoreContext(): boolean;
}

// ---------------------------------------------------------------------------------------------
// Resource records
// ---------------------------------------------------------------------------------------------

class BufferRes implements RegisteredResource {
  glBuf: WebGLBuffer | null = null;
  id = 0;
  restore: (() => void) | undefined;
  constructor(
    private readonly dev: Device,
    readonly desc: BufferDesc,
  ) {
    const cb = desc.restore;
    this.restore = cb === undefined ? undefined : () => cb(this.id as BufH);
  }
  realize(): void {
    const gl = this.dev.gl;
    const buf = gl.createBuffer();
    // The first bind fixes the WebGL buffer type: index buffers must be bound to
    // ELEMENT_ARRAY_BUFFER first (with no VAO bound so no VAO state is touched).
    const target = bufferTarget(this.desc);
    if (target === GL.ELEMENT_ARRAY_BUFFER) this.dev.bindVao(null);
    gl.bindBuffer(target, buf);
    gl.bufferData(target, this.desc.size, this.desc.dynamic === true ? GL.DYNAMIC_DRAW : GL.STATIC_DRAW);
    gl.bindBuffer(target, null);
    this.glBuf = buf;
  }
  release(deleteObjects: boolean): void {
    if (deleteObjects && this.glBuf !== null) this.dev.gl.deleteBuffer(this.glBuf);
    this.glBuf = null;
  }
}

class TextureRes implements RegisteredResource {
  glTex: WebGLTexture | null = null;
  id = 0;
  restore: (() => void) | undefined;
  readonly target: number;
  readonly levels: number;
  readonly layers: number;
  readonly info: TexFormatInfo;
  constructor(
    private readonly dev: Device,
    readonly desc: TexDesc,
  ) {
    const cb = desc.restore;
    this.restore = cb === undefined ? undefined : () => cb(this.id as TexH);
    this.target = desc.dimension === '2d-array' ? GL.TEXTURE_2D_ARRAY : GL.TEXTURE_2D;
    this.levels = Math.max(1, desc.mipLevels ?? 1);
    this.layers = desc.dimension === '2d-array' ? Math.max(1, desc.layers ?? 1) : 1;
    this.info = textureFormat(desc.format);
    if (!(desc.width >= 1 && desc.height >= 1)) {
      throw new Error(`createTexture(${desc.label ?? ''}): size ${desc.width}×${desc.height} must be ≥ 1`);
    }
    if (desc.compare !== undefined && this.info.kind !== 'depth') {
      throw new Error(`createTexture(${desc.label ?? ''}): compare needs a depth format, got ${desc.format}`);
    }
  }
  realize(): void {
    const gl = this.dev.gl;
    const d = this.desc;
    const f = this.info;
    const tex = gl.createTexture();
    const t = this.target;
    this.dev.bindTextureUnit(0, tex, t);
    if (t === GL.TEXTURE_2D_ARRAY) gl.texStorage3D(t, this.levels, f.internal, d.width, d.height, this.layers);
    else gl.texStorage2D(t, this.levels, f.internal, d.width, d.height);
    const linear = d.filter === 'linear' && this.dev.isFilterable(f, d.compare !== undefined);
    const mag = linear ? GL.LINEAR : GL.NEAREST;
    const min = this.levels > 1 ? (linear ? GL.LINEAR_MIPMAP_LINEAR : GL.NEAREST_MIPMAP_NEAREST) : mag;
    const wrap = d.wrap === 'repeat' ? GL.REPEAT : GL.CLAMP_TO_EDGE;
    gl.texParameteri(t, GL.TEXTURE_MIN_FILTER, min);
    gl.texParameteri(t, GL.TEXTURE_MAG_FILTER, mag);
    gl.texParameteri(t, GL.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(t, GL.TEXTURE_WRAP_T, wrap);
    if (d.compare !== undefined) {
      gl.texParameteri(t, GL.TEXTURE_COMPARE_MODE, GL.COMPARE_REF_TO_TEXTURE);
      gl.texParameteri(t, GL.TEXTURE_COMPARE_FUNC, compareFunc(d.compare));
    }
    this.dev.bindTextureUnit(0, null, t);
    this.glTex = tex;
  }
  release(deleteObjects: boolean): void {
    if (deleteObjects && this.glTex !== null) this.dev.gl.deleteTexture(this.glTex);
    this.glTex = null;
  }
  /** Size of a mip level. */
  levelWidth(mip: number): number {
    return Math.max(1, this.desc.width >> mip);
  }
  levelHeight(mip: number): number {
    return Math.max(1, this.desc.height >> mip);
  }
}

/** Cached framebuffer for one attachment set (offscreen passes, readback). */
interface FboEntry {
  fbo: WebGLFramebuffer | null;
  /** (texture handle, layer, mip) per color attachment. */
  readonly colors: Int32Array;
  /** (texture handle, layer, mip) of the depth attachment; handle 0 = none. */
  readonly depth: Int32Array;
  readonly width: number;
  readonly height: number;
  /** Format kind per color attachment (clear path). */
  readonly kinds: readonly string[];
}

interface VaoEntry {
  vao: WebGLVertexArrayObject | null;
  /** Buffer handle per stream. */
  readonly buffers: Int32Array;
  /** Byte offset per stream as currently baked into the VAO. */
  readonly offsets: Float64Array;
  readonly indexBuffer: number;
}

class PipelineRes implements RegisteredResource {
  program: WebGLProgram | null = null;
  id = 0;
  readonly restore = undefined;
  readonly vaos: VaoEntry[] = [];
  readonly mode: number;
  readonly depthFunc: number;
  constructor(
    private readonly dev: Device,
    readonly desc: PipelineDesc,
  ) {
    this.mode = primitiveMode(desc.primitive ?? 'triangles');
    this.depthFunc = compareFunc(desc.depthCompare ?? 'less');
  }
  realize(): void {
    this.program = this.dev.buildProgram(this.desc);
  }
  release(deleteObjects: boolean): void {
    const gl = this.dev.gl;
    if (deleteObjects) {
      for (const e of this.vaos) if (e.vao !== null) gl.deleteVertexArray(e.vao);
      if (this.program !== null) gl.deleteProgram(this.program);
    }
    this.vaos.length = 0;
    this.program = null;
  }
}

class BindGroupRes implements RegisteredResource {
  id = 0;
  readonly restore = undefined;
  constructor(readonly desc: BindGroupDesc) {}
  realize(): void {
    // Bind groups only reference other handles; nothing to create.
  }
  release(): void {
    // Nothing owned.
  }
}

// ---------------------------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------------------------

function bufferTarget(d: BufferDesc): number {
  switch (d.usage) {
    case 'vertex':
      return GL.ARRAY_BUFFER;
    case 'index':
      return GL.ELEMENT_ARRAY_BUFFER;
    case 'uniform':
      return GL.UNIFORM_BUFFER;
  }
}

function scalarGlType(s: ScalarType): number {
  switch (s) {
    case 'u8':
      return GL.UNSIGNED_BYTE;
    case 'i8':
      return GL.BYTE;
    case 'u16':
      return GL.UNSIGNED_SHORT;
    case 'i16':
      return GL.SHORT;
    case 'u32':
      return GL.UNSIGNED_INT;
    case 'i32':
      return GL.INT;
    case 'f32':
      return GL.FLOAT;
  }
}

function primitiveMode(p: Primitive): number {
  switch (p) {
    case 'triangles':
      return GL.TRIANGLES;
    case 'triangle-strip':
      return GL.TRIANGLE_STRIP;
    case 'lines':
      return GL.LINES;
    case 'line-strip':
      return GL.LINE_STRIP;
    case 'points':
      return GL.POINTS;
  }
}

function compareFunc(c: CompareFunc): number {
  switch (c) {
    case 'never':
      return GL.NEVER;
    case 'less':
      return GL.LESS;
    case 'lequal':
      return GL.LEQUAL;
    case 'equal':
      return GL.EQUAL;
    case 'greater':
      return GL.GREATER;
    case 'gequal':
      return GL.GEQUAL;
    case 'always':
      return GL.ALWAYS;
  }
}

interface TexFormatInfo {
  readonly internal: number;
  /** Upload format/type (writeTexture). */
  readonly format: number;
  readonly type: number;
  /** Filterable without extensions. */
  readonly filterable: boolean;
  /** 32-bit float: filterable only with OES_texture_float_linear. */
  readonly float32: boolean;
  /** Renderable as color attachment: 'always', 'float' (EXT_color_buffer_float), 'depth' or 'never'. */
  readonly renderable: 'always' | 'float' | 'depth';
  /** readPixels format/type (the combinations WebGL2 guarantees). */
  readonly readFormat: number;
  readonly readType: number;
  readonly kind: ReturnType<typeof textureKind>;
  readonly channels: 1 | 2 | 4;
}

function fmt(
  f: TextureFormat,
  internal: number,
  format: number,
  type: number,
  filterable: boolean,
  renderable: 'always' | 'float' | 'depth',
  readFormat: number,
  readType: number,
  float32 = false,
): TexFormatInfo {
  return { internal, format, type, filterable, float32, renderable, readFormat, readType, kind: textureKind(f), channels: textureChannels(f) };
}

const TEX_FORMATS: { readonly [K in TextureFormat]: TexFormatInfo } = {
  rgba8: fmt('rgba8', GL.RGBA8, GL.RGBA, GL.UNSIGNED_BYTE, true, 'always', GL.RGBA, GL.UNSIGNED_BYTE),
  r8: fmt('r8', GL.R8, GL.RED, GL.UNSIGNED_BYTE, true, 'always', GL.RGBA, GL.UNSIGNED_BYTE),
  rg8: fmt('rg8', GL.RG8, GL.RG, GL.UNSIGNED_BYTE, true, 'always', GL.RGBA, GL.UNSIGNED_BYTE),
  r16ui: fmt('r16ui', GL.R16UI, GL.RED_INTEGER, GL.UNSIGNED_SHORT, false, 'always', GL.RGBA_INTEGER, GL.UNSIGNED_INT),
  r32ui: fmt('r32ui', GL.R32UI, GL.RED_INTEGER, GL.UNSIGNED_INT, false, 'always', GL.RGBA_INTEGER, GL.UNSIGNED_INT),
  r32i: fmt('r32i', GL.R32I, GL.RED_INTEGER, GL.INT, false, 'always', GL.RGBA_INTEGER, GL.INT),
  rgba16ui: fmt('rgba16ui', GL.RGBA16UI, GL.RGBA_INTEGER, GL.UNSIGNED_SHORT, false, 'always', GL.RGBA_INTEGER, GL.UNSIGNED_INT),
  rgba32ui: fmt('rgba32ui', GL.RGBA32UI, GL.RGBA_INTEGER, GL.UNSIGNED_INT, false, 'always', GL.RGBA_INTEGER, GL.UNSIGNED_INT),
  rgba32i: fmt('rgba32i', GL.RGBA32I, GL.RGBA_INTEGER, GL.INT, false, 'always', GL.RGBA_INTEGER, GL.INT),
  r32f: fmt('r32f', GL.R32F, GL.RED, GL.FLOAT, false, 'float', GL.RGBA, GL.FLOAT, true),
  rgba16f: fmt('rgba16f', GL.RGBA16F, GL.RGBA, GL.HALF_FLOAT, true, 'float', GL.RGBA, GL.FLOAT),
  rgba32f: fmt('rgba32f', GL.RGBA32F, GL.RGBA, GL.FLOAT, false, 'float', GL.RGBA, GL.FLOAT, true),
  depth24: fmt('depth24', GL.DEPTH_COMPONENT24, GL.DEPTH_COMPONENT, GL.UNSIGNED_INT, false, 'depth', 0, 0),
  depth32f: fmt('depth32f', GL.DEPTH_COMPONENT32F, GL.DEPTH_COMPONENT, GL.FLOAT, false, 'depth', 0, 0),
};

function textureFormat(f: TextureFormat): TexFormatInfo {
  return TEX_FORMATS[f];
}

/** Validates stream layouts against WebGL2 rules; throws with a descriptive message. */
export function validateStreams(streams: readonly VertexStreamLayout[], maxAttribs: number, label: string): void {
  const seen = new Uint8Array(Math.max(maxAttribs, 16));
  streams.forEach((s, si) => {
    if (s.stride <= 0 || s.stride > 255) throw new Error(`${label}: stream ${si} stride ${s.stride} not in 1..255`);
    for (const a of s.attributes) {
      const f = a.format;
      const size = scalarSize(f.scalar);
      if (f.scalar === 'f32' && f.mode !== 'float') {
        throw new Error(`${label}: location ${a.location}: f32 attributes must use mode 'float'`);
      }
      if (a.offset % size !== 0) throw new Error(`${label}: location ${a.location}: offset ${a.offset} not aligned to ${size}`);
      if (s.stride % size !== 0) throw new Error(`${label}: stream ${si}: stride ${s.stride} not aligned to ${size}`);
      if (a.offset + size * f.count > s.stride) {
        throw new Error(`${label}: location ${a.location}: attribute exceeds stride ${s.stride}`);
      }
      if (a.location < 0 || a.location >= maxAttribs) {
        throw new Error(`${label}: location ${a.location} out of range (max ${maxAttribs - 1})`);
      }
      if (seen[a.location] === 1) throw new Error(`${label}: duplicate attribute location ${a.location}`);
      seen[a.location] = 1;
    }
  });
}

function numberedSource(src: string): string {
  return src
    .split('\n')
    .map((l, i) => `${String(i + 1).padStart(4, ' ')}: ${l}`)
    .join('\n');
}

// ---------------------------------------------------------------------------------------------
// Pass encoder
// ---------------------------------------------------------------------------------------------

const MAX_STREAMS = 8;

class Encoder implements PassEncoder {
  pipeline: PipelineRes | null = null;
  streamCount = 0;
  readonly streamBufs = new Int32Array(MAX_STREAMS);
  readonly streamOffs = new Float64Array(MAX_STREAMS);
  indexBuffer = 0;
  indexType: number = GL.UNSIGNED_SHORT;
  indexSize = 2;
  indexOffset = 0;
  open = false;
  readonly multiDrawIndexedInstanced:
    | ((counts: Int32Array, byteOffsets: Int32Array, instanceCounts: Int32Array, drawCount: number) => void)
    | undefined;

  constructor(private readonly dev: Device) {
    this.multiDrawIndexedInstanced =
      dev.multiDrawExt === null
        ? undefined
        : (counts, byteOffsets, instanceCounts, drawCount) => this.multiDraw(counts, byteOffsets, instanceCounts, drawCount);
  }

  reset(): void {
    this.pipeline = null;
    this.streamCount = 0;
    this.indexBuffer = 0;
    this.open = true;
  }

  setPipeline(p: PipeH): void {
    const res = this.dev.registry.get(p);
    if (!(res instanceof PipelineRes)) throw new Error(`setPipeline: invalid pipeline handle ${p}`);
    this.pipeline = res;
    this.streamCount = 0;
    this.indexBuffer = 0;
    if (this.dev.isLost()) return;
    this.dev.applyPipeline(res);
  }

  setBindGroup(g: BindGroupH): void {
    const res = this.dev.registry.get(g);
    if (!(res instanceof BindGroupRes)) throw new Error(`setBindGroup: invalid bind group handle ${g}`);
    if (this.dev.isLost()) return;
    this.dev.applyBindGroup(res.desc);
  }

  setVertexStreams(streams: readonly VertexStreamBinding[]): void {
    if (streams.length > MAX_STREAMS) throw new Error(`setVertexStreams: at most ${MAX_STREAMS} streams`);
    for (let i = 0; i < streams.length; i++) {
      const s = streams[i]!;
      this.streamBufs[i] = s.buffer;
      this.streamOffs[i] = s.offset;
    }
    this.streamCount = streams.length;
  }

  setIndexBuffer(buffer: BufH, format: IndexFormat, offset = 0): void {
    this.indexBuffer = buffer;
    this.indexType = format === 'uint32' ? GL.UNSIGNED_INT : GL.UNSIGNED_SHORT;
    this.indexSize = format === 'uint32' ? 4 : 2;
    this.indexOffset = offset;
  }

  drawIndexedInstanced(indexCount: number, instanceCount: number, firstIndex = 0): void {
    const p = this.pipeline;
    if (p === null) throw new Error('drawIndexedInstanced: no pipeline');
    if (this.indexBuffer === 0) throw new Error('drawIndexedInstanced: no index buffer');
    if (this.dev.isLost() || indexCount <= 0 || instanceCount <= 0) return;
    this.dev.prepareDraw(p, this);
    this.dev.gl.drawElementsInstanced(
      p.mode,
      indexCount,
      this.indexType,
      this.indexOffset + firstIndex * this.indexSize,
      instanceCount,
    );
    this.dev.counters.drawCalls++;
    this.dev.counters.instances += instanceCount;
  }

  drawInstanced(vertexCount: number, instanceCount: number, firstVertex = 0): void {
    const p = this.pipeline;
    if (p === null) throw new Error('drawInstanced: no pipeline');
    if (this.dev.isLost() || vertexCount <= 0 || instanceCount <= 0) return;
    this.dev.prepareDraw(p, this);
    this.dev.gl.drawArraysInstanced(p.mode, firstVertex, vertexCount, instanceCount);
    this.dev.counters.drawCalls++;
    this.dev.counters.instances += instanceCount;
  }

  private multiDraw(counts: Int32Array, byteOffsets: Int32Array, instanceCounts: Int32Array, drawCount: number): void {
    const p = this.pipeline;
    const ext = this.dev.multiDrawExt;
    if (p === null) throw new Error('multiDrawIndexedInstanced: no pipeline');
    if (this.indexBuffer === 0) throw new Error('multiDrawIndexedInstanced: no index buffer');
    if (ext === null || this.dev.isLost() || drawCount <= 0) return;
    this.dev.prepareDraw(p, this);
    ext.multiDrawElementsInstancedWEBGL(p.mode, counts, 0, this.indexType, byteOffsets, 0, instanceCounts, 0, drawCount);
    this.dev.counters.drawCalls++;
    for (let i = 0; i < drawCount; i++) this.dev.counters.instances += instanceCounts[i]!;
  }

  end(): void {
    this.open = false;
    this.pipeline = null;
  }
}

// ---------------------------------------------------------------------------------------------
// Device
// ---------------------------------------------------------------------------------------------

interface MultiDrawExt {
  multiDrawElementsInstancedWEBGL(
    mode: number,
    counts: Int32Array,
    countsOffset: number,
    type: number,
    offsets: Int32Array,
    offsetsOffset: number,
    instanceCounts: Int32Array,
    instanceCountsOffset: number,
    drawcount: number,
  ): void;
}

interface LoseContextExt {
  loseContext(): void;
  restoreContext(): void;
}

const MAX_UBO_SLOTS = 16;
const MAX_TEX_UNITS = 16;
const TIMER_POOL = 6;

class Device implements WebGL2Device {
  readonly gl: WebGL2RenderingContext;
  readonly registry: ContextLossRegistry;
  caps: DeviceCaps;
  readonly counters: DeviceCounters = { drawCalls: 0, instances: 0, uploadBytes: 0 };
  multiDrawExt: MultiDrawExt | null = null;
  private timerExt: object | null = null;
  private loseExt: LoseContextExt | null = null;
  private readonly encoder: Encoder;
  private readonly pipelines: PipelineRes[] = [];

  // state cache (null / -1 = unknown)
  private curProgram: WebGLProgram | null = null;
  private curVao: WebGLVertexArrayObject | null | undefined = undefined;
  private depthTest = -1;
  private depthMask = -1;
  private depthFunc = -1;
  private cull = -1;
  private cullFace = -1;
  private frontFace = -1;
  private blend: BlendMode | null = null;
  private readonly uboBuf: (WebGLBuffer | null)[] = new Array<WebGLBuffer | null>(MAX_UBO_SLOTS).fill(null);
  private readonly uboOff = new Float64Array(MAX_UBO_SLOTS);
  private readonly uboSize = new Float64Array(MAX_UBO_SLOTS);
  private readonly texBound: (WebGLTexture | null)[] = new Array<WebGLTexture | null>(MAX_TEX_UNITS).fill(null);
  private readonly texTarget = new Int32Array(MAX_TEX_UNITS);
  private activeUnit = -1;
  private colorMask = -1;
  private polyOffset = -1;
  private polyFactor = Number.NaN;
  private polyUnits = Number.NaN;
  /** Currently bound framebuffer; undefined = unknown, null = canvas. */
  private curFbo: WebGLFramebuffer | null | undefined = undefined;
  private readonly fbos: FboEntry[] = [];
  private readonly clearF = new Float32Array(4);
  private readonly clearI = new Int32Array(4);
  private readonly clearU = new Uint32Array(4);
  private readonly clearD = new Float32Array(1);
  private readonly vp = new Float64Array([-1, -1, -1, -1]);
  private readonly dbSize = { width: 0, height: 0 };

  // GPU timer
  private readonly freeQueries: WebGLQuery[] = [];
  private readonly pendingQueries: WebGLQuery[] = [];
  private activeQuery: WebGLQuery | null = null;
  private lastGpuMs: number | undefined = undefined;

  constructor(canvas: DeviceCanvas, opts: WebGL2DeviceOptions) {
    const gl =
      opts.context ??
      (canvas.getContext('webgl2', {
        alpha: false,
        antialias: true,
        depth: true,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
        ...opts.attributes,
      }) as WebGL2RenderingContext | null);
    if (gl === null || gl === undefined) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.caps = this.queryCaps();
    this.encoder = new Encoder(this);
    this.registry = new ContextLossRegistry(canvas, { beforeRealize: () => this.onContextRestored() }, gl.isContextLost());
    this.loseExt = gl.getExtension('WEBGL_lose_context') as LoseContextExt | null;
    if (!gl.isContextLost()) gl.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
    this.registry.onLost(() => this.onContextLost());
  }

  private queryCaps(): DeviceCaps {
    const gl = this.gl;
    const lost = gl.isContextLost();
    this.multiDrawExt = lost ? null : (gl.getExtension('WEBGL_multi_draw') as MultiDrawExt | null);
    this.timerExt = lost ? null : (gl.getExtension('EXT_disjoint_timer_query_webgl2') as object | null);
    const ext = (name: string): boolean => !lost && gl.getExtension(name) !== null;
    const colorBufferFloat = ext('EXT_color_buffer_float');
    const floatBlend = ext('EXT_float_blend');
    const textureFloatLinear = ext('OES_texture_float_linear');
    let renderer = lost ? 'lost' : String(gl.getParameter(GL.RENDERER) ?? 'unknown');
    if (!lost && (renderer === 'WebKit WebGL' || renderer === 'unknown')) {
      // Chromium masks RENDERER; the debug extension gives the real name (not used in Firefox, where it is deprecated).
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg !== null) renderer = String(gl.getParameter(GL.UNMASKED_RENDERER_WEBGL) ?? renderer);
    }
    const num = (p: number, fallback: number): number => {
      const v: unknown = lost ? null : gl.getParameter(p);
      return typeof v === 'number' ? v : fallback;
    };
    return {
      backend: 'webgl2',
      multiDraw: this.multiDrawExt !== null,
      timerQuery: this.timerExt !== null,
      colorBufferFloat,
      floatBlend,
      textureFloatLinear,
      maxUniformBlockSize: num(GL.MAX_UNIFORM_BLOCK_SIZE, 16384),
      uniformOffsetAlignment: num(GL.UNIFORM_BUFFER_OFFSET_ALIGNMENT, 256),
      maxVertexAttribs: num(GL.MAX_VERTEX_ATTRIBS, 16),
      maxTextureSize: num(GL.MAX_TEXTURE_SIZE, 4096),
      maxArrayTextureLayers: num(GL.MAX_ARRAY_TEXTURE_LAYERS, 256),
      maxColorAttachments: num(GL.MAX_COLOR_ATTACHMENTS, 4),
      maxDrawBuffers: num(GL.MAX_DRAW_BUFFERS, 4),
      maxSamples: num(GL.MAX_SAMPLES, 4),
      maxVertexTextureUnits: num(GL.MAX_VERTEX_TEXTURE_IMAGE_UNITS, 16),
      maxTextureUnits: num(GL.MAX_TEXTURE_IMAGE_UNITS, 16),
      renderer,
    };
  }

  private resetStateCache(): void {
    this.curProgram = null;
    this.curVao = undefined;
    this.depthTest = this.depthMask = this.depthFunc = this.cull = this.cullFace = this.frontFace = -1;
    this.blend = null;
    this.uboBuf.fill(null);
    this.texBound.fill(null);
    this.texTarget.fill(0);
    this.activeUnit = -1;
    this.colorMask = -1;
    this.polyOffset = -1;
    this.polyFactor = Number.NaN;
    this.polyUnits = Number.NaN;
    this.curFbo = undefined;
    this.vp.fill(-1);
  }

  private onContextLost(): void {
    this.resetStateCache();
    this.fbos.length = 0;
    this.freeQueries.length = 0;
    this.pendingQueries.length = 0;
    this.activeQuery = null;
    this.lastGpuMs = undefined;
  }

  private onContextRestored(): void {
    this.resetStateCache();
    this.fbos.length = 0;
    this.caps = this.queryCaps();
    this.gl.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
  }

  // ------------------------------------------------------------------ state helpers (internal)

  bindVao(vao: WebGLVertexArrayObject | null): void {
    if (this.curVao === vao) return;
    this.gl.bindVertexArray(vao);
    this.curVao = vao;
  }

  bindTextureUnit(unit: number, tex: WebGLTexture | null, target: number = GL.TEXTURE_2D): void {
    if (this.activeUnit !== unit) {
      this.gl.activeTexture(GL.TEXTURE0 + unit);
      this.activeUnit = unit;
    }
    this.gl.bindTexture(target, tex);
    this.texBound[unit] = tex;
    this.texTarget[unit] = target;
  }

  /** Whether linear filtering is allowed for a format (depth: only with compare mode). */
  isFilterable(f: TexFormatInfo, compare: boolean): boolean {
    if (f.kind === 'depth') return compare;
    if (f.float32) return this.caps.textureFloatLinear;
    return f.filterable;
  }

  buildProgram(d: PipelineDesc): WebGLProgram | null {
    const gl = this.gl;
    const label = d.label ?? 'pipeline';
    validateStreams(d.streams, this.caps.maxVertexAttribs, label);
    const vs = gl.createShader(GL.VERTEX_SHADER);
    const fs = gl.createShader(GL.FRAGMENT_SHADER);
    const prog = gl.createProgram();
    if (vs === null || fs === null || prog === null) {
      if (gl.isContextLost()) return null;
      throw new Error(`${label}: could not create shader objects`);
    }
    gl.shaderSource(vs, d.vertex);
    gl.shaderSource(fs, d.fragment);
    gl.compileShader(vs);
    gl.compileShader(fs);
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    // Query status only after linking: lets drivers compile in parallel.
    if (gl.getProgramParameter(prog, GL.LINK_STATUS) !== true && !gl.isContextLost()) {
      const parts: string[] = [];
      if (gl.getShaderParameter(vs, GL.COMPILE_STATUS) !== true) {
        parts.push(`vertex shader:\n${gl.getShaderInfoLog(vs) ?? ''}\n${numberedSource(d.vertex)}`);
      }
      if (gl.getShaderParameter(fs, GL.COMPILE_STATUS) !== true) {
        parts.push(`fragment shader:\n${gl.getShaderInfoLog(fs) ?? ''}\n${numberedSource(d.fragment)}`);
      }
      parts.push(`link log:\n${gl.getProgramInfoLog(prog) ?? ''}`);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteProgram(prog);
      throw new Error(`[render] ${label}: shader compile/link failed\n${parts.join('\n')}`);
    }
    gl.detachShader(prog, vs);
    gl.detachShader(prog, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    for (const b of d.uniformBlocks ?? []) {
      const idx = gl.getUniformBlockIndex(prog, b.name);
      if (idx !== GL.INVALID_INDEX) gl.uniformBlockBinding(prog, idx, b.slot);
    }
    if (d.samplers !== undefined && d.samplers.length > 0) {
      gl.useProgram(prog);
      for (const s of d.samplers) {
        const loc = gl.getUniformLocation(prog, s.name);
        if (loc !== null) gl.uniform1i(loc, s.unit);
      }
      gl.useProgram(this.curProgram);
    }
    return prog;
  }

  applyPipeline(p: PipelineRes): void {
    const gl = this.gl;
    const d = p.desc;
    if (this.curProgram !== p.program) {
      gl.useProgram(p.program);
      this.curProgram = p.program;
    }
    const dt = d.depthTest === false ? 0 : 1;
    if (this.depthTest !== dt) {
      if (dt === 1) gl.enable(GL.DEPTH_TEST);
      else gl.disable(GL.DEPTH_TEST);
      this.depthTest = dt;
    }
    const dw = d.depthWrite === false ? 0 : 1;
    if (this.depthMask !== dw) {
      gl.depthMask(dw === 1);
      this.depthMask = dw;
    }
    if (dt === 1 && this.depthFunc !== p.depthFunc) {
      gl.depthFunc(p.depthFunc);
      this.depthFunc = p.depthFunc;
    }
    const cullMode = d.cullMode ?? 'back';
    const c = cullMode === 'none' ? 0 : 1;
    if (this.cull !== c) {
      if (c === 1) gl.enable(GL.CULL_FACE);
      else gl.disable(GL.CULL_FACE);
      this.cull = c;
    }
    if (c === 1) {
      const face = cullMode === 'front' ? GL.FRONT : GL.BACK;
      if (this.cullFace !== face) {
        gl.cullFace(face);
        this.cullFace = face;
      }
    }
    const ff = d.frontFace === 'cw' ? GL.CW : GL.CCW;
    if (this.frontFace !== ff) {
      gl.frontFace(ff);
      this.frontFace = ff;
    }
    const cm = d.colorWrite === false ? 0 : 1;
    if (this.colorMask !== cm) {
      gl.colorMask(cm === 1, cm === 1, cm === 1, cm === 1);
      this.colorMask = cm;
    }
    const bias = d.depthBias;
    const po = bias === undefined ? 0 : 1;
    if (this.polyOffset !== po) {
      if (po === 1) gl.enable(GL.POLYGON_OFFSET_FILL);
      else gl.disable(GL.POLYGON_OFFSET_FILL);
      this.polyOffset = po;
    }
    if (bias !== undefined && (this.polyFactor !== bias.slopeScale || this.polyUnits !== bias.constant)) {
      gl.polygonOffset(bias.slopeScale, bias.constant);
      this.polyFactor = bias.slopeScale;
      this.polyUnits = bias.constant;
    }
    const blend = d.blend ?? 'none';
    if (this.blend !== blend) {
      if (blend === 'none') gl.disable(GL.BLEND);
      else {
        gl.enable(GL.BLEND);
        gl.blendEquation(GL.FUNC_ADD);
        if (blend === 'alpha') gl.blendFuncSeparate(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA, GL.ONE, GL.ONE_MINUS_SRC_ALPHA);
        else if (blend === 'premultiplied') gl.blendFunc(GL.ONE, GL.ONE_MINUS_SRC_ALPHA);
        else gl.blendFunc(GL.SRC_ALPHA, GL.ONE);
      }
      this.blend = blend;
    }
  }

  applyBindGroup(d: BindGroupDesc): void {
    const gl = this.gl;
    if (d.buffers !== undefined) {
      for (const b of d.buffers) {
        const res = this.registry.get(b.buffer);
        if (!(res instanceof BufferRes)) throw new Error(`bind group: invalid buffer handle ${b.buffer}`);
        const off = b.offset ?? 0;
        const size = b.size ?? res.desc.size - off;
        const slot = b.slot;
        if (this.uboBuf[slot] !== res.glBuf || this.uboOff[slot] !== off || this.uboSize[slot] !== size) {
          gl.bindBufferRange(GL.UNIFORM_BUFFER, slot, res.glBuf, off, size);
          this.uboBuf[slot] = res.glBuf;
          this.uboOff[slot] = off;
          this.uboSize[slot] = size;
        }
      }
    }
    if (d.textures !== undefined) {
      for (const t of d.textures) {
        const res = this.registry.get(t.texture);
        if (!(res instanceof TextureRes)) throw new Error(`bind group: invalid texture handle ${t.texture}`);
        if (this.texBound[t.unit] !== res.glTex || this.texTarget[t.unit] !== res.target) {
          this.bindTextureUnit(t.unit, res.glTex, res.target);
        }
      }
    }
  }

  /** Binds (or creates) the VAO matching pipeline + bound streams, re-pointing changed offsets. */
  prepareDraw(p: PipelineRes, enc: Encoder): void {
    const streams = p.desc.streams;
    const n = streams.length;
    if (enc.streamCount < n) throw new Error(`${p.desc.label ?? 'pipeline'}: expects ${n} vertex streams, got ${enc.streamCount}`);
    let entry: VaoEntry | null = null;
    for (const e of p.vaos) {
      if (e.indexBuffer !== enc.indexBuffer) continue;
      let same = true;
      for (let i = 0; i < n; i++) {
        if (e.buffers[i] !== enc.streamBufs[i]) {
          same = false;
          break;
        }
      }
      if (same) {
        entry = e;
        break;
      }
    }
    const gl = this.gl;
    if (entry === null) {
      const vao = gl.createVertexArray();
      entry = {
        vao,
        buffers: new Int32Array(n),
        offsets: new Float64Array(n).fill(-1),
        indexBuffer: enc.indexBuffer,
      };
      for (let i = 0; i < n; i++) entry.buffers[i] = enc.streamBufs[i]!;
      p.vaos.push(entry);
      this.bindVao(vao);
      for (let i = 0; i < n; i++) this.pointStream(streams[i]!, enc.streamBufs[i]!, enc.streamOffs[i]!, true);
      for (let i = 0; i < n; i++) entry.offsets[i] = enc.streamOffs[i]!;
      if (enc.indexBuffer !== 0) {
        const ib = this.registry.get(enc.indexBuffer);
        if (!(ib instanceof BufferRes)) throw new Error(`invalid index buffer handle ${enc.indexBuffer}`);
        gl.bindBuffer(GL.ELEMENT_ARRAY_BUFFER, ib.glBuf);
      }
      return;
    }
    this.bindVao(entry.vao);
    for (let i = 0; i < n; i++) {
      const off = enc.streamOffs[i]!;
      if (entry.offsets[i] !== off) {
        this.pointStream(streams[i]!, enc.streamBufs[i]!, off, false);
        entry.offsets[i] = off;
      }
    }
  }

  private pointStream(layout: VertexStreamLayout, bufH: number, base: number, first: boolean): void {
    const gl = this.gl;
    const res = this.registry.get(bufH);
    if (!(res instanceof BufferRes)) throw new Error(`invalid vertex buffer handle ${bufH}`);
    gl.bindBuffer(GL.ARRAY_BUFFER, res.glBuf);
    const stride = layout.stride;
    for (const a of layout.attributes) {
      const f = a.format;
      const type = scalarGlType(f.scalar);
      const off = base + a.offset;
      if (f.mode === 'int') gl.vertexAttribIPointer(a.location, f.count, type, stride, off);
      else gl.vertexAttribPointer(a.location, f.count, type, f.mode === 'norm', stride, off);
      if (first) {
        gl.enableVertexAttribArray(a.location);
        gl.vertexAttribDivisor(a.location, layout.stepMode === 'instance' ? 1 : 0);
      }
    }
  }

  // ------------------------------------------------------------------ GpuDevice

  createBuffer(d: BufferDesc): BufH {
    if (d.size <= 0) throw new Error(`createBuffer(${d.label ?? ''}): size must be > 0`);
    const res = new BufferRes(this, d);
    res.id = this.registry.register(res);
    return res.id as BufH;
  }

  writeBuffer(h: BufH, dstOffset: number, src: ArrayBufferView, srcOffset = 0, size?: number): void {
    const res = this.registry.get(h);
    if (!(res instanceof BufferRes)) throw new Error(`writeBuffer: invalid buffer handle ${h}`);
    if (this.registry.isLost()) return;
    const bpe = (src as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT ?? 1;
    const elems = size ?? (src.byteLength / bpe - srcOffset);
    if (elems <= 0) return;
    if (dstOffset + elems * bpe > res.desc.size) {
      throw new Error(`writeBuffer(${res.desc.label ?? h}): ${dstOffset}+${elems * bpe} exceeds size ${res.desc.size}`);
    }
    const gl = this.gl;
    gl.bindBuffer(GL.COPY_WRITE_BUFFER, res.glBuf);
    gl.bufferSubData(GL.COPY_WRITE_BUFFER, dstOffset, src, srcOffset, elems);
    this.counters.uploadBytes += elems * bpe;
  }

  destroyBuffer(h: BufH): void {
    const res = this.registry.get(h);
    if (!(res instanceof BufferRes)) return;
    // Drop VAOs that reference the buffer (handles are never reused, but the GL objects are).
    for (const p of this.pipelines) {
      for (let i = p.vaos.length - 1; i >= 0; i--) {
        const e = p.vaos[i]!;
        if (e.indexBuffer === h || e.buffers.includes(h)) {
          if (e.vao !== null && !this.registry.isLost()) this.gl.deleteVertexArray(e.vao);
          if (this.curVao === e.vao) this.curVao = undefined;
          p.vaos.splice(i, 1);
        }
      }
    }
    for (let s = 0; s < MAX_UBO_SLOTS; s++) if (this.uboBuf[s] === res.glBuf) this.uboBuf[s] = null;
    this.registry.unregister(h);
  }

  createTexture(d: TexDesc): TexH {
    const res = new TextureRes(this, d);
    res.id = this.registry.register(res);
    return res.id as TexH;
  }

  writeTexture(h: TexH, r: Rect, src: ArrayBufferView, layer = 0, mipLevel = 0): void {
    const res = this.registry.get(h);
    if (!(res instanceof TextureRes)) throw new Error(`writeTexture: invalid texture handle ${h}`);
    const f = res.info;
    if (f.kind === 'depth') throw new Error(`writeTexture(${res.desc.label ?? h}): depth textures are render targets only`);
    if (mipLevel < 0 || mipLevel >= res.levels) throw new Error(`writeTexture(${res.desc.label ?? h}): mip ${mipLevel} out of range`);
    if (layer < 0 || layer >= res.layers) throw new Error(`writeTexture(${res.desc.label ?? h}): layer ${layer} out of range`);
    if (r.x < 0 || r.y < 0 || r.x + r.width > res.levelWidth(mipLevel) || r.y + r.height > res.levelHeight(mipLevel)) {
      throw new Error(`writeTexture(${res.desc.label ?? h}): rect exceeds level size`);
    }
    if (this.registry.isLost()) return;
    // rgba16f accepts half floats (Uint16Array) or 32-bit floats.
    const type = f.type === GL.HALF_FLOAT && src instanceof Float32Array ? GL.FLOAT : f.type;
    this.bindTextureUnit(0, res.glTex, res.target);
    if (res.target === GL.TEXTURE_2D_ARRAY) {
      this.gl.texSubImage3D(res.target, mipLevel, r.x, r.y, layer, r.width, r.height, 1, f.format, type, src);
    } else {
      this.gl.texSubImage2D(res.target, mipLevel, r.x, r.y, r.width, r.height, f.format, type, src);
    }
    this.counters.uploadBytes += src.byteLength;
  }

  generateMipmaps(h: TexH): void {
    const res = this.registry.get(h);
    if (!(res instanceof TextureRes)) throw new Error(`generateMipmaps: invalid texture handle ${h}`);
    if (res.levels <= 1 || this.registry.isLost()) return;
    if (!this.isFilterable(res.info, false)) {
      throw new Error(`generateMipmaps(${res.desc.label ?? h}): format ${res.desc.format} is not filterable`);
    }
    this.bindTextureUnit(0, res.glTex, res.target);
    this.gl.generateMipmap(res.target);
  }

  readTexture(h: TexH, r: Rect, out: ArrayBufferView, layer = 0): void {
    const res = this.registry.get(h);
    if (!(res instanceof TextureRes)) throw new Error(`readTexture: invalid texture handle ${h}`);
    const f = res.info;
    if (f.kind === 'depth') throw new Error(`readTexture(${res.desc.label ?? h}): depth textures cannot be read back`);
    if (f.renderable === 'float' && !this.caps.colorBufferFloat) {
      throw new Error(`readTexture(${res.desc.label ?? h}): float readback needs EXT_color_buffer_float`);
    }
    const n = r.width * r.height;
    const need = n * f.channels;
    const outLen = (out as unknown as { length?: number }).length ?? out.byteLength;
    if (outLen < need) throw new Error(`readTexture(${res.desc.label ?? h}): out holds ${outLen} values, need ${need}`);
    if (this.registry.isLost()) throw new Error('readTexture: context lost');
    const att: PassAttachment = { texture: h, layer };
    const entry = this.framebufferFor([att], undefined);
    this.bindFbo(entry.fbo);
    const gl = this.gl;
    const direct =
      f.channels === 4 &&
      ((f.readType === GL.UNSIGNED_BYTE && out instanceof Uint8Array) ||
        (f.readType === GL.UNSIGNED_INT && out instanceof Uint32Array) ||
        (f.readType === GL.INT && out instanceof Int32Array) ||
        (f.readType === GL.FLOAT && out instanceof Float32Array));
    if (direct) {
      gl.readPixels(r.x, r.y, r.width, r.height, f.readFormat, f.readType, out);
      return;
    }
    let scratch: Uint8Array | Uint32Array | Int32Array | Float32Array;
    switch (f.readType) {
      case GL.UNSIGNED_BYTE:
        scratch = new Uint8Array(n * 4);
        break;
      case GL.UNSIGNED_INT:
        scratch = new Uint32Array(n * 4);
        break;
      case GL.INT:
        scratch = new Int32Array(n * 4);
        break;
      default:
        scratch = new Float32Array(n * 4);
    }
    gl.readPixels(r.x, r.y, r.width, r.height, f.readFormat, f.readType, scratch);
    const dst = out as unknown as { [i: number]: number };
    const ch = f.channels;
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) dst[i * ch + c] = scratch[i * 4 + c]!;
  }

  destroyTexture(h: TexH): void {
    const res = this.registry.get(h);
    if (!(res instanceof TextureRes)) return;
    for (let u = 0; u < MAX_TEX_UNITS; u++) if (this.texBound[u] === res.glTex) this.texBound[u] = null;
    // Framebuffers referencing the texture are dropped (handles are never reused).
    for (let i = this.fbos.length - 1; i >= 0; i--) {
      const e = this.fbos[i]!;
      let uses = e.depth[0] === h;
      for (let k = 0; k < e.colors.length; k += 3) if (e.colors[k] === h) uses = true;
      if (!uses) continue;
      if (e.fbo !== null && !this.registry.isLost()) {
        if (this.curFbo === e.fbo) this.bindFbo(null);
        this.gl.deleteFramebuffer(e.fbo);
      }
      this.fbos.splice(i, 1);
    }
    this.registry.unregister(h);
  }

  // ------------------------------------------------------------------ framebuffers (internal)

  private bindFbo(fbo: WebGLFramebuffer | null): void {
    if (this.curFbo === fbo) return;
    this.gl.bindFramebuffer(GL.FRAMEBUFFER, fbo);
    this.curFbo = fbo;
  }

  private texRes(a: PassAttachment, what: string): TextureRes {
    const res = this.registry.get(a.texture);
    if (!(res instanceof TextureRes)) throw new Error(`${what}: invalid texture handle ${a.texture}`);
    return res;
  }

  /** Finds or creates the framebuffer for an attachment set (no allocation on a cache hit). */
  framebufferFor(colors: readonly PassAttachment[], depth: PassAttachment | undefined): FboEntry {
    const nc = colors.length;
    for (const e of this.fbos) {
      if (e.colors.length !== nc * 3) continue;
      if (depth === undefined ? e.depth[0] !== 0 : e.depth[0] !== depth.texture || e.depth[1] !== (depth.layer ?? 0) || e.depth[2] !== (depth.mipLevel ?? 0)) {
        continue;
      }
      let same = true;
      for (let i = 0; i < nc; i++) {
        const a = colors[i]!;
        if (e.colors[i * 3] !== a.texture || e.colors[i * 3 + 1] !== (a.layer ?? 0) || e.colors[i * 3 + 2] !== (a.mipLevel ?? 0)) {
          same = false;
          break;
        }
      }
      if (same) return e;
    }
    if (nc > this.caps.maxColorAttachments) throw new Error(`offscreen pass: ${nc} color attachments > max ${this.caps.maxColorAttachments}`);
    const gl = this.gl;
    const colorIds = new Int32Array(nc * 3);
    const depthIds = new Int32Array(3);
    const kinds: string[] = [];
    let width = -1;
    let height = -1;
    const checkSize = (res: TextureRes, mip: number): void => {
      const w = res.levelWidth(mip);
      const h = res.levelHeight(mip);
      if (width < 0) {
        width = w;
        height = h;
      } else if (w !== width || h !== height) {
        throw new Error(`offscreen pass: attachment ${res.desc.label ?? res.id} is ${w}×${h}, expected ${width}×${height}`);
      }
    };
    for (let i = 0; i < nc; i++) {
      const a = colors[i]!;
      const res = this.texRes(a, 'offscreen pass');
      const f = res.info;
      if (f.renderable === 'depth') throw new Error(`offscreen pass: ${res.desc.format} cannot be a color attachment`);
      if (f.renderable === 'float' && !this.caps.colorBufferFloat) {
        throw new Error(`offscreen pass: ${res.desc.format} color targets need EXT_color_buffer_float (caps.colorBufferFloat)`);
      }
      checkSize(res, a.mipLevel ?? 0);
      colorIds[i * 3] = a.texture;
      colorIds[i * 3 + 1] = a.layer ?? 0;
      colorIds[i * 3 + 2] = a.mipLevel ?? 0;
      kinds.push(f.kind);
    }
    if (depth !== undefined) {
      const res = this.texRes(depth, 'offscreen pass');
      if (res.info.renderable !== 'depth') throw new Error(`offscreen pass: ${res.desc.format} is not a depth format`);
      checkSize(res, depth.mipLevel ?? 0);
      depthIds[0] = depth.texture;
      depthIds[1] = depth.layer ?? 0;
      depthIds[2] = depth.mipLevel ?? 0;
    }
    if (width < 0) throw new Error('offscreen pass: no attachments');
    const fbo = gl.createFramebuffer();
    this.bindFbo(fbo);
    const attach = (point: number, a: PassAttachment): void => {
      const res = this.texRes(a, 'offscreen pass');
      if (res.target === GL.TEXTURE_2D_ARRAY) gl.framebufferTextureLayer(GL.FRAMEBUFFER, point, res.glTex, a.mipLevel ?? 0, a.layer ?? 0);
      else gl.framebufferTexture2D(GL.FRAMEBUFFER, point, GL.TEXTURE_2D, res.glTex, a.mipLevel ?? 0);
    };
    const bufs: number[] = [];
    for (let i = 0; i < nc; i++) {
      attach(GL.COLOR_ATTACHMENT0 + i, colors[i]!);
      bufs.push(GL.COLOR_ATTACHMENT0 + i);
    }
    if (depth !== undefined) attach(GL.DEPTH_ATTACHMENT, depth);
    gl.drawBuffers(nc > 0 ? bufs : [GL.NONE]);
    gl.readBuffer(nc > 0 ? GL.COLOR_ATTACHMENT0 : GL.NONE);
    const status = gl.checkFramebufferStatus(GL.FRAMEBUFFER);
    if (status !== GL.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
      this.bindFbo(null);
      if (fbo !== null) gl.deleteFramebuffer(fbo);
      throw new Error(`offscreen pass: framebuffer incomplete (${glErrorName(status)})`);
    }
    const entry: FboEntry = { fbo, colors: colorIds, depth: depthIds, width, height, kinds };
    this.fbos.push(entry);
    return entry;
  }

  createPipeline(d: PipelineDesc): PipeH {
    const res = new PipelineRes(this, d);
    res.id = this.registry.register(res);
    this.pipelines.push(res);
    return res.id as PipeH;
  }

  destroyPipeline(h: PipeH): void {
    const res = this.registry.get(h);
    if (!(res instanceof PipelineRes)) return;
    if (this.curProgram === res.program) this.curProgram = null;
    for (const e of res.vaos) if (this.curVao === e.vao) this.curVao = undefined;
    const i = this.pipelines.indexOf(res);
    if (i >= 0) this.pipelines.splice(i, 1);
    this.registry.unregister(h);
  }

  createBindGroup(d: BindGroupDesc): BindGroupH {
    const res = new BindGroupRes(d);
    res.id = this.registry.register(res);
    return res.id as BindGroupH;
  }

  destroyBindGroup(h: BindGroupH): void {
    const res = this.registry.get(h);
    if (res instanceof BindGroupRes) this.registry.unregister(h);
  }

  beginPass(d: PassDesc): PassEncoder {
    const enc = this.encoder;
    if (enc.open) throw new Error('beginPass: previous pass not ended');
    enc.reset();
    if (this.registry.isLost()) return enc;
    const gl = this.gl;
    const colors = d.colorAttachments;
    const offscreen = (colors !== undefined && colors.length > 0) || d.depthAttachment !== undefined;
    let fb: FboEntry | null = null;
    let tw: number;
    let th: number;
    if (offscreen) {
      fb = this.framebufferFor(colors ?? [], d.depthAttachment);
      this.bindFbo(fb.fbo);
      tw = fb.width;
      th = fb.height;
    } else {
      this.bindFbo(null);
      tw = gl.drawingBufferWidth;
      th = gl.drawingBufferHeight;
    }
    const vw = d.viewport?.width ?? tw;
    const vh = d.viewport?.height ?? th;
    const vx = d.viewport?.x ?? 0;
    const vy = d.viewport?.y ?? 0;
    const vp = this.vp;
    if (vp[0] !== vx || vp[1] !== vy || vp[2] !== vw || vp[3] !== vh) {
      gl.viewport(vx, vy, vw, vh);
      vp[0] = vx;
      vp[1] = vy;
      vp[2] = vw;
      vp[3] = vh;
    }
    if (d.clearColor !== undefined && this.colorMask !== 1) {
      gl.colorMask(true, true, true, true);
      this.colorMask = 1;
    }
    if (d.clearDepth !== undefined && this.depthMask !== 1) {
      gl.depthMask(true);
      this.depthMask = 1;
    }
    if (fb === null) {
      let mask = 0;
      if (d.clearColor !== undefined) {
        const c = d.clearColor;
        gl.clearColor(c[0], c[1], c[2], c[3]);
        mask |= GL.COLOR_BUFFER_BIT;
      }
      if (d.clearDepth !== undefined) {
        gl.clearDepth(d.clearDepth);
        mask |= GL.DEPTH_BUFFER_BIT;
      }
      if (mask !== 0) gl.clear(mask);
      return enc;
    }
    // Offscreen: per-attachment clears with the attachment's component type.
    const c = d.clearColor;
    if (c !== undefined) {
      for (let i = 0; i < fb.kinds.length; i++) {
        const kind = fb.kinds[i];
        if (kind === 'uint') {
          for (let k = 0; k < 4; k++) this.clearU[k] = Math.max(0, Math.trunc(c[k]!));
          gl.clearBufferuiv(GL.COLOR, i, this.clearU);
        } else if (kind === 'sint') {
          for (let k = 0; k < 4; k++) this.clearI[k] = Math.trunc(c[k]!);
          gl.clearBufferiv(GL.COLOR, i, this.clearI);
        } else {
          for (let k = 0; k < 4; k++) this.clearF[k] = c[k]!;
          gl.clearBufferfv(GL.COLOR, i, this.clearF);
        }
      }
    }
    if (d.clearDepth !== undefined && fb.depth[0] !== 0) {
      this.clearD[0] = d.clearDepth;
      gl.clearBufferfv(GL.DEPTH, 0, this.clearD);
    }
    return enc;
  }

  beginFrame(): void {
    this.counters.drawCalls = 0;
    this.counters.instances = 0;
    this.counters.uploadBytes = 0;
    if (this.timerExt === null || this.registry.isLost()) return;
    const gl = this.gl;
    this.pollQueries();
    if (this.activeQuery !== null) return;
    if (this.pendingQueries.length >= TIMER_POOL) return; // GPU far behind: skip timing this frame
    const q = this.freeQueries.pop() ?? gl.createQuery();
    if (q === null) return;
    gl.beginQuery(GL.TIME_ELAPSED_EXT, q);
    this.activeQuery = q;
  }

  endFrame(): void {
    const q = this.activeQuery;
    if (q === null) return;
    this.activeQuery = null;
    if (this.registry.isLost()) return;
    this.gl.endQuery(GL.TIME_ELAPSED_EXT);
    this.pendingQueries.push(q);
  }

  private pollQueries(): void {
    const gl = this.gl;
    while (this.pendingQueries.length > 0) {
      const q = this.pendingQueries[0]!;
      if (gl.getQueryParameter(q, GL.QUERY_RESULT_AVAILABLE) !== true) break;
      const disjoint = gl.getParameter(GL.GPU_DISJOINT_EXT) === true;
      const ns: unknown = gl.getQueryParameter(q, GL.QUERY_RESULT);
      if (!disjoint && typeof ns === 'number') this.lastGpuMs = ns / 1e6;
      this.pendingQueries.shift();
      this.freeQueries.push(q);
    }
  }

  gpuTimeMs(): number | undefined {
    return this.lastGpuMs;
  }

  drawingBufferSize(): { readonly width: number; readonly height: number } {
    this.dbSize.width = this.gl.drawingBufferWidth;
    this.dbSize.height = this.gl.drawingBufferHeight;
    return this.dbSize;
  }

  isLost(): boolean {
    return this.registry.isLost();
  }

  onRestored(cb: () => void): () => void {
    return this.registry.onRestored(cb);
  }

  onLost(cb: () => void): () => void {
    return this.registry.onLost(cb);
  }

  checkErrors(): string[] {
    const out: string[] = [];
    for (let i = 0; i < 16; i++) {
      const e = this.gl.getError();
      if (e === GL.NO_ERROR) break;
      out.push(glErrorName(e));
    }
    return out;
  }

  debugLoseContext(): boolean {
    if (this.loseExt === null) return false;
    this.loseExt.loseContext();
    return true;
  }

  debugRestoreContext(): boolean {
    if (this.loseExt === null) return false;
    this.loseExt.restoreContext();
    return true;
  }

  destroy(): void {
    if (!this.registry.isLost()) {
      const gl = this.gl;
      this.bindVao(null);
      for (const q of this.freeQueries) gl.deleteQuery(q);
      for (const q of this.pendingQueries) gl.deleteQuery(q);
      this.bindFbo(null);
      for (const e of this.fbos) if (e.fbo !== null) gl.deleteFramebuffer(e.fbo);
    }
    this.fbos.length = 0;
    this.freeQueries.length = 0;
    this.pendingQueries.length = 0;
    this.pipelines.length = 0;
    this.registry.dispose();
  }
}

/** Creates the WebGL2 device for a canvas (throws if WebGL2 is unavailable). */
export function createWebGL2Device(canvas: DeviceCanvas, opts: WebGL2DeviceOptions = {}): WebGL2Device {
  return new Device(canvas, opts);
}
