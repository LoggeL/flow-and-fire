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
}

export interface FakeWebGL2 {
  readonly calls: GlCall[];
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
