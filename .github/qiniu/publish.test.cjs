const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const { PLATFORMS, fingerprint, releaseFiles, sourceCommit, verifyArtifacts } = require('./artifacts.cjs');
const { verifyPublic, uploadChecked, copyChecked, publicUrl } = require('./storage.cjs');
const { publish, checkConnection } = require('./publish.cjs');
const { assertNewestRelease } = require('./run.cjs');

const commit = 'a'.repeat(40);
const tag = 'v0.1.1';
const release = { tag_name: tag, draft: false, published_at: '2026-10-13T07:00:00Z', html_url: 'https://github.com/example/repo/releases/tag/v0.1.1', assets: [] };
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neuink-qiniu-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
async function fixture(t, changes = {}) {
  const directory = temp(t);
  const group = PLATFORMS[0];
  fs.writeFileSync(path.join(directory, group.zip), 'PK\x03\x04synthetic-test-archive');
  const zip = await fingerprint(path.join(directory, group.zip));
  const info = { version: '0.1.1', commit, platform: group.platform, embedding: true, demoIncluded: false, zipSha256: zip.sha256, ...changes };
  fs.writeFileSync(path.join(directory, group.info), JSON.stringify(info));
  fs.writeFileSync(path.join(directory, group.sums), `${zip.sha256}  ${group.zip}\n${(await fingerprint(path.join(directory, group.info))).sha256}  ${group.info}\n`);
  return { directory, group, info };
}
function mockStorage() {
  const objects = new Map();
  const events = [];
  return { objects, events,
    async stat(key) { return objects.get(key) || null; },
    async upload(key, file, options) {
      events.push({ type: 'upload', key, options });
      const data = await fingerprint(file);
      objects.set(key, { hash: data.etag, fsize: data.size });
      return { key, hash: data.etag };
    },
    async copy(source, key) {
      events.push({ type: 'copy', source, key });
      if (!objects.has(source)) throw new Error('Missing source');
      objects.set(key, { ...objects.get(source) });
    },
    async expireCheckObject(key) { events.push({ type: 'expire', key }); },
    async refresh(keys) { events.push({ type: 'refresh', keys }); },
  };
}

test('published Releases require complete platform triplets; unrelated attachments are excluded', () => {
  const assets = [PLATFORMS[0].zip, PLATFORMS[0].info, PLATFORMS[0].sums, '.env'].map(name => ({ name }));
  assert.deepEqual(releaseFiles({ ...release, assets }, tag), [PLATFORMS[0]]);
  assert.throws(() => releaseFiles({ ...release, assets: assets.slice(0, 1) }, tag), /Incomplete/);
  assert.throws(() => releaseFiles({ ...release, assets, draft: true }, tag), /published/);
  assert.throws(() => releaseFiles({ ...release, assets }, '../main'), /published/);
  assert.throws(() => releaseFiles({ ...release, assets: [...assets, assets[0]] }, tag), /Duplicate/);
});

test('artifact fingerprints use the Qiniu ETag wire format, including the 4 MiB boundary', async t => {
  const directory = temp(t);
  const file = path.join(directory, 'file');
  fs.writeFileSync(file, '');
  assert.equal((await fingerprint(file)).etag, 'Fto5o-5ea0sNMlW_75VgGJCv2AcJ');
  const bytes = Buffer.alloc(4 * 1024 * 1024 + 1, 42);
  fs.writeFileSync(file, bytes);
  const sha1 = data => crypto.createHash('sha1').update(data).digest();
  const expected = Buffer.concat([Buffer.from([0x96]), sha1(Buffer.concat([sha1(bytes.subarray(0, -1)), sha1(bytes.subarray(-1))]))]).toString('base64url');
  const result = await fingerprint(file);
  assert.equal(result.etag, expected);
  assert.equal(result.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
});

test('all artifact hashes are checked before a valid publication list is returned', async t => {
  const { directory, group } = await fixture(t);
  assert.equal((await verifyArtifacts(directory, [group], tag, commit)).length, 3);
  fs.appendFileSync(path.join(directory, group.zip), 'corrupted');
  await assert.rejects(verifyArtifacts(directory, [group], tag, commit), /Checksum/);
});
for (const change of [{ version: '9.0.0' }, { commit: 'b'.repeat(40) }, { platform: 'macos-x64' }, { demoIncluded: true }, { embedding: false }]) {
  test(`mismatched/unsafe metadata is rejected: ${JSON.stringify(change)}`, async t => {
    const { directory, group } = await fixture(t, change);
    await assert.rejects(verifyArtifacts(directory, [group], tag, commit));
  });
}
test('checksum manifests cannot introduce paths or omit metadata', async t => {
  const { directory, group } = await fixture(t);
  fs.writeFileSync(path.join(directory, group.sums), `${'a'.repeat(64)}  ../secret\n`);
  await assert.rejects(verifyArtifacts(directory, [group], tag, commit), /Invalid checksum/);
});

test('a release tag must be included in main and match the committed version', t => {
  const root = temp(t);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  git('init', '--initial-branch=main');
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"0.1.1"}');
  git('add', 'package.json');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('tag', tag);
  assert.match(sourceCommit(root, tag), /^[a-f0-9]{40}$/);
  git('tag', 'v99.0.0');
  assert.throws(() => sourceCommit(root, 'v99.0.0'), /source version/);
  git('switch', '-c', 'beta');
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"0.1.2"}');
  git('add', 'package.json');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'unapproved feature');
  git('tag', 'v0.1.2');
  assert.throws(() => sourceCommit(root, 'v0.1.2'), /not included/);
});

test('archives finish before fixed URLs change, and the manifest is written last', async t => {
  const { directory, group } = await fixture(t);
  const files = await verifyArtifacts(directory, [group], tag, commit);
  const storage = mockStorage();
  const result = await publish({ storage, files, release, directory, log() {}, verify: async key => {
    storage.events.push({ type: 'verify', key });
    assert.ok(storage.objects.has(key));
  } });
  assert.equal(result.aliasesUpdated, true);
  const events = storage.events;
  const firstAlias = events.findIndex(e => e.type === 'copy' && e.key === group.zip);
  assert.equal(events.slice(0, firstAlias).filter(e => e.type === 'verify').length, 3);
  assert.equal(events.filter(e => e.type === 'upload').at(-1).key, 'releases/latest.json');
  assert.equal(events.at(-1).key, 'releases/latest.json');
  assert.equal(events.filter(e => e.type === 'copy').length, 3);
  assert.equal(events.filter(e => e.type === 'upload' && e.key.endsWith('.zip')).length, 1);
});

test('archive conflicts or verification failures leave fixed downloads untouched', async t => {
  const { directory, group } = await fixture(t);
  const files = await verifyArtifacts(directory, [group], tag, commit);
  const storage = mockStorage();
  storage.objects.set(`releases/${tag}/${group.zip}`, { hash: 'different', fsize: 1 });
  await assert.rejects(publish({ storage, files, release, directory, log() {}, verify: async () => {} }), /different bytes/);
  assert.equal(storage.events.length, 0);
  storage.objects.clear();
  await assert.rejects(publish({ storage, files, release, directory, log() {}, verify: async () => { throw new Error('offline'); } }), /offline/);
  assert.ok(storage.events.every(event => event.key.startsWith(`releases/${tag}/`)));
});

test('refresh failures never claim success or write a latest manifest', async t => {
  const { directory, group } = await fixture(t);
  const files = await verifyArtifacts(directory, [group], tag, commit);
  const storage = mockStorage();
  storage.refresh = async () => { throw new Error('refresh denied'); };
  await assert.rejects(publish({ storage, files, release, directory, log() {}, verify: async () => {} }), /refresh denied/);
  assert.equal(storage.objects.has('releases/latest.json'), false);
});

test('retries reuse byte-identical version files and archive-only never promotes downloads', async t => {
  const { directory, group } = await fixture(t);
  const files = await verifyArtifacts(directory, [group], tag, commit);
  const storage = mockStorage();
  for (let i = 0; i < 2; i++) await publish({ storage, files, release, directory, archiveOnly: true, log() {}, verify: async () => {} });
  assert.equal(storage.events.filter(e => e.type === 'upload').length, 3);
  assert.equal(storage.objects.has(group.zip), false);
  await assert.rejects(uploadChecked({ ...storage, upload: async () => ({ hash: 'wrong' }) }, 'test.zip', files[0]), /verification/);
});

test('CDN validation waits for the real URL to change and also checks small response bodies', async t => {
  const { directory, group } = await fixture(t);
  const [file] = await verifyArtifacts(directory, [group], tag, commit);
  let calls = 0;
  const request = async url => {
    assert.equal(url, publicUrl(group.zip));
    const actual = calls++ > 0;
    return new Response(actual ? fs.readFileSync(file.file) : 'old', { headers: { etag: `"${actual ? file.etag : 'stale'}"`, 'content-length': String(actual ? file.size : 3) } });
  };
  await verifyPublic(group.zip, file, { attempts: 2, pause: async () => {}, request });
  assert.equal(calls, 2);
  await assert.rejects(verifyPublic(group.zip, file, { attempts: 1, request: async () => new Response('wrong bytes', { headers: { etag: file.etag, 'content-length': String(file.size) } }) }), /expected file/);
  assert.throws(() => publicUrl('../secret'), /Invalid/);
});

test('the connection test verifies both uploads and a server-side replacement using temporary files', async t => {
  const storage = mockStorage();
  let verified = 0;
  const result = await checkConnection({ storage, directory: temp(t), log() {}, verify: async () => { verified++; } });
  const uploads = storage.events.filter(e => e.type === 'upload');
  assert.equal(verified, 3);
  assert.equal(new Set(uploads.map(e => e.key)).size, 2);
  assert.ok(uploads.every(e => e.options.temporary));
  assert.match(result.key, /^releases\/_checks\//);
  assert.equal(storage.events.filter(e => e.type === 'copy').length, 1);
  assert.match(result.copyKey, /^releases\/_checks\//);
  assert.equal(storage.events.filter(e => e.type === 'expire').at(-1).key, result.copyKey);
});

test('promotion rejects a missing or changed archive before replacing a download', async t => {
  const { directory, group } = await fixture(t);
  const [file] = await verifyArtifacts(directory, [group], tag, commit);
  const storage = mockStorage();
  storage.objects.set(group.zip, { hash: 'old', fsize: 1 });
  await assert.rejects(copyChecked(storage, 'archive.zip', group.zip, file), /source verification/);
  storage.objects.set('archive.zip', { hash: 'unexpected', fsize: file.size });
  await assert.rejects(copyChecked(storage, 'archive.zip', group.zip, file), /source verification/);
  assert.equal(storage.events.length, 0);
  assert.equal(storage.objects.get(group.zip).hash, 'old');
});

test('promotion is idempotent and detects a copy that returned success without matching bytes', async t => {
  const { directory, group } = await fixture(t);
  const [file] = await verifyArtifacts(directory, [group], tag, commit);
  const storage = mockStorage();
  storage.objects.set('archive.zip', { hash: file.etag, fsize: file.size });
  await copyChecked(storage, 'archive.zip', group.zip, file);
  await copyChecked(storage, 'archive.zip', group.zip, file);
  assert.equal(storage.events.filter(e => e.type === 'copy').length, 1);
  storage.objects.set(group.zip, { hash: 'old', fsize: 1 });
  await assert.rejects(copyChecked({ ...storage, copy: async () => {} }, 'archive.zip', group.zip, file), /Copied object verification/);
});

test('failed server-side promotion never writes the latest manifest', async t => {
  const { directory, group } = await fixture(t);
  const files = await verifyArtifacts(directory, [group], tag, commit);
  const storage = mockStorage();
  storage.copy = async () => { throw new Error('copy denied'); };
  await assert.rejects(publish({ storage, files, release, directory, log() {}, verify: async () => {} }), /copy denied/);
  assert.equal(storage.objects.has('releases/latest.json'), false);
});

test('older Releases cannot replace current downloads and drafts do not affect ordering', () => {
  const releases = [release, { ...release, tag_name: 'v0.1.2', published_at: '2026-10-14T00:00:00Z' }, { ...release, tag_name: 'v0.1.3', draft: true, published_at: null }];
  assert.throws(() => assertNewestRelease(releases, tag), /newest/);
  assertNewestRelease(releases, 'v0.1.2');
});
