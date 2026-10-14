const qiniu = require('qiniu');
const { setTimeout: delay } = require('node:timers/promises');
const crypto = require('node:crypto');

const BUCKET = 'sugrsertraline';
const REGION = 'z2';
const DOMAIN = 'https://cdn.sugrsertraline.top';

function publicUrl(key) {
  if (!/^[A-Za-z0-9._/-]+$/.test(key) || key.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid publication key');
  return `${DOMAIN}/${key}`;
}

async function sdkResult(promise, operation, allowMissing = false) {
  let result;
  try { result = await promise; } catch { throw new Error(`${operation}: Qiniu transport failure`); }
  if (allowMissing && result.resp?.statusCode === 612) return null;
  if (!result.ok()) throw new Error(`${operation}: Qiniu HTTP ${result.resp?.statusCode || 'unknown'}`);
  return result.data;
}

function createStorage(env = process.env) {
  if (!env.QINIU_ACCESS_KEY || !env.QINIU_SECRET_KEY) throw new Error('Missing QINIU_ACCESS_KEY or QINIU_SECRET_KEY');
  const mac = new qiniu.auth.digest.Mac(env.QINIU_ACCESS_KEY, env.QINIU_SECRET_KEY);
  const region = qiniu.httpc.Region.fromRegionId(REGION, { preferredScheme: 'https' });
  const config = new qiniu.conf.Config({ useHttpsDomain: true, regionsProvider: new qiniu.httpc.StaticRegionsProvider([region]) });
  const manager = new qiniu.rs.BucketManager(mac, config);
  const uploader = new qiniu.resume_up.ResumeUploader(config);
  return {
    stat: key => { publicUrl(key); return sdkResult(manager.stat(BUCKET, key), `Inspect ${key}`, true); },
    async upload(key, file, { immutable = false, temporary = false } = {}) {
      publicUrl(key);
      const policy = new qiniu.rs.PutPolicy({ scope: `${BUCKET}:${key}`, insertOnly: immutable ? 1 : 0, expires: 3600, ...(temporary ? { deleteAfterDays: 1 } : {}) });
      const extra = qiniu.resume_up.PutExtra.create();
      let lastProgress = 0;
      console.log(`Uploading: ${key}`);
      extra.progressCallback = (uploaded, total) => {
        if (Date.now() - lastProgress >= 15000 || uploaded === total) {
          console.log(`Upload progress: ${key} ${uploaded}/${total} bytes (${Math.floor(uploaded / total * 100)}%)`);
          lastProgress = Date.now();
        }
      };
      const uploaded = await sdkResult(uploader.putFileV2(policy.uploadToken(mac), key, file, extra), `Upload ${key}`);
      if (uploaded.key !== key) throw new Error(`Unexpected uploaded key: ${key}`);
      return uploaded;
    },
    async copy(source, destination, { immutable = false } = {}) {
      publicUrl(source); publicUrl(destination);
      await sdkResult(manager.copy(BUCKET, source, BUCKET, destination, { force: !immutable }), `Copy ${destination}`);
    },
    async fetchRelease(url, key) {
      publicUrl(key);
      console.log(`Fetching public release into Qiniu: ${key}`);
      await sdkResult(manager.fetch(url, BUCKET, key), `Fetch ${key}`);
    },
    async expireTransferObject(key) {
      publicUrl(key);
      if (!key.startsWith('releases/_transfers/')) throw new Error('Only transfer staging objects may expire');
      await sdkResult(manager.deleteAfterDays(BUCKET, key, 1), `Expire transfer ${key}`, true);
    },
    async expireCheckObject(key) {
      publicUrl(key);
      if (!key.startsWith('releases/_checks/') || !key.endsWith('.txt')) throw new Error('Only connection-check objects may expire');
      await sdkResult(manager.deleteAfterDays(BUCKET, key, 1), `Expire connection check ${key}`);
    },
    async refresh(keys) {
      const urls = keys.map(publicUrl);
      // The SDK's CDN wrapper uses HTTP; sign with its public helper and send over HTTPS.
      const url = 'https://fusion.qiniuapi.com/v2/tune/refresh';
      const response = await fetch(url, {
        method: 'POST', headers: { Authorization: qiniu.util.generateAccessToken(mac, url, ''), 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }), signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`CDN refresh failed (HTTP ${response.status})`);
      const body = await response.json();
      if (body.code !== 200 || body.invalidUrls?.length) throw new Error(`CDN refresh rejected (code ${Number(body.code) || 'unknown'})`);
    },
  };
}

function sameObject(remote, file) { return remote && remote.hash === file.etag && remote.fsize === file.size; }

async function verifyPublic(key, file, { attempts = 18, pause = delay, request = fetch } = {}) {
  const url = publicUrl(key);
  let lastResponse = 'no response';
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await request(url, { method: file.size <= 32768 ? 'GET' : 'HEAD', headers: { 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(30000) });
      const etag = (response.headers.get('etag') || '').replace(/^W\//, '').replaceAll('"', '');
      lastResponse = `HTTP ${response.status}, length=${response.headers.get('content-length') || 'unknown'}, etag=${etag || 'missing'}`;
      if (response.ok) {
        if (file.size > 32768 && Number(response.headers.get('content-length')) === file.size && etag === file.etag) return;
        if (file.size <= 32768 && response.body) {
          // A CDN may send JSON chunked or change its ETag for a compressed representation.
          // The bounded, decoded bytes and SHA256 are authoritative for these small files.
          const hash = crypto.createHash('sha256');
          let received = 0;
          for await (const chunk of response.body) {
            received += chunk.length;
            if (received > file.size) break;
            hash.update(chunk);
          }
          const actual = hash.digest('hex');
          if (received === file.size && actual === file.sha256) return;
          lastResponse += `, bodyLength=${received}, sha256=${actual}`;
        }
      }
      await response.body?.cancel();
    } catch { /* Cache propagation and temporary network failures are retried within this bound. */ }
    if (attempt + 1 < attempts) await pause(10000);
  }
  throw new Error(`CDN did not serve the expected file: ${key} (${lastResponse})`);
}

async function uploadChecked(storage, key, file, options) {
  const before = await storage.stat(key);
  if (sameObject(before, file)) return;
  if (before && options?.immutable) throw new Error(`Published version already contains different bytes: ${key}`);
  const uploaded = await storage.upload(key, file.file, options);
  if (uploaded.hash !== file.etag || !sameObject(await storage.stat(key), file)) throw new Error(`Uploaded object verification failed: ${key}`);
}

async function copyChecked(storage, source, destination, file) {
  if (!sameObject(await storage.stat(source), file)) throw new Error(`Copy source verification failed: ${source}`);
  if (sameObject(await storage.stat(destination), file)) return;
  await storage.copy(source, destination);
  if (!sameObject(await storage.stat(destination), file)) throw new Error(`Copied object verification failed: ${destination}`);
}

async function fetchChecked(storage, key, file) {
  const url = new URL(file.sourceUrl);
  const prefix = 'https://github.com/SugrSertraline/neuink/releases/download/';
  if (!url.href.startsWith(prefix) || url.search || url.hash || !/^v[\w.-]+\/[\w.-]+$/.test(url.href.slice(prefix.length)) || !url.pathname.endsWith(`/${file.name}`)) throw new Error('Unexpected public Release source');
  const before = await storage.stat(key);
  if (sameObject(before, file)) return;
  if (before) throw new Error(`Published version already contains different bytes: ${key}`);
  const temporary = `releases/_transfers/${crypto.randomUUID()}/${file.name}`;
  try {
    await storage.fetchRelease(url.href, temporary);
    if (!sameObject(await storage.stat(temporary), file)) throw new Error(`Fetched file verification failed: ${file.name}`);
    // Never overwrite an immutable version or copy unverified remote bytes into it.
    await storage.copy(temporary, key, { immutable: true });
    if (!sameObject(await storage.stat(key), file)) throw new Error(`Fetched archive verification failed: ${key}`);
  } finally {
    // Set expiration only after copying, so the permanent archive cannot inherit it.
    await storage.expireTransferObject(temporary);
  }
}

module.exports = { BUCKET, REGION, DOMAIN, createStorage, publicUrl, sameObject, verifyPublic, uploadChecked, copyChecked, fetchChecked };
