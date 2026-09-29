/**
 * FAF unit material for the viewer: the same inputs the game's UnitPass gets (COLOR_0, _MASK, _PARTID + part
 * pivots/parents), lit with one sun + hemisphere light, flat shading. Mask: R team, G glow, B metal, A AO.
 */
import * as THREE from 'three';

export const MAX_PARTS = 16;

const vertexShader = /* glsl */ `
attribute float _partid;
attribute vec4 _mask;
uniform mat4 uPart[${MAX_PARTS}];
varying vec3 vColor;
varying vec4 vMask;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  int pid = int(_partid + 0.5);
  mat4 pm = uPart[pid];
  vec4 p = pm * vec4(position, 1.0);
  vec4 wp = modelMatrix * p;
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * (mat3(pm) * normal));
  vColor = color;
  vMask = _mask;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uTeam;
uniform vec3 uGlowColor;
uniform float uGlow;
uniform float uSilhouette;
uniform float uGray;
uniform vec3 uSunDir;
varying vec3 vColor;
varying vec4 vMask;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  if (uSilhouette > 0.5) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 n = normalize(vNormalW);
  vec3 team = uGray > 0.5 ? vec3(0.35) : uTeam;
  vec3 albedo = vColor * mix(vec3(1.0), team, vMask.r);
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
  vec3 glow = uGlowColor * uGlow * vMask.g * 3.0;
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
  uGlowColor: THREE.IUniform<THREE.Color>;
  uGlow: THREE.IUniform<number>;
  uSilhouette: THREE.IUniform<number>;
  uGray: THREE.IUniform<number>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
}

export type UnitMaterial = THREE.ShaderMaterial & { uniforms: UnitMaterialUniforms };

const GLOW_CORE = '#FF9A3C';
const GLOW_WHITE = '#FFE9C0';

export function createUnitMaterial(): UnitMaterial {
  const uniforms: UnitMaterialUniforms = {
    uPart: { value: Array.from({ length: MAX_PARTS }, () => new THREE.Matrix4()) },
    uTeam: { value: new THREE.Color('#2F6FD0') },
    uGlowColor: { value: new THREE.Color(GLOW_CORE) },
    uGlow: { value: 1 },
    uSilhouette: { value: 0 },
    uGray: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.45, 0.8, 0.4).normalize() },
  };
  return new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, vertexColors: true }) as UnitMaterial;
}

/** Team color + glow conflict rule (faction.md §4.3: hue within 25° of the glow hue ≈ 27° → white glow). */
export function setTeam(mat: UnitMaterial, hex: string): void {
  mat.uniforms.uTeam.value.set(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl);
  const hue = hsl.h * 360;
  const d = Math.min(Math.abs(hue - 27), 360 - Math.abs(hue - 27));
  mat.uniforms.uGlowColor.value.set(d < 25 ? GLOW_WHITE : GLOW_CORE);
}
