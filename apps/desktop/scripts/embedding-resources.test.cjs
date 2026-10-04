const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { prepare, targetPath } = require('./embedding-resources.cjs');
const bytes = Buffer.from('fixture-model');
const hash = createHash('sha256').update(bytes).digest('hex');
const lock = { repository: 'intfloat/multilingual-e5-small', revision: 'a'.repeat(40), files: { 'onnx/model.onnx': hash, 'README.md': hash } };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuink-embedding-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('downloads pinned resources, preserves README, and verifies offline without fetching', async t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'README.md'), 'placeholder');
  await prepare({ root, lock, fetchFile: async (url, destination) => {
    assert.ok(url.startsWith(`https://huggingface.co/${lock.repository}/resolve/${lock.revision}/`));
    fs.writeFileSync(destination, bytes);
  } });
  await prepare({ root, lock, verifyOnly: true, fetchFile: () => assert.fail('unexpected network') });
  assert.equal(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), 'placeholder');
  assert.equal(fs.readFileSync(path.join(root, 'MODEL_CARD.md'), 'utf8'), bytes.toString());
});
test('missing resources fail verification', async t => {
  await assert.rejects(prepare({ root: fixture(t), lock, verifyOnly: true }), /Missing model/);
});
test('rejects corrupt downloads and cleans only its temporary file', async t => {
  const root = fixture(t);
  await assert.rejects(prepare({ root, lock, fetchFile: async (_, file) => fs.writeFileSync(file, 'bad') }), /checksum mismatch/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'onnx')), []);
});
test('never replaces an existing mismatched model', async t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'onnx'));
  fs.writeFileSync(path.join(root, 'onnx/model.onnx'), 'custom-model');
  await assert.rejects(prepare({ root, lock }), /file preserved/);
  assert.equal(fs.readFileSync(path.join(root, 'onnx/model.onnx'), 'utf8'), 'custom-model');
});
test('rejects traversal and unpinned revisions', async t => {
  for (const name of ['../secret', '/secret', 'x/../../secret', 'C:/secret', 'x\\secret']) assert.throws(() => targetPath(fixture(t), name));
  await assert.rejects(prepare({ root: fixture(t), lock: { ...lock, revision: 'main' } }), /Invalid pinned/);
});
