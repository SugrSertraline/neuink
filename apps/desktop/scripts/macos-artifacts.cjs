const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { hashFile } = require('./embedding-resources.cjs');
const { assertEmbeddingResources, verifyResources: verifyDemo } = require('./onboarding-resources.cjs');
const { verifyResources: verifyLicenses } = require('./reader-licenses.cjs');
const { validateVersion } = require('./release-version.cjs');

function inspectBundle(app) {
  const resources = path.join(app, 'Contents/Resources/resources');
  const binary = path.join(app, 'Contents/MacOS/neuink-desktop');
  if (!fs.statSync(binary).isFile()) throw new Error('Missing macOS executable');
  assertEmbeddingResources(path.join(resources, 'embedding-models/default'));
  verifyLicenses(path.join(resources, 'reader-licenses'));
  const availability = JSON.parse(fs.readFileSync(path.join(resources, 'onboarding-availability.json'), 'utf8'));
  if (typeof availability.included !== 'boolean') throw new Error('Invalid demo manifest');
  if (availability.included) verifyDemo(path.join(resources, 'onboarding'));
  return { binary, demoIncluded: availability.included };
}

async function packageMac(arch) {
  if (process.platform !== 'darwin') throw new Error('macOS packaging requires a macOS runner');
  const targets = { arm64: 'aarch64-apple-darwin', x64: 'x86_64-apple-darwin' };
  if (!targets[arch]) throw new Error('Expected arm64 or x64');
  const root = path.resolve(__dirname, '../../..');
  const version = validateVersion(root);
  const app = path.join(root, 'target', targets[arch], 'release/bundle/macos/Neuink.app');
  const { binary, demoIncluded } = inspectBundle(app);
  execFileSync('lipo', ['-verify_arch', arch === 'x64' ? 'x86_64' : 'arm64', binary]);
  execFileSync('codesign', ['--verify', '--deep', '--strict', app]);
  const output = path.join(root, 'release', `publish-macos-${arch}`);
  fs.mkdirSync(output, { recursive: true });
  const stem = `Neuink-macos-${arch}`;
  const zip = path.join(output, `${stem}.app.zip`);
  if (fs.readdirSync(output).length) throw new Error('Refuse to overwrite macOS artifacts');
  // ditto retains the executable bit, symlinks and app bundle layout.
  execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const metadata = { version, commit, ref: process.env.GITHUB_REF_NAME || 'local', platform: `macos-${arch}`, embedding: true, demoIncluded,
    embeddedBrowser: false, videoRuntime: false, notarized: false, signing: 'ad-hoc',
    builtAt: new Date().toISOString(), zipSha256: await hashFile(zip) };
  const info = `${stem}-build-info.json`;
  fs.writeFileSync(path.join(output, info), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(output, `${stem}-SHA256SUMS.txt`),
    `${metadata.zipSha256}  ${stem}.app.zip\n${await hashFile(path.join(output, info))}  ${info}\n`, { flag: 'wx' });
  console.log(JSON.stringify(metadata));
}
module.exports = { inspectBundle, packageMac };
if (require.main === module) packageMac(process.argv[2]).catch(error => {
  console.error(error.message); process.exitCode = 1;
});
