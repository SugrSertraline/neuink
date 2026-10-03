const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_SOURCE = path.resolve(__dirname, '../src-tauri/resources/reader-licenses');
const MANIFEST = 'manifest.json';
const COMPONENTS = {
  readability: {
    version: '0.6.0', license: 'Apache-2.0',
    source: 'https://github.com/mozilla/readability/tree/0.6.0',
  },
  'pdfjs-dist': {
    version: '6.0.227', license: 'Apache-2.0 and bundled asset notices',
    source: 'https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.0.227.tgz',
  },
  subtp: {
    version: '0.2.0', license: 'MIT OR Apache-2.0',
    source: 'https://static.crates.io/crates/subtp/subtp-0.2.0.crate',
  },
};

// Exact upstream bytes are preserved. Updating a dependency requires reviewing its notices and hashes.
const FILES = [
  ['readability/LICENSE.md', 'readability', 'LICENSE.md', 'a5b1e8181751ce05b85b7bfaa832b785e87086250a5148e679d17ca9bdcfa958'],
  ['readability/LICENSE-APACHE', 'pdfjs-dist', 'LICENSE', '0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594'],
  ['pdfjs-dist/LICENSE', 'pdfjs-dist', 'LICENSE', '0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594'],
  ['pdfjs-dist/cmaps/LICENSE', 'pdfjs-dist', 'cmaps/LICENSE', 'aa92ab5a472974865a96fd4a4e9c13bb41bf6fe1b309cb6b8da48bc9e19839a2'],
  ['pdfjs-dist/iccs/LICENSE', 'pdfjs-dist', 'iccs/LICENSE', '286e4fd7b447330b2c88e23890e3cd0a9d38cb398d4a59cb247f578ccbda3213'],
  ['pdfjs-dist/standard_fonts/LICENSE_FOXIT', 'pdfjs-dist', 'standard_fonts/LICENSE_FOXIT', 'b578cdd2345840ada550bd12519533812320d5f1d21cf4c1c7e1b1b0a31c98b7'],
  ['pdfjs-dist/standard_fonts/LICENSE_LIBERATION', 'pdfjs-dist', 'standard_fonts/LICENSE_LIBERATION', '93fed46019c38bbe566b479d22148e2e8a1e85ada614accb0211c37b2c61c19b'],
  ['pdfjs-dist/wasm/LICENSE_JBIG2', 'pdfjs-dist', 'wasm/LICENSE_JBIG2', '9e66b7f1b934a28b37f3bc4dac97915de1674271e79a0a88182a18ed9731b4d1'],
  ['pdfjs-dist/wasm/LICENSE_OPENJPEG', 'pdfjs-dist', 'wasm/LICENSE_OPENJPEG', 'a6af136f3e15038a666b61f376612a07d9a4e48cb7c01adbf3e33b3f14ab49b6'],
  ['pdfjs-dist/wasm/LICENSE_PDFJS_JBIG2', 'pdfjs-dist', 'wasm/LICENSE_PDFJS_JBIG2', 'aad3cce09842e00e9e11ad5e8fef8cc02fbc3a3768fe2f007443b9cee37aaee5'],
  ['pdfjs-dist/wasm/LICENSE_PDFJS_OPENJPEG', 'pdfjs-dist', 'wasm/LICENSE_PDFJS_OPENJPEG', '717fc62da03292dbb4dd0c8280bd4ce7bb8550dcf31d772bc93455fb50313425'],
  ['pdfjs-dist/wasm/LICENSE_PDFJS_QCMS', 'pdfjs-dist', 'wasm/LICENSE_PDFJS_QCMS', 'eb5104ca33552be007857a28351bc408f379ddd4bfacab1226b09c6d1e9fd7c4'],
  ['pdfjs-dist/wasm/LICENSE_QCMS', 'pdfjs-dist', 'wasm/LICENSE_QCMS', '36d847ae882f6574ebc72f56a4f354e4f104fde4a584373496482e97d52d31bc'],
  ['subtp/LICENSE-APACHE', 'subtp', 'LICENSE-APACHE', 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4'],
  ['subtp/LICENSE-MIT', 'subtp', 'LICENSE-MIT', 'a110a0bbeb1d6a6178c98294180abf9d14540abc1aac2a417dac9bdf2d7cc78e'],
];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function expectedManifest() {
  return {
    version: 1, components: COMPONENTS,
    notes: 'Original license bytes, unmodified. Readability Apache-2.0 full text is copied from the identical standard license supplied by PDF.js. Video-runtime notices are separately retained in resources/browser-reader.',
    files: Object.fromEntries(FILES.map(([name, component, upstreamPath, hash]) => [name, {
      component, upstreamPath, source: COMPONENTS[component].source, sha256: hash,
    }])),
  };
}

function listFiles(root, prefix = '') {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`许可目录不允许符号链接：${relative}`);
    if (entry.isDirectory()) return listFiles(path.join(root, entry.name), `${relative}/`);
    if (!entry.isFile()) throw new Error(`许可目录包含非普通文件：${relative}`);
    return [relative];
  }).sort();
}

function verifyResources(root = DEFAULT_SOURCE) {
  try {
    if (fs.lstatSync(root).isSymbolicLink()) throw new Error('许可目录不能为符号链接');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8'));
    const expected = expectedManifest();
    if (JSON.stringify(manifest) !== JSON.stringify(expected)) throw new Error('版本或来源清单不符');
    const names = [...FILES.map(([name]) => name), MANIFEST].sort();
    if (JSON.stringify(listFiles(root)) !== JSON.stringify(names)) throw new Error('许可文件集不完整或包含额外文件');
    for (const [name, , , hash] of FILES) {
      if (sha256(fs.readFileSync(path.join(root, name))) !== hash) throw new Error(`SHA256 校验失败：${name}`);
    }
    return manifest;
  } catch (error) {
    throw new Error(`读取组件许可资源校验失败：${error.message}。请恢复 resources/reader-licenses，或运行 npm run prepare:reader-licenses；不会自动下载。`);
  }
}

function findSubtpRoot() {
  const registry = path.join(process.env.CARGO_HOME || path.join(os.homedir(), '.cargo'), 'registry/src');
  if (!fs.existsSync(registry)) return undefined;
  return fs.readdirSync(registry).map(name => path.join(registry, name, 'subtp-0.2.0'))
    .find(candidate => fs.existsSync(path.join(candidate, 'LICENSE-MIT')));
}

function prepareResources({ source = DEFAULT_SOURCE, vendoredRoot = DEFAULT_SOURCE,
  pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json')),
  readabilityRoot = path.join(PROJECT_ROOT, 'crates/neuink-ipc/src/commands/vendor/readability'),
  subtpRoot = findSubtpRoot() } = {}) {
  if (fs.existsSync(source)) return verifyResources(source);
  const roots = { readability: readabilityRoot, 'pdfjs-dist': pdfjsRoot, subtp: subtpRoot };
  const pdfPackage = JSON.parse(fs.readFileSync(path.join(pdfjsRoot, 'package.json'), 'utf8'));
  if (pdfPackage.version !== COMPONENTS['pdfjs-dist'].version) throw new Error('PDF.js 版本已变化，请更新读取组件许可清单。');
  // Read and verify everything before creating output; existing directories are never overwritten.
  const contents = FILES.map(([name, component, original, hash]) => {
    const originalPath = roots[component] && path.join(roots[component], original);
    const input = originalPath && fs.existsSync(originalPath) ? originalPath : path.join(vendoredRoot, name);
    const bytes = fs.readFileSync(input);
    if (sha256(bytes) !== hash) throw new Error(`上游许可 SHA256 校验失败：${name}`);
    return [name, bytes];
  });
  const target = path.resolve(source);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(target), '.reader-licenses-'));
  try {
    for (const [name, bytes] of contents) {
      fs.mkdirSync(path.dirname(path.join(staging, name)), { recursive: true });
      fs.writeFileSync(path.join(staging, name), bytes, { flag: 'wx' });
    }
    fs.writeFileSync(path.join(staging, MANIFEST), `${JSON.stringify(expectedManifest(), null, 2)}\n`, { flag: 'wx' });
    verifyResources(staging);
    // Windows may deny renaming a populated directory. Claim a new destination exclusively,
    // then publish the manifest last; an interrupted copy always fails packaging verification.
    fs.mkdirSync(target);
    for (const [name] of FILES) {
      fs.mkdirSync(path.dirname(path.join(target, name)), { recursive: true });
      fs.copyFileSync(path.join(staging, name), path.join(target, name), fs.constants.COPYFILE_EXCL);
    }
    fs.copyFileSync(path.join(staging, MANIFEST), path.join(target, MANIFEST), fs.constants.COPYFILE_EXCL);
    return verifyResources(target);
  } finally {
    // Only this operation's freshly allocated sibling staging directory can be removed.
    if (path.dirname(staging) === path.dirname(target) && path.basename(staging).startsWith('.reader-licenses-')) {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
}

function resourcePaths({ source = DEFAULT_SOURCE } = {}) {
  verifyResources(source);
  return ['resources/reader-licenses/**/*'];
}

function copyResources(source, destination) {
  verifyResources(source);
  if (fs.existsSync(destination)) throw new Error(`拒绝覆盖已存在的许可目录：${destination}`);
  fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
  return verifyResources(destination);
}

module.exports = { DEFAULT_SOURCE, COMPONENTS, FILES, MANIFEST, expectedManifest,
  verifyResources, prepareResources, resourcePaths, copyResources };

if (require.main === module) {
  try {
    const result = process.argv.includes('--prepare') ? prepareResources() : verifyResources();
    console.log(`读取组件许可已校验：${Object.keys(result.files).length} 份原文，3 个固定版本组件。`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
