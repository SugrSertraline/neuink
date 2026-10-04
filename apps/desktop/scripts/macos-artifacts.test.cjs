const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { inspectBundle, verifyNativeBundle } = require('./macos-artifacts.cjs');
const { bundleConfig, LIBRARY } = require('./macos-intel-runtime.cjs');
test('lipo receives the file before verify_arch and signatures are verified', () => {
  const calls = [];
  verifyNativeBundle('/app', '/app/binary', 'arm64', (command, args) => calls.push([command, args]));
  assert.deepEqual(calls, [['lipo', ['/app/binary', '-verify_arch', 'arm64']],
    ['codesign', ['--verify', '--deep', '--strict', '/app']]]);
});
test('Intel runtime is bundled with licenses and must have a portable install name', () => {
  const config = bundleConfig('/runtime');
  assert.deepEqual(config.frameworks, [path.join('/runtime', LIBRARY)]);
  assert.equal(Object.keys(config.files).length, 2);
  assert.equal(config.minimumSystemVersion, '13.3');
  assert.throws(() => verifyNativeBundle('/app', '/app/binary', 'x64', () => '/build/libonnxruntime.dylib'), /bundled/);
  verifyNativeBundle('/app', '/app/binary', 'x64', () => `@executable_path/../Frameworks/${LIBRARY}`);
});
test('macOS bundle requires embedded resources and honestly reports demo absence', t => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'neuink-mac-test-'));
  t.after(() => fs.rmSync(app, { recursive: true, force: true }));
  const resources = path.join(app, 'Contents/Resources/resources');
  fs.mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents/MacOS/neuink-desktop'), 'fixture');
  assert.throws(() => inspectBundle(app), /embedding/);
  const model = path.join(resources, 'embedding-models/default');
  fs.mkdirSync(path.join(model, 'onnx'), { recursive: true });
  for (const name of ['onnx/model.onnx', 'tokenizer.json', 'config.json', 'special_tokens_map.json', 'tokenizer_config.json']) {
    fs.writeFileSync(path.join(model, name), 'fixture');
  }
  fs.cpSync(path.resolve(__dirname, '../src-tauri/resources/reader-licenses'), path.join(resources, 'reader-licenses'), { recursive: true });
  fs.writeFileSync(path.join(resources, 'onboarding-availability.json'), '{"included":false}');
  assert.equal(inspectBundle(app).demoIncluded, false);
  fs.writeFileSync(path.join(resources, 'onboarding-availability.json'), '{"included":true}');
  assert.throws(() => inspectBundle(app), /素材/);
});
