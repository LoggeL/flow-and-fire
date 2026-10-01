import type { FrameReader } from '@faf/protocol';
import { isOwnUnit, type Selection } from './selection.ts';

/** Ten handle groups. Stable generation handles prevent a recycled unit from entering a group. */
export class ControlGroups {
  private readonly groups: number[][] = Array.from({ length: 10 }, () => []);
  private lastSlot = -1;
  private lastAt = -Infinity;

  save(slot: number, handles: ArrayLike<number>, additive = false): void {
    const group = this.group(slot);
    if (!additive) group.length = 0;
    for (let i = 0; i < handles.length; i++) if (!group.includes(handles[i]! >>> 0)) group.push(handles[i]! >>> 0);
  }

  recall(slot: number, selection: Selection, frame: FrameReader | null, additive: boolean, now: number): { x: number; z: number } | null {
    this.prune(frame, selection.playerArmy);
    const group = this.group(slot);
    selection.set(group, additive);
    const center = slot === this.lastSlot && now - this.lastAt < 350 && now >= this.lastAt;
    this.lastSlot = slot; this.lastAt = now;
    if (!center || frame === null || group.length === 0) return null;
    let x = 0; let z = 0; let n = 0;
    for (let i = 0; i < frame.unitCount; i++) {
      if (!group.includes(frame.unitHandle(i))) continue;
      x += frame.unitCur(i, 0); z += frame.unitCur(i, 2); n++;
    }
    return n === 0 ? null : { x: x / n, z: z / n };
  }

  prune(frame: FrameReader | null, army: number): void {
    if (frame === null) return;
    for (let g = 0; g < this.groups.length; g++) {
      const group = this.groups[g]!;
      let w = 0;
      for (let k = 0; k < group.length; k++) {
        const h = group[k]!;
        for (let i = 0; i < frame.unitCount; i++) {
          if (frame.unitHandle(i) !== h || !isOwnUnit(frame, i, army)) continue;
          group[w++] = h; break;
        }
      }
      group.length = w;
    }
  }

  snapshot(): number[][] { return this.groups.map((g) => g.slice()); }
  private group(slot: number): number[] {
    if (!Number.isInteger(slot) || slot < 0 || slot > 9) throw new RangeError('control group must be 0..9');
    return this.groups[slot]!;
  }
}
