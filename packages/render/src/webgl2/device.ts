/**
 * WebGL2 backend of the RHI (PLAN §3.7).
 *
 * - Every resource lives in the {@link ContextLossRegistry}; handles stay valid across context loss.
 * - VAO cache per pipeline + bound buffer set; when only stream offsets change (instance ring
 *   regions, per-visual buckets) the cached VAO is re-pointed instead of creating a new one.
 * - Integer attributes use `vertexAttribIPointer`, instance streams `vertexAttribDivisor(loc, 1)`.
 * - Redundant state changes (program, VAO, depth/blend/cull, UBO ranges, textures) are filtered.
 * - Optional: EXT_disjoint_timer_query_webgl2 (GPU frame time), WEBGL_multi_draw.
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
import { scalarSize } from '../rhi/types.ts';
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
  constructor(
    private readonly dev: Device,
    readonly desc: TexDesc,
  ) {
    const cb = desc.restore;
    this.restore = cb === undefined ? undefined : () => cb(this.id as TexH);
  }
  realize(): void {
    const gl = this.dev.gl;
    const d = this.desc;
    const f = textureFormat(d.format);
    const tex = gl.createTexture();
    this.dev.bindTextureUnit(0, null);
    gl.bindTexture(GL.TEXTURE_2D, tex);
    gl.texStorage2D(GL.TEXTURE_2D, 1, f.internal, d.width, d.height);
    const filter = d.filter === 'linear' && f.filterable ? GL.LINEAR : GL.NEAREST;
    const wrap = d.wrap === 'repeat' ? GL.REPEAT : GL.CLAMP_TO_EDGE;
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_WRAP_T, wrap);
    gl.bindTexture(GL.TEXTURE_2D, null);
    this.glTex = tex;
  }
  release(deleteObjects: boolean): void {
    if (deleteObjects && this.glTex !== null) this.dev.gl.deleteTexture(this.glTex);
    this.glTex = null;
  }
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
  readonly format: number;
  readonly type: number;
  readonly filterable: boolean;
}

function textureFormat(f: TextureFormat): TexFormatInfo {
  switch (f) {
    case 'rgba8':
      return { internal: GL.RGBA8, format: GL.RGBA, type: GL.UNSIGNED_BYTE, filterable: true };
    case 'r8':
      return { internal: GL.R8, format: GL.RED, type: GL.UNSIGNED_BYTE, filterable: true };
    case 'rg8':
      return { internal: GL.RG8, format: GL.RG, type: GL.UNSIGNED_BYTE, filterable: true };
    case 'r16ui':
      return { internal: GL.R16UI, format: GL.RED_INTEGER, type: GL.UNSIGNED_SHORT, filterable: false };
    case 'r32ui':
      return { internal: GL.R32UI, format: GL.RED_INTEGER, type: GL.UNSIGNED_INT, filterable: false };
    case 'r32f':
      return { internal: GL.R32F, format: GL.RED, type: GL.FLOAT, filterable: false };
    case 'rgba16f':
      return { internal: GL.RGBA16F, format: GL.RGBA, type: GL.HALF_FLOAT, filterable: true };
  }
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
  private activeUnit = -1;
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
      maxUniformBlockSize: num(GL.MAX_UNIFORM_BLOCK_SIZE, 16384),
      uniformOffsetAlignment: num(GL.UNIFORM_BUFFER_OFFSET_ALIGNMENT, 256),
      maxVertexAttribs: num(GL.MAX_VERTEX_ATTRIBS, 16),
      maxTextureSize: num(GL.MAX_TEXTURE_SIZE, 4096),
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
    this.activeUnit = -1;
    this.vp.fill(-1);
  }

  private onContextLost(): void {
    this.resetStateCache();
    this.freeQueries.length = 0;
    this.pendingQueries.length = 0;
    this.activeQuery = null;
    this.lastGpuMs = undefined;
  }

  private onContextRestored(): void {
    this.resetStateCache();
    this.caps = this.queryCaps();
    this.gl.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
  }

  // ------------------------------------------------------------------ state helpers (internal)

  bindVao(vao: WebGLVertexArrayObject | null): void {
    if (this.curVao === vao) return;
    this.gl.bindVertexArray(vao);
    this.curVao = vao;
  }

  bindTextureUnit(unit: number, tex: WebGLTexture | null): void {
    if (this.activeUnit !== unit) {
      this.gl.activeTexture(GL.TEXTURE0 + unit);
      this.activeUnit = unit;
    }
    this.gl.bindTexture(GL.TEXTURE_2D, tex);
    this.texBound[unit] = tex;
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
        if (this.texBound[t.unit] !== res.glTex) this.bindTextureUnit(t.unit, res.glTex);
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

  writeTexture(h: TexH, r: Rect, src: ArrayBufferView): void {
    const res = this.registry.get(h);
    if (!(res instanceof TextureRes)) throw new Error(`writeTexture: invalid texture handle ${h}`);
    if (this.registry.isLost()) return;
    const f = textureFormat(res.desc.format);
    this.bindTextureUnit(0, res.glTex);
    this.gl.texSubImage2D(GL.TEXTURE_2D, 0, r.x, r.y, r.width, r.height, f.format, f.type, src);
    this.counters.uploadBytes += src.byteLength;
  }

  destroyTexture(h: TexH): void {
    const res = this.registry.get(h);
    if (!(res instanceof TextureRes)) return;
    for (let u = 0; u < MAX_TEX_UNITS; u++) if (this.texBound[u] === res.glTex) this.texBound[u] = null;
    this.registry.unregister(h);
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
    const vw = d.viewport?.width ?? gl.drawingBufferWidth;
    const vh = d.viewport?.height ?? gl.drawingBufferHeight;
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
    let mask = 0;
    if (d.clearColor !== undefined) {
      const c = d.clearColor;
      gl.clearColor(c[0], c[1], c[2], c[3]);
      mask |= GL.COLOR_BUFFER_BIT;
    }
    if (d.clearDepth !== undefined) {
      if (this.depthMask !== 1) {
        gl.depthMask(true);
        this.depthMask = 1;
      }
      gl.clearDepth(d.clearDepth);
      mask |= GL.DEPTH_BUFFER_BIT;
    }
    if (mask !== 0) gl.clear(mask);
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
    }
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
