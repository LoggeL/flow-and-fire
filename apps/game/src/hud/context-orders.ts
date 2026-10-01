import type { SimBpTable } from '@faf/blueprints/simbin';
import { Op, UnitFlags, type FrameReader } from '@faf/protocol';

type Capabilities = Pick<SimBpTable, 'speedPerTick' | 'mountCount' | 'buildPowerQ16PerTickCol' | 'categoryNames' | 'categoryWord'>;
export interface ContextOrder { readonly op: number; readonly units: readonly number[]; readonly target?: number }
const HIDDEN = UnitFlags.Ghost | UnitFlags.Blip;

/** Completed own factories from accepted records, shared by explicit and contextual rally input. */
export function completedFactoryHandles(frame: FrameReader, bp: Capabilities, selected: ArrayLike<number>, ownArmy: number): number[] {
  const bit = bp.categoryNames.indexOf('FACTORY');
  if (bit < 0) return [];
  const handles = new Set(Array.from(selected)), result: number[] = [];
  for (let i = 0; i < frame.unitCount; i++) if (handles.has(frame.unitHandle(i)) && frame.unitArmy(i) === ownArmy &&
      frame.unitBuild(i) === 255 && !(frame.unitFlags(i) & (HIDDEN | UnitFlags.Wreck)) &&
      (bp.categoryWord(frame.unitVisual(i), bit >>> 5) & (1 << (bit & 31))) !== 0) result.push(frame.unitHandle(i));
  return result;
}

/** Accepted-frame target hit only. Selection and hidden simulation state are never touched. */
export function contextTarget(
  frame: FrameReader, x: number, y: number,
  screenPos: (handle: number, index: number) => { x: number; y: number } | null,
  eligible: (index: number) => boolean = () => true,
): number | null {
  let result: number | null = null, best = 24 * 24;
  for (let i = 0; i < frame.unitCount; i++) {
    if ((frame.unitFlags(i) & HIDDEN) || !eligible(i)) continue;
    const pos = screenPos(frame.unitHandle(i), i);
    if (!pos) continue;
    const distance = (pos.x - x) ** 2 + (pos.y - y) ** 2;
    if (distance < best || (distance === best && result !== null && frame.unitHandle(i) < frame.unitHandle(result))) {
      best = distance; result = i;
    }
  }
  return result;
}

/** Mirrors current Sim opcode eligibility, with ground-only fallbacks explicitly partitioned. */
export function contextOrders(
  frame: FrameReader, bp: Capabilities, selected: ArrayLike<number>, ownArmy: number,
  allied: (army: number) => boolean, target: number | null, groundValid: boolean,
): readonly ContextOrder[] {
  const selectedSet = new Set(Array.from(selected)), actors: number[] = [];
  for (let i = 0; i < frame.unitCount; i++) {
    if (selectedSet.has(frame.unitHandle(i)) && frame.unitArmy(i) === ownArmy && frame.unitBuild(i) === 255 &&
        !(frame.unitFlags(i) & (HIDDEN | UnitFlags.Wreck))) actors.push(i);
  }
  const category = (i: number, name: string): boolean => {
    const bit = bp.categoryNames.indexOf(name);
    return bit >= 0 && (bp.categoryWord(frame.unitVisual(i), bit >>> 5) & (1 << (bit & 31))) !== 0;
  };
  const mobile = (i: number): boolean => bp.speedPerTick(frame.unitVisual(i)) > 0;
  const builder = (i: number): boolean => mobile(i) && bp.buildPowerQ16PerTickCol[frame.unitVisual(i)]! > 0;
  const order = (op: number, indices: number[], handle?: number): readonly ContextOrder[] => indices.length ?
    [{ op, units: indices.map(i => frame.unitHandle(i)), ...(handle === undefined ? {} : { target: handle }) }] : [];
  const factories = completedFactoryHandles(frame, bp, selected, ownArmy);
  const rally: readonly ContextOrder[] = groundValid && factories.length ? [{ op: Op.SetRally, units: factories }] : [];
  const withRally = (orders: readonly ContextOrder[]): readonly ContextOrder[] => [...rally, ...orders];
  const ground = (): readonly ContextOrder[] => groundValid ? [
    ...rally,
    ...order(Op.Move, actors.filter(i => mobile(i) && !category(i, 'FACTORY'))),
  ] : [];
  if (target === null || target < 0 || target >= frame.unitCount || (frame.unitFlags(target) & HIDDEN)) return ground();
  const handle = frame.unitHandle(target), others = actors.filter(i => frame.unitHandle(i) !== handle && !category(i, 'FACTORY'));
  if (frame.unitFlags(target) & UnitFlags.Wreck) {
    const reclaimers = others.filter(i => builder(i) && category(i, 'RECLAIM'));
    return reclaimers.length ? withRally(order(Op.Reclaim, reclaimers, handle)) : ground();
  }
  if (!allied(frame.unitArmy(target))) {
    const armed = others.filter(i => bp.mountCount(frame.unitVisual(i)) > 0);
    return armed.length ? withRally(order(Op.Attack, armed, handle)) : ground();
  }
  if (frame.unitBuild(target) < 255) return withRally(order(Op.Assist, others.filter(builder), handle));
  if (frame.unitHp(target) < 255) return withRally(order(Op.Repair, others.filter(builder), handle));
  return withRally(order(Op.Guard, others.filter(mobile), handle));
}
