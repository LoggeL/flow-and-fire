/**
 * LabFx without any FX systems (rfx-p5 baseline): no draws, empty stats. rfx-p6 replaces it through
 * `createLabFx` in scenes/index.ts with the real ParticleSystem/BeamPass/TrailPass/ShieldPass wiring.
 */
import type { LabContext, LabFx, LabFxStats } from './context.ts';

const EMPTY_STATS: LabFxStats = { particles: null, shields: null, beams: 0, trails: 0 };

export function createNullLabFx(_ctx?: LabContext): LabFx {
  return {
    update(): void {},
    encodeShields(): number {
      return 0;
    },
    encodeParticles(): number {
      return 0;
    },
    encodeBeams(): number {
      return 0;
    },
    stats(): LabFxStats {
      return EMPTY_STATS;
    },
    destroy(): void {},
  };
}
