const { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');

const REQUIRED_FILES = Object.freeze([
  'demo.json', 'attention-is-all-you-need.pdf', 'segments.json', 'mineru.zip', 'NOTICE.txt',
]);
const DEFAULT_SOURCE = path.resolve(__dirname, '../src-tauri/resources/onboarding');
const DEFAULT_MODEL_SOURCE = path.resolve(__dirname, '../src-tauri/resources/embedding-models/default');
const DEFAULT_MANIFEST_PATH = path.resolve(__dirname, '../src-tauri/resources/onboarding-availability.json');

function readResources(directory) {
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
  return files;
}

function resourceHashes(files) {
  return Object.fromEntries([...files].map(([name, bytes]) => [
    name, createHash('sha256').update(bytes).digest('hex'),
  ]));
}

function verifyResources(directory = DEFAULT_SOURCE) {
  return resourceHashes(readResources(directory));
}

function inspectResources(directory = DEFAULT_SOURCE) {
  try {
    return { included: true, hashes: verifyResources(directory) };
  } catch (error) {
    return { included: false, reason: error.message };
  }
}

function reportResources(result, log = console.log) {
  log(result.included
    ? '已选择 5 个离线新手教程素材文件（存在及基础格式检查通过；运行时另做完整校验）。'
    : `跳过整套离线新手教程素材：${result.reason}；应用主体和 embedding 模型仍正常打包。`);
}

function copySnapshot(files, destination) {
  const target = path.resolve(destination);
  if (existsSync(target)) throw new Error(`拒绝覆盖已有素材目录：${target}`);
  mkdirSync(path.dirname(target), { recursive: true });
  // Publish one verified directory, never a partially copied tutorial. Cleanup only owns this new temporary directory.
  const staging = mkdtempSync(path.join(path.dirname(target), '.onboarding-copy-'));
  try {
    for (const [name, bytes] of files) writeFileSync(path.join(staging, name), bytes, { flag: 'wx' });
    if (JSON.stringify(verifyResources(staging)) !== JSON.stringify(resourceHashes(files))) {
      throw new Error('新手教程素材复制后的校验值不一致');
    }
    renameSync(staging, target);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function copyResources(source, destination) {
  copySnapshot(readResources(source), destination);
}

function copyOptionalResources(source, destination, log = console.log) {
  let files;
  try {
    files = readResources(source);
  } catch (error) {
    reportResources({ included: false, reason: error.message }, log);
    return false;
  }
  // Destination I/O failures still fail the build; they must not produce a misleading successful partial package.
  copySnapshot(files, destination);
  reportResources({ included: true }, log);
  return true;
}

function assertEmbeddingResources(directory = DEFAULT_MODEL_SOURCE) {
  for (const name of ['onnx/model.onnx', 'tokenizer.json', 'config.json', 'special_tokens_map.json', 'tokenizer_config.json']) {
    const file = path.join(directory, name);
    if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0) {
      throw new Error(`缺少必需 embedding 资源：${file}；不能仅凭 README 或缓存目录生成安装包。`);
    }
  }
}

function writeAvailabilityManifest(included, manifestPath = DEFAULT_MANIFEST_PATH) {
  if (typeof included !== 'boolean') throw new Error('演示素材包含状态必须是布尔值。');
  const target = path.resolve(manifestPath);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, included }) + '\n', { flag: 'wx' });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function prepareResources({ source = DEFAULT_SOURCE, modelSource = DEFAULT_MODEL_SOURCE,
  manifestPath = DEFAULT_MANIFEST_PATH, log = console.log } = {}) {
  assertEmbeddingResources(modelSource);
  const result = inspectResources(source);
  // Always overwrite the state, including false: Tauri's resource copying does not remove old tutorial files.
  writeAvailabilityManifest(result.included, manifestPath);
  reportResources(result, log);
  return result;
}

module.exports = { REQUIRED_FILES, DEFAULT_SOURCE, DEFAULT_MODEL_SOURCE, DEFAULT_MANIFEST_PATH, verifyResources, inspectResources,
  copyResources, copyOptionalResources, assertEmbeddingResources, prepareResources, writeAvailabilityManifest };

if (require.main === module) {
  try {
    if (process.argv.includes('--optional')) prepareResources();
    else {
      verifyResources();
      console.log('离线新手教程素材存在及基础格式检查通过（5 个文件）；运行时另做完整校验。');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
