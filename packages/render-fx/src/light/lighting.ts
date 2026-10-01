/**
 * Forward lighting GLSL (PLAN §3.7 "Forward-Rendering, ein direktionales Licht plus Hemisphere") and
 * the emissive convention of the glow colors (faction.md §3.5 "Glut als Spielinformation").
 *
 * `fxLight` matches the terrain/unit shading of @faf/render (Lambert sun + hemisphere between
 * `u_groundColor` and `u_skyColor`), with the sun term multiplied by the shadow factor. It needs
 * render's FRAME_BLOCK_GLSL (`u_sunDir`, `u_sunColor`, `u_skyColor`, `u_groundColor`) declared before.
 *
 * Emissive: `fxEmissive(glow, intensity)` returns a display-referred color that is ADDED to the lit
 * color. With an HDR scene target values above 1 survive and the bloom makes the glow visible; on
 * LDR (Low, no bloom) the color is normalised to its brightest channel instead of clipping per
 * channel, so the glow stays a fully saturated hue ("über vollgesättigte Farbe erkennbar").
 */

function lightingSource(hdr: boolean): string {
  const emissive = hdr
    ? `vec3 fxEmissive(vec3 glow, float intensity) {
  return glow * intensity;
}`
    : `vec3 fxEmissive(vec3 glow, float intensity) {
  vec3 c = glow * intensity;
  float m = max(c.r, max(c.g, c.b));
  return m > 1.0 ? c / m : c;
}`;
  return /* glsl */ `
// Lambert sun (× shadow) + hemisphere ambient; albedo and result are display-referred.
vec3 fxLight(vec3 albedo, vec3 normal, float shadow) {
  float ndl = max(dot(normal, u_sunDir.xyz), 0.0);
  vec3 hemi = mix(u_groundColor.rgb, u_skyColor.rgb, normal.y * 0.5 + 0.5);
  return albedo * (hemi + u_sunColor.rgb * (ndl * shadow));
}
const float FX_HDR_SCENE = ${hdr ? '1.0' : '0.0'};
${emissive}
`;
}

/** Lighting GLSL for the scene format: pass `PostChain.hdrActive`. */
export function lightingGlsl(hdr: boolean): string {
  return hdr ? LIGHTING_GLSL : LIGHTING_GLSL_LDR;
}

/** Lighting GLSL for an HDR scene target (emissive values > 1 feed the bloom). */
export const LIGHTING_GLSL = lightingSource(true);
/** Lighting GLSL for an LDR scene target (emissive normalised to the brightest channel). */
export const LIGHTING_GLSL_LDR = lightingSource(false);

export interface LightParams {
  readonly sunDir: readonly [number, number, number];
  readonly sunColor: readonly [number, number, number];
  readonly skyColor: readonly [number, number, number];
  readonly groundColor: readonly [number, number, number];
}

/** JS reference of `fxLight` (tests, smoke expectations). */
export function fxLightRef(
  albedo: readonly [number, number, number],
  normal: readonly [number, number, number],
  shadow: number,
  l: LightParams,
): [number, number, number] {
  const ndl = Math.max(normal[0] * l.sunDir[0] + normal[1] * l.sunDir[1] + normal[2] * l.sunDir[2], 0);
  const t = normal[1] * 0.5 + 0.5;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const hemi = l.groundColor[i]! + (l.skyColor[i]! - l.groundColor[i]!) * t;
    out[i] = albedo[i]! * (hemi + l.sunColor[i]! * ndl * shadow);
  }
  return out;
}

/** JS reference of `fxEmissive`. */
export function fxEmissiveRef(glow: readonly [number, number, number], intensity: number, hdr: boolean): [number, number, number] {
  const c: [number, number, number] = [glow[0] * intensity, glow[1] * intensity, glow[2] * intensity];
  if (hdr) return c;
  const m = Math.max(c[0], c[1], c[2]);
  return m > 1 ? [c[0] / m, c[1] / m, c[2] / m] : c;
}
