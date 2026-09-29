/**
 * Recording fake of a WebGL2 context for Node tests (no GPU). Every method call is appended to
 * `calls` as `{ name, args }`; object-creating calls return fresh tagged objects. Context loss is
 * simulated via `lose()` / `restore()` which dispatch the canvas events like a browser would.
 */

export interface GlCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

export interface FakeGlObject {
  readonly kind: string;
  readonly id: number;
  /** Context generation that created the object (objects of a lost generation are dead). */
  readonly gen: number;
}

type Listener = (ev: Event) => void;

export class FakeCanvas {
  width = 300;
  height = 150;
  clientWidth = 800;
  clientHeight = 600;
  private readonly listeners = new Map<string, Listener[]>();
  readonly gl: FakeWebGL2;

  constructor(opts: FakeGlOptions = {}) {
    this.gl = createFakeWebGL2(this, opts);
  }

  getContext(id: string): unknown {
    return id === 'webgl2' ? this.gl : null;
  }

  addEventListener(type: string, l: Listener): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(l);
    this.listeners.set(type, arr);
  }

  removeEventListener(type: string, l: Listener): void {
    const arr = this.listeners.get(type);
    if (arr === undefined) return;
    const i = arr.indexOf(l);
    if (i >= 0) arr.splice(i, 1);
  }

  dispatch(type: string): { defaultPrevented: boolean } {
    const ev = {
      type,
      defaultPrevented: false,
      preventDefault(): void {
        this.defaultPrevented = true;
      },
    };
    for (const l of (this.listeners.get(type) ?? []).slice()) l(ev as unknown as Event);
    return ev;
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }
}

export interface FakeGlOptions {
  /** Extensions returned by getExtension (name → object). Default: none. */
  readonly extensions?: Readonly<Record<string, object>>;
  /** Makes compileShader fail for sources containing this marker. */
  readonly failCompileMarker?: string;
  /** Emulates readPixels (fills `args[6]`) from the tracked state – e.g. a CPU shader model. */
  readonly onReadPixels?: (state: FakeGlState, args: readonly unknown[]) => void;
  /** Status returned by checkFramebufferStatus (default FRAMEBUFFER_COMPLETE). */
  readonly framebufferStatus?: number;
}

/** Upload recorded by texSubImage2D/3D (copy of the source data). */
export interface FakeTexUpload {
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly layer: number;
  readonly width: number;
  readonly height: number;
  readonly data: ArrayBufferView;
}

export interface FakeTexState {
  target: number;
  internalFormat: number;
  width: number;
  height: number;
  depth: number;
  levels: number;
  readonly uploads: FakeTexUpload[];
  readonly params: Map<number, number>;
}

/** Tracked GL state for emulation hooks and assertions. */
export interface FakeGlState {
  /** Per texture object of any generation. */
  readonly textures: Map<FakeGlObject, FakeTexState>;
  /** Latest bufferSubData payload per buffer object (copy, in elements of the source type). */
  readonly bufferData: Map<FakeGlObject, ArrayBufferView>;
  /** Buffer written by the most recent bufferSubData. */
  lastBufferWrite: FakeGlObject | null;
  /** Framebuffer currently bound (null = canvas). */
  framebuffer: FakeGlObject | null;
  /** Attachments per framebuffer: attachment point → texture. */
  readonly attachments: Map<FakeGlObject, Map<number, FakeGlObject>>;
  /** Last draw: primitive mode and vertex count. */
  lastDraw: { mode: number; count: number; instances: number } | null;
  /** Current context generation. */
  readonly generation: number;
}

export interface FakeWebGL2 {
  readonly calls: GlCall[];
  readonly state: FakeGlState;
  /** Calls with the given name. */
  named(name: string): GlCall[];
  /** Forgets recorded calls (not named `clear`: that is a WebGL method). */
  resetCalls(): void;
  lose(): void;
  restore(): void;
  readonly generation: number;
  /** Objects created per kind in the current generation. */
  created(kind: string): number;
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;
}

const PARAMS: Record<number, unknown> = {
  0x8a30: 16384, // MAX_UNIFORM_BLOCK_SIZE
  0x8a34: 256, // UNIFORM_BUFFER_OFFSET_ALIGNMENT
  0x8869: 16, // MAX_VERTEX_ATTRIBS
  0x0d33: 8192, // MAX_TEXTURE_SIZE
  0x1f01: 'FakeGL', // RENDERER
  0x8fbb: false, // GPU_DISJOINT_EXT
};

export function createFakeWebGL2(canvas: FakeCanvas, opts: FakeGlOptions = {}): FakeWebGL2 {
  const calls: GlCall[] = [];
  let lost = false;
  let gen = 1;
  let nextId = 1;
  const createdCount = new Map<string, number>();
  const shaderSrc = new Map<FakeGlObject, string>();
  const shaderOk = new Map<FakeGlObject, boolean>();
  const programOk = new Map<FakeGlObject, boolean>();
  const attached = new Map<FakeGlObject, FakeGlObject[]>();
  let activeUnit = 0;
  const bound = new Map<string, FakeGlObject | null>(); // `${unit}:${target}` → texture
  const boundBuffers = new Map<number, FakeGlObject | null>();
  const state: FakeGlState = {
    textures: new Map(),
    bufferData: new Map(),
    lastBufferWrite: null,
    framebuffer: null,
    attachments: new Map(),
    lastDraw: null,
    get generation() {
      return gen;
    },
  };
  const boundTex = (target: number): FakeGlObject | null => bound.get(`${activeUnit}:${target}`) ?? null;
  const copyView = (src: unknown, offset: number, len: number | undefined): ArrayBufferView => {
    const t = src as { slice?: (a: number, b?: number) => ArrayBufferView; length?: number };
    if (typeof t.slice === 'function' && typeof t.length === 'number') {
      return t.slice(offset, len === undefined ? undefined : offset + len);
    }
    return src as ArrayBufferView;
  };

  const make = (kind: string): FakeGlObject | null => {
    if (lost) return null;
    createdCount.set(`${gen}:${kind}`, (createdCount.get(`${gen}:${kind}`) ?? 0) + 1);
    return { kind, id: nextId++, gen };
  };

  const impl: Record<string, (...args: unknown[]) => unknown> = {
    isContextLost: () => lost,
    getExtension: (name) => (lost ? null : (opts.extensions?.[name as string] ?? null)),
    getParameter: (p) => PARAMS[p as number] ?? null,
    getError: () => 0,
    createBuffer: () => make('buffer'),
    createTexture: () => make('texture'),
    createVertexArray: () => make('vao'),
    createProgram: () => make('program'),
    createShader: () => make('shader'),
    createQuery: () => make('query'),
    createFramebuffer: () => make('framebuffer'),
    checkFramebufferStatus: () => opts.framebufferStatus ?? 0x8cd5,
    activeTexture: (unit) => {
      activeUnit = (unit as number) - 0x84c0;
    },
    bindTexture: (target, tex) => {
      bound.set(`${activeUnit}:${target as number}`, tex as FakeGlObject | null);
    },
    texStorage2D: (target, levels, internal, w, h) => {
      const t = boundTex(target as number);
      if (t !== null) {
        state.textures.set(t, {
          target: target as number,
          internalFormat: internal as number,
          width: w as number,
          height: h as number,
          depth: 1,
          levels: levels as number,
          uploads: [],
          params: new Map(),
        });
      }
    },
    texStorage3D: (target, levels, internal, w, h, d) => {
      const t = boundTex(target as number);
      if (t !== null) {
        state.textures.set(t, {
          target: target as number,
          internalFormat: internal as number,
          width: w as number,
          height: h as number,
          depth: d as number,
          levels: levels as number,
          uploads: [],
          params: new Map(),
        });
      }
    },
    texParameteri: (target, pname, value) => {
      const t = boundTex(target as number);
      if (t !== null) state.textures.get(t)?.params.set(pname as number, value as number);
    },
    texSubImage2D: (target, level, x, y, w, h, _f, _t, src) => {
      const t = boundTex(target as number);
      if (t === null) return;
      state.textures.get(t)?.uploads.push({
        level: level as number,
        x: x as number,
        y: y as number,
        layer: 0,
        width: w as number,
        height: h as number,
        data: copyView(src, 0, undefined),
      });
    },
    texSubImage3D: (target, level, x, y, z, w, h, _d, _f, _t, src) => {
      const t = boundTex(target as number);
      if (t === null) return;
      state.textures.get(t)?.uploads.push({
        level: level as number,
        x: x as number,
        y: y as number,
        layer: z as number,
        width: w as number,
        height: h as number,
        data: copyView(src, 0, undefined),
      });
    },
    bindBuffer: (target, buf) => {
      boundBuffers.set(target as number, buf as FakeGlObject | null);
    },
    bufferSubData: (target, _dst, src, srcOffset, len) => {
      const b = boundBuffers.get(target as number) ?? null;
      if (b === null) return;
      state.bufferData.set(b, copyView(src, (srcOffset as number | undefined) ?? 0, len as number | undefined));
      state.lastBufferWrite = b;
    },
    bindFramebuffer: (_target, fb) => {
      state.framebuffer = (fb as FakeGlObject | null) ?? null;
    },
    framebufferTexture2D: (_target, point, _texTarget, tex) => {
      const fb = state.framebuffer;
      if (fb === null) return;
      const m = state.attachments.get(fb) ?? new Map<number, FakeGlObject>();
      m.set(point as number, tex as FakeGlObject);
      state.attachments.set(fb, m);
    },
    framebufferTextureLayer: (_target, point, tex) => {
      const fb = state.framebuffer;
      if (fb === null) return;
      const m = state.attachments.get(fb) ?? new Map<number, FakeGlObject>();
      m.set(point as number, tex as FakeGlObject);
      state.attachments.set(fb, m);
    },
    drawArraysInstanced: (mode, _first, count, instances) => {
      state.lastDraw = { mode: mode as number, count: count as number, instances: instances as number };
    },
    drawElementsInstanced: (mode, count, _type, _off, instances) => {
      state.lastDraw = { mode: mode as number, count: count as number, instances: instances as number };
    },
    readPixels: (...args) => {
      opts.onReadPixels?.(state, args);
    },
    shaderSource: (s, src) => {
      shaderSrc.set(s as FakeGlObject, src as string);
    },
    compileShader: (s) => {
      const src = shaderSrc.get(s as FakeGlObject) ?? '';
      const marker = opts.failCompileMarker;
      shaderOk.set(s as FakeGlObject, marker === undefined || !src.includes(marker));
    },
    attachShader: (p, s) => {
      const arr = attached.get(p as FakeGlObject) ?? [];
      arr.push(s as FakeGlObject);
      attached.set(p as FakeGlObject, arr);
    },
    linkProgram: (p) => {
      const ok = (attached.get(p as FakeGlObject) ?? []).every((s) => shaderOk.get(s) === true);
      programOk.set(p as FakeGlObject, ok);
    },
    getProgramParameter: (p) => programOk.get(p as FakeGlObject) ?? false,
    getShaderParameter: (s) => shaderOk.get(s as FakeGlObject) ?? false,
    getShaderInfoLog: (s) => (shaderOk.get(s as FakeGlObject) === true ? '' : 'ERROR: 0:1: fake compile error'),
    getProgramInfoLog: () => 'fake link log',
    getUniformBlockIndex: (_p, name) => (name === 'Missing' ? 0xffffffff : 0),
    getUniformLocation: () => (lost ? null : {}),
    getQueryParameter: () => false,
  };

  const target = {
    calls,
    state,
    named: (name: string) => calls.filter((c) => c.name === name),
    resetCalls: () => {
      calls.length = 0;
    },
    lose: () => {
      lost = true;
      canvas.dispatch('webglcontextlost');
    },
    restore: () => {
      lost = false;
      gen++;
      bound.clear();
      boundBuffers.clear();
      state.framebuffer = null;
      canvas.dispatch('webglcontextrestored');
    },
    get generation() {
      return gen;
    },
    created: (kind: string) => createdCount.get(`${gen}:${kind}`) ?? 0,
    get drawingBufferWidth() {
      return canvas.width;
    },
    get drawingBufferHeight() {
      return canvas.height;
    },
  };

  return new Proxy(target, {
    get(t, prop, recv) {
      if (typeof prop === 'symbol' || prop in t) return Reflect.get(t, prop, recv) as unknown;
      const fn = impl[prop];
      return (...args: unknown[]) => {
        calls.push({ name: prop, args });
        return fn === undefined ? undefined : fn(...args);
      };
    },
  }) as FakeWebGL2;
}
