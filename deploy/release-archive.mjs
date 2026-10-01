import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, readFile, readdir, readlink, rename, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const HASH = /^[A-Za-z0-9_-]{1,64}$/;
const POINTER = /^\.pointers\/[0-9a-f-]{36}$/;

function require(condition, message) {
  if (!condition) throw new Error(message);
}

async function stat(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function directory(path) {
  require((await stat(path))?.isDirectory(), `Expected a regular directory: ${path}`);
}

async function file(path) {
  require((await stat(path))?.isFile(), `Expected a regular file: ${path}`);
  return readFile(path);
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function buildHash(bytes) {
  const value = JSON.parse(bytes.toString('utf8'));
  require(typeof value.buildHash === 'string' && HASH.test(value.buildHash), 'Invalid buildHash');
  return value.buildHash;
}

/** Includes empty directories and rejects symlinks/devices rather than following them. */
async function inventory(root) {
  const files = Object.create(null), directories = [];
  async function visit(path, relative = '') {
    await directory(path);
    for (const name of (await readdir(path)).sort()) {
      const child = join(path, name), key = relative ? `${relative}/${name}` : name;
      const info = await lstat(child);
      if (info.isDirectory()) { directories.push(key); await visit(child, key); }
      else {
        require(info.isFile(), `Non-regular release entry: ${key}`);
        const hash = createHash('sha256');
        for await (const bytes of createReadStream(child)) hash.update(bytes);
        files[key] = hash.digest('hex');
      }
    }
  }
  await visit(root);
  return { files, directories };
}

function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function payload(root) {
  await directory(root);
  const json = await file(join(root, 'build.json')), hash = buildHash(json);
  const index = await file(join(root, 'index.html'));
  require(index.toString('utf8').includes(`/b/${hash}/`), 'Root index does not reference its buildHash');
  await directory(join(root, 'b'));
  const release = join(root, 'b', hash);
  const tree = await inventory(release);
  require(Object.hasOwn(tree.files, 'index.html'), 'Release index.html is missing');
  const capability = JSON.parse((await file(join(release, 'replay-capabilities.json'))).toString('utf8'));
  require(capability.buildHash === hash && capability.replayPlayer === 1 && capability.sessionTransfer === 1,
    'Release replay capabilities do not match the build');
  return { hash, release, identity: { schema: 1, buildHash: hash, ...tree,
    indexBase64: index.toString('base64'), buildJsonBase64: json.toString('base64') } };
}

function entrypoints(identity) {
  require(typeof identity.indexBase64 === 'string' && typeof identity.buildJsonBase64 === 'string', 'Missing archived entrypoints');
  const index = Buffer.from(identity.indexBase64, 'base64'), json = Buffer.from(identity.buildJsonBase64, 'base64');
  require(index.toString('base64') === identity.indexBase64 && json.toString('base64') === identity.buildJsonBase64,
    'Invalid archived entrypoint encoding');
  require(buildHash(json) === identity.buildHash && index.toString('utf8').includes(`/b/${identity.buildHash}/`),
    'Archived entrypoints do not match their build');
  return { index, json };
}

async function archivedIdentity(root, hash) {
  const path = join(root, 'b', hash);
  const identity = JSON.parse((await file(join(root, '.identities', `${hash}.json`))).toString('utf8'));
  require(identity.schema === 1 && identity.buildHash === hash, `Invalid identity for release ${hash}`);
  entrypoints(identity);
  const actual = await inventory(path);
  require(equal(actual.files, identity.files) && equal(actual.directories, identity.directories),
    `Archived release identity mismatch: ${hash}`);
  return identity;
}

async function link(path, expected) {
  const info = await stat(path);
  if (!info) { await symlink(expected, path); return; }
  require(info.isSymbolicLink(), `Refusing existing non-link entrypoint: ${path}`);
  require(await readlink(path) === expected, `Unexpected entrypoint link: ${path}`);
}

/** Verify every retained release before accepting an update; unknown old trees are not adopted. */
async function archive(root) {
  await mkdir(root, { recursive: true }); await directory(root);
  for (const name of ['b', '.pointers', '.identities']) {
    await mkdir(join(root, name), { recursive: true }); await directory(join(root, name));
  }
  const identities = new Map();
  for (const hash of (await readdir(join(root, 'b'))).sort()) {
    require(HASH.test(hash), `Invalid archived buildHash: ${hash}`);
    identities.set(hash, await archivedIdentity(root, hash));
  }
  const current = await stat(join(root, 'current'));
  if (current) {
    require(current.isSymbolicLink(), 'Current pointer must be a symlink');
    const target = await readlink(join(root, 'current'));
    require(POINTER.test(target), 'Invalid current pointer target');
    await directory(join(root, target));
    const json = await file(join(root, target, 'build.json')), hash = buildHash(json);
    const identity = identities.get(hash);
    require(identity, 'Current pointer references a missing release');
    const entries = entrypoints(identity);
    require(json.equals(entries.json) && (await file(join(root, target, 'index.html'))).equals(entries.index),
      'Current entrypoint identity mismatch');
    await link(join(root, 'index.html'), 'current/index.html');
    await link(join(root, 'build.json'), 'current/build.json');
    return { identities, currentHash: hash };
  }
  // Interrupted first initialization may have left our exact, still dangling links.
  for (const name of ['index.html', 'build.json']) {
    if (await stat(join(root, name))) await link(join(root, name), `current/${name}`);
  }
  return { identities, currentHash: null };
}

async function stage(source, root) {
  const path = join(root, `.staging-${randomUUID()}`);
  await cp(source.release, path, { recursive: true, force: false, errorOnExist: true });
  const actual = await inventory(path);
  require(equal(actual.files, source.identity.files) && equal(actual.directories, source.identity.directories),
    'Staged release differs from the image payload');
  return path;
}

/** Staging alone cannot change the served pointer; exposed for the interrupted-install contract. */
export async function stageRelease({ payloadRoot, releasesRoot }) {
  const source = await payload(resolve(payloadRoot)), root = resolve(releasesRoot);
  await archive(root);
  return { buildHash: source.hash, stagePath: await stage(source, root) };
}

export async function publishRelease({ payloadRoot, releasesRoot }) {
  const source = await payload(resolve(payloadRoot)), root = resolve(releasesRoot);
  const state = await archive(root), existing = state.identities.get(source.hash);
  if (existing) require(equal(existing, source.identity), `BuildHash collision: ${source.hash}`);
  else {
    const staged = await stage(source, root);
    const identityPath = join(root, '.identities', `${source.hash}.json`);
    // Identity precedes installation: a crash can leave an unused identity, never a
    // visible release without one. Reuse only an exact identity from that interrupted install.
    if (await stat(identityPath)) {
      require(equal(JSON.parse((await file(identityPath)).toString('utf8')), source.identity),
        `BuildHash collision in pending identity: ${source.hash}`);
    } else await writeFile(identityPath, JSON.stringify(source.identity) + '\n', { flag: 'wx' });
    // The complete payload directory becomes visible in one rename. Sidecars do not
    // add or change any file within the original /b/hash asset tree.
    // An existing nonempty release cannot be replaced by rename; no overwrite fallback exists.
    await rename(staged, join(root, 'b', source.hash));
  }
  if (state.currentHash !== source.hash) {
    const id = randomUUID(), target = `.pointers/${id}`, entries = entrypoints(source.identity);
    await mkdir(join(root, target));
    await writeFile(join(root, target, 'index.html'), entries.index, { flag: 'wx' });
    await writeFile(join(root, target, 'build.json'), entries.json, { flag: 'wx' });
    await link(join(root, 'index.html'), 'current/index.html');
    await link(join(root, 'build.json'), 'current/build.json');
    const temporary = join(root, `.current-${id}`);
    await symlink(target, temporary);
    // One pointer publishes index and build.json together, only after the release is installed.
    await rename(temporary, join(root, 'current'));
  }
  return { buildHash: source.hash, releaseInstalled: !existing, root,
    identitySha256: digest(Buffer.from(JSON.stringify(source.identity))) };
}
