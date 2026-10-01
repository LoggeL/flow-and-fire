import { BrowserReplayHost, convertCommandLog, listRecordedLogs, opfsRoot, parseCommandLog, readLogFile } from '@faf/sim-host';
import { mapSimHash, readRtsMap, readRtsReplay } from '@faf/formats';
import type { PortLike } from '@faf/protocol';
import type { ReplayTaskRequest } from './library.ts';

const scope = globalThis as unknown as PortLike;
let host: BrowserReplayHost | null = null;
scope.addEventListener('message', (event) => {
  const data = (event as { data: unknown }).data;
  if (typeof data !== 'object' || data === null) return;
  if ((data as { t?: string }).t === 'replay-task') {
    void task(data as ReplayTaskRequest); return;
  }
  if ((data as { t?: string }).t === 'replay-load' && host === null) host = new BrowserReplayHost({ port: scope });
  host?.handleMessage(data);
});

async function task(req: ReplayTaskRequest): Promise<void> {
  try {
    let value: unknown;
    switch (req.kind) {
      case 'list': {
        const root = await opfsRoot();
        if (root === null) throw new Error('OPFS is unavailable in this browser');
        const files = [];
        for (const name of (await listRecordedLogs(root)).reverse()) {
          try {
            const bytes = await readLogFile(root, name), log = parseCommandLog(bytes);
            files.push({ name, bytes: bytes.length, endTick: log.lastTick, complete: log.endTick >= 0,
              tainted: log.tainted, buildHash: log.header.buildHash, mapSimHash: log.header.mapSimHash, mapSizeWu: log.header.mapSizeWu, error: null });
          } catch (error) {
            files.push({ name, bytes: 0, endTick: 0, complete: false, tainted: false, buildHash: '', mapSimHash: 0, mapSizeWu: 0,
              error: error instanceof Error ? error.message : String(error) });
          }
        }
        value = files; break;
      }
      case 'export': case 'convert': {
        let bytes: Uint8Array;
        if (req.kind === 'export') {
          const root = await opfsRoot(); if (root === null) throw new Error('OPFS is unavailable in this browser');
          bytes = await readLogFile(root, req.name);
        } else bytes = new Uint8Array(req.bytes);
        const header = parseCommandLog(bytes).header;
        if (mapSimHash(readRtsMap(new Uint8Array(req.map))) !== header.mapSimHash)
          throw new Error(`Recorded map 0x${header.mapSimHash.toString(16)} is unavailable. Load the matching map before exporting this recording.`);
        const converted = convertCommandLog(bytes, { simBin: new Uint8Array(req.simBin), map: new Uint8Array(req.map) });
        value = { bytes: converted.bytes, verified: converted.verified, warnings: converted.warnings, truncated: converted.truncatedSource,
          endTick: converted.input.meta?.endTick ?? 0, mismatches: converted.mismatches }; break;
      }
      case 'inspect': {
        const replay = readRtsReplay(new Uint8Array(req.bytes));
        value = { head: replay.head, game: replay.game, meta: replay.meta }; break;
      }
    }
    const transfer = typeof value === 'object' && value !== null && 'bytes' in value && value.bytes instanceof Uint8Array
      ? [value.bytes.buffer as ArrayBuffer] : [];
    scope.postMessage({ t: 'replay-task-result', id: req.id, value }, transfer);
  } catch (error) {
    scope.postMessage({ t: 'replay-task-result', id: req.id, error: error instanceof Error ? error.message : String(error) }, []);
  }
}
