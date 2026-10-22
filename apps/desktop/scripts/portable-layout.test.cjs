const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { preparePortableLayout } = require('./portable-layout.cjs');

test('a portable release starts with an explicit marker and no personal settings or library', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuink-portable-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  preparePortableLayout(root);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'neuink.portable.json'), 'utf8')), { version: 1 });
  assert.deepEqual(fs.readdirSync(path.join(root, 'data')), ['说明.txt']);
  fs.writeFileSync(path.join(root, 'data/settings.json'), 'existing private settings');
  assert.throws(() => preparePortableLayout(root));
  assert.equal(fs.readFileSync(path.join(root, 'data/settings.json'), 'utf8'), 'existing private settings');
});
