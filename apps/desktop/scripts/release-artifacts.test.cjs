const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepareRelease } = require('./release-artifacts.cjs');
function fixture(t, included) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuink-release-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = path.join(root, 'release/Neuink-portable-20261004-010000');
  fs.mkdirSync(path.join(base, 'resources'), { recursive: true });
  fs.writeFileSync(`${base}.zip`, 'fixture');
  fs.writeFileSync(path.join(base, 'resources/onboarding-availability.json'), JSON.stringify({ included }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"version":"0.1.0"}');
  fs.mkdirSync(path.join(root, 'apps/desktop/src-tauri'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/desktop/package.json'), '{"version":"0.1.0"}');
  fs.writeFileSync(path.join(root, 'apps/desktop/src-tauri/tauri.conf.json'), '{"version":"0.1.0"}');
  fs.writeFileSync(path.join(root, 'Cargo.toml'), '[workspace.package]\nversion = "0.1.0"\n');
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: '0.1.0', packages: { '': { version: '0.1.0' }, 'apps/desktop': { version: '0.1.0' } } }));
  return root;
}
for (const included of [true, false]) test(`release metadata honestly reports demo=${included} and refuses overwrite`, async t => {
  const root = fixture(t, included);
  const result = await prepareRelease({ root, commit: 'a'.repeat(40), ref: 'main', gitRef: '' });
  assert.equal(result.demoIncluded, included);
  assert.match(fs.readFileSync(path.join(root, 'release/publish/SHA256SUMS.txt'), 'utf8'), /^[a-f0-9]{64}  Neuink/);
  await assert.rejects(prepareRelease({ root, commit: 'a'.repeat(40), gitRef: '' }), /EEXIST/);
});
test('ambiguous old ZIPs are never silently published', async t => {
  const root = fixture(t, false);
  fs.writeFileSync(path.join(root, 'release/Neuink-portable-20261003-010000.zip'), 'old');
  await assert.rejects(prepareRelease({ root, commit: 'a'.repeat(40), gitRef: '' }), /exactly one/);
});
test('wrong release tag fails before producing publish assets', async t => {
  const root = fixture(t, false);
  await assert.rejects(prepareRelease({ root, commit: 'a'.repeat(40), gitRef: 'refs/tags/v9.9.9' }), /tag mismatch/);
  assert.equal(fs.existsSync(path.join(root, 'release/publish')), false);
});
