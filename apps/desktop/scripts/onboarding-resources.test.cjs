const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { REQUIRED_FILES, DEFAULT_SOURCE, verifyResources, copyResources } = require('./onboarding-resources.cjs');

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

test('installer explicitly packages every required file and invokes preflight', () => {
  const config = JSON.parse(readFileSync(path.resolve(__dirname, '../src-tauri/tauri.conf.json'), 'utf8'));
  for (const name of REQUIRED_FILES) assert.ok(config.bundle.resources.includes(`resources/onboarding/${name}`));
  assert.ok(config.build.beforeBuildCommand.startsWith('npm run check:onboarding-resources &&'));
});

test('copy verifies identical bytes and excludes unrelated local files', (t) => {
  const source = fixture(t);
  writeFileSync(path.join(source, 'private.txt'), 'not a bundled resource');
  const destination = path.join(source, 'output');
  copyResources(source, destination);
  assert.deepEqual(verifyResources(destination), verifyResources(source));
  assert.equal(existsSync(path.join(destination, 'private.txt')), false);
});

test('missing or empty assets stop packaging', (t) => {
  const source = fixture(t);
  writeFileSync(path.join(source, 'mineru.zip'), '');
  assert.throws(() => verifyResources(source), /mineru.zip/);
  rmSync(path.join(source, 'mineru.zip'));
  assert.throws(() => copyResources(source, path.join(source, 'output')), /mineru.zip/);
  assert.equal(existsSync(path.join(source, 'output')), false);
});

test('invalid PDF, ZIP and unbound note references stop packaging', (t) => {
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

test('locally supplied real bundle survives portable resource assembly', {
  skip: !REQUIRED_FILES.every((name) => existsSync(path.join(DEFAULT_SOURCE, name))),
}, (t) => {
  const destination = path.join(fixture(t), 'real-output');
  copyResources(DEFAULT_SOURCE, destination);
  assert.deepEqual(verifyResources(destination), verifyResources(DEFAULT_SOURCE));
  assert.equal(JSON.parse(readFileSync(path.join(destination, 'segments.json'), 'utf8')).length, 165);
});
