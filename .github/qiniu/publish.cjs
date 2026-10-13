const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fingerprint } = require('./artifacts.cjs');
const { verifyPublic, uploadChecked, copyChecked, publicUrl } = require('./storage.cjs');

async function publish({ storage, files, release, directory, archiveOnly = false, verify = verifyPublic, log = console.log }) {
  const prefix = `releases/${release.tag_name}`;
  // Complete and verify the immutable archive before touching any fixed download URL.
  for (const file of files) {
    const key = `${prefix}/${file.name}`;
    await uploadChecked(storage, key, file, { immutable: true });
    log(`Verified archive: ${key}`);
  }
  for (const file of files) await verify(`${prefix}/${file.name}`, file);
  if (archiveOnly) return { prefix, aliasesUpdated: false };
  for (const file of files) {
    await copyChecked(storage, `${prefix}/${file.name}`, file.name, file);
    log(`Updated download: ${file.name}`);
  }
  await storage.refresh(files.map(file => file.name));
  for (const file of files) await verify(file.name, file);
  const manifest = {
    tag: release.tag_name, releaseUrl: release.html_url, publishedAt: release.published_at,
    files: files.map(({ name, size, sha256 }) => ({ name, size, sha256, url: publicUrl(`${prefix}/${name}`) })),
  };
  const file = path.join(directory, 'cdn-latest.json');
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  const latest = { file, ...await fingerprint(file) };
  // Commit the public manifest only after every selected platform is downloadable.
  await uploadChecked(storage, 'releases/latest.json', latest);
  await storage.refresh(['releases/latest.json']);
  await verify('releases/latest.json', latest);
  return { prefix, aliasesUpdated: true };
}

async function checkConnection({ storage, directory, verify = verifyPublic, log = console.log }) {
  const key = `releases/_checks/${crypto.randomUUID()}.txt`;
  const file = path.join(directory, 'connection-check.txt');
  // Exercise both first upload and replacement at the same URL; no installer is touched.
  for (const revision of [1, 2]) {
    fs.writeFileSync(file, `Neuink CDN connection check\nrevision=${revision}\n`);
    const item = { file, ...await fingerprint(file) };
    await uploadChecked(storage, key, item, { temporary: true });
    await storage.refresh([key]);
    await verify(key, item);
    log(`Connection check revision ${revision}: upload, stat, refresh and public download verified`);
  }
  // Both temporary objects already exist and expire; exercise replacement without touching installers.
  const copyKey = key.replace(/\.txt$/, '-copy.txt');
  fs.writeFileSync(file, 'Neuink CDN copy target\n');
  await uploadChecked(storage, copyKey, { file, ...await fingerprint(file) }, { temporary: true });
  fs.writeFileSync(file, 'Neuink CDN connection check\nrevision=2\n');
  const latest = { file, ...await fingerprint(file) };
  await copyChecked(storage, key, copyKey, latest);
  await storage.expireCheckObject(copyKey);
  await storage.refresh([copyKey]);
  await verify(copyKey, latest);
  log('Connection check: server-side replacement and public download verified');
  return { key, copyKey, expiresAfterDays: 1 };
}

module.exports = { publish, checkConnection };
