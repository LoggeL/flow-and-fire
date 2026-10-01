import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publishRelease } from './release-archive.mjs';

const options = { payloadRoot: '/app/payload', releasesRoot: '/app/releases', archiveOnly: false };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--archive-only') options.archiveOnly = true;
  else if ((args[i] === '--payload' || args[i] === '--releases') && args[i + 1]) {
    options[args[i] === '--payload' ? 'payloadRoot' : 'releasesRoot'] = args[++i];
  } else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
}

const published = await publishRelease(options);
console.log(`release-archive: ${JSON.stringify(published)}`);
if (!options.archiveOnly) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)),
    '--root', published.root, '--host', '0.0.0.0', '--port', '8080', '--coi'], { stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
