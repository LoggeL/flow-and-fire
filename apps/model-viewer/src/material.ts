/**
 * FAF unit material for the viewer: the same inputs the game's UnitPass gets (COLOR_0, _MASK, _PARTID + part
 * pivots/parents), lit with one sun + hemisphere light; normals as exported (flat or smooth). Mask: R team, G glow,
 * B metal, A AO. The emissive color is the vertex color of the glow slots (faction palette); team-color conflicts
 * swap slot colors per army (palette `teamAlt`: Varkan white glow, Aurith smoke quartz, …).
 */
import * as THREE from 'three';
import { ARMOR_SURFACE_GLSL, ARMOR_SURFACE_SIZE, armorSurfacePixels } from './armor-surface.ts';

const armorTexture = new THREE.DataTexture(armorSurfacePixels(), ARMOR_SURFACE_SIZE, ARMOR_SURFACE_SIZE, THREE.RedFormat);
armorTexture.wrapS = armorTexture.wrapT = THREE.RepeatWrapping;
armorTexture.magFilter = THREE.LinearFilter;
armorTexture.minFilter = THREE.LinearMipmapLinearFilter;
armorTexture.generateMipmaps = true;
armorTexture.needsUpdate = true;

export const MAX_PARTS = 16;
/** Max. team-conflict swaps per faction palette (Palette.teamAlt). */
export const MAX_ALTS = 4;

const vertexShader = /* glsl */ `
attribute float _partid;
attribute vec4 _mask;
attribute float _surface;
uniform mat4 uPart[${MAX_PARTS}];
varying vec3 vColor;
varying vec4 vMask;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vSurfacePos;
varying vec3 vSurfaceNormal;
varying float vSurface;
void main() {
  int pid = int(_partid + 0.5);
  mat4 pm = uPart[pid];
  vec4 p = pm * vec4(position, 1.0);
  vec4 wp = modelMatrix * p;
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * (mat3(pm) * normal));
  vColor = color;
  vMask = _mask;
  vSurfacePos = position;
  vSurfaceNormal = normal;
  vSurface = _surface;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uSurface;
${ARMOR_SURFACE_GLSL.replaceAll('texture(', 'texture2D(')}
uniform vec3 uTeam;
uniform vec3 uAltFrom[${MAX_ALTS}];
uniform vec3 uAltTo[${MAX_ALTS}];
uniform float uAltOn[${MAX_ALTS}];
uniform float uGlow;
uniform float uSilhouette;
uniform float uGray;
uniform vec3 uSunDir;
varying vec3 vColor;
varying vec4 vMask;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vSurfacePos;
varying vec3 vSurfaceNormal;
varying float vSurface;
void main() {
  if (uSilhouette > 0.5) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 n = normalize(vNormalW);
  vec3 team = uGray > 0.5 ? vec3(0.35) : uTeam;
  vec3 base = vColor;
  for (int i = 0; i < ${MAX_ALTS}; i++) {
    if (uAltOn[i] > 0.5 && distance(vColor, uAltFrom[i]) < 0.004) base = uAltTo[i];
  }
  vec3 albedo = base * mix(vec3(1.0), team, vMask.r);
  if (vSurface > 0.0) albedo *= armorGrain(uSurface, vSurfacePos, vSurfaceNormal, vSurface);
  if (uGray > 0.5) albedo = vec3(dot(albedo, vec3(0.2126, 0.7152, 0.0722)));
  float ao = vMask.a;
  vec3 sky = vec3(0.60, 0.66, 0.75);
  vec3 ground = vec3(0.22, 0.20, 0.18);
  vec3 hemi = mix(ground, sky, n.y * 0.5 + 0.5);
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 sun = vec3(1.9, 1.8, 1.65) * ndl;
  vec3 v = normalize(cameraPosition - vPosW);
  vec3 h = normalize(v + uSunDir);
  float metal = vMask.b;
  float spec = pow(max(dot(n, h), 0.0), mix(16.0, 48.0, metal)) * mix(0.06, 1.1, metal) * ndl;
  vec3 specCol = mix(vec3(1.0), albedo, metal);
  vec3 col = albedo * (hemi * 0.9 + sun) * ao + specCol * spec;
  vec3 glow = base * uGlow * vMask.g * 3.0;
  if (uGray > 0.5) glow = vec3(dot(glow, vec3(0.2126, 0.7152, 0.0722)));
  gl_FragColor = vec4(col * (1.0 - vMask.g) + glow + col * vMask.g * 0.2, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface UnitMaterialUniforms {
  [uniform: string]: THREE.IUniform;
  uPart: THREE.IUniform<THREE.Matrix4[]>;
  uTeam: THREE.IUniform<THREE.Color>;
  uAltFrom: THREE.IUniform<THREE.Color[]>;
  uAltTo: THREE.IUniform<THREE.Color[]>;
  uAltOn: THREE.IUniform<number[]>;
  uGlow: THREE.IUniform<number>;
  uSilhouette: THREE.IUniform<number>;
  uGray: THREE.IUniform<number>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
}

export type UnitMaterial = THREE.ShaderMaterial & { uniforms: UnitMaterialUniforms };

/** A palette slot color swapped for some team colors (from the manifest's `teamAlt`). */
export interface TeamSwap {
  /** Slot color (sRGB hex) as baked into COLOR_0. */
  readonly from: string;
  readonly to: string;
  /** Team colors (sRGB hex, upper case) that trigger the swap. */
  readonly teams: readonly string[];
}

export function createUnitMaterial(): UnitMaterial {
  const uniforms: UnitMaterialUniforms = {
    uPart: { value: Array.from({ length: MAX_PARTS }, () => new THREE.Matrix4()) },
    uSurface: { value: armorTexture },
    uTeam: { value: new THREE.Color('#2F6FD0') },
    uAltFrom: { value: Array.from({ length: MAX_ALTS }, () => new THREE.Color()) },
    uAltTo: { value: Array.from({ length: MAX_ALTS }, () => new THREE.Color()) },
    uAltOn: { value: Array.from({ length: MAX_ALTS }, () => 0) },
    uGlow: { value: 1 },
    uSilhouette: { value: 0 },
    uGray: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.45, 0.8, 0.4).normalize() },
  };
  const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, vertexColors: true }) as UnitMaterial;
  (material.defaultAttributeValues as Record<string, number[]>)['_surface'] = [0];
  return material;
}

/** Team color + the faction's conflict swaps (faction.md §4.3 of each faction, e.g. Varkan red/orange → white glow). */
export function setTeam(mat: UnitMaterial, hex: string, swaps: readonly TeamSwap[] = []): void {
  mat.uniforms.uTeam.value.set(hex);
  const key = hex.toUpperCase();
  for (let i = 0; i < MAX_ALTS; i++) {
    const s = swaps[i];
    const on = s !== undefined && s.teams.includes(key);
    mat.uniforms.uAltOn.value[i] = on ? 1 : 0;
    if (s !== undefined) {
      mat.uniforms.uAltFrom.value[i]!.set(s.from);
      mat.uniforms.uAltTo.value[i]!.set(s.to);
    }
  }
}
