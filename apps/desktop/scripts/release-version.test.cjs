const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateVersion } = require('./release-version.cjs');

function fixture(t, version = '0.1.0') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuink-version-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'apps/desktop/src-tauri'), { recursive: true });
  for (const name of ['package.json', 'apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json']) {
    fs.writeFileSync(path.join(root, name), JSON.stringify({ version }));
  }
  fs.writeFileSync(path.join(root, 'Cargo.toml'), `[workspace.package]\nversion = "${version}"\nedition = "2021"\n\n[workspace.dependencies]\n`);
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version }, 'apps/desktop': { version } } }));
  return root;
}

test('release and prerelease tags must match the full application version', t => {
  for (const version of ['0.1.0', '0.1.0-beta.2']) {
    const root = fixture(t, version);
    assert.equal(validateVersion(root, `refs/tags/v${version}`), version);
    assert.equal(validateVersion(root, 'refs/heads/v9.9.9'), version);
    for (const ref of ['refs/tags/v9.9.9', 'refs/tags/v0.1.0-beta.3', 'refs/tags/not-a-version']) {
      assert.throws(() => validateVersion(root, ref), /tag mismatch/);
    }
  }
  assert.throws(() => validateVersion(fixture(t), 'refs/tags/v0.1.0-beta.2'), /tag mismatch/);
});
for (const name of ['apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json', 'package-lock.json']) {
  test(`rejects mismatched ${name}`, t => {
    const root = fixture(t);
    const file = path.join(root, name);
    const value = JSON.parse(fs.readFileSync(file, 'utf8')); value.version = '0.2.0';
    fs.writeFileSync(file, JSON.stringify(value));
    assert.throws(() => validateVersion(root, ''), /Version mismatch/);
  });
}
test('Rust workspace and npm workspace lock versions are checked', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'Cargo.toml'), '[workspace.package]\nversion = "0.2.0"\n');
  assert.throws(() => validateVersion(root, ''), /Cargo.toml/);
  const next = fixture(t);
  const file = path.join(next, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
  lock.packages['apps/desktop'].version = '0.2.0';
  fs.writeFileSync(file, JSON.stringify(lock));
  assert.throws(() => validateVersion(next, ''), /desktop/);
});
test('Mac check always prepares absent demo manifests first; version gate runs before builds', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/windows-portable.yml'), 'utf8');
  const mac = workflow.split('\n  macos:')[1].split('\n  release-draft:')[0];
  const prepare = mac.indexOf('run: npm --workspace apps/desktop run prepare:resources');
  assert.ok(prepare > 0 && prepare < mac.indexOf('run: cargo check'));
  assert.ok(!mac.slice(0, prepare).includes('if: github.event_name'));
  const verify = workflow.split('\n  verify:')[1].split('\n  build:')[0];
  assert.ok(verify.indexOf('run: node apps/desktop/scripts/release-version.cjs') < verify.indexOf('run: npm run desktop:build'));
});
