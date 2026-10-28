const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { hashFile } = require('./embedding-resources.cjs');
const { validateVersion } = require('./release-version.cjs');

async function prepareRelease({ root = path.resolve(__dirname, '../../..'), commit, ref, gitRef = process.env.GITHUB_REF || '' } = {}) {
  const version = validateVersion(root, gitRef);
  const release = path.join(root, 'release');
  const zips = fs.readdirSync(release).filter(name => /^Neuink-portable-\d{8}-\d{6}\.zip$/.test(name));
  if (zips.length !== 1) throw new Error('Expected exactly one freshly built portable ZIP; refuse to guess');
  const source = path.join(release, zips[0]);
  const availability = JSON.parse(fs.readFileSync(path.join(release, zips[0].slice(0, -4), 'resources/onboarding-availability.json'), 'utf8'));
  if (typeof availability.included !== 'boolean') throw new Error('Missing demo availability');
  const sha = commit || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid source commit');
  const output = path.join(release, 'publish');
  fs.mkdirSync(output); // Refuse to overwrite an earlier publish folder.
  const name = 'Neuink-windows-x64-portable.zip';
  fs.copyFileSync(source, path.join(output, name), fs.constants.COPYFILE_EXCL);
  const metadata = { version,
    commit: sha, ref: ref || process.env.GITHUB_REF_NAME || 'local', platform: 'windows-x64',
    embedding: true, browserReader: true, demoIncluded: availability.included,
    builtAt: new Date().toISOString(), zipSha256: await hashFile(source) };
  fs.writeFileSync(path.join(output, 'build-info.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), `${metadata.zipSha256}  ${name}\n${await hashFile(path.join(output, 'build-info.json'))}  build-info.json\n`, { flag: 'wx' });
  fs.writeFileSync(path.join(output, 'RELEASE_NOTES.md'), [
    `# Neuink ${version} · Windows x64 便携版`, '', `源码提交：${sha}`, '',
    ...releaseChanges(root, version),
    '下载 Neuink-windows-x64-portable.zip，完整解压后运行 Neuink.exe。不要只复制 EXE。',
    '包含本地 embedding 模型、网页/PDF/视频字幕读取组件及第三方声明；不包含个人资料库、API Key 或聊天记录。',
    availability.included ? '包含离线演示素材。' : '本包不含离线演示 PDF/解析素材，新手演示不可用；正常导入与阅读不受影响。', '',
    '需要 Windows 10 1903+/Windows 11 x64 和 Microsoft Edge WebView2 Runtime。签名状态请检查程序文件的数字签名；校验和不代替发布者签名。',
    'Windows 安装版和便携版均将资料、设置和阅读状态固定保存在程序旁的 data。移动时复制整个程序文件夹，退出后再安全弹出移动盘。',
    '更新前备份并保留整个 data，将新程序与原 data 放在一起；不要用公开包的空 data 覆盖个人数据。',
    '启动时自动检查程序目录旁及所在磁盘根目录的 neuink_data，合并缺少的资料并保留当前冲突内容；校验成功后旧目录进入系统回收站。失败保留原目录，不会永久删除。公开包不包含个人配置或密钥。',
    '版本确认使用 build-info.json 的 commit，完整性检查使用 SHA256SUMS.txt。', '',
    '发布前请核对本版附件、校验值和平台验收状态。', ''
  ].join('\n'), { flag: 'wx' });
  return metadata;
}
function releaseChanges(root, version) {
  const file = path.join(root, 'CHANGELOG.md');
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const start = lines.findIndex(line => line === `## ${version}` || line.startsWith(`## ${version} `));
  if (start < 0) return [];
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return [...lines.slice(start, next < 0 ? lines.length : next).join('\n').trimEnd().split('\n'), ''];
}
module.exports = { prepareRelease };
if (require.main === module) prepareRelease().then(info => console.log(JSON.stringify(info)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
