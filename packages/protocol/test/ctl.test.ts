import { describe, expect, it } from 'vitest';
import {
  MAX_WATCH,
  parseCmdMessage,
  parseCtlMessage,
  parseInitMessage,
  parseMainToHostMessage,
  permilleToSpeed,
  speedToPermille,
  type CtlMessage,
  type HostMessage,
  type InitMessage,
} from '../src/index.ts';

describe('ctl messages', () => {
  it('accepts every well-formed ctl message and survives structured clone', () => {
    const msgs: CtlMessage[] = [
      { t: 'pause' },
      { t: 'resume' },
      { t: 'speed', speed: 2 },
      { t: 'step', ticks: 1 },
      { t: 'viewer', army: -1 },
      { t: 'viewer', army: 15 },
      { t: 'watch', handles: [0, 0xffffffff] },
      { t: 'debug', flags: 5 },
      { t: 'devReload' },
      { t: 'exportLog' },
    ];
    for (const m of msgs) {
      const c = structuredClone(m);
      expect(parseCtlMessage(c)).toEqual(m);
      expect(parseMainToHostMessage(c)).toEqual(m);
    }
  });

  it('rejects malformed ctl messages', () => {
    const bad: unknown[] = [
      null,
      42,
      { t: 'nope' },
      { t: 'speed', speed: Number.NaN },
      { t: 'step', ticks: 0 },
      { t: 'step', ticks: 1.5 },
      { t: 'viewer', army: 16 },
      { t: 'viewer', army: -2 },
      { t: 'watch', handles: new Array(MAX_WATCH + 1).fill(0) },
      { t: 'watch', handles: [-1] },
      { t: 'debug', flags: -1 },
    ];
    for (const b of bad) expect(parseCtlMessage(b)).toBeNull();
  });

  it('speed is clamped to 0.25–3 and carried as permille', () => {
    expect(speedToPermille(1)).toBe(1000);
    expect(speedToPermille(0.1)).toBe(250);
    expect(speedToPermille(10)).toBe(3000);
    expect(speedToPermille(1.5)).toBe(1500);
    expect(speedToPermille(Number.POSITIVE_INFINITY)).toBe(1000);
    expect(permilleToSpeed(250)).toBe(0.25);
  });

  it('init / cmd validation', () => {
    const init: InitMessage = {
      t: 'init',
      simBin: new ArrayBuffer(8),
      seed: 123,
      armyCount: 2,
      playerArmy: 0,
      transport: 'transfer',
      frameCapacity: 4096,
      buildHash: 'abc',
    };
    expect(parseInitMessage(init)).toBe(init);
    expect(parseMainToHostMessage(init)).toBe(init);
    expect(parseInitMessage({ ...init, transport: 'sab' })).toBeNull();
    expect(parseInitMessage({ ...init, transport: 'sab', frameSab: new SharedArrayBuffer(64) })).not.toBeNull();
    expect(parseInitMessage({ ...init, armyCount: 0 })).toBeNull();
    const cmd = { t: 'cmd', batch: new ArrayBuffer(3) };
    expect(parseCmdMessage(cmd)).toBe(cmd);
    expect(parseCmdMessage({ t: 'cmd', batch: new Uint8Array(3) })).toBeNull();
  });

  it('host messages are plain structured-clonable data', () => {
    const msgs: HostMessage[] = [
      { t: 'ready', simId: 1, layoutHash: 2, transport: 'sab' },
      { t: 'status', tick: 10, paused: false, speed: 1, ticksBehind: 0 },
      { t: 'stats', tickP50Us: 100, tickP95Us: 200, hashTickP95Us: 50, phases: [{ id: 1, name: 'Movement', p50Us: 5, p95Us: 9 }] },
      { t: 'log', bytes: new ArrayBuffer(4) },
      { t: 'error', message: 'x' },
    ];
    for (const m of msgs) expect(structuredClone(m)).toEqual(m);
  });
});
