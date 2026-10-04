// Explicit build-time preparation only; never imported by the application runtime.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const LOCK = require('./embedding-lock.json');
const DEFAULT_SOURCE = path.resolve(__dirname, '../src-tauri/resources/embedding-models/default');
const CONFIG = { provider: 'fastembed-local', model_name: LOCK.repository, dimensions: 384 };

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function targetPath(root, name) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.split('/').some(p => !p || p === '..' || p === '.')) {
    throw new Error('Invalid model resource path');
  }
  const resolved = path.resolve(root, name);
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Model path escapes root');
  return resolved;
}

async function download(url, destination) {
  if (process.platform !== 'win32') {
    // Stream large model files to disk, retaining HTTPS across redirects.
    execFileSync('curl', ['--fail', '--location', '--proto', '=https', '--proto-redir', '=https',
      '--retry', '2', '--connect-timeout', '30', '--max-time', '600', '--output', destination, url],
    { stdio: 'pipe', timeout: 630_000 });
    return;
  }
  // Use Windows OS networking/proxy settings rather than Node's default fetch.
  const quote = value => `'${value.replace(/'/g, "''")}'`;
  const script = `$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri ${quote(url)} -OutFile ${quote(destination)} -TimeoutSec 600`;
  execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, stdio: 'pipe', timeout: 630_000 });
}

async function prepare({ root = DEFAULT_SOURCE, lock = LOCK, fetchFile = download, verifyOnly = false } = {}) {
  if (!/^[\w-]+\/[\w.-]+$/.test(lock.repository) || !/^[a-f0-9]{40}$/.test(lock.revision)) throw new Error('Invalid pinned model');
  for (const [name, expected] of Object.entries(lock.files)) {
    if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Invalid model checksum');
    // Keep the repository placeholder README and distribute the original model card separately.
    const target = targetPath(root, name === 'README.md' ? 'MODEL_CARD.md' : name);
    if (fs.existsSync(target)) {
      if (await hashFile(target) !== expected) throw new Error(`Existing model checksum mismatch: ${name}; file preserved`);
      continue;
    }
    if (verifyOnly) throw new Error(`Missing model resource: ${name}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await fetchFile(`https://huggingface.co/${lock.repository}/resolve/${lock.revision}/${name}`, temporary);
      if (await hashFile(temporary) !== expected) throw new Error(`Downloaded model checksum mismatch: ${name}`);
      fs.copyFileSync(temporary, target, fs.constants.COPYFILE_EXCL);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  const configPath = path.join(root, 'neuink-embedding.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (Object.entries(CONFIG).some(([key, value]) => config[key] !== value)) throw new Error('Existing embedding configuration mismatch');
  } else if (verifyOnly) throw new Error('Missing embedding configuration');
  else fs.writeFileSync(configPath, JSON.stringify(CONFIG, null, 2) + '\n', { flag: 'wx' });
  // E5 model card declares MIT; upstream code/notice: https://github.com/microsoft/unilm/tree/master/e5
  const license = fs.readFileSync(path.join(__dirname, 'embedding-LICENSE.txt'));
  const licensePath = path.join(root, 'LICENSE.txt');
  if (fs.existsSync(licensePath)) {
    if (!fs.readFileSync(licensePath).equals(license)) throw new Error('Existing embedding license mismatch');
  } else if (verifyOnly) throw new Error('Missing embedding license');
  else fs.writeFileSync(licensePath, license, { flag: 'wx' });
}

module.exports = { prepare, hashFile, targetPath };
if (require.main === module) prepare({ verifyOnly: process.argv.includes('--verify') })
  .then(() => console.log('Pinned embedding files and SHA256 verified.'))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
