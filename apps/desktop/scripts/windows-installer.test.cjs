const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSource } = require('./build-windows-installer.cjs');
const config = require('../src-tauri/tauri.windows.conf.json');
test('Windows setup is per-user, bilingual and cannot silently downgrade', () => {
  assert.deepEqual(config.bundle.targets, ['nsis']);
  assert.equal(config.bundle.windows.nsis.installMode, 'currentUser');
  assert.deepEqual(config.bundle.windows.nsis.languages, ['SimpChinese', 'English']);
  assert.equal(config.bundle.windows.allowDowngrades, false);
});
test('release installer accepts main CI only; preview remains explicit', () => {
  assert.equal(validateSource({ testBuild: true }), 'local-preview');
  assert.equal(validateSource({ root: '.', env: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' } }), 'main');
  assert.throws(() => validateSource({ root: '.', env: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/beta' } }));
});
