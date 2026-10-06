import { describe, expect, it } from 'vitest';
import type { RenderPresetName } from '@faf/client';
import { CONSOLE_HELP, ConsoleHistory, runConsoleCommand, tokenize, type ConsoleApi } from '../src/console-commands.ts';

/** Records every API call; the console must reach the game only through this surface. */
function fakeApi(paused = false) {
  const calls: string[] = [];
  let seq = 0;
  let isPaused = paused;
  let budget = false;
  let preset: RenderPresetName = 'medium';
  let overlay = false;
  const api: ConsoleApi = {
    resolveBlueprint: (name) => (name === 'core:cube' || name === '0' ? 0 : name === 'core:tank' || name === '1' ? 1 : null),
    defaultBlueprint: 0,
    armyCount: 2,
    spawn: (bp, count, army) => {
      calls.push(`spawn ${bp} ${count} ${army}`);
      return ++seq;
    },
    killSelection: () => {
      calls.push('kill');
      return ++seq;
    },
    pause: () => {
      calls.push('pause');
      isPaused = true;
    },
    resume: () => {
      calls.push('resume');
      isPaused = false;
    },
    get paused() {
      return isPaused;
    },
    step: (n) => {
      calls.push(`step ${n}`);
      return isPaused;
    },
    setSpeed: (x) => calls.push(`speed ${x}`),
    hashInfo: () => ['hash line'],
    toggleBudget: () => (budget = !budget),
    exportLog: () => calls.push('export'),
    transportInfo: () => ['Transport: sab'],
    mapInfo: () => ['Karte: Test'],
    mapSizeWu: () => 512,
    jumpCamera: (x, z, d) => {
      calls.push(`camera ${x} ${z} ${d ?? '-'}`);
      return ['camera ok'];
    },
    setPreset: (name) => {
      calls.push(`preset ${name}`);
      preset = name;
      return [`preset ${name}`];
    },
    presetName: () => preset,
    obstacle: (x, z, w, h, remove) => {
      calls.push(`obstacle ${x} ${z} ${w} ${h} ${remove ? 'remove' : 'add'}`);
      return ++seq;
    },
    pathInfo: () => ['Tick 5: Anfragen 3'],
    setPathOverlay: (on) => {
      overlay = on ?? !overlay;
      calls.push(`overlay ${overlay}`);
      return overlay;
    },
    selectBlueprint: (bp) => {
      calls.push(`select ${bp}`);
      return 7;
    },
    watchInfo: () => ['beobachtet: 3'],
    get selectedCount() {
      return 7;
    },
  };
  return { api, calls };
}

describe('dev console commands (S8)', () => {
  it('tokenizes on whitespace', () => {
    expect(tokenize('  spawn   10\t1 core:cube ')).toEqual(['spawn', '10', '1', 'core:cube']);
    expect(tokenize('')).toEqual([]);
  });

  it('help lists every command', () => {
    const { api } = fakeApi();
    const r = runConsoleCommand('help', api);
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual(CONSOLE_HELP);
    for (const cmd of ['spawn', 'kill', 'pause', 'resume', 'step', 'speed', 'hash', 'budget', 'export', 'transport', 'map', 'camera', 'preset', 'help']) {
      expect(CONSOLE_HELP.some((l) => l.includes(cmd))).toBe(true);
    }
  });

  it('spawn: defaults, army, blueprint by name or id, validation', () => {
    const { api, calls } = fakeApi();
    expect(runConsoleCommand('spawn 10', api).ok).toBe(true);
    expect(runConsoleCommand('SPAWN 3 1', api).ok).toBe(true);
    expect(runConsoleCommand('spawn 2 0 core:tank', api).ok).toBe(true);
    expect(runConsoleCommand('spawn 2 0 1', api).ok).toBe(true);
    expect(calls).toEqual(['spawn 0 10 0', 'spawn 0 3 1', 'spawn 1 2 0', 'spawn 1 2 0']);
    for (const bad of ['spawn', 'spawn 0', 'spawn -1', 'spawn 8193', 'spawn x', 'spawn 1 2', 'spawn 1 -1', 'spawn 1 0 core:nope']) {
      expect(runConsoleCommand(bad, api).ok, bad).toBe(false);
    }
    expect(calls).toHaveLength(4);
  });

  it('kill, pause, resume, export go through the API', () => {
    const { api, calls } = fakeApi();
    runConsoleCommand('kill', api);
    runConsoleCommand('pause', api);
    runConsoleCommand('resume', api);
    runConsoleCommand('export', api);
    expect(calls).toEqual(['kill', 'pause', 'resume', 'export']);
  });

  it('kill without a selection fails', () => {
    const { api } = fakeApi();
    const r = runConsoleCommand('kill', { ...api, killSelection: () => -1 });
    expect(r.ok).toBe(false);
  });

  it('step only while paused, default 1, bounds', () => {
    const running = fakeApi(false);
    expect(runConsoleCommand('step', running.api).ok).toBe(false);
    const paused = fakeApi(true);
    expect(runConsoleCommand('step', paused.api).ok).toBe(true);
    expect(runConsoleCommand('step 25', paused.api).ok).toBe(true);
    expect(runConsoleCommand('step 0', paused.api).ok).toBe(false);
    expect(runConsoleCommand('step 100001', paused.api).ok).toBe(false);
    expect(paused.calls).toEqual(['step 1', 'step 25']);
  });

  it('speed accepts 0.25–3 incl. comma and x suffix', () => {
    const { api, calls } = fakeApi();
    for (const ok of ['speed 0.25', 'speed 3', 'speed 1,5', 'speed 2x']) expect(runConsoleCommand(ok, api).ok, ok).toBe(true);
    for (const bad of ['speed', 'speed 0.2', 'speed 3.5', 'speed fast']) expect(runConsoleCommand(bad, api).ok, bad).toBe(false);
    expect(calls).toEqual(['speed 0.25', 'speed 3', 'speed 1.5', 'speed 2']);
  });

  it('hash, budget toggle, transport, unknown command, empty line', () => {
    const { api } = fakeApi();
    expect(runConsoleCommand('hash', api).lines).toEqual(['hash line']);
    expect(runConsoleCommand('budget', api).lines[0]).toContain('an');
    expect(runConsoleCommand('budget', api).lines[0]).toContain('aus');
    expect(runConsoleCommand('transport', api).lines).toEqual(['Transport: sab']);
    const u = runConsoleCommand('frobnicate 1', api);
    expect(u.ok).toBe(false);
    expect(u.lines[0]).toContain("'frobnicate'");
    expect(runConsoleCommand('   ', api)).toEqual({ ok: true, lines: [] });
  });
});

describe('dev console commands (MS2: map, camera, preset)', () => {
  it('map prints the map info', () => {
    const { api } = fakeApi();
    expect(runConsoleCommand('map', api)).toEqual({ ok: true, lines: ['Karte: Test'] });
  });

  it('camera <x> <z> [dist] within the map, decimal comma, validation', () => {
    const { api, calls } = fakeApi();
    for (const ok of ['camera 96 96', 'camera 256.5 10 40', 'cam 0 512', 'camera 1,5 2 3,25']) expect(runConsoleCommand(ok, api).ok, ok).toBe(true);
    for (const bad of ['camera', 'camera 10', 'camera -1 5', 'camera 513 5', 'camera 5 5 0', 'camera 5 5 x', 'camera a b']) {
      expect(runConsoleCommand(bad, api).ok, bad).toBe(false);
    }
    expect(calls).toEqual(['camera 96 96 -', 'camera 256.5 10 40', 'camera 0 512 -', 'camera 1.5 2 3.25']);
  });

  it('preset shows or switches the render preset', () => {
    const { api, calls } = fakeApi();
    expect(runConsoleCommand('preset', api).lines[0]).toContain('medium');
    expect(runConsoleCommand('preset ULTRA', api).ok).toBe(true);
    expect(runConsoleCommand('preset low', api).ok).toBe(true);
    expect(runConsoleCommand('preset potato', api).ok).toBe(false);
    expect(calls).toEqual(['preset ultra', 'preset low']);
    expect(runConsoleCommand('preset', api).lines[0]).toContain('low');
  });
});

describe('ConsoleHistory', () => {
  it('navigates with ↑/↓, skips duplicates and blanks, caps its size', () => {
    const h = new ConsoleHistory(3);
    expect(h.prev()).toBe('');
    for (const l of ['a', 'b', 'b', '  ', 'c', 'd']) h.push(l);
    expect(h.size).toBe(3);
    expect(h.prev()).toBe('d');
    expect(h.prev()).toBe('c');
    expect(h.prev()).toBe('b');
    expect(h.prev()).toBe('b');
    expect(h.next()).toBe('c');
    expect(h.next()).toBe('d');
    expect(h.next()).toBe('');
    h.push('e');
    expect(h.prev()).toBe('e');
  });
});

describe('dev console commands (MS3)', () => {
  it('obstacle <x> <z> <w> <h> [remove]: validated, goes to the API', () => {
    const { api, calls } = fakeApi();
    expect(runConsoleCommand('obstacle 100 120 4 6', api).ok).toBe(true);
    expect(runConsoleCommand('obstacle 100 120 4 6 remove', api).ok).toBe(true);
    expect(calls).toEqual(['obstacle 100 120 4 6 add', 'obstacle 100 120 4 6 remove']);
    expect(runConsoleCommand('obstacle 1 2 3', api).ok).toBe(false);
    expect(runConsoleCommand('obstacle 1 2 65 3', api).ok).toBe(false);
    expect(runConsoleCommand('obstacle 1 2 0 3', api).ok).toBe(false);
    expect(runConsoleCommand('obstacle 600 2 3 3', api).ok).toBe(false);
    expect(runConsoleCommand('obstacle 1 2 3 3 banana', api).ok).toBe(false);
    expect(runConsoleCommand('obstacle 1.5 2 3 3', api).ok).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it('paths [on|off], select <bp>, watch', () => {
    const { api, calls } = fakeApi();
    expect(runConsoleCommand('paths', api).lines).toEqual(['Tick 5: Anfragen 3']);
    expect(runConsoleCommand('paths on', api).lines).toEqual(['Pfad-Overlay an']);
    expect(runConsoleCommand('paths off', api).lines).toEqual(['Pfad-Overlay aus']);
    expect(runConsoleCommand('paths maybe', api).ok).toBe(false);
    expect(runConsoleCommand('select core:tank', api).lines[0]).toMatch(/7 Einheiten von bp 1/);
    expect(runConsoleCommand('select nothing', api).ok).toBe(false);
    expect(runConsoleCommand('select', api).ok).toBe(false);
    expect(runConsoleCommand('watch', api).lines).toEqual(['beobachtet: 3']);
    expect(calls).toEqual(['overlay true', 'overlay false', 'select 1']);
    for (const c of ['obstacle', 'paths', 'select', 'watch']) expect(CONSOLE_HELP.some((l) => l.startsWith(c))).toBe(true);
  });
});
