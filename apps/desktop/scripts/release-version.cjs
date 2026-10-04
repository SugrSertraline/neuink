const fs = require('node:fs');
const path = require('node:path');
const DEFAULT_ROOT = path.resolve(__dirname, '../../..');

function validateVersion(root = DEFAULT_ROOT, gitRef = process.env.GITHUB_REF || '') {
  const readJson = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const versions = {
    'package.json': readJson('package.json').version,
    'apps/desktop/package.json': readJson('apps/desktop/package.json').version,
    'tauri.conf.json': readJson('apps/desktop/src-tauri/tauri.conf.json').version,
  };
  const cargo = fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8');
  const workspace = cargo.match(/^\[workspace\.package\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  versions['Cargo.toml workspace.package'] = workspace?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  const lock = readJson('package-lock.json');
  versions['package-lock.json'] = lock.version;
  versions['package-lock.json root'] = lock.packages?.['']?.version;
  versions['package-lock.json desktop'] = lock.packages?.['apps/desktop']?.version;
  const version = versions['package.json'];
  const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
  const parsed = typeof version === 'string' && version.match(semver);
  if (!parsed || parsed[4]?.split('.').some(part => /^0\d+$/.test(part))) throw new Error('Invalid release version');
  for (const [file, value] of Object.entries(versions)) {
    if (value !== version) throw new Error(`Version mismatch: ${file}=${value}; expected ${version}`);
  }
  if (gitRef.startsWith('refs/tags/') && gitRef !== `refs/tags/v${version}`) {
    throw new Error(`Release tag mismatch: ${gitRef}; expected refs/tags/v${version} (including prerelease suffix)`);
  }
  return version;
}

module.exports = { validateVersion };
if (require.main === module) {
  try { console.log(`Release version verified: ${validateVersion()}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
