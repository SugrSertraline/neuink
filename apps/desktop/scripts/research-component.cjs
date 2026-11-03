const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const LOCK = require('../resources/research/component-lock.json');
const DEFAULT_SOURCE = path.resolve(__dirname, '../src-tauri/resources/research-component');
function verifyResources(source = DEFAULT_SOURCE) {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  if (manifest.component_id !== LOCK.component_id || manifest.platform !== LOCK.platform) throw new Error('研究组件版本不匹配，请重新构建组件。');
  const archive = path.join(source, 'component.zip');
  if (fs.statSync(archive).size !== manifest.size) throw new Error('研究组件不完整。');
  const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(128 * 1024);
  const descriptor = fs.openSync(archive, 'r');
  try { let count; while ((count = fs.readSync(descriptor, buffer)) > 0) hash.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(descriptor); }
  if (hash.digest('hex') !== manifest.sha256) throw new Error('研究组件校验失败。');
  return manifest;
}
function resourcePaths({ command = 'build', source = DEFAULT_SOURCE, platform = process.platform, log = console.log } = {}) {
  if (platform !== 'win32') return [];
  if (command === 'dev' && !fs.existsSync(path.join(source, 'manifest.json'))) {
    log('研究组件尚未构建，深度研究安装入口将提示缺少组件。'); return [];
  }
  verifyResources(source);
  return ['resources/research-component/component.zip', 'resources/research-component/manifest.json'];
}
function copyResources(source, destination) {
  verifyResources(source);
  if (fs.existsSync(destination)) throw new Error('拒绝覆盖已有研究组件目录。');
  fs.mkdirSync(destination, { recursive: true });
  for (const name of ['component.zip', 'manifest.json']) fs.copyFileSync(path.join(source, name), path.join(destination, name), fs.constants.COPYFILE_EXCL);
  return verifyResources(destination);
}
module.exports = { DEFAULT_SOURCE, verifyResources, resourcePaths, copyResources };
