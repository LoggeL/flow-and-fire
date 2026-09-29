import { describe, expect, it } from 'vitest';
import { CONSOLE_HELP, ConsoleHistory, runConsoleCommand, tokenize, type ConsoleApi } from '../src/console-commands.ts';

/** Records every API call; the console must reach the game only through this surface. */
function fakeApi(paused = false) {
  const calls: string[] = [];
  let seq = 0;
  let isPaused = paused;
  let budget = false;
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
    for (const cmd of ['spawn', 'kill', 'pause', 'resume', 'step', 'speed', 'hash', 'budget', 'export', 'transport', 'help']) {
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
