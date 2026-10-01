import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const dir=dirname(fileURLToPath(import.meta.url)),root=resolve(dir,'../../../..'),out=resolve(dir,'../../dist-ai-qualification');
function sourceFiles(path:string):string[]{return readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?sourceFiles(resolve(path,entry.name)):entry.name.endsWith('.ts')?[resolve(path,entry.name)]:[]);}
export default defineConfig({root:dir,base:'/',worker:{format:'es'},build:{outDir:out,emptyOutDir:true,target:'es2022',sourcemap:true},
  plugins:[{name:'qualification-provenance',closeBundle(){
    const files=['ai','blueprints','fixed','formats','heap','nav','protocol','rules','sim','sim-host'].flatMap(name=>sourceFiles(resolve(root,'packages',name,'src')));
    files.push(resolve(root,'content/generated/sim.bin'),resolve(root,'content/maps/setons.rtsmap'));
    files.push(resolve(dir,'../support/silent-output.ts'));
    files.push(...sourceFiles(dir).filter(file=>!file.endsWith('.spec.ts')));
    const hashes=Object.fromEntries(files.sort().map(file=>[relative(root,file),createHash('sha256').update(readFileSync(file)).digest('hex')]));
    writeFileSync(resolve(out,'qualification-build.json'),JSON.stringify({hashes},null,2)+'\n');
  }}]});
