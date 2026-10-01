import { describe, expect, it } from 'vitest';
import { readRtsReplay, readAllCommands, replaySizeReport, writeRtsReplay } from '@faf/formats';
import { syntheticReplayInput } from '../src/replay/size-model.ts';

describe('synthetic portable replay size gate', () => {
  it('preserves the full 30-minute command mix under both size budgets', () => {
    const input = syntheticReplayInput(), bytes = writeRtsReplay(input), report = replaySizeReport(bytes);
    expect(report.byChunk['CMDS']).toBeLessThanOrEqual(100000);
    expect(report.total).toBeLessThanOrEqual(250000);
    const commands = readAllCommands(readRtsReplay(bytes));
    expect(commands.length).toBe(input.commands.length);
    for (let i = 0; i < commands.length; i++) {
      expect(commands[i]!.tick).toBe(input.commands[i]!.tick);
      expect(Buffer.from(commands[i]!.batch).equals(input.commands[i]!.batch), `batch ${i}`).toBe(true);
    }
  });
});
