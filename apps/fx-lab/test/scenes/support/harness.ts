/**
 * Headless harness for the scene tests: a LabSimulation without GPU (units/scorch/shake/rng are real,
 * the FX systems are the recording parts of fx-record.ts, so every FX call lands in a checksum).
 */
import { RENDER_PRESETS } from '@faf/render';
import type { RtsCamera, WebGL2Device } from '@faf/render';
import type { FxFrameUniforms } from '@faf/render-fx';
import type { LabContext, LabFx, SceneName } from '../../../src/app/context.ts';
import { labGroundHeight } from '../../../src/app/ground.ts';
import { parseLabParams } from '../../../src/app/params.ts';
import { LabSimulation } from '../../../src/app/sim.ts';
import type { LabWorld } from '../../../src/app/sim.ts';
import { LabUnitList } from '../../../src/app/units.ts';
import { LabFxKit, labEffectLibrary, labShakeHook } from '../../../src/scenes/fx.ts';
import { createRecordingFxParts } from '../../../src/scenes/fx-record.ts';
import type { RecordingFxParts } from '../../../src/scenes/fx-record.ts';
import { LAB_SCENES } from '../../../src/scenes/index.ts';

export function headlessWorld(search: string): LabWorld {
  const params = parseLabParams(search, () => true);
  return {
    dev: null as unknown as WebGL2Device,
    camera: null as unknown as RtsCamera,
    frame: null as unknown as FxFrameUniforms,
    preset: RENDER_PRESETS[params.preset],
    params,
    units: new LabUnitList(null, labGroundHeight),
  };
}

/** FX factory that builds the kit on recording parts (and remembers them). */
export function recordingFx(): { factory: (ctx: LabContext) => LabFx; parts: () => RecordingFxParts } {
  let last: RecordingFxParts | null = null;
  return {
    factory: (ctx) => {
      last = createRecordingFxParts(labEffectLibrary(), labShakeHook(ctx));
      return new LabFxKit(ctx, last);
    },
    parts: () => {
      if (last === null) throw new Error('no FX created yet');
      return last;
    },
  };
}

export interface SceneRun {
  sim: LabSimulation;
  kit: LabFxKit;
  parts: RecordingFxParts;
}

/** Starts scene `name` headless (search = extra URL params, e.g. '&seed=3'). */
export function startScene(name: SceneName, search = ''): SceneRun {
  const rec = recordingFx();
  const sim = new LabSimulation(headlessWorld(`?scene=${name}${search}`), LAB_SCENES[name]!, rec.factory);
  return { sim, kit: sim.ctx.fx as LabFxKit, parts: rec.parts() };
}

/** Advances `seconds` of 60 Hz frames (one fixed step per frame). */
export function runSeconds(r: SceneRun, seconds: number, each?: (stepT: number) => void): void {
  const steps = Math.round(seconds * 60);
  for (let k = 0; k < steps; k++) {
    r.sim.advance(1 / 60);
    each?.(r.sim.clock.simTime);
  }
}
