import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { deflateRawSync } from 'node:zlib';
import { COMMAND_BATCH_VERSION, CommandBatchEncoder, Op } from '@faf/protocol';
import { FormatError, writeContainer, readRtsReplay, readAllCommands, rewriteRtsReplay, writeRtsReplay, RtsReplayBuilder, ReplayFlags, type RtsReplayInput } from '../src/index.ts';

import { encodeMeta } from '../src/rtsreplay/meta.ts';
import { cmdsBlockRaw } from '../src/rtsreplay/cmds.ts';

function fixture(ticks: readonly number[] = [1, 599, 600, 1201]): RtsReplayInput {
  const alliances = new Uint8Array(32); for (let i = 0; i < 16; i++) { const bit = 17 * i; alliances[bit >>> 3]! |= 1 << (bit & 7); }
  const enc = new CommandBatchEncoder(4096);
  return { head: { formatVersion: 1, simBuild: 'test', buildHash: 'build', simId: 1, bpSimHash: 2, mapSimHash: 3, layoutHash: 4,
    protocolVersion: COMMAND_BATCH_VERSION, hashInterval: 10, subHashInterval: 100, flags: ReplayFlags.Complete, sourceLogVersion: 2 },
    game: { seed: 5, mapName: 'map', mapSizeWu: 512, playerArmy: 0, armies: [{ index: 0, kind: 0, team: 0, aixPermille: 1000, name: 'α', aiProfile: '', faction: 'core' }], alliances },
    commands: ticks.map((tick, seq) => { enc.reset(); enc.addRaw(tick, 0, seq, Op.Stop, 0, [1, 3, 5], new Uint8Array(0), 0, 0); return { tick, batch: enc.view().slice() }; }),
    hashes: { interval: 10, firstTick: 10, hashes: Uint32Array.of(0x12345678), subInterval: 100, subFirstTick: 100, regionNames: ['world', 'units'], subHashes: Uint32Array.of(123, 456) },
    marks: [], meta: { durationTicks: 1800, endTick: 1800, players: [{ army: 0, name: 'α' }], result: { winner: -1, reason: 'test' }, stats: { z: 2, a: 1 }, extra: { z: 'last', a: 'first' } },
    extraChunks: [{ id: 'FUTR', data: Uint8Array.of(9, 8, 7) }] };
}
describe('.rtsreplay format', () => {
  it('roundtrips a thousand streams across block boundaries', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 1800 }), { maxLength: 30 }), (values) => {
      const input = fixture(values.sort((a, b) => a - b)), bytes = writeRtsReplay(input), r = readRtsReplay(bytes);
      expect(readAllCommands(r)).toEqual(input.commands); expect(r.head).toEqual(input.head); expect(r.game).toEqual(input.game);
      expect(r.hashes).toEqual(input.hashes); expect(r.meta).toEqual(input.meta); expect(r.unknown[0]!.data).toEqual(Uint8Array.of(9, 8, 7));
      expect(rewriteRtsReplay(r)).toEqual(bytes);
    }), { seed: 9029, numRuns: 1000 });
  }, 30000);
  it('incremental writer is byte-identical to the canonical writer', () => {
    const input = fixture(); const b = new RtsReplayBuilder(input.head, input.game, { regionNames: input.hashes.regionNames });
    for (const c of input.commands) b.commands(c.tick, c.batch);
    b.hash(10, 0x12345678); b.subHashes(100, Uint32Array.of(123, 456));
    const { extraChunks: _extra, ...plain } = input;
    expect(b.finish(input.meta)).toEqual(writeRtsReplay(plain));
  });
  it('handles ten thousand arbitrary or damaged inputs with FormatError', () => {
    const valid = writeRtsReplay(fixture());
    fc.assert(fc.property(fc.uint8Array({ maxLength: 1000 }), (data) => {
      try { readRtsReplay(data); throw new Error('random bytes accepted'); } catch (e) { expect(e).toBeInstanceOf(FormatError); }
    }), { seed: 9902, numRuns: 10000 });
    for (let i = 0; i < valid.length; i += 17) {
      const damaged = valid.slice(); damaged[i]! ^= 0x80;
      expect(() => readRtsReplay(damaged)).toThrow(FormatError);
    }
    for (let i = 0; i < valid.length; i += 19) expect(() => readRtsReplay(valid.slice(0, i))).toThrow(FormatError);
    for (let i = 1; i <= 32; i++) {
      const extended = new Uint8Array(valid.length + i); extended.set(valid);
      expect(() => readRtsReplay(extended)).toThrowError(expect.objectContaining({ code: 'trailing-bytes' }));
    }
  }, 30000);
  it('fuzzes ten thousand CRC-correct containers with junk in every known chunk', () => {
    const chunks = readRtsReplay(writeRtsReplay(fixture())).chunks;
    fc.assert(fc.property(fc.constantFrom('HEAD', 'GAME', 'CMDS', 'HASH', 'MARK', 'META'),
      fc.uint8Array({ maxLength: 128 }), (id, junk) => {
        const payload = new Uint8Array(junk.length + 2); payload[0] = 1; payload.set(junk, 2);
        let replaced = false;
        const bytes = writeContainer('RTSR', 1, chunks.map(c => {
          if (c.id !== id || replaced) return c;
          replaced = true; return { id, data: payload };
        }));
        let replay;
        try { replay = readRtsReplay(bytes); readAllCommands(replay); }
        catch (error) { expect(error).toBeInstanceOf(FormatError); return; }
        expect(rewriteRtsReplay(replay)).toEqual(bytes);
      }), { seed: 9903, numRuns: 10000 });
  }, 30000);
  it.each([
    ['HEAD', 32, 2, 0xffff], ['GAME', 8, 1, 17], ['HASH', 8, 4, 0xffffffff],
    ['MARK', 2, 4, 0xffffffff], ['CMDS', 8, 4, 601], ['CMDS', 12, 4, 16 * 1024 * 1024 + 1],
  ] as const)('rejects CRC-correct %s length/count corruption at offset %i', (id, offset, width, value) => {
    const chunks = readRtsReplay(writeRtsReplay(fixture())).chunks;
    let replaced = false;
    const bytes = writeContainer('RTSR', 1, chunks.map(c => {
      if (c.id !== id || replaced) return c;
      replaced = true; const data = c.data.slice(), view = new DataView(data.buffer);
      if (width === 1) view.setUint8(offset, value);
      else if (width === 2) view.setUint16(offset, value, true);
      else view.setUint32(offset, value, true);
      return { id, data };
    }));
    expect(() => readRtsReplay(bytes)).toThrow(FormatError);
    expect(() => readRtsReplay(bytes, { verifyBlocks: false })).toThrow(FormatError);
  });
  it.each(['HEAD', 'GAME', 'CMDS', 'HASH', 'MARK', 'META'])('rejects future %s chunk versions with a valid CRC', (id) => {
    const chunks = readRtsReplay(writeRtsReplay(fixture())).chunks;
    let replaced = false;
    const bytes = writeContainer('RTSR', 1, chunks.map(c => {
      if (c.id !== id || replaced) return c;
      replaced = true; const data = c.data.slice(); new DataView(data.buffer).setUint16(0, 0xffff, true);
      return { id, data };
    }));
    expect(() => readRtsReplay(bytes)).toThrowError(expect.objectContaining({ code: 'unsupported-version', chunkId: id }));
  });
  it('rejects future format/envelope versions and preserves unknown chunks between blocks', () => {
    const replay = readRtsReplay(writeRtsReplay(fixture()));
    expect(() => readRtsReplay(writeContainer('RTSR', 2, replay.chunks)))
      .toThrowError(expect.objectContaining({ code: 'unsupported-version' }));
    const futureEnvelope = writeContainer('RTSR', 1, replay.chunks);
    new DataView(futureEnvelope.buffer).setUint16(4, 2, true);
    expect(() => readRtsReplay(futureEnvelope)).toThrowError(expect.objectContaining({ code: 'bad-container-version' }));
    const chunks = [...replay.chunks]; chunks.splice(3, 0, { id: 'XTRA', data: Uint8Array.of(1, 2, 3), offset: -1 });
    const bytes = writeContainer('RTSR', 1, chunks), roundtrip = readRtsReplay(bytes);
    expect(roundtrip.chunks[2]!.id).toBe('CMDS'); expect(roundtrip.chunks[3]!.id).toBe('XTRA');
    expect(roundtrip.chunks[4]!.id).toBe('CMDS'); expect(readAllCommands(roundtrip)).toEqual(fixture().commands);
    expect(rewriteRtsReplay(roundtrip)).toEqual(bytes);
  });
  it('reads native zlib and CompressionStream command blocks byte-exactly', async () => {
    const input = fixture(), replay = readRtsReplay(writeRtsReplay(input));
    const raw = cmdsBlockRaw(replay.blocks[0]!);
    const webStream = new Blob([new Uint8Array(raw)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const compressed = [new Uint8Array(deflateRawSync(raw)), new Uint8Array(await new Response(webStream).arrayBuffer())];
    for (const payload of compressed) {
      let replaced = false;
      const chunks = replay.chunks.map(c => {
        if (c.id !== 'CMDS' || replaced) return c;
        replaced = true; const data = new Uint8Array(16 + payload.length);
        data.set(c.data.subarray(0, 16)); data[2] = 1; data.set(payload, 16); return { id: c.id, data };
      });
      const bytes = writeContainer('RTSR', 1, chunks), decoded = readRtsReplay(bytes);
      expect(readAllCommands(decoded)).toEqual(input.commands); expect(rewriteRtsReplay(decoded)).toEqual(bytes);
    }
  });
  it('rejects a CRC-correct deflate stream that expands beyond its command rawLength', () => {
    const replay = readRtsReplay(writeRtsReplay(fixture()));
    const payload = new Uint8Array(deflateRawSync(new Uint8Array(32 * 1024)));
    let replaced = false;
    const chunks = replay.chunks.map(c => {
      if (c.id !== 'CMDS' || replaced) return c;
      replaced = true; const data = new Uint8Array(16 + payload.length);
      data.set(c.data.subarray(0, 16)); data[2] = 1; new DataView(data.buffer).setUint32(12, 1, true);
      data.set(payload, 16); return { id: c.id, data };
    });
    expect(() => readRtsReplay(writeContainer('RTSR', 1, chunks))).toThrow(FormatError);
  });
  it.each(['command', 'hash', 'subhash', 'mark'] as const)('rejects META that hides a later %s', (kind) => {
    const base = fixture(kind === 'command' ? [1201] : [1]);
    const input: RtsReplayInput = { ...base,
      hashes: { ...base.hashes, ...(kind === 'hash' ? { firstTick: 2000 } : {}), ...(kind === 'subhash' ? { subFirstTick: 2000 } : {}) },
      marks: kind === 'mark' ? [{ tick: 2000, kind: 1, value: 0 }] : [],
      meta: { ...base.meta!, endTick: 2100, durationTicks: 2100 } };
    const short = { ...input.meta!, endTick: kind === 'command' ? 1199 : 1999 };
    expect(() => writeRtsReplay({ ...input, meta: short })).toThrow(FormatError);
    const valid = readRtsReplay(writeRtsReplay(input));
    const malicious = writeContainer('RTSR', 1, valid.chunks.map(c => c.id === 'META' ? { id: c.id, data: encodeMeta(short) } : c));
    expect(() => readRtsReplay(malicious)).toThrow(FormatError);
    expect(() => readRtsReplay(malicious, { verifyBlocks: false })).toThrow(FormatError);
    const builder = new RtsReplayBuilder(input.head, input.game, { regionNames: input.hashes.regionNames });
    for (const c of input.commands) builder.commands(c.tick, c.batch);
    builder.hash(input.hashes.firstTick, input.hashes.hashes[0]!);
    builder.subHashes(input.hashes.subFirstTick, input.hashes.subHashes);
    for (const mark of input.marks) builder.mark(mark.tick, mark.kind, mark.value);
    expect(() => builder.finish(short)).toThrow(FormatError);
  });
  it('rejects inconsistent taint, duplicate known chunks and unsafe metadata', () => {
    const input = fixture();
    expect(() => writeRtsReplay({ ...input, marks: [{ tick: 1, kind: 4, value: 0 }] })).toThrow(FormatError);
    expect(() => writeRtsReplay({ ...input, extraChunks: [{ id: 'HEAD', data: new Uint8Array() }] })).toThrow(FormatError);
    expect(() => writeRtsReplay({ ...input, meta: { ...input.meta!, stats: { bad: 0.1 } } })).toThrow(FormatError);
  });
});
