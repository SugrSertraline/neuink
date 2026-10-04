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
    '# Windows x64 便携版', '', `源码提交：${sha}`, '',
    '下载 Neuink-windows-x64-portable.zip，完整解压后运行 Neuink.exe。不要只复制 EXE。',
    '包含本地 embedding 模型、网页/PDF/视频字幕读取组件及第三方声明；不包含个人资料库、API Key 或聊天记录。',
    availability.included ? '包含离线演示素材。' : '本包不含离线演示 PDF/解析素材，新手演示不可用；正常导入与阅读不受影响。', '',
    '需要 Windows 10 1903+/Windows 11 x64 和 Microsoft Edge WebView2 Runtime。本版本未签名。',
    '更新前备份资料库，关闭旧程序，将新版解压到新目录；不要覆盖或删除用户资料库。',
    '版本确认使用 build-info.json 的 commit，完整性检查使用 SHA256SUMS.txt。', '',
    '此条目由 Actions 生成草稿，维护者人工测试后再发布。', ''
  ].join('\n'), { flag: 'wx' });
  return metadata;
}
module.exports = { prepareRelease };
if (require.main === module) prepareRelease().then(info => console.log(JSON.stringify(info)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
