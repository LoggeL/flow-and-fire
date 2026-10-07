/**
 * URL parameters of the fx-lab (`index.html?scene=battle&preset=medium&hdr=1&…`).
 *
 * | Param  | Default                                  | Meaning                                              |
 * |--------|------------------------------------------|------------------------------------------------------|
 * | scene  | 'battle' if registered, else 'lighting' | scene to start                                       |
 * | preset | 'medium'                                 | render preset (canvas scale, caps)                   |
 * | hdr    | 1                                        | HDR RGBA16F scene target (0 = LDR fallback)          |
 * | bloom  | 1                                        | dual-Kawase bloom                                    |
 * | csm    | 1                                        | cascaded shadow maps                                 |
 * | fxaa   | 1                                        | FXAA                                                 |
 * | seed   | 1                                        | scene seed (u32)                                     |
 * | freeze | –                                        | simulate to T seconds, then hold the frame           |
 * | bench  | 0                                        | 1 = HUD off                                          |
 * | flight | 0                                        | 1 = slow camera flight                               |
 * | fx     | 1                                        | 0 = transparent FX off; or a list of the parts drawn |
 * |        |                                          | (`shields,particles,beams`, e.g. `fx=shields`)       |
 * | gpuseg | fine                                     | GPU timer segments: fine (6, FX inside the pass) or  |
 * |        |                                          | pass (shadow / scene / post, pass boundaries only)   |
 * | cam    | –                                        | camera override `dist,pitch,heading[,x,z]` (WU, °)   |
 *
 * Invalid values fall back to the default and add a warning.
 */
import { parsePresetName } from '@faf/render';
import type { LabCameraOverride, LabFxParts, LabGpuSegMode, LabParams, SceneName } from './context.ts';
import { SCENE_NAMES } from './context.ts';

/** Largest accepted `freeze` value in seconds (the catch-up simulates every step up to it). */
export const MAX_FREEZE_S = 600;

function parseBool(v: string | null, def: boolean, name: string, warnings: string[]): boolean {
  if (v === null) return def;
  const s = v.trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'on' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'off' || s === 'no') return false;
  warnings.push(`${name}='${v}' is not a boolean (0/1) – using ${def ? 1 : 0}`);
  return def;
}

const FX_ALL: LabFxParts = { shields: true, particles: true, beams: true };
const FX_NONE: LabFxParts = { shields: false, particles: false, beams: false };
const FX_PART_NAMES = ['shields', 'particles', 'beams'] as const;

/** `fx=`: a boolean (all / none) or a comma list of FX parts. */
function parseFxParts(v: string | null, warnings: string[]): LabFxParts {
  if (v === null) return FX_ALL;
  const s = v.trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'on' || s === 'yes') return FX_ALL;
  if (s === '0' || s === 'false' || s === 'off' || s === 'no') return FX_NONE;
  const parts = s.split(',').map((x) => x.trim());
  if (parts.length > 0 && parts.every((x) => (FX_PART_NAMES as readonly string[]).includes(x))) {
    return { shields: parts.includes('shields'), particles: parts.includes('particles'), beams: parts.includes('beams') };
  }
  warnings.push(`fx='${v}' is neither 0/1 nor a list of shields,particles,beams – using 1`);
  return FX_ALL;
}

function parseGpuSeg(v: string | null, warnings: string[]): LabGpuSegMode {
  if (v === null) return 'fine';
  const s = v.trim().toLowerCase();
  if (s === 'fine' || s === 'pass') return s;
  warnings.push(`gpuseg='${v}' is not 'fine' or 'pass' – using 'fine'`);
  return 'fine';
}

function isSceneName(s: string): s is SceneName {
  return (SCENE_NAMES as readonly string[]).includes(s);
}

/** Default scene: 'battle' when registered, otherwise 'lighting'. */
export function defaultScene(available: (name: SceneName) => boolean): SceneName {
  return available('battle') ? 'battle' : 'lighting';
}

/**
 * Parses `location.search` (with or without leading '?'). `available` tells which scenes are
 * registered; an unknown or unregistered scene falls back to {@link defaultScene}.
 */
export function parseLabParams(search: string, available: (name: SceneName) => boolean, warnings: string[] = []): LabParams {
  const q = new URLSearchParams(search);
  const def = defaultScene(available);

  let scene = def;
  const sceneRaw = q.get('scene');
  if (sceneRaw !== null) {
    if (isSceneName(sceneRaw) && available(sceneRaw)) scene = sceneRaw;
    else warnings.push(`scene='${sceneRaw}' is ${isSceneName(sceneRaw) ? 'not available yet' : 'unknown'} – using '${def}'`);
  }

  const presetRaw = q.get('preset');
  const preset = parsePresetName(presetRaw) ?? 'medium';
  if (presetRaw !== null && parsePresetName(presetRaw) === undefined) warnings.push(`preset='${presetRaw}' is unknown – using 'medium'`);

  let seed = 1;
  const seedRaw = q.get('seed');
  if (seedRaw !== null) {
    const n = Number(seedRaw);
    if (seedRaw.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 0xffffffff) seed = n;
    else warnings.push(`seed='${seedRaw}' is not an integer in [0, 2^32) – using 1`);
  }

  let freeze: number | null = null;
  const freezeRaw = q.get('freeze');
  if (freezeRaw !== null) {
    const n = Number(freezeRaw);
    if (freezeRaw.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= MAX_FREEZE_S) freeze = n;
    else warnings.push(`freeze='${freezeRaw}' is not a time in [0, ${MAX_FREEZE_S}] s – not freezing`);
  }

  let cam: LabCameraOverride | undefined;
  const camRaw = q.get('cam');
  if (camRaw !== null) {
    const v = camRaw.split(',').map((x) => Number(x));
    const ok = (v.length === 3 || v.length === 5) && v.every((x) => Number.isFinite(x)) && v[0]! >= 4 && v[0]! <= 900 && v[1]! >= 5 && v[1]! <= 89;
    if (ok) cam = { distanceWu: v[0]!, pitchDeg: v[1]!, headingDeg: v[2]!, targetWu: v.length === 5 ? [v[3]!, v[4]!] : null };
    else warnings.push(`cam='${camRaw}' is not 'dist,pitch,heading[,x,z]' (dist 4..900, pitch 5..89) – using the scene camera`);
  }

  const fxParts = parseFxParts(q.get('fx'), warnings);
  return {
    ...(cam !== undefined ? { cam } : {}),
    scene,
    preset,
    hdr: parseBool(q.get('hdr'), true, 'hdr', warnings),
    bloom: parseBool(q.get('bloom'), true, 'bloom', warnings),
    csm: parseBool(q.get('csm'), true, 'csm', warnings),
    fxaa: parseBool(q.get('fxaa'), true, 'fxaa', warnings),
    seed,
    freeze,
    bench: parseBool(q.get('bench'), false, 'bench', warnings),
    flight: parseBool(q.get('flight'), false, 'flight', warnings),
    fx: fxParts.shields || fxParts.particles || fxParts.beams,
    fxParts,
    gpuSeg: parseGpuSeg(q.get('gpuseg'), warnings),
  };
}

/** Query string (with '?') that reproduces `p`; default values are omitted except scene and preset. */
export function labParamsToSearch(p: LabParams): string {
  const q = new URLSearchParams();
  q.set('scene', p.scene);
  q.set('preset', p.preset);
  if (!p.hdr) q.set('hdr', '0');
  if (!p.bloom) q.set('bloom', '0');
  if (!p.csm) q.set('csm', '0');
  if (!p.fxaa) q.set('fxaa', '0');
  if (p.seed !== 1) q.set('seed', String(p.seed));
  if (p.freeze !== null) q.set('freeze', String(p.freeze));
  if (p.bench) q.set('bench', '1');
  if (p.flight) q.set('flight', '1');
  const f = p.fxParts;
  if (!p.fx) q.set('fx', '0');
  else if (!(f.shields && f.particles && f.beams)) q.set('fx', FX_PART_NAMES.filter((k) => f[k]).join(','));
  if (p.gpuSeg !== 'fine') q.set('gpuseg', p.gpuSeg);
  if (p.cam !== undefined) {
    const c = p.cam;
    q.set('cam', [c.distanceWu, c.pitchDeg, c.headingDeg, ...(c.targetWu ?? [])].join(','));
  }
  return `?${q.toString()}`;
}
