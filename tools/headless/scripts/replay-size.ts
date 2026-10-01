import { replaySizeReport, writeRtsReplay } from '@faf/formats';
import { syntheticReplayInput } from '../src/replay/size-model.ts';
const input = syntheticReplayInput();
const report = replaySizeReport(writeRtsReplay(input));
const highApm = replaySizeReport(writeRtsReplay(syntheticReplayInput({ apm: [200, 200] })));
console.log(JSON.stringify({ ...report, nonGated200Apm: highApm, cmdGate: report.byChunk['CMDS']! <= 100000, totalGate: report.total <= 250000 }, null, 2));
if (report.byChunk['CMDS']! > 100000 || report.total > 250000) process.exitCode = 1;
