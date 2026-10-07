/**
 * Scene 'lighting': checks the non-particle parts of render-fx – CSM (static props/ground cache +
 * dynamic unit casters), scorch/crater decals with ember glow and bloom on the glowing unit seams.
 *
 * - 40 driving units (20 per army) on concentric loops around the centre (army 0 counter-clockwise,
 *   army 1 clockwise) plus static structures, shield generators and wrecks,
 * - {@link DECALS} scorch/crater/scar decals; every {@link DECAL_INTERVAL_S} the oldest is replaced by a
 *   fresh (glowing) one, so embers are always visible,
 * - low, oblique sun (lab default) → long shadows, no particles.
 * Everything is derived from ctx.rng (params.seed) and the fixed-step time.
 */
import type { ScorchKind } from '@faf/render-fx';
import type { LabContext, LabScene, LabUnitKind } from '../app/context.ts';
import { LAB_WORLD_WU } from '../app/context.ts';

export const MOVING_PER_ARMY = 20;
export const DECALS = 30;
export const DECAL_INTERVAL_S = 0.5;

const CENTER = LAB_WORLD_WU / 2;
/** Kinds of the 20 moving units of each army. */
const ARMY_KINDS: readonly LabUnitKind[] = [
  'acu',
  'engineer',
  'engineer',
  'engineer',
  'arty',
  'arty',
  'arty',
  'arty',
  'bot',
  'bot',
  'bot',
  'bot',
  'bot',
  'tank',
  'tank',
  'tank',
  'tank',
  'tank',
  'tank',
  'tank',
];

interface Mover {
  index: number;
  radius: number;
  /** Signed angular speed (rad/s). */
  omega: number;
  phase: number;
  /** Radial wobble amplitude (WU) and frequency (rad/s) → loops are not perfect circles. */
  wobble: number;
  wobbleFreq: number;
}

interface DecalRec {
  handle: number;
  bornS: number;
  emberS: number;
}

const LABELS: readonly { text: string; xWu: number; yWu: number; zWu: number }[] = [
  { text: 'Wracks (rostig, kalt)', xWu: CENTER, yWu: 14, zWu: CENTER + 4 },
  { text: 'Struktur (Armee 1)', xWu: CENTER - 84, yWu: 20, zWu: CENTER - 18 },
  { text: 'Struktur (Armee 2)', xWu: CENTER + 84, yWu: 20, zWu: CENTER - 22 },
];

const EMBER_S: Readonly<Record<ScorchKind, number>> = { scorch: 3, crater: 6, scar: 2 };

class LightingScene implements LabScene {
  readonly name = 'lighting' as const;
  readonly camera = { targetWu: [CENTER, CENTER + 8] as const, distanceWu: 128, pitchDeg: 50, headingDeg: -90 };
  private readonly movers: Mover[] = [];
  private readonly decals: DecalRec[] = [];
  private nextDecal = 0;
  private staticUnits = 0;
  private acuIndex: [number, number] = [-1, -1];
  private tNow = 0;
  private readonly scratch = new Float64Array(3);

  init(ctx: LabContext): void {
    const rng = ctx.rng;
    for (let army = 0; army < 2; army++) {
      const dir = army === 0 ? 1 : -1;
      for (let k = 0; k < MOVING_PER_ARMY; k++) {
        const kind = ARMY_KINDS[k]!;
        const radius = kind === 'acu' ? 22 : rng.range(16, 66);
        const speed = kind === 'acu' ? 2.2 : kind === 'arty' ? rng.range(2.4, 3.4) : rng.range(3.2, 5.6);
        const phase = (army === 0 ? Math.PI : 0) + rng.range(-1.35, 1.35);
        const m: Mover = { index: -1, radius, omega: (dir * speed) / radius, phase, wobble: rng.range(0, 5), wobbleFreq: rng.range(0.1, 0.35) };
        const p = this.pose(m, 0);
        m.index = ctx.units.add({ kind, army, xWu: p[0]!, zWu: p[1]!, yaw: p[2]!, glow: kind === 'acu' ? 2 : 1.2 });
        if (kind === 'acu') this.acuIndex[army] = m.index;
        this.movers.push(m);
      }
    }
    // Static set pieces: structures and shield generators of both armies, wrecks in the middle.
    const statics: { kind: LabUnitKind; army: number; x: number; z: number; yaw: number; hp?: number }[] = [
      { kind: 'structure', army: 0, x: CENTER - 84, z: CENTER - 18, yaw: 0.3 },
      { kind: 'structure', army: 1, x: CENTER + 84, z: CENTER - 22, yaw: 2.6 },
      { kind: 'shieldgen', army: 0, x: CENTER - 74, z: CENTER + 16, yaw: 0 },
      { kind: 'shieldgen', army: 1, x: CENTER + 76, z: CENTER + 12, yaw: 0 },
      { kind: 'wreck', army: 0, x: CENTER - 6, z: CENTER + 4, yaw: 1.1, hp: 0.2 },
      { kind: 'wreck', army: 1, x: CENTER + 7, z: CENTER - 5, yaw: 4.0, hp: 0.1 },
      { kind: 'wreck', army: 1, x: CENTER + 2, z: CENTER + 13, yaw: 2.2, hp: 0.3 },
    ];
    for (const s of statics) {
      ctx.units.add({ kind: s.kind, army: s.army, xWu: s.x, zWu: s.z, yaw: s.yaw, ...(s.hp !== undefined ? { hp: s.hp } : {}) });
      this.staticUnits++;
    }
    // Initial decals: born during the last seconds, so part of them still glows at t = 0.
    for (let i = 0; i < DECALS; i++) this.addDecal(ctx, -rng.range(0, 9));
    this.nextDecal = DECAL_INTERVAL_S;
  }

  /** Position/yaw of a mover at time t (closed form → frame-rate independent), written into `out`. */
  private pose(m: Mover, t: number, out: Float64Array = this.scratch): Float64Array {
    const a = m.phase + m.omega * t;
    const r = m.radius + m.wobble * Math.sin(m.wobbleFreq * t + m.phase * 3);
    const x = CENTER + Math.cos(a) * r;
    const z = CENTER + Math.sin(a) * r;
    // Direction of motion (derivative of the loop; wobble ignored for the heading).
    out[0] = x;
    out[1] = z;
    out[2] = a + (m.omega > 0 ? Math.PI / 2 : -Math.PI / 2);
    return out;
  }

  private addDecal(ctx: LabContext, bornS: number): void {
    const rng = ctx.rng;
    const u = rng.float01();
    const kind: ScorchKind = u < 0.4 ? 'scorch' : u < 0.75 ? 'crater' : 'scar';
    const radius = kind === 'crater' ? rng.range(3, 7) : kind === 'scar' ? rng.range(2.5, 5.5) : rng.range(1.8, 4.2);
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.float01()) * 72;
    const emberS = EMBER_S[kind];
    const handle = ctx.scorch.add({
      xWu: CENTER + Math.cos(a) * d,
      zWu: CENTER + 6 + Math.sin(a) * d * 0.8,
      radiusWu: radius,
      kind,
      rotation: rng.range(0, Math.PI * 2),
      seed: rng.next(),
      tS: bornS,
      lifetimeS: 0,
      emberS,
    });
    this.decals.push({ handle, bornS, emberS });
  }

  update(ctx: LabContext, t: number): void {
    this.tNow = t;
    const p = this.scratch;
    for (const m of this.movers) {
      this.pose(m, t, p);
      ctx.units.move(m.index, p[0]!, p[1]!, p[2]!);
    }
    while (t >= this.nextDecal) {
      const old = this.decals.shift();
      if (old !== undefined) ctx.scorch.remove(old.handle);
      this.addDecal(ctx, this.nextDecal);
      this.nextDecal += DECAL_INTERVAL_S;
    }
  }

  labels(): readonly { text: string; xWu: number; yWu: number; zWu: number }[] {
    return LABELS;
  }

  stats(): Readonly<Record<string, number>> {
    let glowing = 0;
    for (const d of this.decals) if (this.tNow - d.bornS < d.emberS) glowing++;
    return { units: this.movers.length + this.staticUnits, moving: this.movers.length, decals: this.decals.length, glowingDecals: glowing, acus: this.acuIndex.filter((i) => i >= 0).length };
  }

  dispose(ctx: LabContext): void {
    for (const m of this.movers) ctx.units.remove(m.index);
    for (const d of this.decals) ctx.scorch.remove(d.handle);
    this.movers.length = 0;
    this.decals.length = 0;
  }
}

export function createLightingScene(): LabScene {
  return new LightingScene();
}
