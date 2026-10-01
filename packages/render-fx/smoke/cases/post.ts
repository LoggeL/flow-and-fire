/**
 * Post smoke case: two PostChains side by side on the 960×540 canvas.
 * - Left half: Medium target settings (HDR RGBA16F + dual-Kawase bloom 5 + ACES + FXAA). `?hdr=0` in the
 *   page URL switches it to the LDR fallback as well.
 * - Right half: Low target settings (LDR RGBA8, no bloom, FXAA) = the fallback path.
 * The scene (procedural, identical in both halves): dark background, one very bright point (40× white),
 * an orange emissive bar and a rotated grey square with hard edges.
 * Checks: HDR → bloom halo falls off radially and is still above the background 20 px away; LDR → no
 * halo; FXAA produces intermediate edge pixels in both halves.
 */
import type { BufH, PipeH, VertexStreamBinding } from '@faf/render';
import { FULLSCREEN_STREAM, FULLSCREEN_TRIANGLE, FULLSCREEN_VS, PostChain, postOptionsForPreset } from '../../src/index.ts';
import type { SmokeCase, SmokeContext } from '../case.ts';

const HALF_W = 480;
const H = 540;
const BG: readonly [number, number, number, number] = [0.07, 0.08, 0.1, 1];
const BRIGHT = 40;
const SQUARE = { cx: 110, cy: 120, half: 34, angle: 0.52 };

const SCENE_FS = /* glsl */ `#version 300 es
precision highp float;
out vec4 o_color;
void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 size = vec2(${HALF_W}.0, ${H}.0);
  vec3 c = vec3(${BG[0]}, ${BG[1]}, ${BG[2]});
  // Rotated grey square (hard edges, FXAA target). Top-left quadrant (GL y up).
  vec2 q = p - vec2(${SQUARE.cx}.0, size.y - ${SQUARE.cy}.0);
  float ca = cos(${SQUARE.angle});
  float sa = sin(${SQUARE.angle});
  q = vec2(ca * q.x + sa * q.y, -sa * q.x + ca * q.y);
  if (max(abs(q.x), abs(q.y)) < ${SQUARE.half}.0) c = vec3(0.7);
  // Emissive glow bar near the bottom (display-referred HDR value 3 × glow color).
  vec2 b = abs(p - vec2(size.x * 0.5, 70.0));
  if (b.x < 70.0 && b.y < 3.0) c = vec3(1.0, 0.45, 0.1) * 3.0;
  // Very bright point in the centre.
  if (length(p - size * 0.5) < 2.5) c = vec3(${BRIGHT}.0);
  o_color = vec4(c, 1.0);
}
`;

let scenePipe: PipeH;
let triangle: BufH;
const streams: VertexStreamBinding[] = [{ buffer: 0 as BufH, offset: 0 }];
let left: PostChain;
let right: PostChain;

function lum(px: Uint8Array, i: number): number {
  return 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
}

/** Mean luma of 8 samples on a circle of radius r around (cx, cy). */
function ring(ctx: SmokeContext, cx: number, cy: number, r: number): number {
  let s = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + 0.2;
    const x = Math.round(cx + Math.cos(a) * r);
    const y = Math.round(cy + Math.sin(a) * r);
    s += lum(ctx.readPixels(x, y, 1, 1), 0);
  }
  return s / 8;
}

function checkHalf(ctx: SmokeContext, x0: number, expectHalo: boolean, label: string): string[] {
  const errors: string[] = [];
  const cx = x0 + HALF_W / 2;
  const cy = H / 2;
  const centre = lum(ctx.readPixels(cx, cy, 1, 1), 0);
  if (centre < 235) errors.push(`${label}: bright point not bright (${centre.toFixed(0)})`);
  const bg = ring(ctx, x0 + 60, cy, 4);
  const radii = [6, 12, 20, 40, 80];
  const r = radii.map((d) => ring(ctx, cx, cy, d));
  const desc = `${label}: bg ${bg.toFixed(1)}, rings ${radii.map((d, i) => `${d}px=${r[i]!.toFixed(1)}`).join(' ')}`;
  if (expectHalo) {
    for (let i = 1; i < r.length; i++) {
      if (!(r[i]! < r[i - 1]!)) errors.push(`${desc}: halo does not fall off radially at ${radii[i]} px`);
    }
    if (!(r[2]! > bg + 6)) errors.push(`${desc}: no bloom halo 20 px from the point`);
    if (r[4]! < bg - 1) errors.push(`${desc}: halo darker than the background`);
  } else if (Math.abs(r[2]! - bg) > 3 || Math.abs(r[1]! - bg) > 3) {
    errors.push(`${desc}: LDR fallback without bloom shows a halo`);
  }
  // FXAA: the rotated square's edges must contain intermediate pixels.
  const sx = x0 + SQUARE.cx - 50;
  const sy = SQUARE.cy - 50;
  const win = ctx.readPixels(sx, sy, 100, 100);
  const inside = lum(ctx.readPixels(x0 + SQUARE.cx, SQUARE.cy, 1, 1), 0);
  const outside = lum(ctx.readPixels(x0 + SQUARE.cx, SQUARE.cy + 70, 1, 1), 0);
  // Without anti-aliasing the procedural square has exactly two colors; FXAA blends along its edges.
  let mid = 0;
  for (let i = 0; i < win.length; i += 4) {
    const l = lum(win, i);
    if (Math.abs(l - inside) > 8 && Math.abs(l - outside) > 8) mid++;
  }
  if (inside - outside < 60) errors.push(`${label}: square not visible (inside ${inside.toFixed(0)}, outside ${outside.toFixed(0)})`);
  if (mid < 40) errors.push(`${label}: FXAA left the square edges aliased (${mid} intermediate pixels)`);
  return errors;
}

export const smokeCase: SmokeCase = {
  name: 'post',
  frames: 30,
  segments: ['scene', 'post'],
  setup(ctx) {
    const dev = ctx.dev;
    const hdrParam = new URLSearchParams(location.search).get('hdr');
    left = new PostChain(dev, { ...postOptionsForPreset('medium'), hdr: hdrParam !== '0' });
    right = new PostChain(dev, postOptionsForPreset('low'));
    left.resize(HALF_W, H);
    right.resize(HALF_W, H);
    left.setOutputViewport({ x: 0, y: 0, width: HALF_W, height: H });
    right.setOutputViewport({ x: HALF_W, y: 0, width: HALF_W, height: H });
    triangle = dev.createBuffer({
      label: 'smoke.post.triangle',
      usage: 'vertex',
      size: FULLSCREEN_TRIANGLE.byteLength,
      restore: (b) => dev.writeBuffer(b, 0, FULLSCREEN_TRIANGLE),
    });
    dev.writeBuffer(triangle, 0, FULLSCREEN_TRIANGLE);
    streams[0]!.buffer = triangle;
    scenePipe = dev.createPipeline({
      label: 'smoke.post.scene',
      vertex: FULLSCREEN_VS,
      fragment: SCENE_FS,
      streams: [FULLSCREEN_STREAM],
      depthTest: false,
      depthWrite: false,
      cullMode: 'none',
    });
  },
  frame(ctx) {
    const dev = ctx.dev;
    ctx.timer.beginNamed('scene');
    let draws = 0;
    for (const chain of [left, right]) {
      const enc = chain.beginScene(BG);
      enc.setPipeline(scenePipe);
      enc.setVertexStreams(streams);
      enc.drawInstanced(3, 1);
      enc.end();
      draws++;
    }
    ctx.timer.beginNamed('post');
    // The canvas is not cleared by the chains' viewport passes: clear it once (both halves are overwritten).
    dev.beginPass({ label: 'smoke.post.clear', clearColor: [0, 0, 0, 1] }).end();
    draws += left.resolve();
    draws += right.resolve();
    return draws;
  },
  check(ctx) {
    const errors: string[] = [];
    if (left.stats.draws !== 11) errors.push(`left chain: ${left.stats.draws} draws, expected 11`);
    if (right.stats.draws !== 2) errors.push(`right chain: ${right.stats.draws} draws, expected 2 (composite + FXAA)`);
    if (right.hdrActive) errors.push('right chain (Low) must be LDR');
    const hdrWanted = new URLSearchParams(location.search).get('hdr') !== '0';
    if (hdrWanted && ctx.dev.caps.colorBufferFloat && !left.hdrActive) errors.push('left chain: HDR supported but not active');
    // Bloom also runs on the LDR fallback (medium keeps bloom on), but the RGBA8 scene clips the
    // point at 1.0: the halo is weaker but must still exist.
    errors.push(...checkHalf(ctx, 0, true, left.hdrActive ? 'HDR' : 'LDR-fallback(medium)'));
    errors.push(...checkHalf(ctx, HALF_W, false, 'LDR(low)'));
    return errors;
  },
  destroy(ctx) {
    left.destroy();
    right.destroy();
    ctx.dev.destroyPipeline(scenePipe);
    ctx.dev.destroyBuffer(triangle);
  },
};
