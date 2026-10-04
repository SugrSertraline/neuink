const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DEFAULT_SOURCE, COMPONENTS, FILES, MANIFEST, expectedManifest,
  verifyResources, prepareResources, resourcePaths, copyResources } = require('./reader-licenses.cjs');
const { allResourceArguments } = require('./tauri.cjs');

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuink-reader-licenses-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function copyFixture(t) {
  const destination = path.join(temporary(t), 'reader-licenses');
  copyResources(DEFAULT_SOURCE, destination);
  return destination;
}

test('committed license bundle preserves every pinned upstream notice and source', () => {
  assert.deepEqual(verifyResources(), expectedManifest());
  assert.match(fs.readFileSync(path.join(DEFAULT_SOURCE, '../.gitattributes'), 'utf8'), /reader-licenses\/\*\* -text/);
  assert.equal(FILES.length, 15);
  assert.equal(COMPONENTS.readability.version, '0.6.0');
  assert.equal(COMPONENTS['pdfjs-dist'].version, require('pdfjs-dist/package.json').version);
  assert.equal(COMPONENTS.subtp.version, '0.2.0');
  assert.match(fs.readFileSync(path.join(DEFAULT_SOURCE, 'readability/LICENSE.md'), 'utf8'), /Copyright.*Arc90/);
  assert.match(fs.readFileSync(path.join(DEFAULT_SOURCE, 'readability/LICENSE-APACHE'), 'utf8'), /END OF TERMS AND CONDITIONS/);
  for (const component of Object.values(COMPONENTS)) {
    assert.equal(new URL(component.source).protocol, 'https:');
    assert.ok(component.source.includes(component.version));
  }
  const packageRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const upstream = fs.readdirSync(packageRoot, { recursive: true })
    .filter(name => /(^|[\\/])LICENSE[^\\/]*$/.test(name)).map(name => name.replaceAll('\\', '/')).sort();
  assert.deepEqual(FILES.filter(([name]) => name.startsWith('pdfjs-dist/')).map(([, , original]) => original).sort(), upstream);
});

test('preparation is offline, reproducible and can use vendored subtp notices without Cargo', t => {
  const root = path.join(temporary(t), 'prepared');
  prepareResources({ source: root, subtpRoot: path.join(root, 'absent-cargo-registry') });
  assert.deepEqual(verifyResources(root), verifyResources());
  assert.deepEqual(prepareResources({ source: root }), expectedManifest());
});

test('missing, tampered, extra or differently versioned notices fail closed', t => {
  assert.throws(() => verifyResources(path.join(temporary(t), 'missing')), /prepare:reader-licenses.*不会自动下载/);
  for (const alteration of ['missing', 'bytes', 'extra', 'version']) {
    const root = copyFixture(t);
    const license = path.join(root, 'subtp/LICENSE-MIT');
    if (alteration === 'missing') fs.unlinkSync(license);
    if (alteration === 'bytes') fs.writeFileSync(license, 'incorrect');
    if (alteration === 'extra') fs.writeFileSync(path.join(root, 'personal.txt'), 'private');
    if (alteration === 'version') {
      const manifest = expectedManifest();
      manifest.components = { ...manifest.components, subtp: { ...manifest.components.subtp, version: '0.3.0' } };
      fs.writeFileSync(path.join(root, MANIFEST), JSON.stringify(manifest));
    }
    assert.throws(() => verifyResources(root), /许可资源校验失败/);
    assert.throws(() => prepareResources({ source: root }), /许可资源校验失败/);
  }
});

test('portable copy retains all sources and notices and cannot overwrite existing files', t => {
  const root = path.join(temporary(t), 'portable/resources/reader-licenses');
  copyResources(DEFAULT_SOURCE, root);
  assert.deepEqual(verifyResources(root), expectedManifest());
  assert.throws(() => copyResources(DEFAULT_SOURCE, root), /拒绝覆盖/);
  const portable = fs.readFileSync(path.join(__dirname, 'build-portable.cjs'), 'utf8');
  assert.match(portable, /verifyReaderLicenses\(readerLicenseSource\)/);
  assert.match(portable, /copyReaderLicenses\(readerLicenseSource, path\.join\(portableRoot, 'resources', 'reader-licenses'\)\)/);
});

test('Tauri dev/build/bundle include licenses; missing licenses cannot silently ship', t => {
  const root = temporary(t);
  const modelSource = path.join(root, 'models');
  fs.mkdirSync(path.join(modelSource, 'onnx'), { recursive: true });
  for (const name of ['onnx/model.onnx', 'tokenizer.json', 'config.json', 'special_tokens_map.json', 'tokenizer_config.json']) {
    fs.writeFileSync(path.join(modelSource, name), 'fixture');
  }
  const options = {
    source: path.join(root, 'missing-onboarding'), modelSource,
    manifestPath: path.join(root, 'onboarding-availability.json'),
    config: { bundle: { resources: ['resources/embedding-models/default/**/*'] } },
    browserReader: { platform: 'darwin' }, log: () => {},
  };
  for (const command of ['dev', 'build', 'bundle']) {
    const args = allResourceArguments([command, '--', '--locked'], options);
    const resources = JSON.parse(args[args.indexOf('--config') + 1]).bundle.resources;
    assert.ok(resources.includes('resources/reader-licenses/**/*'));
    assert.deepEqual(args.slice(-2), ['--', '--locked']);
    assert.throws(() => allResourceArguments([command], {
      ...options, readerLicenses: { source: path.join(root, 'missing-licenses') },
    }), /许可资源校验失败/);
  }
  assert.deepEqual(allResourceArguments(['build', '--help'], options), ['build', '--help']);
  assert.deepEqual(resourcePaths(), ['resources/reader-licenses/**/*']);
});
