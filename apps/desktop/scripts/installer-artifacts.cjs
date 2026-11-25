const fs = require('node:fs');
const path = require('node:path');
const { hashFile } = require('./embedding-resources.cjs');

async function prepareInstaller({ root = path.resolve(__dirname, '../../..') } = {}) {
  const source = path.join(root, 'target/release/bundle/nsis');
  const candidates = fs.readdirSync(source).filter(name => name.endsWith('-setup.exe'));
  if (candidates.length !== 1) throw new Error('Expected exactly one freshly built Windows installer');
  const installer = path.join(source, candidates[0]);
  const output = path.join(root, 'release/publish');
  const metadata = JSON.parse(fs.readFileSync(path.join(output, 'build-info.json'), 'utf8'));
  const name = 'Neuink-windows-x64-setup.exe';
  const info = { version: metadata.version, commit: metadata.commit, platform: 'windows-x64', signatureStatus: 'not_checked', researchInstallation: 'optional-offline', sha256: await hashFile(installer) };
  fs.copyFileSync(installer, path.join(output, name), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(output, 'installer-info.json'), JSON.stringify(info, null, 2) + '\n', { flag: 'wx' });
  fs.appendFileSync(path.join(output, 'SHA256SUMS.txt'), `${info.sha256}  ${name}\n${await hashFile(path.join(output, 'installer-info.json'))}  installer-info.json\n`);
  fs.appendFileSync(path.join(output, 'RELEASE_NOTES.md'), [
    '\n## Windows 安装版', '',
    `运行 ${name}，安装到当前用户目录，可从开始菜单启动或在 Windows 应用列表卸载。`,
    'Research 为可选功能：设置 → 检索与工具 → 深度研究，点击安装并启用；可查看进度、取消或重试。安装包内含压缩组件，无需另装 Python。',
    '资料保存在安装目录旁的 data，更新及默认卸载不删除这份资料。安装到新位置时不会自动复制 D 盘已有资料。',
    '当前构建流程不配置或验证 Windows 代码签名，安装时可能显示未知发布者。', '',
  ].join('\n'));
  return info;
}
module.exports = { prepareInstaller };
if (require.main === module) prepareInstaller().then(info => console.log(JSON.stringify(info)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
