/**
 * Post chain of the SPK4 prototype (PLAN §3.7 "Licht und Post"):
 *
 * 1. Scene target: RGBA16F color (HDR) + DEPTH24 at the backbuffer size (render scale 0.8). Without
 *    EXT_color_buffer_float the scene falls back to RGBA8 (LDR) and the tonemapper is bypassed.
 * 2. Dual-Kawase bloom: `levels` downsamples (½ … 1/2^levels; the first with a soft threshold) and
 *    `levels − 1` upsamples (tent filter + the matching down level), all in the scene format.
 * 3. Composite: scene + bloom × intensity, exposure, ACES filmic (Narkowicz fit) in linear space,
 *    luma into alpha → RGBA8 LDR target.
 * 4. FXAA (3.11-style, 5 taps + edge search light) into the canvas.
 *
 * Every step is one fullscreen-triangle draw.
 */
import { Std140Writer, std140Layout, vf } from '@faf/render';
import type { BindGroupH, BufH, GpuDevice, PassDesc, PassEncoder, PipeH, TexH, TextureFormat, VertexStreamBinding } from '@faf/render';

// Fullscreen triangle from a 3-vertex u8 stream (attribute 0 enabled: Firefox on macOS emulates
// attribute-less draws expensively).
const FULLSCREEN_VS = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
out vec2 v_uv;
void main() {
  v_uv = a_corner;
  gl_Position = vec4(a_corner * 2.0 - 1.0, 0.0, 1.0);
}
`;
const TRIANGLE = Uint8Array.of(0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0);

const POST_LAYOUT = std140Layout([
  { name: 'texel', type: 'vec4' },
  { name: 'params', type: 'vec4' },
]);

const POST_BLOCK = /* glsl */ `
layout(std140) uniform Post {
  vec4 u_texel;  // xy: 1 / source size, zw: 1 / target size
  vec4 u_params; // down: x threshold, y knee, z prefilter (1/0); up: x weight of the down level; composite: x exposure, y bloom, z hdr (1/0)
};
`;

const DOWN_FS = /* glsl */ `#version 300 es
precision highp float;
${POST_BLOCK}
uniform highp sampler2D u_src;
in vec2 v_uv;
out vec4 o_color;
vec3 prefilter(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - u_params.x + u_params.y, 0.0, 2.0 * u_params.y);
  soft = soft * soft / (4.0 * u_params.y + 1e-4);
  float contrib = max(soft, br - u_params.x) / max(br, 1e-4);
  return c * contrib;
}
void main() {
  vec2 h = u_texel.xy * 0.5;
  vec3 sum = texture(u_src, v_uv).rgb * 4.0;
  sum += texture(u_src, v_uv - h).rgb;
  sum += texture(u_src, v_uv + h).rgb;
  sum += texture(u_src, v_uv + vec2(h.x, -h.y)).rgb;
  sum += texture(u_src, v_uv - vec2(h.x, -h.y)).rgb;
  vec3 c = sum / 8.0;
  if (u_params.z > 0.5) c = prefilter(c);
  o_color = vec4(c, 1.0);
}
`;

const UP_FS = /* glsl */ `#version 300 es
precision highp float;
${POST_BLOCK}
uniform highp sampler2D u_src;  // lower (smaller) level
uniform highp sampler2D u_add;  // down level of the target size
in vec2 v_uv;
out vec4 o_color;
void main() {
  vec2 h = u_texel.xy * 0.5;
  vec3 sum = texture(u_src, v_uv + vec2(-h.x * 2.0, 0.0)).rgb;
  sum += texture(u_src, v_uv + vec2(-h.x, h.y)).rgb * 2.0;
  sum += texture(u_src, v_uv + vec2(0.0, h.y * 2.0)).rgb;
  sum += texture(u_src, v_uv + vec2(h.x, h.y)).rgb * 2.0;
  sum += texture(u_src, v_uv + vec2(h.x * 2.0, 0.0)).rgb;
  sum += texture(u_src, v_uv + vec2(h.x, -h.y)).rgb * 2.0;
  sum += texture(u_src, v_uv + vec2(0.0, -h.y * 2.0)).rgb;
  sum += texture(u_src, v_uv + vec2(-h.x, -h.y)).rgb * 2.0;
  o_color = vec4(sum / 12.0 + texture(u_add, v_uv).rgb * u_params.x, 1.0);
}
`;

const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
${POST_BLOCK}
uniform highp sampler2D u_scene;
uniform highp sampler2D u_bloom;
in vec2 v_uv;
out vec4 o_color;
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  vec3 c = texture(u_scene, v_uv).rgb;
  if (u_params.y > 0.0) c += texture(u_bloom, v_uv).rgb * u_params.y;
  if (u_params.z > 0.5) {
    // Scene shaders output display-referred colors: linearize, expose, ACES, back to display.
    vec3 lin = pow(max(c, vec3(0.0)), vec3(2.2)) * u_params.x;
    c = pow(aces(lin), vec3(1.0 / 2.2));
  } else {
    c = clamp(c, 0.0, 1.0);
  }
  o_color = vec4(c, dot(c, vec3(0.299, 0.587, 0.114)));
}
`;

const FXAA_FS = /* glsl */ `#version 300 es
precision highp float;
${POST_BLOCK}
uniform highp sampler2D u_ldr;
in vec2 v_uv;
out vec4 o_color;
void main() {
  vec2 px = u_texel.xy;
  vec4 m = texture(u_ldr, v_uv);
  float lM = m.a;
  float lN = texture(u_ldr, v_uv + vec2(0.0, px.y)).a;
  float lS = texture(u_ldr, v_uv - vec2(0.0, px.y)).a;
  float lE = texture(u_ldr, v_uv + vec2(px.x, 0.0)).a;
  float lW = texture(u_ldr, v_uv - vec2(px.x, 0.0)).a;
  float lMin = min(lM, min(min(lN, lS), min(lE, lW)));
  float lMax = max(lM, max(max(lN, lS), max(lE, lW)));
  float range = lMax - lMin;
  if (range < max(0.0312, lMax * 0.125)) {
    o_color = vec4(m.rgb, 1.0);
    return;
  }
  float lNW = texture(u_ldr, v_uv + vec2(-px.x, px.y)).a;
  float lNE = texture(u_ldr, v_uv + px).a;
  float lSW = texture(u_ldr, v_uv - px).a;
  float lSE = texture(u_ldr, v_uv + vec2(px.x, -px.y)).a;
  float edgeH = abs(lNW + lNE - 2.0 * lN) + 2.0 * abs(lW + lE - 2.0 * lM) + abs(lSW + lSE - 2.0 * lS);
  float edgeV = abs(lNW + lSW - 2.0 * lW) + 2.0 * abs(lN + lS - 2.0 * lM) + abs(lNE + lSE - 2.0 * lE);
  bool horizontal = edgeH >= edgeV;
  float l1 = horizontal ? lS : lW;
  float l2 = horizontal ? lN : lE;
  float g1 = abs(l1 - lM);
  float g2 = abs(l2 - lM);
  float stepLen = horizontal ? px.y : px.x;
  float gradient;
  float lEdge;
  if (g1 >= g2) {
    stepLen = -stepLen;
    gradient = g1;
    lEdge = 0.5 * (l1 + lM);
  } else {
    gradient = g2;
    lEdge = 0.5 * (l2 + lM);
  }
  vec2 uvEdge = v_uv + (horizontal ? vec2(0.0, stepLen * 0.5) : vec2(stepLen * 0.5, 0.0));
  vec2 dir = horizontal ? vec2(px.x, 0.0) : vec2(0.0, px.y);
  float scaled = gradient * 0.25;
  vec2 uvP = uvEdge + dir;
  vec2 uvN = uvEdge - dir;
  float dP = texture(u_ldr, uvP).a - lEdge;
  float dN = texture(u_ldr, uvN).a - lEdge;
  bool doneP = abs(dP) >= scaled;
  bool doneN = abs(dN) >= scaled;
  const float STEPS[6] = float[6](1.5, 2.0, 2.0, 2.0, 4.0, 8.0);
  for (int i = 0; i < 6 && !(doneP && doneN); ++i) {
    if (!doneP) { uvP += dir * STEPS[i]; dP = texture(u_ldr, uvP).a - lEdge; doneP = abs(dP) >= scaled; }
    if (!doneN) { uvN -= dir * STEPS[i]; dN = texture(u_ldr, uvN).a - lEdge; doneN = abs(dN) >= scaled; }
  }
  float distP = horizontal ? uvP.x - v_uv.x : uvP.y - v_uv.y;
  float distN = horizontal ? v_uv.x - uvN.x : v_uv.y - uvN.y;
  bool nearestP = distP < distN;
  float dist = min(distP, distN);
  float span = distP + distN;
  bool correct = ((nearestP ? dP : dN) < 0.0) != (lM - lEdge < 0.0);
  float edgeBlend = correct ? 0.5 - dist / max(span, 1e-6) : 0.0;
  float avg = (2.0 * (lN + lS + lE + lW) + lNW + lNE + lSW + lSE) / 12.0;
  float sub = clamp(abs(avg - lM) / range, 0.0, 1.0);
  sub = smoothstep(0.0, 1.0, sub);
  float subBlend = sub * sub * 0.75;
  float blend = max(edgeBlend, subBlend);
  vec2 uv = v_uv + (horizontal ? vec2(0.0, stepLen * blend) : vec2(stepLen * blend, 0.0));
  o_color = vec4(texture(u_ldr, uv).rgb, 1.0);
}
`;

export interface PostOptions {
  readonly hdr: boolean;
  readonly bloom: boolean;
  readonly bloomLevels: number;
  readonly fxaa: boolean;
  readonly exposure: number;
  readonly bloomIntensity: number;
  readonly bloomThreshold: number;
}

interface Step {
  pipeline: PipeH;
  group: BindGroupH;
  ubo: BufH;
  data: Std140Writer;
  pass: PassDesc;
}

export class PostChain {
  /** Scene color target (RGBA16F with HDR support, else RGBA8). */
  sceneColor: TexH = 0 as TexH;
  sceneDepth: TexH = 0 as TexH;
  readonly sceneFormat: TextureFormat;
  readonly hdrActive: boolean;
  width = 0;
  height = 0;
  private readonly downPipe: PipeH;
  private readonly upPipe: PipeH;
  private readonly compositePipe: PipeH;
  private readonly fxaaPipe: PipeH;
  private down: TexH[] = [];
  private up: TexH[] = [];
  private ldr: TexH = 0 as TexH;
  private steps: Step[] = [];
  private readonly textures: TexH[] = [];
  private readonly triangle: BufH;
  private readonly streams: VertexStreamBinding[];
  /** Pass descriptor for the scene (clear color set by the caller). */
  scenePass: PassDesc = {};

  constructor(
    private readonly dev: GpuDevice,
    private readonly opts: PostOptions,
    private readonly clear: readonly [number, number, number],
  ) {
    this.hdrActive = opts.hdr && dev.caps.colorBufferFloat;
    this.sceneFormat = this.hdrActive ? 'rgba16f' : 'rgba8';
    this.triangle = dev.createBuffer({ label: 'post.triangle', usage: 'vertex', size: TRIANGLE.byteLength, restore: (b) => dev.writeBuffer(b, 0, TRIANGLE) });
    dev.writeBuffer(this.triangle, 0, TRIANGLE);
    this.streams = [{ buffer: this.triangle, offset: 0 }];
    const stream = { stepMode: 'vertex' as const, stride: 4, attributes: [{ location: 0, format: vf('u8', 2, 'float'), offset: 0 }] };
    const common = { vertex: FULLSCREEN_VS, streams: [stream], uniformBlocks: [{ name: 'Post', slot: 0 }], depthTest: false, depthWrite: false, cullMode: 'none' as const };
    this.downPipe = dev.createPipeline({ ...common, label: 'post.down', fragment: DOWN_FS, samplers: [{ name: 'u_src', unit: 0 }] });
    this.upPipe = dev.createPipeline({ ...common, label: 'post.up', fragment: UP_FS, samplers: [{ name: 'u_src', unit: 0 }, { name: 'u_add', unit: 1 }] });
    this.compositePipe = dev.createPipeline({ ...common, label: 'post.composite', fragment: COMPOSITE_FS, samplers: [{ name: 'u_scene', unit: 0 }, { name: 'u_bloom', unit: 1 }] });
    this.fxaaPipe = dev.createPipeline({ ...common, label: 'post.fxaa', fragment: FXAA_FS, samplers: [{ name: 'u_ldr', unit: 0 }] });
  }

  /** (Re)creates the targets for a backbuffer of `w × h`. */
  resize(w: number, h: number): void {
    if (w === this.width && h === this.height) return;
    this.releaseTargets();
    this.width = w;
    this.height = h;
    const dev = this.dev;
    const tex = (label: string, tw: number, th: number, format: TextureFormat): TexH => {
      const t = dev.createTexture({ label, width: Math.max(1, tw), height: Math.max(1, th), format, filter: format === 'depth24' ? 'nearest' : 'linear', wrap: 'clamp' });
      this.textures.push(t);
      return t;
    };
    this.sceneColor = tex('post.scene', w, h, this.sceneFormat);
    this.sceneDepth = tex('post.depth', w, h, 'depth24');
    this.scenePass = {
      label: 'scene',
      colorAttachments: [{ texture: this.sceneColor }],
      depthAttachment: { texture: this.sceneDepth },
      clearColor: [this.clear[0], this.clear[1], this.clear[2], 1],
      clearDepth: 1,
    };
    const levels = this.opts.bloom ? this.opts.bloomLevels : 0;
    this.down = [];
    this.up = [];
    for (let i = 1; i <= levels; i++) this.down.push(tex(`post.down${i}`, w >> i, h >> i, this.sceneFormat));
    for (let i = 1; i < levels; i++) this.up.push(tex(`post.up${i}`, w >> i, h >> i, this.sceneFormat));
    this.ldr = tex('post.ldr', w, h, 'rgba8');

    // Steps: down 1..L, up L-1..1, composite, fxaa (canvas).
    const o = this.opts;
    let src = this.sceneColor;
    let sw = w;
    let sh = h;
    for (let i = 0; i < levels; i++) {
      const dst = this.down[i]!;
      const dw = Math.max(1, w >> (i + 1));
      const dh = Math.max(1, h >> (i + 1));
      this.addStep(this.downPipe, [src], dst, [1 / sw, 1 / sh, 1 / dw, 1 / dh], [o.bloomThreshold, o.bloomThreshold * 0.5, i === 0 ? 1 : 0, 0]);
      src = dst;
      sw = dw;
      sh = dh;
    }
    for (let i = levels - 2; i >= 0; i--) {
      const dst = this.up[i]!;
      const lower = i === levels - 2 ? this.down[levels - 1]! : this.up[i + 1]!;
      const lw = Math.max(1, w >> (i + 2));
      const lh = Math.max(1, h >> (i + 2));
      this.addStep(this.upPipe, [lower, this.down[i]!], dst, [1 / lw, 1 / lh, 0, 0], [1, 0, 0, 0]);
    }
    const bloomTex = levels === 0 ? this.sceneColor : levels === 1 ? this.down[0]! : this.up[0]!;
    this.addStep(this.compositePipe, [this.sceneColor, bloomTex], o.fxaa ? this.ldr : null, [1 / w, 1 / h, 1 / w, 1 / h], [o.exposure, levels > 0 ? o.bloomIntensity : 0, this.hdrActive ? 1 : 0, 0]);
    if (o.fxaa) this.addStep(this.fxaaPipe, [this.ldr], null, [1 / w, 1 / h, 1 / w, 1 / h], [0, 0, 0, 0]);
  }

  private addStep(pipeline: PipeH, srcs: TexH[], dst: TexH | null, texel: readonly number[], params: readonly number[]): void {
    const dev = this.dev;
    const data = new Std140Writer(POST_LAYOUT);
    data.vec4(POST_LAYOUT.offsetOf('texel'), texel[0]!, texel[1]!, texel[2]!, texel[3]!);
    data.vec4(POST_LAYOUT.offsetOf('params'), params[0]!, params[1]!, params[2]!, params[3]!);
    const ubo = dev.createBuffer({ label: 'post.ubo', usage: 'uniform', size: POST_LAYOUT.size, restore: (b) => dev.writeBuffer(b, 0, data.bytes) });
    dev.writeBuffer(ubo, 0, data.bytes);
    const group = dev.createBindGroup({ label: 'post', buffers: [{ slot: 0, buffer: ubo }], textures: srcs.map((t, unit) => ({ unit, texture: t })) });
    const pass: PassDesc = dst === null ? { label: 'post.canvas' } : { label: 'post', colorAttachments: [{ texture: dst }] };
    this.steps.push({ pipeline, group, ubo, data, pass });
  }

  /** Records the post chain; returns the number of draws. */
  run(): number {
    const dev = this.dev;
    for (const s of this.steps) {
      const enc: PassEncoder = dev.beginPass(s.pass);
      enc.setPipeline(s.pipeline);
      enc.setBindGroup(s.group);
      enc.setVertexStreams(this.streams);
      enc.drawInstanced(3, 1);
      enc.end();
    }
    return this.steps.length;
  }

  private releaseTargets(): void {
    const dev = this.dev;
    for (const s of this.steps) {
      dev.destroyBindGroup(s.group);
      dev.destroyBuffer(s.ubo);
    }
    this.steps = [];
    for (const t of this.textures) dev.destroyTexture(t);
    this.textures.length = 0;
  }

  dispose(): void {
    this.releaseTargets();
    for (const p of [this.downPipe, this.upPipe, this.compositePipe, this.fxaaPipe]) this.dev.destroyPipeline(p);
    this.dev.destroyBuffer(this.triangle);
  }
}
