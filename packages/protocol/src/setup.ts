/** Deterministic tick-zero setup shared by host, simulation and replay formats. */
export interface SkirmishArmySetup {
  readonly start: number;
  readonly team: number;
  readonly faction: number;
  readonly controller: 'human' | 'ai';
  readonly difficulty?: 'easy' | 'normal' | 'hard';
  /** Fixed Q16 resource income multiplier, 65536 = normal. */
  readonly aixFactorQ16?: number;
}
export interface SkirmishInitialization {
  readonly kind: 'skirmish';
  readonly faction: number;
  readonly slots?: readonly SkirmishArmySetup[];
  readonly rules?: {
    readonly unitCap: number;
    readonly fog: 'explore' | 'revealed';
    readonly victory: 'assassination' | 'supremacy' | 'annihilation';
  };
}
const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
const VICTORIES = ['assassination', 'supremacy', 'annihilation'] as const;
function integer(value: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError(`Invalid skirmish ${label}`);
}
export function validateSkirmishInitialization(setup: SkirmishInitialization, armyCount?: number): void {
  if (setup.kind !== 'skirmish') throw new RangeError('Invalid skirmish kind');
  integer(setup.faction, 255, 'faction');
  if (setup.slots !== undefined) {
    if (setup.slots.length < 1 || setup.slots.length > 16 || (armyCount !== undefined && setup.slots.length !== armyCount)) throw new RangeError('Invalid skirmish slot count');
    const starts: number[] = [];
    for (const slot of setup.slots) {
      integer(slot.start, 65535, 'start'); integer(slot.team, 255, 'team'); integer(slot.faction, 255, 'faction');
      if (starts.includes(slot.start)) throw new RangeError('Duplicate skirmish start'); starts.push(slot.start);
      if (slot.controller !== 'human' && slot.controller !== 'ai') throw new RangeError('Invalid skirmish controller');
      if (slot.difficulty !== undefined && !DIFFICULTIES.includes(slot.difficulty)) throw new RangeError('Invalid skirmish difficulty');
      if (slot.aixFactorQ16 !== undefined && (!Number.isInteger(slot.aixFactorQ16) || slot.aixFactorQ16 < 65536 || slot.aixFactorQ16 > 131072)) throw new RangeError('Invalid skirmish AI multiplier');
      if (slot.controller === 'human' && (slot.difficulty !== undefined || (slot.aixFactorQ16 !== undefined && slot.aixFactorQ16 !== 65536))) throw new RangeError('Human slot cannot use AI settings');
    }
  }
  if (setup.rules !== undefined) {
    integer(setup.rules.unitCap, 8192, 'unit cap');
    if (setup.rules.unitCap < 1 || !['explore', 'revealed'].includes(setup.rules.fog) || !VICTORIES.includes(setup.rules.victory)) throw new RangeError('Invalid skirmish rules');
  }
}
/** 12-byte header and 12 bytes per slot. Every reserved field is checked on read. */
export function encodeSkirmishInitialization(setup: SkirmishInitialization): Uint8Array {
  validateSkirmishInitialization(setup);
  const count = setup.slots?.length ?? 0, out = new Uint8Array(12 + count * 12), view = new DataView(out.buffer);
  view.setUint8(0, 1); view.setUint8(1, setup.faction); view.setUint8(2, count); view.setUint8(3, setup.rules === undefined ? 0 : 1);
  if (setup.rules !== undefined) {
    view.setUint16(4, setup.rules.unitCap, true); view.setUint8(6, setup.rules.fog === 'revealed' ? 1 : 0); view.setUint8(7, VICTORIES.indexOf(setup.rules.victory));
  }
  for (let i = 0; i < count; i++) {
    const slot = setup.slots![i]!, offset = 12 + i * 12;
    view.setUint16(offset, slot.start, true); view.setUint8(offset + 2, slot.team); view.setUint8(offset + 3, slot.faction);
    view.setUint8(offset + 4, slot.controller === 'ai' ? 1 : 0);
    view.setUint8(offset + 5, slot.difficulty === undefined ? 0 : DIFFICULTIES.indexOf(slot.difficulty) + 1);
    view.setUint32(offset + 8, slot.aixFactorQ16 ?? 0, true);
  }
  return out;
}
export function decodeSkirmishInitialization(bytes: Uint8Array): SkirmishInitialization {
  if (bytes.length < 12) throw new RangeError('Truncated skirmish setup');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = view.getUint8(2), flags = view.getUint8(3);
  if (view.getUint8(0) !== 1 || count > 16 || bytes.length !== 12 + count * 12 || flags > 1 || view.getUint32(8, true) !== 0) throw new RangeError('Invalid skirmish setup header');
  const slots: SkirmishArmySetup[] = [];
  for (let i = 0; i < count; i++) {
    const offset = 12 + i * 12, controller = view.getUint8(offset + 4), difficulty = view.getUint8(offset + 5), multiplier = view.getUint32(offset + 8, true);
    if (controller > 1 || difficulty > 3 || view.getUint16(offset + 6, true) !== 0) throw new RangeError('Invalid skirmish setup slot');
    slots.push({ start: view.getUint16(offset, true), team: view.getUint8(offset + 2), faction: view.getUint8(offset + 3), controller: controller === 1 ? 'ai' : 'human',
      ...(difficulty === 0 ? {} : { difficulty: DIFFICULTIES[difficulty - 1]! }), ...(multiplier === 0 ? {} : { aixFactorQ16: multiplier }) });
  }
  const fog = view.getUint8(6), victory = view.getUint8(7), cap = view.getUint16(4, true);
  if (fog > 1 || victory > 2 || (flags === 0 && (fog !== 0 || victory !== 0 || cap !== 0))) throw new RangeError('Invalid skirmish setup rules');
  const setup: SkirmishInitialization = { kind: 'skirmish', faction: view.getUint8(1), ...(count === 0 ? {} : { slots }),
    ...(flags === 0 ? {} : { rules: { unitCap: cap, fog: fog === 1 ? 'revealed' : 'explore', victory: VICTORIES[victory]! } }) };
  validateSkirmishInitialization(setup); return setup;
}
