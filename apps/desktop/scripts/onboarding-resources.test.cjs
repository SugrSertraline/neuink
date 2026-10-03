const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const os = require('node:os');
const path = require('node:path');
const { REQUIRED_FILES, DEFAULT_SOURCE, verifyResources, copyResources, copyOptionalResources,
  inspectResources, assertEmbeddingResources, prepareResources, writeAvailabilityManifest } = require('./onboarding-resources.cjs');
const { resourceArguments } = require('./tauri.cjs');
const BASE_RESOURCES = ['resources/embedding-models/default/**/*', 'resources/onboarding-availability.json'];

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'neuink-packaging-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(path.join(directory, 'demo.json'), JSON.stringify({
    version: 'attention-v1', segment_uid: 'abstract', note_markdown: '{source}', translation: '摘要',
  }));
  writeFileSync(path.join(directory, 'segments.json'), JSON.stringify([{ uid: 'abstract' }]));
  writeFileSync(path.join(directory, 'attention-is-all-you-need.pdf'), '%PDF-1.7\n');
  writeFileSync(path.join(directory, 'mineru.zip'), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  writeFileSync(path.join(directory, 'NOTICE.txt'), 'fixture');
  return directory;
}

function models(directory) {
  const modelSource = path.join(directory, 'models');
  mkdirSync(path.join(modelSource, 'onnx'), { recursive: true });
  writeFileSync(path.join(modelSource, 'onnx/model.onnx'), 'fixture model');
  for (const name of ['tokenizer.json', 'config.json', 'special_tokens_map.json', 'tokenizer_config.json']) {
    writeFileSync(path.join(modelSource, name), '{}');
  }
  return modelSource;
}

test('installer base config has no mandatory demo paths or empty optional globs', () => {
  const config = JSON.parse(readFileSync(path.resolve(__dirname, '../src-tauri/tauri.conf.json'), 'utf8'));
  assert.deepEqual(config.bundle.resources, BASE_RESOURCES);
  assert.ok(config.build.beforeBuildCommand.startsWith('npm run prepare:resources &&'));
  const scripts = JSON.parse(readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')).scripts;
  assert.equal(scripts.tauri, 'node scripts/tauri.cjs');
  assert.equal(scripts.dev, 'node scripts/tauri.cjs dev');
  assert.equal(scripts['prepare:resources'], 'node scripts/onboarding-resources.cjs --optional');
  const portable = readFileSync(path.resolve(__dirname, 'build-portable.cjs'), 'utf8');
  assert.match(portable, /assertEmbeddingResources\(modelSource\)/);
  assert.match(portable, /copyOptionalResources\(onboardingSource,/);
  assert.match(portable, /writeAvailabilityManifest\(includesOnboarding, path.join\(portableRoot, 'resources', 'onboarding-availability.json'\)\)/);
});

test('Tauri build selects all five verified resources and preserves forwarded arguments', (t) => {
  const source = fixture(t); const logs = []; const manifestPath = path.join(source, 'onboarding-availability.json');
  const args = resourceArguments(['build', '--no-bundle', '--', '--locked'], {
    source, modelSource: models(source), manifestPath, log: line => logs.push(line),
  });
  assert.deepEqual(args.slice(0, 3), ['build', '--no-bundle', '--config']);
  assert.deepEqual(args.slice(-2), ['--', '--locked']);
  const config = JSON.parse(args[3]);
  assert.deepEqual(config.bundle.resources, [...BASE_RESOURCES,
    ...REQUIRED_FILES.map(name => `resources/onboarding/${name}`)]);
  assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')), { version: 1, included: true });
  assert.match(logs.join('\n'), /5 个.*基础格式检查/);
});

test('metadata-only checkout is buildable without any onboarding resource glob', (t) => {
  const source = fixture(t); const modelSource = models(source); const logs = [];
  const manifestPath = path.join(source, 'onboarding-availability.json');
  for (const name of ['attention-is-all-you-need.pdf', 'segments.json', 'mineru.zip']) rmSync(path.join(source, name));
  const selected = prepareResources({ source, modelSource, manifestPath, log: line => logs.push(line) });
  assert.equal(selected.included, false);
  for (const command of ['build', 'dev', 'bundle']) {
    const args = resourceArguments([command], { source, modelSource, manifestPath, log: line => logs.push(line) });
    assert.deepEqual(JSON.parse(args[2]).bundle.resources, BASE_RESOURCES);
  }
  assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')), { version: 1, included: false });
  assert.match(logs.join('\n'), /跳过整套/);
});

test('Tauri config excludes every demo path when a supplied asset is corrupt', (t) => {
  const source = fixture(t); const modelSource = models(source);
  const manifestPath = path.join(source, 'onboarding-availability.json');
  writeFileSync(path.join(source, 'segments.json'), '{broken JSON');
  const args = resourceArguments(['build'], { source, modelSource, manifestPath, log: () => {} });
  assert.deepEqual(JSON.parse(args[2]).bundle.resources, BASE_RESOURCES);
  assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')), { version: 1, included: false });
});

test('rebuilding without source assets overwrites a previous true manifest with false', (t) => {
  const source = fixture(t); const modelSource = models(source);
  const manifestPath = path.join(source, 'build-resources/onboarding-availability.json');
  const options = { source, modelSource, manifestPath, log: () => {} };
  const before = resourceArguments(['build', '--no-bundle'], options);
  assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')), { version: 1, included: true });
  assert.ok(JSON.parse(before[3]).bundle.resources.includes('resources/onboarding/mineru.zip'));
  rmSync(path.join(source, 'mineru.zip'));
  const after = resourceArguments(['build', '--no-bundle'], options);
  assert.deepEqual(JSON.parse(after[3]).bundle.resources, BASE_RESOURCES);
  assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')), { version: 1, included: false });
  assert.deepEqual(readdirSync(path.dirname(manifestPath)), ['onboarding-availability.json']);
});

for (const included of [true, false]) {
  test(`portable assembly stamps its own included=${included} manifest from the copy result`, (t) => {
    const source = fixture(t); const resources = path.join(source, 'portable/resources');
    if (!included) rmSync(path.join(source, 'attention-is-all-you-need.pdf'));
    const copied = copyOptionalResources(source, path.join(resources, 'onboarding'), () => {});
    writeAvailabilityManifest(copied, path.join(resources, 'onboarding-availability.json'));
    assert.equal(copied, included);
    assert.deepEqual(JSON.parse(readFileSync(path.join(resources, 'onboarding-availability.json'), 'utf8')),
      { version: 1, included });
    assert.equal(existsSync(path.join(resources, 'onboarding')), included);
  });
}

test('embedding stays mandatory even when tutorial assets are optional or only README remains', (t) => {
  const source = fixture(t); const modelSource = models(source);
  const manifestPath = path.join(source, 'onboarding-availability.json');
  rmSync(path.join(modelSource, 'onnx/model.onnx'));
  writeFileSync(path.join(modelSource, 'README.md'), 'not a model');
  assert.throws(() => assertEmbeddingResources(modelSource), /必需 embedding/);
  assert.throws(() => resourceArguments(['build'], { source, modelSource, manifestPath, log: () => {} }), /必需 embedding/);
  writeFileSync(path.join(modelSource, 'onnx/model.onnx'), 'fixture model');
  writeFileSync(path.join(modelSource, 'tokenizer.json'), '');
  assert.throws(() => prepareResources({ source, modelSource, manifestPath, log: () => {} }), /tokenizer.json/);
});

for (const name of ['config.json', 'special_tokens_map.json', 'tokenizer_config.json']) {
  for (const state of ['missing', 'empty']) {
    test(`embedding preflight rejects ${state} ${name}`, (t) => {
      const source = fixture(t); const modelSource = models(source);
      const manifestPath = path.join(source, 'onboarding-availability.json');
      assert.doesNotThrow(() => assertEmbeddingResources(modelSource));
      const file = path.join(modelSource, name);
      if (state === 'missing') rmSync(file);
      else writeFileSync(file, '');
      const expected = error => error.message.includes('必需 embedding') && error.message.includes(name);
      assert.throws(() => assertEmbeddingResources(modelSource), expected);
      assert.throws(() => prepareResources({ source, modelSource, manifestPath, log: () => {} }), expected);
      assert.throws(() => resourceArguments(['build'], { source, modelSource, manifestPath, log: () => {} }), expected);
    });
  }
}

test('CLI help and unrelated subcommands do not require local build resources', () => {
  for (const args of [['--version'], ['info'], ['build', '--help']]) {
    assert.deepEqual(resourceArguments(args, { modelSource: 'missing' }), args);
  }
});

test('copy verifies identical bytes and excludes unrelated local files', (t) => {
  const source = fixture(t);
  writeFileSync(path.join(source, 'private.txt'), 'not a bundled resource');
  const destination = path.join(source, 'output');
  copyResources(source, destination);
  assert.deepEqual(verifyResources(destination), verifyResources(source));
  assert.equal(existsSync(path.join(destination, 'private.txt')), false);
});

test('strict verifier remains available for explicitly checking missing assets', (t) => {
  const source = fixture(t);
  writeFileSync(path.join(source, 'mineru.zip'), '');
  assert.throws(() => verifyResources(source), /mineru.zip/);
  rmSync(path.join(source, 'mineru.zip'));
  assert.throws(() => copyResources(source, path.join(source, 'output')), /mineru.zip/);
  assert.equal(existsSync(path.join(source, 'output')), false);
});

test('strict verifier rejects invalid PDF, ZIP and unbound note references', (t) => {
  const source = fixture(t);
  writeFileSync(path.join(source, 'attention-is-all-you-need.pdf'), 'bad PDF');
  assert.throws(() => verifyResources(source), /格式错误/);
  writeFileSync(path.join(source, 'attention-is-all-you-need.pdf'), '%PDF-1.7');
  writeFileSync(path.join(source, 'mineru.zip'), 'bad ZIP');
  assert.throws(() => verifyResources(source), /格式错误/);
  writeFileSync(path.join(source, 'mineru.zip'), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  writeFileSync(path.join(source, 'segments.json'), JSON.stringify([{ uid: 'other' }]));
  assert.throws(() => verifyResources(source), /不完整/);
});

test('optional portable copy includes all five files and no unrelated local files', (t) => {
  const source = fixture(t); const destination = path.join(source, 'portable/resources/onboarding'); const logs = [];
  writeFileSync(path.join(source, 'private.txt'), 'not bundled');
  assert.equal(copyOptionalResources(source, destination, line => logs.push(line)), true);
  assert.deepEqual(readdirSync(destination).sort(), [...REQUIRED_FILES].sort());
  assert.deepEqual(verifyResources(destination), verifyResources(source));
  assert.match(logs.join('\n'), /5 个.*基础格式检查/);
});

for (const name of REQUIRED_FILES) {
  test(`optional portable copy skips the entire bundle if ${name} is absent`, (t) => {
    const source = fixture(t); const destination = path.join(source, 'portable/resources/onboarding'); const logs = [];
    rmSync(path.join(source, name));
    assert.equal(inspectResources(source).included, false);
    assert.equal(copyOptionalResources(source, destination, line => logs.push(line)), false);
    assert.equal(existsSync(destination), false);
    assert.equal(existsSync(path.dirname(destination)), false);
    assert.match(logs.join('\n'), /跳过整套/);
  });
}

for (const [name, value] of [['segments.json', 'invalid JSON'], ['mineru.zip', 'bad ZIP'],
  ['attention-is-all-you-need.pdf', 'bad PDF'], ['demo.json', '{}']]) {
  test(`optional portable copy skips the entire bundle if ${name} is corrupt`, (t) => {
    const source = fixture(t); const destination = path.join(source, 'portable/resources/onboarding');
    writeFileSync(path.join(source, name), value);
    assert.equal(copyOptionalResources(source, destination, () => {}), false);
    assert.equal(existsSync(destination), false);
  });
}

test('failed copy never publishes partial resources and cleans only its own temporary directory', (t) => {
  const source = fixture(t); const destination = path.join(source, 'output');
  const filename = path.resolve(__dirname, 'onboarding-resources.cjs');
  const fakeFs = { ...require('node:fs'), writeFileSync(file, ...args) {
    if (path.basename(file) === 'segments.json') throw new Error('simulated disk full');
    writeFileSync(file, ...args);
  } };
  const sandbox = { __dirname, Buffer, console, process, module: { exports: {} },
    require: name => name === 'node:fs' ? fakeFs : require(name) };
  runInNewContext(readFileSync(filename, 'utf8'), sandbox, { filename });
  assert.throws(() => sandbox.module.exports.copyOptionalResources(source, destination, () => {}), /disk full/);
  assert.equal(existsSync(destination), false);
  assert.deepEqual(readdirSync(source).sort(), [...REQUIRED_FILES].sort());
  assert.doesNotThrow(() => verifyResources(source));
});

test('locally supplied real bundle survives portable resource assembly', {
  skip: !inspectResources(DEFAULT_SOURCE).included,
}, (t) => {
  const destination = path.join(fixture(t), 'real-output');
  copyResources(DEFAULT_SOURCE, destination);
  assert.deepEqual(verifyResources(destination), verifyResources(DEFAULT_SOURCE));
  assert.equal(JSON.parse(readFileSync(path.join(destination, 'segments.json'), 'utf8')).length, 165);
});
