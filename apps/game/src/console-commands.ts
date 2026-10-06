/**
 * Dev console command interpreter (S8, MS2: map/camera/preset, MS3: obstacle/paths/select/watch).
 * Pure logic over a
 * {@link ConsoleApi}: the game wires it to the client, tests to a fake. Cheats (spawn, kill) go
 * through the command pipeline only.
 */
import { RENDER_PRESET_NAMES, parsePresetName, type RenderPresetName } from '@faf/client';

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
  /** Lines describing the map (name, size, water, starts, spots, mapSimHash). */
  mapInfo(): string[];
  /** Map edge length in WU (camera target range). */
  mapSizeWu(): number;
  /** Moves the camera focus to (x, z) WU, optionally with a distance (WU); returns info lines. */
  jumpCamera(x: number, z: number, distance?: number): string[];
  /** Switches the render preset; returns info lines. */
  setPreset(name: RenderPresetName): string[];
  /** Active preset. */
  presetName(): RenderPresetName;
  /** Stamps (or removes) a footprint of w × h cells at cell (x, z) (CheatSub.Footprint); returns the seq. */
  obstacle(x: number, z: number, w: number, h: number, remove: boolean): number;
  /** Lines describing the path statistics. */
  pathInfo(): string[];
  /** Path overlay on/off (undefined = toggle); returns the new state. */
  setPathOverlay(on?: boolean): boolean;
  /** Selects every own unit of blueprint (sim id) `bp`; returns the count. */
  selectBlueprint(bp: number): number;
  /** Lines describing the watch data of the selection. */
  watchInfo(): string[];
  /** Current selection size. */
  readonly selectedCount: number;
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
  'map                    – Karte: Name, Größe, Wasser, Starts, Spots, mapSimHash',
  'camera <x> <z> [dist]  – Kamera auf (x, z) WU setzen, optional Abstand in WU',
  'preset [name]          – Render-Preset low|medium|high|ultra (ohne Name: aktuelles)',
  'obstacle <x> <z> <w> <h> [remove] – Cheat: Hindernis (w×h Zellen à 1 WU, max. 64) setzen/entfernen',
  'paths [on|off]         – Pfadstatistik; on/off schaltet das Pfad-Overlay',
  'select <bp>            – alle eigenen Einheiten eines Blueprints auswählen (z. B. lnd_t1_tank)',
  'watch                  – Watch-Daten (Orders, Wegpunkte) der Auswahl',
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

/** Decimal number with `.` or `,`; null if malformed. */
function parseDecimal(s: string | undefined): number | null {
  if (s === undefined || !/^-?\d+([.,]\d+)?$/.test(s)) return null;
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
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
    case 'map':
      return ok(...api.mapInfo());
    case 'camera':
    case 'cam': {
      const size = api.mapSizeWu();
      const x = parseDecimal(args[0]);
      const z = parseDecimal(args[1]);
      if (x === null || z === null || x < 0 || z < 0 || x > size || z > size) return fail(`camera: x und z in 0–${size} WU erwartet`);
      let d: number | undefined;
      if (args[2] !== undefined) {
        const v = parseDecimal(args[2]);
        if (v === null || v <= 0) return fail('camera: Abstand > 0 WU erwartet');
        d = v;
      }
      return ok(...api.jumpCamera(x, z, d));
    }
    case 'preset': {
      if (args[0] === undefined) return ok(`preset ${api.presetName()} (verfügbar: ${RENDER_PRESET_NAMES.join(', ')})`);
      const name = parsePresetName(args[0].toLowerCase());
      if (name === undefined) return fail(`preset: ${RENDER_PRESET_NAMES.join('|')} erwartet`);
      return ok(...api.setPreset(name));
    }
    case 'obstacle': {
      const size = api.mapSizeWu();
      const v = args.slice(0, 4).map((a) => parseIntStrict(a));
      if (v.length < 4 || v.some((n) => n === null)) return fail('obstacle: <x> <z> <w> <h> [remove] als ganze Zahlen (Zellen = WU) erwartet');
      const [x, z, w, h] = v as [number, number, number, number];
      if (w < 1 || h < 1 || w > 64 || h > 64) return fail('obstacle: Breite/Höhe 1–64 Zellen erwartet');
      if (x + w <= 0 || z + h <= 0 || x >= size || z >= size) return fail(`obstacle: Rechteck liegt außerhalb der Karte (0–${size} WU)`);
      const extra = args[4]?.toLowerCase();
      if (extra !== undefined && extra !== 'remove' && extra !== 'rm' && extra !== '-') return fail(`obstacle: unbekannte Option '${args[4]}' (nur "remove")`);
      const remove = extra !== undefined;
      const seq = api.obstacle(x, z, w, h, remove);
      return ok(`obstacle ${remove ? 'entfernt' : 'gesetzt'}: (${x}, ${z}) ${w}×${h} (seq ${seq})`);
    }
    case 'paths': {
      const a = args[0]?.toLowerCase();
      if (a === 'on' || a === 'off') {
        const on = api.setPathOverlay(a === 'on');
        return ok(`Pfad-Overlay ${on ? 'an' : 'aus'}`);
      }
      if (a !== undefined) return fail('paths: on|off erwartet');
      return ok(...api.pathInfo());
    }
    case 'select': {
      if (args[0] === undefined) return fail('select: Blueprint erwartet (z. B. lnd_t1_tank)');
      const bp = api.resolveBlueprint(args[0]);
      if (bp === null) return fail(`select: unbekannter Blueprint '${args[0]}'`);
      const n = api.selectBlueprint(bp);
      return ok(`select: ${n} Einheiten von bp ${bp} ausgewählt`);
    }
    case 'watch':
      return ok(...api.watchInfo());
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
