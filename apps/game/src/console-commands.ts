/**
 * Dev console command interpreter (S8). Pure logic over a {@link ConsoleApi}: the game wires it to
 * the client, tests to a fake. Cheats (spawn, kill) go through the command pipeline only.
 */

export interface ConsoleApi {
  /** Resolves a blueprint name (`core:cube`) or numeric sim id; null if unknown. */
  resolveBlueprint(name: string): number | null;
  /** Default blueprint for `spawn` without bp. */
  readonly defaultBlueprint: number;
  /** Number of armies in the session. */
  readonly armyCount: number;
  /** Cheat spawn at the camera focus. Returns the command seq. */
  spawn(bp: number, count: number, army: number): number;
  /** Cheat kill of the current selection. Returns the seq (−1: nothing selected). */
  killSelection(): number;
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  /** Steps `n` ticks (only while paused); false if not paused. */
  step(n: number): boolean;
  setSpeed(x: number): void;
  /** Lines describing the current hash state. */
  hashInfo(): string[];
  /** Toggles the phase budget overlay; returns the new visibility. */
  toggleBudget(): boolean;
  /** Requests the command log export (download follows asynchronously). */
  exportLog(): void;
  /** Lines describing the transport. */
  transportInfo(): string[];
}

export interface ConsoleResult {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

export const CONSOLE_HELP: readonly string[] = [
  'spawn <n> [army] [bp]  – Cheat: n Einheiten am Kamerafokus (Standard: Armee 0, core:cube)',
  'kill                   – Cheat: Selektion zerstören',
  'pause | resume         – Sim anhalten / fortsetzen',
  'step [n]               – n Ticks weiter (nur in Pause, Standard 1)',
  'speed <x>              – Spielgeschwindigkeit 0.25–3',
  'hash                   – letzter Regel-Hash, simId, Frame-Fingerprint',
  'budget                 – Phasenbudget-Overlay ein/aus',
  'export                 – Command-Log herunterladen',
  'transport              – Frame-Transport und Isolation',
  'help                   – diese Hilfe',
];

const MAX_SPAWN = 8192;

function ok(...lines: string[]): ConsoleResult {
  return { ok: true, lines };
}

function fail(...lines: string[]): ConsoleResult {
  return { ok: false, lines };
}

function parseIntStrict(s: string): number | null {
  if (!/^-?\d+$/.test(s)) return null;
  const v = Number.parseInt(s, 10);
  return Number.isSafeInteger(v) ? v : null;
}

/** Splits a console line into words (whitespace separated, case preserved). */
export function tokenize(line: string): string[] {
  return line.trim().split(/\s+/).filter((w) => w !== '');
}

/** Executes one console line. */
export function runConsoleCommand(line: string, api: ConsoleApi): ConsoleResult {
  const words = tokenize(line);
  const cmd = words[0]?.toLowerCase();
  const args = words.slice(1);
  switch (cmd) {
    case undefined:
      return ok();
    case 'help':
    case '?':
      return ok(...CONSOLE_HELP);
    case 'spawn': {
      const n = args[0] === undefined ? null : parseIntStrict(args[0]);
      if (n === null || n < 1 || n > MAX_SPAWN) return fail(`spawn: Anzahl 1–${MAX_SPAWN} erwartet`);
      let army = 0;
      if (args[1] !== undefined) {
        const a = parseIntStrict(args[1]);
        if (a === null || a < 0 || a >= api.armyCount) return fail(`spawn: Armee 0–${api.armyCount - 1} erwartet`);
        army = a;
      }
      let bp = api.defaultBlueprint;
      if (args[2] !== undefined) {
        const b = api.resolveBlueprint(args[2]);
        if (b === null) return fail(`spawn: unbekannter Blueprint '${args[2]}'`);
        bp = b;
      }
      const seq = api.spawn(bp, n, army);
      return ok(`spawn ${n} × bp ${bp} für Armee ${army} (seq ${seq})`);
    }
    case 'kill': {
      const seq = api.killSelection();
      return seq < 0 ? fail('kill: nichts ausgewählt') : ok(`kill: Selektion (seq ${seq})`);
    }
    case 'pause':
      api.pause();
      return ok('pause');
    case 'resume':
      api.resume();
      return ok('resume');
    case 'step': {
      const n = args[0] === undefined ? 1 : parseIntStrict(args[0]);
      if (n === null || n < 1 || n > 100_000) return fail('step: Anzahl 1–100000 erwartet');
      if (!api.step(n)) return fail('step: nur in Pause (erst "pause")');
      return ok(`step ${n}`);
    }
    case 'speed': {
      const raw = args[0];
      const x = raw === undefined ? Number.NaN : Number(raw.replace(',', '.').replace(/x$/i, ''));
      if (!Number.isFinite(x) || x < 0.25 || x > 3) return fail('speed: Faktor 0.25–3 erwartet');
      api.setSpeed(x);
      return ok(`speed ${x}x`);
    }
    case 'hash':
      return ok(...api.hashInfo());
    case 'budget':
      return ok(api.toggleBudget() ? 'budget: Overlay an' : 'budget: Overlay aus');
    case 'export':
      api.exportLog();
      return ok('export: Command-Log angefordert (Download folgt)');
    case 'transport':
      return ok(...api.transportInfo());
    default:
      return fail(`unbekannter Befehl '${words[0] ?? ''}' – "help" zeigt alle Befehle`);
  }
}

/** Input history with ↑/↓ navigation (newest last). */
export class ConsoleHistory {
  private readonly items: string[] = [];
  private cursor = 0;
  constructor(private readonly max = 100) {}

  push(line: string): void {
    const t = line.trim();
    if (t !== '' && this.items[this.items.length - 1] !== t) {
      this.items.push(t);
      if (this.items.length > this.max) this.items.shift();
    }
    this.cursor = this.items.length;
  }

  /** Older entry (↑); stays at the oldest. */
  prev(): string {
    if (this.items.length === 0) return '';
    this.cursor = Math.max(0, this.cursor - 1);
    return this.items[this.cursor] ?? '';
  }

  /** Newer entry (↓); past the newest returns ''. */
  next(): string {
    if (this.cursor >= this.items.length) return '';
    this.cursor++;
    return this.items[this.cursor] ?? '';
  }

  get size(): number {
    return this.items.length;
  }
}
