const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { validateReleaseSource } = require('./release-source.cjs');

function validateSource({ testBuild, root, env = process.env }) {
  if (testBuild) return 'local-preview';
  if (env.GITHUB_ACTIONS === 'true') return validateReleaseSource(root, env);
  const branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  if (branch !== 'main') throw new Error('正式安装包必须从 main 构建；beta 可用 installer:test 生成隔离的本地预览版。');
  if (spawnSync('git', ['diff', '--quiet', 'HEAD'], { cwd: root, windowsHide: true }).status !== 0) throw new Error('正式安装包要求 main 没有未提交的修改。');
  return 'main';
}
function main() {
  if (process.platform !== 'win32') throw new Error('请在 Windows 上构建安装包。');
  const desktop = path.resolve(__dirname, '..'), root = path.resolve(desktop, '../..');
  const testBuild = process.argv.includes('--test');
  validateSource({ testBuild, root });
  const runtime = require('./windows-runtime.cjs').findVcRuntimeDir();
  console.log('当前构建流程不配置 Windows 代码签名。');
  const args = [path.join(__dirname, 'tauri.cjs'), 'build', '--bundles', 'nsis'];
  const config = { bundle: { windows: { nsis: { installerHooks: path.join(desktop, 'src-tauri/windows/installer-hooks.nsh') } } } };
  if (testBuild) {
    args.push('--debug');
    Object.assign(config, { productName: 'Neuink Preview', identifier: 'com.neuink.preview' });
    // Fast local validation; formal releases retain LZMA compression.
    Object.assign(config.bundle.windows.nsis, { startMenuFolder: 'Neuink Preview', compression: 'zlib' });
  }
  args.push('--config', JSON.stringify(config));
  const result = spawnSync(process.execPath, args, { cwd: desktop, stdio: 'inherit', windowsHide: true, env: { ...process.env, NEUINK_VC_RUNTIME_DIR: runtime } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Windows 安装包构建失败。');
}
module.exports = { validateSource };
if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
