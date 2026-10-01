import { EventType, UnitFlags } from '@faf/protocol';
import type { FrameReader } from '@faf/protocol';
import { VARKAN_EVENT_FX } from '@faf/render-fx';
import type { VarkanTrailStyleName } from '@faf/render-fx';

export type WeaponFxClass = keyof typeof VARKAN_EVENT_FX.weapon;
/** Content IDs are lexical table entries, never hard-coded numeric visuals. */
const WEAPONS: Readonly<Record<string, WeaponFxClass>> = {
  'core:wpn_mg_t1': 'direct_small', 'core:wpn_cannon_t1': 'cannon',
  'core:wpn_cannon_t2': 'cannon', 'core:wpn_cannon_t3': 'cannon',
  'core:wpn_arty_t1': 'artillery', 'core:wpn_death_heavy': 'artillery',
  'core:wpn_reeve_cannon': 'cannon', 'core:wpn_reeve_tapshot': 'artillery',
  'core:wpn_plumb_break': 'artillery',
};
const PROJECTILES: Readonly<Record<string, VarkanTrailStyleName>> = {
  'core:prj_bullet': 'tracer', 'core:prj_shell_light': 'cannon',
  'core:prj_shell_heavy': 'cannon', 'core:prj_arty_shell': 'artillery',
};
export interface FrameFxSink {
  reset(): void;
  burst(effects: readonly string[], position: Int32Array, seed: number): void;
  scorch(position: Int32Array, radiusWu: number, crater: boolean, seed: number): void;
  trail(prev: Int32Array, cur: Int32Array, style: VarkanTrailStyleName): void;
  beam(from: Int32Array, to: Int32Array, sourceHandle: number): void;
  smoke?(handle: number, position: Int32Array, wreck: boolean): void;
}
/** Consumes only the viewer-filtered protocol stream; no world, sim or hidden state access. */
export class FrameFxBridge {
  private lastTick = -1;
  private viewer = -127;
  private readonly position = new Int32Array(3);
  private readonly previous = new Int32Array(3);
  private readonly current = new Int32Array(3);
  private readonly units = new Map<number, number>();
  constructor(private readonly weaponIds: readonly string[], private readonly projectileIds: readonly string[],
    private readonly sink: FrameFxSink) {}
  present(frame: FrameReader, alpha: number): void {
    if (frame.viewer !== this.viewer || frame.tick < this.lastTick) {
      this.sink.reset(); this.lastTick = -1; this.viewer = frame.viewer;
    }
    if (frame.tick !== this.lastTick) {
      for (let i = 0; i < frame.eventCount; i++) {
        const type = frame.eventType(i); const flags = frame.eventFlags(i);
        const seed = (frame.eventTick(i) * 1664525 + i * 1013904223 + frame.eventHandle(i)) >>> 0;
        for (let c = 0; c < 3; c++) this.position[c] = frame.eventPos(i, c);
        const weapon = WEAPONS[this.weaponIds[frame.eventVisual(i)] ?? ''];
        if (type === EventType.Shot && weapon !== undefined) this.sink.burst(VARKAN_EVENT_FX.weapon[weapon], this.position, seed);
        else if (type === EventType.Impact && weapon !== undefined) {
          const surface = frame.eventAux(i);
          const impact = surface === 2 ? 'water' : surface === 3 ? 'shield' : surface === 1 || surface === 4 ? 'unit' : VARKAN_EVENT_FX.groundImpactForWeapon[weapon];
          this.sink.burst(VARKAN_EVENT_FX.impact[impact], this.position, seed);
          if (surface === 0) this.sink.scorch(this.position, weapon === 'artillery' ? 3 : 1.2, weapon === 'artillery', seed);
        } else if (type === EventType.UnitDeath) {
          const death = (flags & 4) !== 0 ? 'acu' : (flags & 1) !== 0 ? 'structure' : frame.eventAux(i) >= 2 ? 'large' : frame.eventAux(i) === 1 ? 'medium' : 'small';
          this.sink.burst(VARKAN_EVENT_FX.death[death], this.position, seed);
          if ((flags & 2) === 0) this.sink.scorch(this.position, death === 'acu' ? 12 : death === 'large' || death === 'structure' ? 4 : 2, death === 'acu', seed);
        }
      }
      this.lastTick = frame.tick;
    }
    for (let i = 0; i < frame.projectileCount; i++) {
      const style = PROJECTILES[this.projectileIds[frame.projectileVisual(i)] ?? ''];
      if (style === undefined) continue;
      for (let c = 0; c < 3; c++) { this.previous[c] = frame.projectilePrev(i, c); this.current[c] = frame.projectileCur(i, c); }
      this.sink.trail(this.previous, this.current, style);
    }
    this.units.clear();
    for (let i = 0; i < frame.unitCount; i++) {
      const flags = frame.unitFlags(i);
      if ((flags & (UnitFlags.Ghost | UnitFlags.Blip)) !== 0) continue;
      const wreck = (flags & UnitFlags.Wreck) !== 0;
      if ((flags & UnitFlags.Damaged) !== 0 || wreck) {
        for (let c = 0; c < 3; c++) this.position[c] = Math.round(frame.unitPrev(i, c) + (frame.unitCur(i, c) - frame.unitPrev(i, c)) * alpha);
        this.sink.smoke?.(frame.unitHandle(i), this.position, wreck);
      }
      if (!wreck) this.units.set(frame.unitHandle(i), i);
    }
    for (let i = 0; i < frame.beamCount; i++) {
      if (frame.beamVisual(i) !== 65535) continue;
      const src = this.units.get(frame.beamSrcHandle(i)); const dst = this.units.get(frame.beamDstHandle(i));
      if (src === undefined || dst === undefined) continue;
      for (let c = 0; c < 3; c++) {
        this.previous[c] = Math.round(frame.unitPrev(src, c) + (frame.unitCur(src, c) - frame.unitPrev(src, c)) * alpha);
        this.current[c] = Math.round(frame.unitPrev(dst, c) + (frame.unitCur(dst, c) - frame.unitPrev(dst, c)) * alpha);
      }
      this.sink.beam(this.previous, this.current, frame.beamSrcHandle(i));
    }
  }
}
