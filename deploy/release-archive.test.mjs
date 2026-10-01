import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { publishRelease, stageRelease } from './release-archive.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'faf-releases-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, releasesRoot: join(root, 'releases') };
}

async function image(root, hash, asset = 'original assets') {
  const path = join(root, `image-${hash}`), release = join(path, 'b', hash);
  await mkdir(join(release, 'assets'), { recursive: true });
  await mkdir(join(release, 'empty'));
  await writeFile(join(path, 'build.json'), JSON.stringify({ buildHash: hash }, null, 2) + '\n');
  await writeFile(join(path, 'index.html'), `<script>location.replace('/b/${hash}/')</script>\n`);
  await writeFile(join(release, 'index.html'), `<title>${hash}</title>`);
  await writeFile(join(release, 'replay-capabilities.json'), JSON.stringify({ buildHash: hash, replayPlayer: 1, sessionTransfer: 1 }));
  await writeFile(join(release, 'assets', 'game.js'), asset);
  return path;
}

async function tree(path, prefix = '') {
  const entries = [];
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const key = prefix + entry.name, child = join(path, entry.name);
    if (entry.isDirectory()) entries.push([key + '/', 'directory'], ...await tree(child, key + '/'));
    else if (entry.isSymbolicLink()) entries.push([key, 'link:' + await readlink(child)]);
    else entries.push([key, (await readFile(child)).toString('hex')]);
  }
  return entries;
}

async function pointer(root) {
  return { target: await readlink(join(root, 'current')), index: await readFile(join(root, 'index.html')),
    json: await readFile(join(root, 'build.json')) };
}

test('first initialization copies complete payload bytes and publishes both entrypoints', async t => {
  const { root, releasesRoot } = await fixture(t), payloadRoot = await image(root, 'first');
  const result = await publishRelease({ payloadRoot, releasesRoot });
  assert.equal(result.buildHash, 'first'); assert.equal(result.releaseInstalled, true);
  assert.deepEqual(await tree(join(releasesRoot, 'b', 'first')), await tree(join(payloadRoot, 'b', 'first')));
  assert.deepEqual(await readFile(join(releasesRoot, 'index.html')), await readFile(join(payloadRoot, 'index.html')));
  assert.deepEqual(await readFile(join(releasesRoot, 'build.json')), await readFile(join(payloadRoot, 'build.json')));
});

test('second release retains every original release byte and empty directory', async t => {
  const { root, releasesRoot } = await fixture(t), first = await image(root, 'first'), second = await image(root, 'second', 'new assets');
  await publishRelease({ payloadRoot: first, releasesRoot });
  const original = await tree(join(releasesRoot, 'b', 'first'));
  await publishRelease({ payloadRoot: second, releasesRoot });
  assert.deepEqual(await tree(join(releasesRoot, 'b', 'first')), original);
  assert.deepEqual(await tree(join(releasesRoot, 'b', 'second')), await tree(join(second, 'b', 'second')));
  assert.equal(JSON.parse(await readFile(join(releasesRoot, 'build.json'))).buildHash, 'second');
});

test('same release is idempotent with no new pointer, staging or archive writes', async t => {
  const { root, releasesRoot } = await fixture(t), payloadRoot = await image(root, 'same');
  await publishRelease({ payloadRoot, releasesRoot });
  const before = await tree(releasesRoot);
  assert.equal((await publishRelease({ payloadRoot, releasesRoot })).releaseInstalled, false);
  assert.deepEqual(await tree(releasesRoot), before);
});

test('same hash with different asset or entrypoint bytes fails without changing current', async t => {
  const { root, releasesRoot } = await fixture(t), payloadRoot = await image(root, 'same');
  await publishRelease({ payloadRoot, releasesRoot });
  const before = await tree(releasesRoot), original = await readFile(join(payloadRoot, 'b', 'same', 'assets', 'game.js'));
  await writeFile(join(payloadRoot, 'b', 'same', 'assets', 'game.js'), 'different assets');
  await assert.rejects(publishRelease({ payloadRoot, releasesRoot }), /BuildHash collision/);
  assert.deepEqual(await tree(releasesRoot), before);
  await writeFile(join(payloadRoot, 'b', 'same', 'assets', 'game.js'), original);
  await writeFile(join(payloadRoot, 'index.html'), `<a href='/b/same/'>different entrypoint</a>`);
  await assert.rejects(publishRelease({ payloadRoot, releasesRoot }), /BuildHash collision/);
  assert.deepEqual(await tree(releasesRoot), before);
});

test('malicious hashes and symlink payloads are rejected without publication', async t => {
  const { root, releasesRoot } = await fixture(t), payloadRoot = await image(root, 'safe');
  await publishRelease({ payloadRoot, releasesRoot }); const before = await tree(releasesRoot);
  for (const hash of ['../outside', '/absolute', '..', 'x/y', 'x\\y', 'x%2fy', '', 'x'.repeat(65)]) {
    await writeFile(join(payloadRoot, 'build.json'), JSON.stringify({ buildHash: hash }));
    await assert.rejects(publishRelease({ payloadRoot, releasesRoot }), /Invalid buildHash/);
  }
  await writeFile(join(payloadRoot, 'build.json'), JSON.stringify({ buildHash: 'safe' }));
  const asset = join(payloadRoot, 'b', 'safe', 'assets', 'game.js');
  await rm(asset); await symlink(join(payloadRoot, 'index.html'), asset);
  await assert.rejects(publishRelease({ payloadRoot, releasesRoot }), /Non-regular release entry/);
  assert.deepEqual(await tree(releasesRoot), before);
});

test('interrupted and partial staging never publishes and is not adopted on the next start', async t => {
  const { root, releasesRoot } = await fixture(t), first = await image(root, 'first'), second = await image(root, 'second');
  await publishRelease({ payloadRoot: first, releasesRoot }); const before = await pointer(releasesRoot);
  const staged = await stageRelease({ payloadRoot: second, releasesRoot });
  await rm(join(staged.stagePath, 'assets', 'game.js')); // interrupted copy: real incomplete filesystem state
  assert.deepEqual(await pointer(releasesRoot), before);
  await assert.rejects(readFile(join(releasesRoot, 'b', 'second', 'index.html')), { code: 'ENOENT' });
  await publishRelease({ payloadRoot: second, releasesRoot });
  assert.deepEqual(await tree(join(releasesRoot, 'b', 'second')), await tree(join(second, 'b', 'second')));
  assert.deepEqual(await tree(join(releasesRoot, 'b', 'first')), await tree(join(first, 'b', 'first')));
});

test('retained release corruption rejects later updates and preserves current pointer', async t => {
  const { root, releasesRoot } = await fixture(t), first = await image(root, 'first'), second = await image(root, 'second');
  await publishRelease({ payloadRoot: first, releasesRoot }); const before = await pointer(releasesRoot);
  await writeFile(join(releasesRoot, 'b', 'first', 'assets', 'game.js'), 'corrupted');
  await assert.rejects(publishRelease({ payloadRoot: second, releasesRoot }), /Archived release identity mismatch/);
  assert.deepEqual(await pointer(releasesRoot), before);
});

test('real archive-only CLI imports an old image payload without starting a server', async t => {
  const { root, releasesRoot } = await fixture(t), payloadRoot = await image(root, 'af8a6a3f88d6');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./start.mjs', import.meta.url)),
    '--archive-only', '--payload', payloadRoot, '--releases', releasesRoot], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"buildHash":"af8a6a3f88d6"/);
  assert.deepEqual(await tree(join(releasesRoot, 'b', 'af8a6a3f88d6')), await tree(join(payloadRoot, 'b', 'af8a6a3f88d6')));
});
