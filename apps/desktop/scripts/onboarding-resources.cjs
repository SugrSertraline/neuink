const { copyFileSync, mkdirSync, readFileSync, statSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');

const REQUIRED_FILES = Object.freeze([
  'demo.json', 'attention-is-all-you-need.pdf', 'segments.json', 'mineru.zip', 'NOTICE.txt',
]);
const DEFAULT_SOURCE = path.resolve(__dirname, '../src-tauri/resources/onboarding');

function verifyResources(directory = DEFAULT_SOURCE) {
  const files = new Map();
  for (const name of REQUIRED_FILES) {
    const file = path.join(directory, name);
    let bytes;
    try {
      if (!statSync(file).isFile()) throw new Error('不是文件');
      bytes = readFileSync(file);
      if (!bytes.length) throw new Error('文件为空');
    } catch (error) {
      throw new Error(`新手教程素材缺失或不可读：${file}；${error.message}`);
    }
    files.set(name, bytes);
  }
  const demo = JSON.parse(files.get('demo.json').toString('utf8'));
  const segments = JSON.parse(files.get('segments.json').toString('utf8'));
  if (demo.version !== 'attention-v1' || !demo.note_markdown?.includes('{source}')
    || !demo.translation || !Array.isArray(segments) || !segments.length
    || !segments.some((segment) => segment.uid === demo.segment_uid)) {
    throw new Error('新手教程模板或解析片段不完整');
  }
  if (files.get('attention-is-all-you-need.pdf').subarray(0, 5).toString() !== '%PDF-'
    || !files.get('mineru.zip').subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    throw new Error('新手教程 PDF 或 MinerU ZIP 格式错误');
  }
  return Object.fromEntries([...files].map(([name, bytes]) => [
    name, createHash('sha256').update(bytes).digest('hex'),
  ]));
}

function copyResources(source, destination) {
  const expected = verifyResources(source);
  mkdirSync(destination, { recursive: true });
  for (const name of REQUIRED_FILES) {
    copyFileSync(path.join(source, name), path.join(destination, name));
  }
  if (JSON.stringify(verifyResources(destination)) !== JSON.stringify(expected)) {
    throw new Error('新手教程素材复制后的校验值不一致');
  }
}

module.exports = { REQUIRED_FILES, DEFAULT_SOURCE, verifyResources, copyResources };

if (require.main === module) {
  try {
    verifyResources();
    console.log('离线新手教程素材检查通过：PDF、解析结果、图片包、演示笔记模板及声明。');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
