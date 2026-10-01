import { afterEach, describe, expect, it } from 'vitest';
import { LOG_DIR_NAME, parseCommandLog, type HostStatusMsg } from '../src/index.ts';
import { FakeDir } from './support/fake-opfs.ts';
import { makeTestHost, type TestHost } from './support/host.ts';
import { bufferOf, spawnCmd } from './support/fixtures.ts';

const hosts: TestHost[] = [];
function host(...args: Parameters<typeof makeTestHost>): TestHost { const value=makeTestHost(...args); hosts.push(value); return value; }
afterEach(() => { for(const value of hosts) value.close(); hosts.length=0; });
async function settle(predicate: () => boolean): Promise<void> {
  for(let i=0;i<30&&!predicate();i++) await new Promise<void>(resolve=>setImmediate(resolve));
  expect(predicate()).toBe(true);
}

describe('live recording lifecycle', () => {
  it('waits for pending storage before durable END and rejects commands during close', async () => {
    const root=new FakeDir(); let resolveRoot!: (value: FakeDir) => void;
    const h=host({host:{opfs:()=>new Promise(resolve=>{resolveRoot=resolve;})}});
    h.host.submit(bufferOf([spawnCmd(0,1,100,100,0,1)])); h.host.runTicks(2);
    h.host.ctl({t:'shutdown'});
    expect(h.of('closed')).toHaveLength(0);
    h.host.submit(bufferOf([spawnCmd(0,1,120,120,0,2)]));
    expect(h.host.core.local.queued).toBe(0);
    resolveRoot(root); await settle(()=>h.of('closed').length===1);
    const file=[...root.dirs.get(LOG_DIR_NAME)!.files.values()][0]!;
    const log=parseCommandLog(file.bytes());
    expect(log.endTick).toBe(2); expect(log.truncated).toBe(false); expect(file.open).toBe(false);
  });
  it('disabling saving cancels a pending open while retaining the memory log', async () => {
    const root=new FakeDir(); let resolveRoot!: (value: FakeDir) => void;
    const h=host({host:{opfs:()=>new Promise(resolve=>{resolveRoot=resolve;})}});
    h.host.ctl({t:'recording',enabled:false}); resolveRoot(root);
    await settle(()=>(h.of('status').at(-1) as HostStatusMsg).recorderNote==='persistence disabled');
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(root.dirs.size).toBe(0);
    h.host.runTicks(3); h.host.ctl({t:'exportLog'});
    expect(parseCommandLog(new Uint8Array(h.of('log')[0]!.bytes)).endTick).toBe(3);
    h.host.ctl({t:'shutdown'}); expect(h.of('closed')).toHaveLength(1);
  });
  it('disabled initial persistence never opens OPFS; enabling it saves the existing log', async () => {
    const root=new FakeDir(); let opens=0;
    const h=host({persistentRecording:false,host:{opfs:async()=>{opens++;return root;}}});
    expect(opens).toBe(0); h.host.runTicks(4);
    h.host.ctl({t:'recording',enabled:true}); await settle(()=>(h.of('status').at(-1) as HostStatusMsg).recorder==='opfs');
    h.host.ctl({t:'shutdown'}); await settle(()=>h.of('closed').length===1);
    expect(opens).toBe(1);
    expect(parseCommandLog([...root.dirs.get(LOG_DIR_NAME)!.files.values()][0]!.bytes()).endTick).toBe(4);
  });
});

describe('applied command notifications', () => {
  it('reports an ACK only after actual command application, independent of viewer changes', () => {
    const h=host(); h.host.submit(bufferOf([spawnCmd(0,1,100,100,0,1)]));
    expect(h.of('ack')).toHaveLength(0);
    h.host.ctl({t:'viewer',army:1}); h.host.runTicks(1);
    expect(h.of('ack')).toEqual([{t:'ack',army:0,tick:1,ackSeq:1}]);
    h.host.runTicks(2); expect(h.of('ack')).toHaveLength(1);
  });
});
