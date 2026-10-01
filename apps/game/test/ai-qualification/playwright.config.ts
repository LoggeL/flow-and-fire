import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
const dir=dirname(fileURLToPath(import.meta.url));
let firefoxEnvironment:Record<string,string>|undefined;
if(process.platform==='darwin'){
  const home=resolve(dir,'../../../../node_modules/.cache/faf-firefox-home');mkdirSync(home,{recursive:true});
  firefoxEnvironment={};for(const [key,value] of Object.entries(process.env))if(value!==undefined)firefoxEnvironment[key]=value;
  firefoxEnvironment['CFFIXED_USER_HOME']=home;
}
export default defineConfig({testDir:dir,testMatch:'qualification.spec.ts',outputDir:resolve(dir,'../../../../test-results/ai-qualification'),
  workers:1,fullyParallel:false,retries:0,forbidOnly:true,timeout:15*60_000,reporter:[['list']],
  use:{trace:'off',screenshot:'off',viewport:{width:800,height:600}},projects:[
    {name:'chromium',use:{...devices['Desktop Chrome']}},
    {name:'firefox',use:{...devices['Desktop Firefox'],launchOptions:firefoxEnvironment===undefined?{}:{env:firefoxEnvironment}}},
    {name:'webkit',use:{...devices['Desktop Safari']}}
  ]});
