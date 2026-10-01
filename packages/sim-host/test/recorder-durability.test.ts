import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandLogRecorder, HeadlessSim, OpfsLogSink, parseCommandLog, type LogSink } from '../src/index.ts';
import { gameSimBin } from './support/fixtures.ts';

afterEach(() => vi.useRealTimers());
describe('wall-clock recorder durability', () => {
  it('persists exactly one END on normal exit, while a detached crash log remains recoverable', () => {
    const sim = new HeadlessSim({ simBin: gameSimBin(), seed: 1, armyCount: 2, keyframes: false });
    const recorder = sim.recorder!;
    let working = new Uint8Array(0), durable = new Uint8Array(0), closes = 0;
    const sink: LogSink = { kind: 'opfs', name: 'normal-exit',
      write(bytes, offset, length, at) { const next = new Uint8Array(at + length); next.set(working.subarray(0, at)); next.set(bytes.subarray(offset, offset + length), at); working = next; },
      truncate(size) { working = working.slice(0, size); }, flush() { durable = working.slice(); }, close() { closes++; } };
    recorder.attachSink(sink); recorder.hash(10, 23);
    expect(parseCommandLog(working).endTick).toBe(-1);
    recorder.finish(15); recorder.finish(20);
    const completed = parseCommandLog(durable);
    expect(completed.endTick).toBe(15); expect(completed.truncated).toBe(false); expect(closes).toBe(1);
    expect(new Uint8Array(recorder.export(30))).toEqual(durable);
    expect(() => recorder.hash(16, 24)).toThrow('finished');
    const crash = new CommandLogRecorder(recorder.header); crash.hash(10, 23); crash.close();
    expect(parseCommandLog(crash.bytes).endTick).toBe(-1);
  });
  it('flushes sparse or paused recordings every five seconds and cancels flushes on detach', () => {
    vi.useFakeTimers();
    const source = new HeadlessSim({ simBin: gameSimBin(), seed: 1, armyCount: 2, keyframes: false });
    const recorder = new CommandLogRecorder(source.recorder!.header);
    let working = new Uint8Array(0), durable = new Uint8Array(0), flushes = 0;
    const sink: LogSink = { kind: 'opfs', name: 'durability',
      write(bytes, offset, length, at) { const next = new Uint8Array(Math.max(working.length, at + length)); next.set(working); next.set(bytes.subarray(offset, offset + length), at); working = next; },
      truncate(size) { working = working.slice(0, size); }, flush() { durable = working.slice(); flushes++; }, close() {} };
    expect(recorder.attachSink(sink)).toBe(true);
    recorder.hash(10, 0x1234); vi.advanceTimersByTime(4999); expect(parseCommandLog(durable).hashes).toHaveLength(0);
    vi.advanceTimersByTime(1); expect(parseCommandLog(durable).hashes).toEqual([{ tick: 10, hash: 0x1234 }]);
    vi.advanceTimersByTime(10000); expect(flushes).toBe(4);
    recorder.detachSink(); const closedFlushes = flushes; vi.advanceTimersByTime(20000); expect(flushes).toBe(closedFlushes);
    source.recorder!.close();
  });
  it('records real flush failure, keeps the in-memory prefix and stops using the failed sink', () => {
    vi.useFakeTimers(); const sim = new HeadlessSim({ simBin: gameSimBin(), seed: 1, armyCount: 2, keyframes: false }), recorder = sim.recorder!;
    let fail = false, calls = 0;
    const sink: LogSink = { kind: 'opfs', name: 'broken', write() {}, truncate() {}, close() {}, flush() { calls++; if (fail) throw new Error('disk flush failed'); } };
    recorder.attachSink(sink); recorder.hash(10, 23); fail = true; vi.advanceTimersByTime(5000);
    expect(recorder.sinkError).toBe('disk flush failed'); expect(recorder.storage).toBe('memory');
    expect(parseCommandLog(recorder.bytes).hashes).toEqual([{ tick: 10, hash: 23 }]);
    const before = calls; vi.advanceTimersByTime(20000); expect(calls).toBe(before); recorder.close();
  });
  it('closes the actual sync access handle even when the final flush throws', () => {
    let closes = 0;
    const sink = new OpfsLogSink('flush-error', { write: (bytes) => bytes.length, truncate() {},
      flush() { throw new Error('disk flush failed'); }, close() { closes++; } });
    expect(() => sink.close()).toThrow('disk flush failed'); expect(closes).toBe(1);
    sink.close(); expect(closes).toBe(1);
  });
});
