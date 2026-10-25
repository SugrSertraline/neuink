const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateVersion } = require('./release-version.cjs');
const { validateReleaseSource } = require('./release-source.cjs');
const { execFileSync } = require('node:child_process');

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
  const model = mac.indexOf('run: node apps/desktop/scripts/embedding-resources.cjs');
  assert.ok(model > 0 && model < prepare);
  assert.ok(!mac.slice(0, prepare).includes('if: github.event_name'));
  const verify = workflow.split('\n  verify:')[1].split('\n  build:')[0];
  assert.ok(verify.indexOf('run: node apps/desktop/scripts/release-version.cjs') < verify.indexOf('run: npm run desktop:build'));
});
test('Windows resource downloads suppress progress rather than filling child-process buffers', () => {
  for (const file of ['embedding-resources.cjs', 'browser-reader-resources.cjs']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.match(source, /\$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest/);
  }
});

test('only main builds artifacts; main PRs remain validation-only', () => {
  for (const event of ['push', 'workflow_dispatch']) {
    assert.equal(validateReleaseSource(undefined, { GITHUB_EVENT_NAME: event, GITHUB_REF: 'refs/heads/main' }), 'main');
    for (const ref of ['refs/heads/beta', 'refs/heads/seal-campus-travel', 'refs/heads/main-copy', 'refs/tags/not-a-version', '']) {
      assert.throws(() => validateReleaseSource(undefined, { GITHUB_EVENT_NAME: event, GITHUB_REF: ref }), /require main/);
    }
  }
  assert.equal(validateReleaseSource(undefined, { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main', GITHUB_REF: 'refs/pull/1/merge' }), 'pull-request-validation');
  for (const base of ['beta', 'seal-campus-travel', '']) {
    assert.throws(() => validateReleaseSource(undefined, { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: base }), /require main/);
  }
  for (const event of ['pull_request_target', 'schedule', undefined]) {
    assert.throws(() => validateReleaseSource(undefined, { GITHUB_EVENT_NAME: event, GITHUB_REF: 'refs/heads/main' }), /require main/);
  }
});

test('version tags may release main history but cannot release beta-only commits', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuink-release-source-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).toString().trim();
  git('init', '--initial-branch=main');
  git('-c', 'user.name=Neuink test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'approved main');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  for (const tag of ['refs/tags/v0.1.0', 'refs/tags/v0.1.0-beta.2']) {
    assert.equal(validateReleaseSource(root, { GITHUB_EVENT_NAME: 'push', GITHUB_REF: tag }), 'main-release-tag');
  }
  assert.throws(() => validateReleaseSource(root, { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/tags/v0.1.0' }), /require main/);
  git('switch', '-c', 'beta');
  git('-c', 'user.name=Neuink test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'unapproved feature');
  assert.throws(() => validateReleaseSource(root, { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/v0.1.0-beta.2' }), /already included/);
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  assert.equal(validateReleaseSource(root, { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/v0.1.0' }), 'main-release-tag');
  git('update-ref', '-d', 'refs/remotes/origin/main');
  assert.throws(() => validateReleaseSource(root, { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/v0.1.0' }), /Full checkout history/);
});

test('release source gate runs before dependency installation, and all packages depend on verification', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/windows-portable.yml'), 'utf8');
  const verify = workflow.split('\n  verify:')[1].split('\n  build:')[0];
  assert.match(verify, /fetch-depth: 0/);
  assert.ok(verify.indexOf('run: node apps/desktop/scripts/release-source.cjs') < verify.indexOf('run: npm ci'));
  for (const name of ['build', 'macos']) {
    assert.match(workflow.split(`\n  ${name}:`)[1], /^\r?\n    needs: verify/);
  }
  const pages = fs.readFileSync(path.resolve(__dirname, '../../../.github/workflows/pages.yml'), 'utf8');
  assert.match(pages, /pull_request:\r?\n    branches: \[main\]/);
  assert.match(pages, /build:\r?\n    if: github.event_name == 'pull_request' \|\| github.ref == 'refs\/heads\/main'/);
});
