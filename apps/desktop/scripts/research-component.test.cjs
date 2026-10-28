const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { resourcePaths, verifyResources, copyResources } = require('./research-component.cjs');
const lock = require('../resources/research/component-lock.json');
test('release requires a verified component; dev can explain its absence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neuink-component-'));
  const source = path.join(root, 'source'); fs.mkdirSync(source);
  try {
    assert.throws(() => resourcePaths({ source, platform: 'win32' }));
    const logs = [];
    assert.deepEqual(resourcePaths({ command: 'dev', source, platform: 'win32', log: message => logs.push(message) }), []);
    assert.equal(logs.length, 1);
    const content = Buffer.from('fixture archive');
    fs.writeFileSync(path.join(source, 'component.zip'), content);
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({ ...lock, size: content.length, sha256: crypto.createHash('sha256').update(content).digest('hex') }));
    assert.equal(resourcePaths({ source, platform: 'win32' }).length, 2);
    const copy = path.join(root, 'portable');
    fs.writeFileSync(path.join(source, 'unrelated.txt'), 'must not ship');
    copyResources(source, copy);
    assert.deepEqual(fs.readdirSync(copy).sort(), ['component.zip', 'manifest.json']);
    assert.throws(() => copyResources(source, copy), /拒绝覆盖/);
    // A changed payload must fail even when its file size still matches.
    fs.writeFileSync(path.join(source, 'component.zip'), Buffer.alloc(content.length));
    assert.throws(() => verifyResources(source), /校验失败/);
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('neuink-component-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
