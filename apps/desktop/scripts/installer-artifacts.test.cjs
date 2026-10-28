const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareInstaller } = require('./installer-artifacts.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuink-installer-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'target/release/bundle/nsis'), { recursive: true });
  fs.writeFileSync(path.join(root, 'target/release/bundle/nsis/Neuink_0.1.3_x64-setup.exe'), 'fixture');
  fs.mkdirSync(path.join(root, 'release/publish'), { recursive: true });
  fs.writeFileSync(path.join(root, 'release/publish/build-info.json'), JSON.stringify({ version: '0.1.3', commit: 'a'.repeat(40) }));
  return root;
}
test('installer publication records unverified signature status and refuses overwrites', async t => {
  const root = fixture(t);
  const result = await prepareInstaller({ root });
  assert.equal(result.signatureStatus, 'not_checked');
  assert.match(fs.readFileSync(path.join(root, 'release/publish/RELEASE_NOTES.md'), 'utf8'), /未知发布者/);
  assert.match(fs.readFileSync(path.join(root, 'release/publish/SHA256SUMS.txt'), 'utf8'), /^[a-f0-9]{64}  Neuink/);
  await assert.rejects(prepareInstaller({ root }), /EEXIST/);
});
