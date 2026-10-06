/**
 * Scene 'gallery': every effect of VARKAN_EFFECTS on a labelled grid for the visual review.
 *
 * - Burst effects are re-triggered periodically; the phase is chosen so that at t = {@link GALLERY_SHOW_T}
 *   (the default screenshot time) every effect is at a characteristic age (flash, fireball, smoke …).
 * - Continuous effects run permanently: smoke_damage over a damaged tank, wreck_smolder over a wreck,
 *   missile_smoke_trail on a circling emitter, build_stream from an engineer into a structure,
 *   reclaim_stream from a wreck to an engineer (both with their BeamPass core).
 * - The ACU death (acu_explosion + acu_aftermath) has its own tile behind the grid.
 * - A front row shows the projectile trails (tracer, cannon, artillery, missile, aa) and the timed
 *   beams (laser, lightning).
 * All effects are spawned at the lab effect scale (LAB_FX_SCALE, ACU: LAB_ACU_FX_SCALE).
 */
import type { LabContext, LabMarker, LabScene } from '../app/context.ts';
import { VARKAN_BEAM_STYLES, VARKAN_EFFECTS } from '@faf/render-fx';
import { CENTER } from './common.ts';
import type { LabLabel } from './common.ts';
import { LAB_WEAPONS, labFxKit } from './fx.ts';
import type { LabFxKit, LabWeapon } from './fx.ts';

/** Screenshot time the burst phases are tuned for. */
export const GALLERY_SHOW_T = 3;
const COLS = 5;
const PITCH_X = 26;
const PITCH_Z = 26;
const GRID_Z0 = CENTER - 36;
const ACU_Z = CENTER - 100;
const TRAIL_Z = CENTER + 68;

/** Age at which a burst effect is shown at GALLERY_SHOW_T, by id suffix. */
const SHOW_AGE: Readonly<Record<string, number>> = {
  muzzle_small: 0.05,
  muzzle_cannon: 0.06,
  muzzle_artillery: 0.08,
  muzzle_missile: 0.08,
  impact_ground_small: 0.12,
  impact_ground_large: 0.25,
  impact_metal: 0.1,
  impact_shield: 0.12,
  impact_water: 0.35,
  explosion_small: 0.35,
  explosion_medium: 0.55,
  explosion_large: 0.8,
  smoke_puff: 1.2,
  sparks_burst: 0.18,
  acu_explosion: 1.6,
};

interface Tile {
  id: string;
  effect: number;
  x: number;
  z: number;
  scale: number;
  period: number;
  next: number;
  continuous: boolean;
}

class GalleryScene implements LabScene {
  readonly name = 'gallery' as const;
  readonly camera = { targetWu: [CENTER, CENTER - 4] as const, distanceWu: 150, pitchDeg: 46, headingDeg: -90 };

  private kit: LabFxKit | null = null;
  private readonly tiles: Tile[] = [];
  private readonly labelList: LabLabel[] = [];
  private readonly markerList: LabMarker[] = [];
  private readonly units: number[] = [];
  private missileEm = -1;
  private readonly missileC: [number, number] = [0, 0];
  private acuT = 0;
  private acuUnit = -1;
  private acuCrater = -1;
  private readonly trailNext = new Float64Array(LAB_WEAPONS.length);
  private beamNext = 0;
  private bursts = 0;

  init(ctx: LabContext): void {
    const kit = labFxKit(ctx);
    this.kit = kit;
    const units = ctx.units;
    let n = 0;
    for (const def of VARKAN_EFFECTS) {
      const short = def.id.slice('varkan:'.length);
      if (short === 'acu_aftermath') continue;
      const effect = kit.lib.indexOf(def.id);
      if (short === 'acu_explosion') {
        const acuPeriod = 8;
        this.tiles.push({ id: short, effect, x: CENTER, z: ACU_Z, scale: 1, period: acuPeriod, next: firstTrigger(SHOW_AGE[short]!, acuPeriod), continuous: false });
        this.acuT = firstTrigger(SHOW_AGE[short]!, acuPeriod);
        this.labelList.push({ text: 'acu_explosion + acu_aftermath', xWu: CENTER, yWu: 46, zWu: ACU_Z });
        continue;
      }
      const col = n % COLS;
      const row = Math.floor(n / COLS);
      n++;
      const x = CENTER + (col - (COLS - 1) / 2) * PITCH_X;
      const z = GRID_Z0 + row * PITCH_Z;
      const scale = 1;
      const continuous = def.continuous === true;
      const age = SHOW_AGE[short] ?? 0.4;
      const maxAge = kit.lib.effects[effect]!.maxAgeS;
      const period = age < 0.2 ? 1.1 : Math.max(1.6, Math.min(4, maxAge + 0.4));
      this.tiles.push({ id: short, effect, x, z, scale, period, next: firstTrigger(age, period), continuous });
      this.labelList.push({ text: short, xWu: x, yWu: ctx.groundHeight(x, z) + 9, zWu: z + 5 });
    }
    for (const tile of this.tiles) {
      const acu = tile.id === 'acu_explosion';
      this.markerList.push({ id: tile.id, xWu: tile.x, yWu: ctx.groundHeight(tile.x, tile.z) + (acu ? 6 : 2), zWu: tile.z, radiusWu: acu ? 22 : 10 });
    }
    // Continuous tiles need props.
    for (const tile of this.tiles) {
      if (!tile.continuous) continue;
      const y = ctx.groundHeight(tile.x, tile.z);
      switch (tile.id) {
        case 'smoke_damage': {
          const i = units.add({ kind: 'tank', army: 0, xWu: tile.x, zWu: tile.z, yaw: 0.4, hp: 0.3 });
          this.units.push(i);
          kit.setDamaged(0, i, true);
          break;
        }
        case 'wreck_smolder': {
          const i = units.add({ kind: 'wreck', army: 1, xWu: tile.x, zWu: tile.z, yaw: 2.1, hp: 0.5, glow: 0 });
          this.units.push(i);
          kit.createEffectEmitter(0, tile.effect, tile.x, y + 0.6, tile.z);
          break;
        }
        case 'missile_smoke_trail':
          this.missileC[0] = tile.x;
          this.missileC[1] = tile.z;
          this.missileEm = kit.createEffectEmitter(0, tile.effect, tile.x + 6, y + 3, tile.z);
          break;
        case 'build_stream': {
          const e = units.add({ kind: 'engineer', army: 0, xWu: tile.x - 7, zWu: tile.z + 2, yaw: -0.25 });
          const s = units.add({ kind: 'structure', army: 0, xWu: tile.x + 3, zWu: tile.z - 1, yaw: 0.2, hp: 0.6, glow: 1 });
          this.units.push(e, s);
          kit.buildStream(0, e, tile.x + 3, ctx.groundHeight(tile.x + 3, tile.z - 1) + 3.5, tile.z - 1);
          break;
        }
        case 'reclaim_stream': {
          const e = units.add({ kind: 'engineer', army: 1, xWu: tile.x - 7, zWu: tile.z + 2, yaw: -0.25 });
          const w = units.add({ kind: 'wreck', army: 0, xWu: tile.x + 4, zWu: tile.z - 1, yaw: 1.2, hp: 0.5, glow: 0 });
          this.units.push(e, w);
          kit.reclaimStream(0, e, w);
          break;
        }
        default:
          kit.createEffectEmitter(0, tile.effect, tile.x, y + 1, tile.z);
      }
    }
    this.acuUnit = units.add({ kind: 'acu', army: 0, xWu: CENTER, zWu: ACU_Z, yaw: 1.2, glow: 2.4 });
    // Front row: projectile trails and timed beams.
    for (let w = 0; w < LAB_WEAPONS.length; w++) {
      const x = this.trailX(w);
      this.labelList.push({ text: `Trail ${LAB_WEAPONS[w]!}`, xWu: x + 8, yWu: ctx.groundHeight(x, TRAIL_Z) + 7, zWu: TRAIL_Z + 3 });
      this.trailNext[w] = 0.1 + w * 0.13;
    }
    this.labelList.push({ text: 'Beam laser / lightning', xWu: CENTER + 76, yWu: 10, zWu: TRAIL_Z - 12 });
    this.beamNext = 0.2;
  }

  private trailX(w: number): number {
    return CENTER - 70 + w * 28;
  }

  update(ctx: LabContext, t: number): void {
    const kit = this.kit!;
    kit.step(t);
    for (const tile of this.tiles) {
      if (tile.continuous || t < tile.next) continue;
      tile.next += tile.period;
      const y = ctx.groundHeight(tile.x, tile.z);
      if (tile.id === 'acu_explosion') {
        this.acuBoom(ctx, t);
        continue;
      }
      const lift = tile.id.startsWith('muzzle') ? 2 : tile.id.startsWith('explosion') || tile.id === 'sparks_burst' || tile.id === 'smoke_puff' ? 1 : 0;
      // Muzzles fire sideways (+x) and slightly up; everything else along +y.
      if (tile.id.startsWith('muzzle')) kit.spawnEffect(t, tile.effect, tile.x - 3, y + lift, tile.z, 1, tile.id === 'muzzle_artillery' || tile.id === 'muzzle_missile' ? 0.8 : 0.08, 0, tile.scale * kit.fxScale);
      else kit.spawnEffect(t, tile.effect, tile.x, y + lift, tile.z, 0, 1, 0, tile.scale * kit.fxScale);
      this.bursts++;
    }
    // Circling missile smoke emitter.
    if (this.missileEm >= 0) {
      const a = t * 2.1;
      const x = this.missileC[0] + Math.cos(a) * 6;
      const z = this.missileC[1] + Math.sin(a) * 6;
      kit.moveEffectEmitter(this.missileEm, x, ctx.groundHeight(x, z) + 3 + Math.sin(a * 0.5), z);
    }
    for (let w = 0; w < LAB_WEAPONS.length; w++) {
      if (t < this.trailNext[w]!) continue;
      const weapon: LabWeapon = LAB_WEAPONS[w]!;
      this.trailNext[w] = this.trailNext[w]! + (weapon === 'artillery' ? 2.2 : weapon === 'missile' ? 1.8 : 0.45);
      const x = this.trailX(w);
      const y0 = ctx.groundHeight(x, TRAIL_Z) + 2;
      const x1 = x + 20;
      const y1 = weapon === 'aa' ? y0 + 16 : ctx.groundHeight(x1, TRAIL_Z - 6) + (weapon === 'artillery' || weapon === 'missile' ? 0 : 1.5);
      kit.spawnProjectile(t, weapon, 0, x, y0, TRAIL_Z, x1, y1, TRAIL_Z - 6);
    }
    if (t >= this.beamNext) {
      this.beamNext += 0.6;
      const x = CENTER + 64;
      const y = ctx.groundHeight(x, TRAIL_Z) + 3;
      kit.timedBeam(t, VARKAN_BEAM_STYLES.laser, x, y, TRAIL_Z - 4, x + 24, y + 2, TRAIL_Z - 14, 0.16);
      kit.timedBeam(t, VARKAN_BEAM_STYLES.lightning, x, y + 4, TRAIL_Z + 2, x + 24, y + 7, TRAIL_Z - 8, 0.24);
    }
  }

  /** ACU tile: explosion + aftermath via killUnit (with crater and shake), ACU respawns later. */
  private acuBoom(ctx: LabContext, t: number): void {
    const kit = this.kit!;
    const units = ctx.units;
    if (this.acuUnit < 0 || !units.has(this.acuUnit)) this.acuUnit = units.add({ kind: 'acu', army: 0, xWu: CENTER, zWu: ACU_Z, yaw: 1.2, glow: 2.4 });
    if (this.acuCrater >= 0) ctx.scorch.remove(this.acuCrater);
    kit.killUnit(t, this.acuUnit, 'acu');
    this.acuCrater = kit.lastDecal;
    this.acuUnit = -1;
    this.acuT = t;
    this.bursts++;
  }

  labels(): readonly LabLabel[] {
    return this.labelList;
  }

  /** One disc per effect tile (the E2E checks each tile for visible FX). */
  markers(): readonly LabMarker[] {
    return this.markerList;
  }

  stats(): Readonly<Record<string, number>> {
    return { effects: this.tiles.length + 1, bursts: this.bursts, lastAcu: this.acuT, streams: this.kit?.streamCount ?? 0 };
  }

  dispose(ctx: LabContext): void {
    for (const i of this.units) ctx.units.remove(i);
    if (this.acuUnit >= 0) ctx.units.remove(this.acuUnit);
  }
}

/** First trigger time ≥ 0.05 s so that a trigger lands exactly `age` s before GALLERY_SHOW_T. */
function firstTrigger(age: number, period: number): number {
  let t = GALLERY_SHOW_T - age;
  while (t - period >= 0.05) t -= period;
  return t;
}

export function createGalleryScene(): LabScene {
  return new GalleryScene();
}
