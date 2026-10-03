const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { LOCK, MANIFEST, REQUIRED_FILES, PYTHON_SEARCH_PATH, sha256, safePath,
  writeRuntimeManifest, verifyResources, inspectResources, resourcePaths,
  copyResources, downloadAsset, replacePreparedRuntime } = require('./browser-reader-resources.cjs');
const { allResourceArguments } = require('./tauri.cjs');

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuink-browser-reader-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function runtime(t) {
  const root = temporary(t);
  for (const name of REQUIRED_FILES) {
    const file = safePath(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, name.endsWith('._pth') ? PYTHON_SEARCH_PATH : `fixture: ${name}`);
  }
  writeRuntimeManifest(root);
  return root;
}

function packaging(t, source) {
  const root = temporary(t);
  const modelSource = path.join(root, 'models');
  fs.mkdirSync(path.join(modelSource, 'onnx'), { recursive: true });
  for (const name of ['onnx/model.onnx', 'tokenizer.json', 'config.json', 'special_tokens_map.json', 'tokenizer_config.json']) {
    fs.writeFileSync(path.join(modelSource, name), 'fixture');
  }
  return {
    source: path.join(root, 'missing-onboarding'), modelSource,
    manifestPath: path.join(root, 'onboarding-availability.json'),
    config: { bundle: { resources: ['resources/embedding-models/default/**/*'] } },
    browserReader: { source, platform: 'win32', arch: 'x64' }, log: () => {},
  };
}

test('runtime lock uses exact official HTTPS assets with SHA256, never a latest URL', () => {
  const hosts = new Set(['www.python.org', 'files.pythonhosted.org', 'github.com', 'raw.githubusercontent.com']);
  for (const asset of LOCK.assets) {
    const url = new URL(asset.url);
    assert.equal(url.protocol, 'https:');
    assert.ok(hosts.has(url.hostname));
    assert.doesNotMatch(asset.url, /\/latest(?:\/|$)/);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
    assert.ok(safePath(os.tmpdir(), asset.destination));
  }
});

test('verification rejects absent, truncated, altered and unexpected runtime files', t => {
  const root = runtime(t);
  assert.ok(verifyResources(root).files['python/python.exe']);
  fs.writeFileSync(path.join(root, 'python/python.exe'), 'corrupt');
  assert.throws(() => verifyResources(root), /校验失败.*python.exe/);
  fs.rmSync(path.join(root, 'python/python.exe'));
  assert.throws(() => verifyResources(root), /文件集/);
  assert.equal(inspectResources(root).included, false);
  const other = runtime(t);
  fs.writeFileSync(path.join(other, 'personal-notes.txt'), 'must not be shipped');
  assert.throws(() => copyResources(other, path.join(temporary(t), 'output')), /文件集/);
});

test('manifest cannot omit a required executable or change the locked version', t => {
  for (const kind of ['missing', 'version']) {
    const root = runtime(t);
    const file = path.join(root, MANIFEST);
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (kind === 'missing') delete manifest.files['quickjs/qjs.exe'];
    else manifest.lockSha256 = '0'.repeat(64);
    fs.writeFileSync(file, JSON.stringify(manifest));
    assert.throws(() => verifyResources(root), kind === 'missing' ? /清单缺少/ : /版本/);
  }
});

test('Python stays isolated even if a manifest is regenerated after changing _pth', t => {
  const root = runtime(t);
  fs.writeFileSync(path.join(root, 'python/python313._pth'), PYTHON_SEARCH_PATH + 'import site\n');
  fs.rmSync(path.join(root, MANIFEST));
  writeRuntimeManifest(root);
  assert.throws(() => verifyResources(root), /隔离路径/);
});

test('resource paths reject traversal, absolute names and Windows alternate streams', () => {
  for (const name of ['../secrets', '/absolute', 'a/../../b', 'C:/outside', 'python\\x', 'a:b', 'a//b']) {
    assert.throws(() => safePath(os.tmpdir(), name));
  }
});

test('portable copy includes verified licenses and refuses to overwrite a destination', t => {
  const source = runtime(t); const parent = temporary(t); const destination = path.join(parent, 'resources/browser-reader');
  copyResources(source, destination);
  assert.deepEqual(verifyResources(destination), verifyResources(source));
  assert.equal(fs.readFileSync(path.join(destination, 'licenses/QuickJS-LICENSE.txt'), 'utf8'),
    'fixture: licenses/QuickJS-LICENSE.txt');
  assert.throws(() => copyResources(source, destination), /拒绝覆盖/);
  assert.deepEqual(fs.readdirSync(path.dirname(destination)), ['browser-reader']);
});

test('preparation updates a Windows tree without moving its root and preserves a recoverable snapshot', t => {
  const staging = runtime(t); const parent = temporary(t); const target = path.join(parent, 'browser-reader');
  copyResources(staging, target);
  fs.writeFileSync(path.join(staging, 'THIRD_PARTY_NOTICES.txt'), 'updated notices');
  fs.rmSync(path.join(staging, MANIFEST)); writeRuntimeManifest(staging);
  const backup = replacePreparedRuntime(staging, target);
  assert.equal(path.dirname(backup), parent);
  assert.equal(fs.readFileSync(path.join(target, 'THIRD_PARTY_NOTICES.txt'), 'utf8'), 'updated notices');
  assert.equal(fs.readFileSync(path.join(backup, 'THIRD_PARTY_NOTICES.txt'), 'utf8'), 'fixture: THIRD_PARTY_NOTICES.txt');
  assert.deepEqual(verifyResources(target), verifyResources(staging));
  assert.doesNotThrow(() => verifyResources(backup));
});

test('preparation leaves unrecognized existing files untouched', t => {
  const staging = runtime(t); const parent = temporary(t); const target = path.join(parent, 'browser-reader');
  copyResources(staging, target);
  fs.writeFileSync(path.join(target, 'personal.txt'), 'preserve this');
  assert.throws(() => replacePreparedRuntime(staging, target), /未识别文件/);
  assert.equal(fs.readFileSync(path.join(target, 'personal.txt'), 'utf8'), 'preserve this');
  assert.deepEqual(fs.readdirSync(parent), ['browser-reader']);
});

test('missing runtime explicitly disables dev subtitles and fails release packaging', t => {
  const logs = []; const options = { source: path.join(temporary(t), 'missing'), platform: 'win32', arch: 'x64', log: line => logs.push(line) };
  assert.deepEqual(resourcePaths({ ...options, command: 'dev' }), []);
  assert.match(logs.join('\n'), /暂不可用.*prepare:browser-reader/);
  for (const command of ['build', 'bundle']) assert.throws(() => resourcePaths({ ...options, command }), /prepare:browser-reader/);
  assert.deepEqual(resourcePaths({ ...options, platform: 'darwin', command: 'build' }), []);
});

test('Tauri dev/build/bundle include the verified runtime while preserving existing resources and Rust arguments', t => {
  for (const command of ['dev', 'build', 'bundle']) {
    const options = packaging(t, runtime(t));
    const args = allResourceArguments([command, '--', '--locked'], options);
    assert.deepEqual(args.slice(-2), ['--', '--locked']);
    const config = JSON.parse(args[args.indexOf('--config') + 1]);
    assert.deepEqual(config.bundle.resources, [
      'resources/embedding-models/default/**/*', 'resources/browser-reader/**/*', 'resources/reader-licenses/**/*',
    ]);
  }
});

test('Tauri help never requires runtime assets; a missing build runtime cannot be silently omitted', t => {
  const options = packaging(t, path.join(temporary(t), 'missing'));
  assert.deepEqual(allResourceArguments(['build', '--help'], options), ['build', '--help']);
  assert.throws(() => allResourceArguments(['build'], options), /prepare:browser-reader/);
  const dev = allResourceArguments(['dev'], options);
  assert.deepEqual(JSON.parse(dev[dev.indexOf('--config') + 1]).bundle.resources,
    ['resources/embedding-models/default/**/*', 'resources/reader-licenses/**/*']);
});

test('download verifies bytes before publishing, reuses exact cache and never trusts a corrupt cache', async t => {
  const cache = temporary(t); const bytes = Buffer.from('official fixture');
  const asset = { name: 'fixture.zip', url: 'https://www.python.org/fixture.zip', sha256: sha256(bytes) };
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(bytes); };
  const file = await downloadAsset(asset, cache, fetcher);
  assert.equal(fs.readFileSync(file, 'utf8'), bytes.toString());
  await downloadAsset(asset, cache, fetcher);
  assert.equal(calls, 1);
  fs.writeFileSync(file, 'corrupt cache');
  await assert.rejects(downloadAsset(asset, cache, async () => new Response('wrong download')), /SHA256/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'corrupt cache');
  await downloadAsset(asset, cache, fetcher);
  assert.equal(calls, 2);
  assert.deepEqual(fs.readdirSync(cache), ['fixture.zip']);
});

test('HTTP errors do not leave a partial install or reusable download', async t => {
  const cache = temporary(t);
  const asset = { name: 'fixture.zip', url: 'https://www.python.org/fixture.zip', sha256: '0'.repeat(64) };
  await assert.rejects(downloadAsset(asset, cache, async () => new Response('no', { status: 503 })), /503/);
  assert.deepEqual(fs.readdirSync(cache), []);
});
