import { FlowFlags, UnitFlags, type FrameReader } from '@faf/protocol';
import type { FlowConsumer, TypeCount } from '@faf/hud';

export interface FlowSubject { readonly typeId: string; readonly factory: boolean }
/** One row per actual billed site. Contributors never duplicate the site's resource charges. */
export function frameFlowConsumers(frame: FrameReader, subject: (bp: number) => FlowSubject): FlowConsumer[] {
  if (frame.flowTick !== frame.tick) return [];
  const rows: FlowConsumer[] = [];
  const billed = new Set<number>();
  const sources = new Map<number, number[]>(), targetTypes = new Map<number, string>();
  for (let u = 0; u < frame.unitCount; u++) targetTypes.set(frame.unitHandle(u), subject(frame.unitVisual(u)).typeId);
  for (let i = 0; i < frame.flowCount; i++) {
    const target = frame.flowTarget(i);
    if (target === 0xffffffff) continue;
    const entries = sources.get(target);
    if (entries) entries.push(i); else sources.set(target, [i]);
  }
  for (let i = 0; i < frame.flowCount; i++) if (frame.flowFlags(i) & (FlowFlags.Billed | FlowFlags.BuildSite)) billed.add(frame.flowHandle(i));
  for (let i = 0; i < frame.flowCount; i++) {
    const flags = frame.flowFlags(i), handle = frame.flowHandle(i), target = frame.flowTarget(i);
    if (!(flags & FlowFlags.Billed) && !(flags & FlowFlags.Paused) ||
      !(flags & FlowFlags.Billed) && target !== 0xffffffff && billed.has(target)) continue;
    let primary = -1;
    const contributors = sources.get(handle) ?? [];
    for (const source of contributors) if (frame.flowHandle(source) !== handle) {
      if (primary < 0 || subject(frame.flowBp(source)).factory) primary = source;
    }
    const own = subject(frame.flowBp(i)), display = primary < 0 ? own : subject(frame.flowBp(primary));
    let count = 0;
    if (primary >= 0) for (const source of contributors) if (frame.flowBp(source) === frame.flowBp(primary)) count++;
    let targetTypeId: string | undefined;
    if (primary >= 0) targetTypeId = own.typeId;
    else if (target !== 0xffffffff) targetTypeId = targetTypes.get(target);
    if (flags & FlowFlags.Upgrading) for (let w = 0; w < frame.watchCount; w++) {
      if (frame.watchHandle(w) === handle && frame.watchFactoryBp(w) >= 0) targetTypeId = subject(frame.watchFactoryBp(w)).typeId;
    }
    rows.push({ id: handle, typeId: display.typeId, kind: flags & FlowFlags.Upgrading ? 'upgrade' : display.factory ? 'factory' : targetTypeId ? 'engineer' : 'upkeep',
      ...(targetTypeId ? { targetTypeId } : {}), ...(count > 1 ? { count } : {}),
      massReq: frame.flowMassDemand(i) / 100, massGot: frame.flowMassSpent(i) / 100,
      energyReq: frame.flowEnergyDemand(i) / 100, energyGot: frame.flowEnergySpent(i) / 100,
      paused: (flags & FlowFlags.Paused) !== 0 });
  }
  return rows;
}

export interface FactoryFlow {
  /** Observation is from this frame's actual economy phase; restored observations are unavailable. */
  readonly available: boolean;
  /** Current contributors' full assist power, including allies, in BP/s before resource allocation. */
  readonly bpAssist: number;
  /** Actual product power after its resource allocation, in BP/s, for progress/ETA. */
  readonly bpEffective: number;
  readonly paused: boolean;
  /** Only identities authorized by the own-army flow stream. Allied power does not invent helpers. */
  readonly helpers: TypeCount[];
}

/** The billed product owns total power and resource allocation, including private allied helpers. */
export function frameFactoryAssistance(frame: FrameReader, handle: number, product: number,
  subject: (bp: number) => FlowSubject): FactoryFlow {
  let paused = false;
  for (let u = 0; u < frame.unitCount; u++) if (frame.unitHandle(u) === handle || frame.unitHandle(u) === product)
    paused ||= (frame.unitFlags(u) & UnitFlags.Paused) !== 0;
  if (frame.flowTick !== frame.tick) return { available: false, bpAssist: 0, bpEffective: 0, paused, helpers: [] };
  let factoryPower = 0, totalPower = 0, productRow = -1;
  const counts = new Map<string, number>();
  for (let i = 0; i < frame.flowCount; i++) {
    if (frame.flowHandle(i) === product) {
      productRow = i;
      totalPower = frame.flowEffectivePower(i);
      paused ||= (frame.flowFlags(i) & FlowFlags.Paused) !== 0;
    }
    const target = frame.flowTarget(i);
    if (!(frame.flowFlags(i) & FlowFlags.Contributing) || product === 0xffffffff || target !== product) continue;
    if (frame.flowHandle(i) === handle) { factoryPower = frame.flowOwnPower(i); continue; }
    const id = subject(frame.flowBp(i)).typeId;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let ratio = 0;
  if (productRow >= 0) for (let i = 0; i < frame.ecoCount; i++) if (frame.ecoArmy(i) === frame.flowArmy(productRow)) {
    ratio = frame.ecoRatio(i, frame.flowPriority(productRow));
    break;
  }
  return { available: true, bpAssist: Math.max(0, totalPower - factoryPower) * 10 / 65536,
    bpEffective: Math.floor(totalPower * ratio / 65536) * 10 / 65536, paused,
    helpers: [...counts].map(([typeId, count]) => ({ typeId, count })) };
}
