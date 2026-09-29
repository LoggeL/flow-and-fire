/**
 * Transient staging of the commands of one step (not simulation state: empty before and after
 * every step). Commands from any input form (binary batch, batch cursor, envelope objects) are
 * copied into flat typed arrays and sorted by (army, seq, arrival index) — a total order
 * (PLAN §3.4 phase 1). The buffers only grow when a step carries more commands than ever
 * before (cold path); steady-state steps do not allocate.
 */
import type { CommandBatchView, CommandEnvelope } from '@faf/protocol';

export class CommandStage {
  count = 0;
  army: Int32Array = new Int32Array(64);
  seq: Int32Array = new Int32Array(64);
  op: Int32Array = new Int32Array(64);
  flags: Int32Array = new Int32Array(64);
  unitStart: Int32Array = new Int32Array(64);
  unitCount: Int32Array = new Int32Array(64);
  payStart: Int32Array = new Int32Array(64);
  payLen: Int32Array = new Int32Array(64);
  /** Sorted envelope indices. */
  order: Int32Array = new Int32Array(64);
  private tmp: Int32Array = new Int32Array(64);
  units: Uint32Array = new Uint32Array(1024);
  unitsUsed = 0;
  payload: Uint8Array = new Uint8Array(4096);
  payloadUsed = 0;
  /** DataView over `payload` (rebuilt only when the buffer grows). */
  dv = new DataView(this.payload.buffer);

  clear(): void {
    this.count = 0;
    this.unitsUsed = 0;
    this.payloadUsed = 0;
  }

  private growEnvelopes(): void {
    const n = this.army.length * 2;
    const grow = (a: Int32Array): Int32Array => {
      const b = new Int32Array(n);
      b.set(a);
      return b;
    };
    this.army = grow(this.army);
    this.seq = grow(this.seq);
    this.op = grow(this.op);
    this.flags = grow(this.flags);
    this.unitStart = grow(this.unitStart);
    this.unitCount = grow(this.unitCount);
    this.payStart = grow(this.payStart);
    this.payLen = grow(this.payLen);
    this.order = new Int32Array(n);
    this.tmp = new Int32Array(n);
  }

  private ensureUnits(extra: number): void {
    if (this.unitsUsed + extra <= this.units.length) return;
    let n = this.units.length * 2;
    while (n < this.unitsUsed + extra) n *= 2;
    const b = new Uint32Array(n);
    b.set(this.units.subarray(0, this.unitsUsed));
    this.units = b;
  }

  private ensurePayload(extra: number): void {
    if (this.payloadUsed + extra <= this.payload.length) return;
    let n = this.payload.length * 2;
    while (n < this.payloadUsed + extra) n *= 2;
    const b = new Uint8Array(n);
    b.set(this.payload.subarray(0, this.payloadUsed));
    this.payload = b;
    this.dv = new DataView(b.buffer);
  }

  private begin(army: number, seq: number, op: number, flags: number, unitCount: number, payLen: number): number {
    if (this.count === this.army.length) this.growEnvelopes();
    const i = this.count++;
    this.army[i] = army;
    this.seq[i] = seq;
    this.op[i] = op;
    this.flags[i] = flags;
    this.ensureUnits(unitCount);
    this.unitStart[i] = this.unitsUsed;
    this.unitCount[i] = unitCount;
    this.unitsUsed += unitCount;
    this.ensurePayload(payLen);
    this.payStart[i] = this.payloadUsed;
    this.payLen[i] = payLen;
    this.payloadUsed += payLen;
    return i;
  }

  /** Stages every remaining envelope of a batch cursor (already `reset()` by the caller). */
  addFromView(v: CommandBatchView): void {
    while (v.next()) {
      const i = this.begin(v.army, v.seq, v.op, v.flags, v.unitCount, v.payloadLength);
      const us = this.unitStart[i]!;
      for (let k = 0; k < v.unitCount; k++) this.units[us + k] = v.unitAt(k);
      const src = v.dataView;
      const po = v.payloadOffset;
      const ps = this.payStart[i]!;
      const pay = this.payload;
      for (let k = 0; k < v.payloadLength; k++) pay[ps + k] = src.getUint8(po + k);
    }
  }

  /** Stages envelope objects (tools, tests, replay sources). */
  addEnvelopes(envs: readonly CommandEnvelope[]): void {
    for (let e = 0; e < envs.length; e++) {
      const env = envs[e]!;
      const i = this.begin(env.army, env.seq, env.op, env.flags, env.units.length, env.payload.length);
      const us = this.unitStart[i]!;
      for (let k = 0; k < env.units.length; k++) this.units[us + k] = env.units[k]!;
      this.payload.set(env.payload, this.payStart[i]!);
    }
  }

  /** Sorts `order` by (army, seq, index): stable bottom-up merge sort, allocation-free. */
  sortByArmySeq(): void {
    const n = this.count;
    let a = this.order;
    let b = this.tmp;
    for (let i = 0; i < n; i++) a[i] = i;
    for (let width = 1; width < n; width *= 2) {
      for (let lo = 0; lo < n; lo += 2 * width) {
        const mid = Math.min(lo + width, n);
        const hi = Math.min(lo + 2 * width, n);
        let i = lo;
        let j = mid;
        let k = lo;
        while (i < mid && j < hi) {
          const x = a[i]!;
          const y = a[j]!;
          if (this.before(y, x)) {
            b[k++] = y;
            j++;
          } else {
            b[k++] = x;
            i++;
          }
        }
        while (i < mid) b[k++] = a[i++]!;
        while (j < hi) b[k++] = a[j++]!;
      }
      const t = a;
      a = b;
      b = t;
    }
    if (a !== this.order) {
      this.tmp = this.order;
      this.order = a;
    }
  }

  /** Strict total order: (army, seq, index). */
  private before(x: number, y: number): boolean {
    const ax = this.army[x]!;
    const ay = this.army[y]!;
    if (ax !== ay) return ax < ay;
    const sx = this.seq[x]!;
    const sy = this.seq[y]!;
    if (sx !== sy) return sx < sy;
    return x < y;
  }
}
