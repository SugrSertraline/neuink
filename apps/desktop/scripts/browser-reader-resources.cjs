const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const LOCK = require('./browser-reader-lock.json');

const DEFAULT_SOURCE = path.resolve(__dirname, '../src-tauri/resources/browser-reader');
const DEFAULT_CACHE = path.resolve(__dirname, '../../../.cache/browser-reader-downloads');
const MANIFEST = 'runtime-manifest.json';
const PYTHON_PATH = 'python/python.exe';
const QUICKJS_PATH = 'quickjs/qjs.exe';
const PYTHON_SEARCH_PATH = 'python313.zip\n.\nLib/site-packages\n';
const REQUIRED_FILES = Object.freeze([
  PYTHON_PATH, QUICKJS_PATH, 'python/python313.dll', 'python/python313.zip',
  'python/python313._pth', 'python/LICENSE.txt',
  'python/Lib/site-packages/yt_dlp/__main__.py',
  'python/Lib/site-packages/yt_dlp_ejs/__init__.py',
  'python/Lib/site-packages/yt_dlp-2026.8.19.dist-info/licenses/LICENSE',
  'python/Lib/site-packages/yt_dlp_ejs-0.8.0.dist-info/licenses/LICENSE',
  'licenses/QuickJS-LICENSE.txt', 'THIRD_PARTY_NOTICES.txt', 'source-lock.json',
  ...LOCK.assets.filter(asset => asset.destination.startsWith('licenses/')).map(asset => asset.destination),
]);
const LOCK_HASH = sha256(Buffer.from(JSON.stringify(LOCK)));
const PREPARE_HINT = '运行 npm --workspace apps/desktop run prepare:browser-reader 显式准备资源（约 16 MB）；应用不会自动下载。';

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function safePath(root, relative) {
  if (typeof relative !== 'string' || !relative || /[\\:]/.test(relative)
    || relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`无效运行时相对路径：${relative}`);
  }
  const base = path.resolve(root);
  const target = path.resolve(base, relative);
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error('运行时路径越界');
  return target;
}

function runtimeFiles(root, relative = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`运行时不允许符号链接：${name}`);
    if (entry.isDirectory()) result.push(...runtimeFiles(root, name));
    else if (entry.isFile() && name !== MANIFEST) result.push(name);
    else if (!entry.isFile()) throw new Error(`不支持的运行时文件：${name}`);
  }
  return result.sort();
}

function writeRuntimeManifest(root) {
  const files = Object.fromEntries(runtimeFiles(root).map(name => [name, sha256(fs.readFileSync(safePath(root, name)))]));
  const manifest = { version: 1, platform: LOCK.platform, lockSha256: LOCK_HASH,
    python: LOCK.pythonVersion, ytDlp: LOCK.ytDlpVersion, ejs: LOCK.ejsVersion,
    quickJs: LOCK.quickJsVersion, files };
  fs.writeFileSync(path.join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}

function verifyResources(root = DEFAULT_SOURCE) {
  try {
    if (fs.lstatSync(root).isSymbolicLink()) throw new Error('运行时目录不能是符号链接');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8'));
    if (manifest.version !== 1 || manifest.platform !== LOCK.platform || manifest.lockSha256 !== LOCK_HASH
      || manifest.python !== LOCK.pythonVersion || manifest.ytDlp !== LOCK.ytDlpVersion
      || manifest.ejs !== LOCK.ejsVersion || manifest.quickJs !== LOCK.quickJsVersion
      || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
      throw new Error('运行时版本或清单无效');
    }
    for (const name of REQUIRED_FILES) {
      if (!Object.hasOwn(manifest.files, name)) throw new Error(`清单缺少 ${name}`);
    }
    const names = Object.keys(manifest.files).sort();
    if (JSON.stringify(names) !== JSON.stringify(runtimeFiles(root))) throw new Error('运行时文件集与清单不一致');
    for (const name of names) {
      const file = safePath(root, name);
      if (!/^[a-f0-9]{64}$/.test(manifest.files[name])
        || sha256(fs.readFileSync(file)) !== manifest.files[name]) throw new Error(`文件校验失败：${name}`);
    }
    if (fs.readFileSync(path.join(root, 'python/python313._pth'), 'utf8') !== PYTHON_SEARCH_PATH) {
      throw new Error('Python 隔离路径配置无效');
    }
    return manifest;
  } catch (error) {
    throw new Error(`网页视频读取运行时缺失或无效：${error.message}。${PREPARE_HINT}`);
  }
}

function inspectResources(root = DEFAULT_SOURCE) {
  try { return { included: true, manifest: verifyResources(root) }; }
  catch (error) { return { included: false, reason: error.message }; }
}

function resourcePaths({ source = DEFAULT_SOURCE, command = 'build', platform = process.platform,
  arch = process.arch, log = console.log } = {}) {
  if (platform !== 'win32' || arch !== 'x64') {
    log('视频字幕运行时目前仅随 Windows x64 包提供；此平台的网页和 PDF 读取不受影响。');
    return [];
  }
  const result = inspectResources(source);
  if (!result.included) {
    if (command !== 'dev') throw new Error(result.reason);
    log(`视频字幕读取暂不可用：${result.reason}`);
    return [];
  }
  log(`已校验视频字幕运行时：yt-dlp ${LOCK.ytDlpVersion}，Python ${LOCK.pythonVersion}，QuickJS ${LOCK.quickJsVersion}。`);
  // An existing, verified non-empty tree keeps the Tauri CLI argument within Windows' command-line limit.
  return ['resources/browser-reader/**/*'];
}

function copyResources(source, destination) {
  const manifest = verifyResources(source);
  const target = path.resolve(destination);
  if (fs.existsSync(target)) throw new Error(`拒绝覆盖已有视频运行时目录：${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(target), '.browser-reader-copy-'));
  try {
    for (const name of [...Object.keys(manifest.files), MANIFEST]) {
      const output = safePath(staging, name);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.copyFileSync(safePath(source, name), output, fs.constants.COPYFILE_EXCL);
    }
    verifyResources(staging);
    publishDirectory(staging, target);
  } finally { removeOwnedStaging(staging, path.dirname(target), '.browser-reader-copy-'); }
}

function publishDirectory(staging, target) {
  // Defender can briefly hold newly extracted executables after the offline probes exit.
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(staging, target); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 20) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

function replacePreparedRuntime(staging, target) {
  const previous = JSON.parse(fs.readFileSync(path.join(target, MANIFEST), 'utf8'));
  const oldNames = Object.keys(previous.files ?? {}).sort();
  if (previous.version !== 1 || JSON.stringify(oldNames) !== JSON.stringify(runtimeFiles(target))) {
    throw new Error('已有运行时含未识别文件或清单不完整；请先保存该目录后重新准备，程序不会覆盖这些文件。');
  }
  const next = verifyResources(staging);
  const backup = fs.mkdtempSync(path.join(path.dirname(target), '.browser-reader-backup-'));
  for (const name of [...oldNames, MANIFEST]) {
    const saved = safePath(backup, name);
    fs.mkdirSync(path.dirname(saved), { recursive: true });
    fs.copyFileSync(safePath(target, name), saved, fs.constants.COPYFILE_EXCL);
  }
  const publishFile = (from, to) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const temporary = `${to}.${randomUUID()}.tmp`;
    try { fs.copyFileSync(from, temporary, fs.constants.COPYFILE_EXCL); publishDirectory(temporary, to); }
    finally { fs.rmSync(temporary, { force: true }); }
  };
  try {
    for (const name of Object.keys(next.files)) {
      const output = safePath(target, name);
      if (fs.existsSync(output) && sha256(fs.readFileSync(output)) === next.files[name]) continue;
      publishFile(safePath(staging, name), output);
    }
    for (const name of oldNames) if (!Object.hasOwn(next.files, name)) fs.unlinkSync(safePath(target, name));
    publishFile(path.join(staging, MANIFEST), path.join(target, MANIFEST));
    verifyResources(target);
    return backup;
  } catch (error) {
    // The backup remains recoverable even if a full disk or file lock also prevents rollback.
    try {
      for (const name of [...oldNames, MANIFEST]) publishFile(safePath(backup, name), safePath(target, name));
      for (const name of Object.keys(next.files)) {
        if (!Object.hasOwn(previous.files, name)) fs.rmSync(safePath(target, name), { force: true });
      }
    } catch { throw new Error(`运行时发布与恢复未完成；原文件完整保留于 ${backup}。${error.message}`); }
    throw error;
  }
}

function removeOwnedStaging(staging, parent, prefix) {
  const resolved = path.resolve(staging);
  if (path.dirname(resolved) !== path.resolve(parent) || !path.basename(resolved).startsWith(prefix)) {
    throw new Error('拒绝清理范围外的临时目录');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function fetchOfficialAsset(url) {
  if (process.platform !== 'win32') return fetch(url, { signal: AbortSignal.timeout(60_000) });
  // PowerShell uses Windows' configured networking/proxy settings, unlike Node's default fetch.
  const temporary = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'neuink-reader-download-'));
  const file = path.join(temporary, 'asset');
  const quote = value => `'${value.replace(/'/g, "''")}'`;
  const script = `$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri ${quote(url)} -OutFile ${quote(file)} -TimeoutSec 60`;
  try {
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'pipe', timeout: 75_000 });
    if (fs.statSync(file).size > 40 * 1024 * 1024) throw new Error('运行时资源超出下载大小限制');
    return new Response(fs.readFileSync(file));
  } finally { removeOwnedStaging(temporary, path.dirname(temporary), 'neuink-reader-download-'); }
}

async function downloadAsset(asset, cache = DEFAULT_CACHE, fetchAsset = fetchOfficialAsset) {
  const target = safePath(cache, asset.name);
  if (fs.existsSync(target) && sha256(fs.readFileSync(target)) === asset.sha256) return target;
  const response = await fetchAsset(asset.url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`下载 ${asset.name} 失败：HTTP ${response.status}`);
  if (response.url && new URL(response.url).protocol !== 'https:') throw new Error('运行时资源只能通过 HTTPS 下载');
  const parts = []; let length = 0;
  for await (const part of response.body) {
    length += part.length;
    if (length > 40 * 1024 * 1024) throw new Error(`资源超出大小限制：${asset.name}`);
    parts.push(part);
  }
  const bytes = Buffer.concat(parts);
  if (sha256(bytes) !== asset.sha256) throw new Error(`下载 SHA256 校验失败：${asset.name}`);
  fs.mkdirSync(cache, { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally { fs.rmSync(temporary, { force: true }); }
  return target;
}

function extractZip(archive, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const quote = value => `'${value.replace(/'/g, "''")}'`;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$zip = [IO.Compression.ZipFile]::OpenRead(${quote(path.resolve(archive))})`,
    `$outputRoot = [IO.Path]::GetFullPath(${quote(path.resolve(destination))}) + [IO.Path]::DirectorySeparatorChar`,
    'try {',
    'foreach ($entry in $zip.Entries) {',
    '$outputPath = [IO.Path]::GetFullPath([IO.Path]::Combine($outputRoot, $entry.FullName))',
    "if (!$outputPath.StartsWith($outputRoot, [StringComparison]::OrdinalIgnoreCase) -or $entry.FullName.Contains(':')) { throw 'Archive path escapes output directory' }",
    '}',
    'foreach ($entry in $zip.Entries) {',
    '$outputPath = [IO.Path]::GetFullPath([IO.Path]::Combine($outputRoot, $entry.FullName))',
    'if ($entry.Name) {',
    '[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null',
    '[IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $outputPath, $false)',
    '} else { [IO.Directory]::CreateDirectory($outputPath) | Out-Null }',
    '}',
    '} finally { $zip.Dispose() }',
  ].join('\n');
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'pipe', timeout: 60_000 });
}

function smokeTest(root = DEFAULT_SOURCE) {
  const python = safePath(root, PYTHON_PATH);
  const options = { encoding: 'utf8', windowsHide: true, timeout: 30_000, cwd: root };
  const version = execFileSync(python, ['-I', '-B', '-m', 'yt_dlp', '--version'], options).trim();
  if (version !== LOCK.ytDlpVersion) throw new Error(`yt-dlp 版本不符：${version}`);
  const probe = 'import sys, ssl, importlib.metadata as m; import yt_dlp_ejs; '
    + `assert sys.flags.isolated and sys.dont_write_bytecode; assert m.version("yt-dlp-ejs") == "${LOCK.ejsVersion}"; `
    + 'print(sys.version.split()[0]); print(ssl.OPENSSL_VERSION)';
  const environment = execFileSync(python, ['-I', '-B', '-c', probe], options).trim();
  if (environment.split(/\r?\n/)[0] !== LOCK.pythonVersion) throw new Error('Python 版本不符');
  const quickJs = execFileSync(safePath(root, QUICKJS_PATH), ['--version'], options).trim();
  if (!quickJs.includes(LOCK.quickJsVersion)) throw new Error(`QuickJS 版本不符：${quickJs}`);
  return { ytDlp: version, python: environment, quickJs };
}

function writeNotices(root) {
  fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), [
    'NeuInk browser video reader runtime', '',
    `CPython ${LOCK.pythonVersion}: Python Software Foundation License Version 2 and bundled component notices: python/LICENSE.txt and licenses/Python-license.rst.`,
    'The original Python LICENSE.txt includes Microsoft CRT, bzip2, libffi and OpenSSL notices. Additional HACL, BLAKE2, Expat, mpdecimal, liblzma/xz and zlib notices are retained in licenses/. SQLite is public domain: https://sqlite.org/copyright.html .',
    `yt-dlp ${LOCK.ytDlpVersion}: Unlicense. Full wheel, metadata and licenses are retained under python/Lib/site-packages.`,
    `yt-dlp-ejs ${LOCK.ejsVersion}: Unlicense AND MIT AND ISC; astring 1.9.0 and meriyah 6.1.4 licenses are in licenses/ and remain in the unmodified JavaScript banners.`,
    `QuickJS-NG ${LOCK.quickJsVersion}: MIT, see licenses/QuickJS-LICENSE.txt.`, '',
    'The official QuickJS Windows executable statically includes mimalloc (MIT). Its release workflow does not pin the mimalloc version; licenses/mimalloc-LICENSE.txt records the license source, not a claim about the binary dependency version. The official workflow is retained as licenses/QuickJS-release.yml.', '',
    'Only the pure Python yt-dlp and EJS wheels are included; the PyInstaller executable and optional default extras are not included.',
    'No FFmpeg or transcription model is bundled. This runtime reads available site subtitles and metadata.',
    'Prepared from exact official assets listed in source-lock.json; installed-file hashes are in runtime-manifest.json.',
    'Python isolated search paths are configured by NeuInk; upstream package source is unmodified.', '',
  ].join('\n'));
}

async function prepareResources({ source = DEFAULT_SOURCE, cache = DEFAULT_CACHE, log = console.log } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('视频运行时准备目前仅支持 Windows x64。');
  if (inspectResources(source).included) { log('视频字幕运行时已准备且校验通过。'); return smokeTest(source); }
  const target = path.resolve(source);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(target), '.browser-reader-prepare-'));
  try {
    for (const asset of LOCK.assets) {
      log(`准备 ${asset.name}（固定版本与 SHA256）…`);
      const downloaded = await downloadAsset(asset, cache);
      const destination = safePath(staging, asset.destination);
      if (asset.kind === 'zip') extractZip(downloaded, destination);
      else {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(downloaded, destination, fs.constants.COPYFILE_EXCL);
      }
    }
    fs.writeFileSync(path.join(staging, 'python/python313._pth'), PYTHON_SEARCH_PATH);
    fs.writeFileSync(path.join(staging, 'source-lock.json'), `${JSON.stringify(LOCK, null, 2)}\n`);
    writeNotices(staging);
    const result = smokeTest(staging);
    writeRuntimeManifest(staging);
    verifyResources(staging);
    let backup;
    if (fs.existsSync(target)) {
      backup = replacePreparedRuntime(staging, target);
    } else publishDirectory(staging, target);
    if (backup) log(`旧运行时已保留，可恢复：${backup}`);
    log('视频字幕运行时已准备；离线启动与文件校验通过。');
    return result;
  } finally { removeOwnedStaging(staging, path.dirname(target), '.browser-reader-prepare-'); }
}

module.exports = { LOCK, LOCK_HASH, DEFAULT_SOURCE, MANIFEST, PYTHON_PATH, QUICKJS_PATH,
  PYTHON_SEARCH_PATH, REQUIRED_FILES, sha256, safePath, runtimeFiles, writeRuntimeManifest,
  verifyResources, inspectResources, resourcePaths, copyResources, downloadAsset, extractZip,
  smokeTest, prepareResources, replacePreparedRuntime };

if (require.main === module) {
  Promise.resolve().then(() => {
    if (process.argv.includes('--prepare')) return prepareResources();
    verifyResources();
    return process.argv.includes('--smoke-test') ? smokeTest() : { verified: true };
  }).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
