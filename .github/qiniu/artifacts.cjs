const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');

const PLATFORMS = [
  { platform: 'windows-x64', zip: 'Neuink-windows-x64-portable.zip', info: 'build-info.json', sums: 'SHA256SUMS.txt' },
  ...['arm64', 'x64'].map(arch => ({ platform: `macos-${arch}`, zip: `Neuink-macos-${arch}.app.zip`, info: `Neuink-macos-${arch}-build-info.json`, sums: `Neuink-macos-${arch}-SHA256SUMS.txt` })),
];
const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;

function releaseFiles(release, tag) {
  if (!TAG_PATTERN.test(tag) || release.tag_name !== tag || release.draft || !release.published_at) {
    throw new Error('Expected a published versioned GitHub Release');
  }
  const names = release.assets.map(asset => asset.name);
  if (new Set(names).size !== names.length) throw new Error('Duplicate release asset names');
  const groups = PLATFORMS.filter(group => [group.zip, group.info, group.sums].some(name => names.includes(name)));
  if (!groups.some(group => group.platform === 'windows-x64')) throw new Error('Windows release assets are required');
  for (const group of groups) {
    if (![group.zip, group.info, group.sums].every(name => names.includes(name))) throw new Error(`Incomplete release assets: ${group.platform}`);
  }
  return groups;
}

// Compute both the published SHA256 and Qiniu's documented 4 MiB block ETag.
async function fingerprint(file) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const size = (await handle.stat()).size;
    const sha256 = crypto.createHash('sha256');
    const blocks = [];
    let offset = 0;
    do {
      const buffer = Buffer.alloc(Math.min(4 * 1024 * 1024, size - offset));
      let read = 0;
      while (read < buffer.length) {
        const { bytesRead } = await handle.read(buffer, read, buffer.length - read, offset + read);
        if (!bytesRead) throw new Error('Artifact changed while hashing');
        read += bytesRead;
      }
      sha256.update(buffer);
      blocks.push(crypto.createHash('sha1').update(buffer).digest());
      offset += buffer.length;
    } while (offset < size);
    const digest = blocks.length === 1 ? blocks[0] : crypto.createHash('sha1').update(Buffer.concat(blocks)).digest();
    return { size, sha256: sha256.digest('hex'), etag: Buffer.concat([Buffer.from([blocks.length === 1 ? 0x16 : 0x96]), digest]).toString('base64url') };
  } finally { await handle.close(); }
}

function sourceCommit(root, tag) {
  if (!TAG_PATTERN.test(tag)) throw new Error('Invalid release tag');
  const commit = execFileSync('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid source commit');
  const included = spawnSync('git', ['merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main'], { cwd: root, windowsHide: true, stdio: 'ignore' });
  if (included.status !== 0) throw new Error('Release tag is not included in origin/main');
  const version = JSON.parse(execFileSync('git', ['show', `${commit}:package.json`], { cwd: root, encoding: 'utf8', windowsHide: true })).version;
  if (`v${version}` !== tag) throw new Error('Tag does not match the source version');
  return commit;
}

async function verifyArtifacts(directory, groups, tag, commit) {
  const files = [];
  for (const group of groups) {
    const info = JSON.parse(fs.readFileSync(path.join(directory, group.info), 'utf8'));
    if (info.version !== tag.slice(1) || info.commit !== commit || info.platform !== group.platform) throw new Error(`Source/version mismatch: ${group.info}`);
    if (info.demoIncluded !== false || info.embedding !== true) throw new Error(`Public release must have embedding and exclude restricted tutorial material: ${group.info}`);
    const checksums = new Map();
    for (const line of fs.readFileSync(path.join(directory, group.sums), 'utf8').trim().split(/\r?\n/)) {
      const match = /^([a-f0-9]{64})  ([A-Za-z0-9.-]+)$/.exec(line);
      if (!match || checksums.has(match[2]) || ![group.zip, group.info].includes(match[2])) throw new Error(`Invalid checksum manifest: ${group.sums}`);
      checksums.set(match[2], match[1]);
    }
    if (checksums.size !== 2) throw new Error(`Incomplete checksum manifest: ${group.sums}`);
    for (const name of [group.zip, group.info, group.sums]) {
      const file = path.join(directory, name);
      const hashes = await fingerprint(file);
      if (name !== group.sums && hashes.sha256 !== checksums.get(name)) throw new Error(`Checksum mismatch: ${name}`);
      if (name === group.zip && hashes.sha256 !== info.zipSha256) throw new Error(`ZIP does not match metadata: ${name}`);
      files.push({ name, file, ...hashes });
    }
  }
  return files;
}

async function githubRelease(repository, tag, token) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !TAG_PATTERN.test(tag)) throw new Error('Invalid repository or tag');
  const response = await fetch(`https://api.github.com/repos/${repository}/releases/tags/${tag}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub Release lookup failed (HTTP ${response.status})`);
  return response.json();
}

async function downloadArtifacts(release, groups, repository, directory) {
  fs.mkdirSync(directory, { recursive: true });
  for (const name of groups.flatMap(group => [group.zip, group.info, group.sums])) {
    const asset = release.assets.find(item => item.name === name);
    const limit = name.endsWith('.zip') ? 2 * 1024 ** 3 : 32768;
    if (!(asset.size > 0 && asset.size <= limit)) throw new Error(`Unexpected release asset size: ${name}`);
    // Published assets are public: never forward GitHub credentials to their download hosts.
    const url = `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`;
    console.log(`Downloading: ${name} (${asset.size} bytes)`);
    const response = await fetch(url, { signal: AbortSignal.timeout(20 * 60 * 1000) });
    if (!response.ok || !response.body) throw new Error(`Download failed: ${name} (HTTP ${response.status})`);
    let received = 0;
    await pipeline(response.body, async function* (source) {
      for await (const chunk of source) {
        received += chunk.length;
        if (received > asset.size) throw new Error(`Download exceeded expected size: ${name}`);
        yield chunk;
      }
    }, fs.createWriteStream(path.join(directory, name), { flags: 'wx' }));
    if (received !== asset.size) throw new Error(`Truncated download: ${name}`);
    console.log(`Downloaded: ${name}`);
  }
}

module.exports = { PLATFORMS, releaseFiles, fingerprint, sourceCommit, verifyArtifacts, githubRelease, downloadArtifacts };
