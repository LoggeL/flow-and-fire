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
 * | fx     | 1                                        | 0 = transparent FX (shields/particles/beams) off     |
 *
 * Invalid values fall back to the default and add a warning.
 */
import { parsePresetName } from '@faf/render';
import type { LabParams, SceneName } from './context.ts';
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

  return {
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
    fx: parseBool(q.get('fx'), true, 'fx', warnings),
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
  if (!p.fx) q.set('fx', '0');
  return `?${q.toString()}`;
}
