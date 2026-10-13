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
      const uploaded = await sdkResult(uploader.putFileV2(policy.uploadToken(mac), key, file, extra), `Upload ${key}`);
      if (uploaded.key !== key) throw new Error(`Unexpected uploaded key: ${key}`);
      return uploaded;
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
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await request(url, { method: file.size <= 32768 ? 'GET' : 'HEAD', headers: { 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(30000) });
      const etag = (response.headers.get('etag') || '').replace(/^W\//, '').replaceAll('"', '');
      if (response.ok && Number(response.headers.get('content-length')) === file.size && etag === file.etag) {
        if (file.size > 32768) return;
        const actual = crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
        if (actual === file.sha256) return;
      }
      await response.body?.cancel();
    } catch { /* Cache propagation and temporary network failures are retried within this bound. */ }
    if (attempt + 1 < attempts) await pause(10000);
  }
  throw new Error(`CDN did not serve the expected file: ${key}`);
}

async function uploadChecked(storage, key, file, options) {
  const before = await storage.stat(key);
  if (sameObject(before, file)) return;
  if (before && options?.immutable) throw new Error(`Published version already contains different bytes: ${key}`);
  const uploaded = await storage.upload(key, file.file, options);
  if (uploaded.hash !== file.etag || !sameObject(await storage.stat(key), file)) throw new Error(`Uploaded object verification failed: ${key}`);
}

module.exports = { BUCKET, REGION, DOMAIN, createStorage, publicUrl, sameObject, verifyPublic, uploadChecked };
