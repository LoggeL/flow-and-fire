import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { installSilentOutput, assertSilentOutput } from '../support/silent-output.ts';
import { p95, type Mode, type QualificationResult, type RunRequest } from './contract.ts';
import { runHeadlessDeterminism } from './headless.ts';
import { startFrozenServer, type FrozenServer } from './frozen-server.ts';

const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../../..'),dist=resolve(dir,'../../dist-ai-qualification');
const test=base.extend<{silentOutput:void},{frozenServer:FrozenServer}>({
  frozenServer:[async({browserName:_browserName},use)=>{
    const server=await startFrozenServer(dist);
    try{await use(server);}finally{await server.close();}
  },{scope:'worker'}],
  silentOutput:[async({page,frozenServer},use,info)=>{
    await installSilentOutput(page);
    try{await use();}finally{
      await receipt(info,'frozen-server-requests.json',frozenServer.receipt());
      if(page.url().startsWith(frozenServer.origin+'/'))await assertSilentOutput(page);
    }
  },{auto:true}]
});
function verifyFrozenBuild():unknown {
  const receipt=JSON.parse(readFileSync(resolve(dist,'qualification-build.json'),'utf8')) as {hashes:Record<string,string>};
  for(const [file,sha] of Object.entries(receipt.hashes))expect(createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex'),`Live source differs from frozen harness: ${file}`).toBe(sha);
  return receipt;
}
async function open(page:Page,server:FrozenServer){
  await page.goto(server.origin+'/');
  await page.waitForFunction(()=>typeof (window as unknown as {__fafAiQualification?:unknown}).__fafAiQualification==='object');
  expect(await page.evaluate(()=>crossOriginIsolated),'Frozen HTTP origin must retain COOP/COEP isolation').toBe(true);
  // A silent sink canary validates the guard even though this harness has no audio producers.
  await page.evaluate(async()=>{const context=new AudioContext();await context.close();});
  await assertSilentOutput(page);
}
async function run(page:Page,request:RunRequest){
  return page.evaluate(request=>(window as unknown as {__fafAiQualification:{run:(request:RunRequest)=>Promise<QualificationResult>}}).__fafAiQualification.run(request),request);
}
async function receipt(info:TestInfo,name:string,data:unknown){await info.attach(name,{body:Buffer.from(JSON.stringify(data,null,2)),contentType:'application/json'});}
function nativeGate(result:QualificationResult,mode:Mode,worker=true){
  expect(result.error).toBeNull();expect(result.tick).toBe(result.target);expect(result.mode).toBe(mode);
  expect(result.simBuild).toBe('faf-sim/ms6.1-upgrades');expect(result.simHash).toBe(0x8321662b);
  expect(result.mapName.toLowerCase()).toBe('setons');expect(result.seed).toBe(7);expect(result.speed).toBe(3);
  expect(result.tickUs).toHaveLength(result.target);
  expect(result.tickUs.every(value=>Number.isFinite(value)&&value>=0)).toBe(true);
  expect(result.ai).not.toBeNull();const ai=result.ai!;
  expect(ai.armies).toHaveLength(2);expect(ai.monotonic).toBe(true);expect(ai.waitIdsDropped).toBe(0);
  expect(new Set(ai.waitingTickIds).size).toBe(ai.distinctWaitingTicks);
  expect(ai.waitingTickIds.every(tick=>tick>0&&tick<=result.tick)).toBe(true);
  for(const army of ai.armies){
    expect(army.execution).toBe(worker?'worker':'inline');expect(army.error).toBeNull();expect(army.timeouts).toBe(0);
    expect(army.thinks).toBeGreaterThan(0);expect(army.budget.measured).toBe(army.thinks);
    expect(army.budget.missingTiming).toBe(0);expect(army.budget.dropped).toBe(0);
    expect(army.budget.opsP99).not.toBeNull();expect(army.budget.opsP99!).toBeLessThanOrEqual(army.opsCap);
    expect(army.budget.opsMax).toBeLessThanOrEqual(army.opsCap);
  }
  if(worker){expect(result.hardwareConcurrency).toBeGreaterThan(2);expect(result.policyOverride).toBeNull();}
}

test('production scheduler: distinct waiting ticks below 1 percent at 3x',async({page,frozenServer},info)=>{
  await receipt(info,'frozen-build.json',verifyFrozenBuild());await open(page,frozenServer);
  const result=await run(page,{mode:'scheduler'});await receipt(info,'scheduler-native.json',result);
  nativeGate(result,'scheduler');expect(result.target).toBe(3000);
  expect(result.ai!.distinctWaitingTicks/result.tick).toBeLessThan(.01);
  for(const army of result.ai!.armies){expect(army.difficulty).toBe('normal');expect(army.budget.thinkP95Ms).not.toBeNull();expect(army.budget.thinkP95Ms!).toBeLessThanOrEqual(8);}
});

test('dual Hard 2x300: real result op budgets, no aborts, same-command no-AI Sim p95 within 2 percent',async({page,frozenServer},info)=>{
  await receipt(info,'frozen-build.json',verifyFrozenBuild());await open(page,frozenServer);
  const ai=await run(page,{mode:'budget'});await receipt(info,'hard-native.json',ai);
  const replay=await run(page,{mode:'budget',replay:ai.commands,replayLog:ai.log});await receipt(info,'hard-no-ai-same-command-native.json',replay);
  const aiP95Us=p95(ai.tickUs),noAiP95Us=p95(replay.tickUs),relativeDelta=(aiP95Us-noAiP95Us)/noAiP95Us;
  await receipt(info,'hard-p95-gate.json',{aiP95Us,noAiP95Us,relativeDelta,absoluteLimit:.02,measurement:'production TimingProbe direct whole Sim step, excludes sources and scheduler retries'});
  nativeGate(ai,'budget');expect(ai.unitsAfterSpawn).toEqual([300,300]);expect(ai.initialization.rules!.unitCap).toBe(1000);
  for(const army of ai.ai!.armies)expect(army.difficulty).toBe('hard');
  expect(replay.error).toBeNull();expect(replay.tick).toBe(600);expect(replay.speed).toBe(3);expect(replay.ai).toBeNull();
  expect(replay.unitsAfterSpawn).toEqual([300,300]);expect(replay.commands).toEqual(ai.commands);
  expect(replay.hashes).toEqual(ai.hashes);expect(replay.finalRuleHash).toBe(ai.finalRuleHash);expect(replay.finalFullHash).toBe(ai.finalFullHash);
  expect(Math.abs(relativeDelta)).toBeLessThanOrEqual(.02);
});

test('Seed 7 Setons 6000 ticks: native child workers and synchronous Node AiHost command bytes and hashes agree',async({page,frozenServer},info)=>{
  await receipt(info,'frozen-build.json',verifyFrozenBuild());await open(page,frozenServer);
  const browser=await run(page,{mode:'determinism'});await receipt(info,'determinism-native-browser.json',browser);
  // Strictly after the browser workload ends. This must not contend with its timing samples.
  const node=runHeadlessDeterminism(new Uint8Array(readFileSync(resolve(root,'content/generated/sim.bin'))),new Uint8Array(readFileSync(resolve(root,'content/maps/setons.rtsmap'))));
  await receipt(info,'determinism-real-node.json',node);verifyFrozenBuild();nativeGate(browser,'determinism');
  expect(node.tick).toBe(6000);expect(node.timeoutMs).toBe(200);for(const army of node.ai)expect(army.timeouts).toBe(0);
  expect(browser.commands.length).toBeGreaterThan(0);expect(browser.commands).toEqual(node.commands);
  expect(browser.hashes.filter(entry=>entry.tick%600===0)).toHaveLength(10);
  expect(browser.hashes).toEqual(node.hashes);expect(browser.finalRuleHash).toBe(node.finalRuleHash);expect(browser.finalFullHash).toBe(node.finalFullHash);
});

test('two-core capability policy executes the same real brain inline and records its route separately',async({page,frozenServer},info)=>{
  await receipt(info,'frozen-build.json',verifyFrozenBuild());await open(page,frozenServer);
  const result=await run(page,{mode:'inline'});await receipt(info,'inline-native.json',result);
  nativeGate(result,'inline',false);expect(result.policyOverride).toBe(2);
  for(const army of result.ai!.armies)expect(army.hardwareConcurrency).toBe(2);
  expect(result.ai!.distinctWaitingTicks/result.tick).toBeLessThan(.01);
});
