import { mkdirSync,writeFileSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBench } from '../src/bench/index.ts';
const args=process.argv.slice(2),i=args.indexOf('--out');const r=await runBench(args.includes('--quick'));const path=i>=0?resolve(args[i+1]!):fileURLToPath(new URL(`../results/bench-${new Date().toISOString().slice(0,10)}.json`,import.meta.url));mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(r,null,2)+'\n');process.stdout.write(JSON.stringify(r,null,2)+'\n');if(!Object.values(r.gates).every(Boolean))process.exitCode=1;
