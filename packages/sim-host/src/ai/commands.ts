import { decodeFactoryRepeat } from '@faf/ai';
import { asTick } from '@faf/fixed';
import { CmdFlags, Op, decodeBatch, encodeBatch, encodeFactoryQueue, type CommandEnvelope } from '@faf/protocol';

/** Converts an AI repeat plan into the game's queue and repeat-switch contract. */
export function gameAiCommands(bytes: Uint8Array, army: number, tick: number, nextSequence: () => number): Uint8Array {
  const output: CommandEnvelope[] = [];
  for (const c of decodeBatch(bytes)) {
    if (c.army !== army || c.tick !== tick || c.op === Op.Cheat) throw new RangeError('AI worker command identity mismatch');
    if (c.op === Op.FactoryRepeat) {
      const repeat = decodeFactoryRepeat(c.payload);
      repeat.items.forEach((bp,index)=>output.push({...c,tick:asTick(tick),seq:nextSequence(),op:Op.FactoryQueue,flags:index===0?c.flags&~CmdFlags.Queue:c.flags|CmdFlags.Queue,payload:encodeFactoryQueue({bp,count:1})}));
      output.push({...c,seq:nextSequence(),payload:Uint8Array.of(repeat.on?1:0)});
    } else output.push({...c,seq:nextSequence()});
  }
  return encodeBatch(output);
}
