/**
 * Blueprint HMR (MS3, dev server only): payload contract between the Vite plugin
 * (vite.config.ts `blueprintHmrPlugin`) and the page, plus the page-side bookkeeping.
 *
 * Flow: a file below content/blueprints or content/locales changes → the plugin loads the content
 * modules through `server.ssrLoadModule` (module graph invalidated), compiles them with
 * `compileBlueprintModules` and sends the custom HMR event {@link BLUEPRINT_HMR_EVENT} with sim.bin
 * (base64) + view.json → the page sends `ctl.devReload {simBin}` to the sim worker → once the worker
 * reports the reload (`status.devReloads` incremented) the page applies view.json (visual table,
 * icons) and records the timing. A compile error arrives as `ok: false` with the diagnostics: no
 * reload, the HUD and the console show them.
 *
 * Timing (`window.__faf.hmr`): `changedAt` = mtime of the changed file (plugin, epoch ms) →
 * `appliedAt` = worker status received (page, epoch ms); goal ≤ 1 s (PLAN §5.2 MS3).
 */

/** Custom HMR event name. */
export const BLUEPRINT_HMR_EVENT = 'faf:blueprints';

/** Payload of {@link BLUEPRINT_HMR_EVENT}. */
export type BlueprintHmrPayload =
  | {
      readonly ok: true;
      /** Update number of this dev server (1, 2, …). */
      readonly id: number;
      /** Repo-relative paths of the changed files. */
      readonly files: readonly string[];
      /** mtime of the newest changed file (epoch ms; `Date.now()` for deletions). */
      readonly changedAt: number;
      /** Plugin: compile finished (epoch ms). */
      readonly compiledAt: number;
      /** Plugin: module loading + compilation (ms). */
      readonly compileMs: number;
      /** sim.bin, base64. */
      readonly simBin: string;
      readonly viewJson: string;
      readonly simHash: number;
      readonly viewHash: number;
    }
  | {
      readonly ok: false;
      readonly id: number;
      readonly files: readonly string[];
      readonly changedAt: number;
      readonly compiledAt: number;
      readonly compileMs: number;
      /** Formatted diagnostics (`formatDiagnostics`), one per line. */
      readonly diagnostics: string;
      /** Number of diagnostics. */
      readonly count: number;
    };

/** One finished (or failed) HMR update as seen by the page. */
export interface HmrRecord {
  readonly id: number;
  readonly ok: boolean;
  readonly files: readonly string[];
  readonly changedAt: number;
  readonly compiledAt: number;
  readonly compileMs: number;
  /** Page received the event (epoch ms). */
  readonly receivedAt: number;
  /** Worker status received / view applied (epoch ms); null on failure. */
  readonly appliedAt: number | null;
  /** appliedAt − changedAt (ms); null on failure. */
  readonly totalMs: number | null;
  /** New blueprint simHash reported by the worker (or the compiler on failure). */
  readonly simHash: number | null;
  /** Command log tainted after the reload. */
  readonly tainted: boolean;
  /** Error text (compile diagnostics or host rejection); null on success. */
  readonly error: string | null;
}

/** Plain snapshot for `window.__faf.hmr`. */
export interface HmrSnapshot {
  /** Updates received (success or failure). */
  readonly count: number;
  readonly applied: number;
  readonly failed: number;
  /** Update waiting for the worker. */
  readonly pending: boolean;
  readonly last: HmrRecord | null;
  readonly history: readonly HmrRecord[];
}

/** base64 → bytes (browser and Node ≥ 16: `atob`). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** What the tracker applies once the worker accepted the new sim.bin. */
export interface HmrPending {
  readonly payload: Extract<BlueprintHmrPayload, { ok: true }>;
  readonly simBin: Uint8Array;
  readonly receivedAt: number;
  /** `status.devReloads` value that confirms this update. */
  readonly expectDevReloads: number;
}

/**
 * Page-side HMR state machine (pure; the game wires sending, applying and the clock):
 * `receive` → (compile error: record failure) | pending → `onStatus` (devReloads reached: record
 * success, return the pending update to apply) | `onHostError` (record failure).
 */
export class HmrTracker {
  private readonly records: HmrRecord[] = [];
  private pendingUpdate: HmrPending | null = null;
  private received = 0;
  private applied = 0;
  private failed = 0;

  constructor(private readonly maxHistory = 32) {}

  get pending(): HmrPending | null {
    return this.pendingUpdate;
  }

  /**
   * A payload arrived at `nowMs` (epoch). Returns the pending update to send to the worker, or
   * null for a compile error (recorded as failure). A still pending update is superseded (failure).
   */
  receive(p: BlueprintHmrPayload, nowMs: number, devReloadsNow: number): HmrPending | null {
    this.received++;
    if (this.pendingUpdate !== null) {
      this.fail(this.pendingUpdate, nowMs, 'superseded by a newer update');
      this.pendingUpdate = null;
    }
    if (!p.ok) {
      this.failed++;
      this.push({
        id: p.id,
        ok: false,
        files: p.files,
        changedAt: p.changedAt,
        compiledAt: p.compiledAt,
        compileMs: p.compileMs,
        receivedAt: nowMs,
        appliedAt: null,
        totalMs: null,
        simHash: null,
        tainted: false,
        error: p.diagnostics,
      });
      return null;
    }
    const upd: HmrPending = { payload: p, simBin: base64ToBytes(p.simBin), receivedAt: nowMs, expectDevReloads: devReloadsNow + 1 };
    this.pendingUpdate = upd;
    return upd;
  }

  /**
   * A worker status arrived: if it confirms the pending update, records the success and returns
   * the update (the caller applies view.json now), else null.
   */
  onStatus(devReloads: number, simHash: number, tainted: boolean, nowMs: number): HmrPending | null {
    const p = this.pendingUpdate;
    if (p === null || devReloads < p.expectDevReloads) return null;
    this.pendingUpdate = null;
    this.applied++;
    this.push({
      id: p.payload.id,
      ok: true,
      files: p.payload.files,
      changedAt: p.payload.changedAt,
      compiledAt: p.payload.compiledAt,
      compileMs: p.payload.compileMs,
      receivedAt: p.receivedAt,
      appliedAt: nowMs,
      totalMs: nowMs - p.payload.changedAt,
      simHash: simHash >>> 0,
      tainted,
      error: null,
    });
    return p;
  }

  /** A host error arrived while an update was pending (e.g. incompatible sim.bin): failure. */
  onHostError(message: string, nowMs: number): boolean {
    const p = this.pendingUpdate;
    if (p === null) return false;
    this.pendingUpdate = null;
    this.fail(p, nowMs, message);
    return true;
  }

  snapshot(): HmrSnapshot {
    const h = this.records.map((r) => ({ ...r, files: [...r.files] }));
    return {
      count: this.received,
      applied: this.applied,
      failed: this.failed,
      pending: this.pendingUpdate !== null,
      last: h.length === 0 ? null : h[h.length - 1]!,
      history: h,
    };
  }

  private fail(p: HmrPending, nowMs: number, error: string): void {
    this.failed++;
    this.push({
      id: p.payload.id,
      ok: false,
      files: p.payload.files,
      changedAt: p.payload.changedAt,
      compiledAt: p.payload.compiledAt,
      compileMs: p.payload.compileMs,
      receivedAt: p.receivedAt,
      appliedAt: null,
      totalMs: null,
      simHash: p.payload.simHash >>> 0,
      tainted: false,
      error,
    });
  }

  private push(r: HmrRecord): void {
    this.records.push(r);
    if (this.records.length > this.maxHistory) this.records.shift();
  }
}
