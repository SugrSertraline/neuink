const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { releaseFiles, sourceCommit, verifyArtifacts, githubRelease, downloadArtifacts } = require('./artifacts.cjs');
const { BUCKET, REGION, DOMAIN, createStorage } = require('./storage.cjs');
const { publish, checkConnection } = require('./publish.cjs');

function assertNewestRelease(releases, tag) {
  const published = releases.filter(release => !release.draft && release.published_at)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
  if (published[0]?.tag_name !== tag) throw new Error('Only the newest published Release can update fixed downloads; use archive for older versions');
}

async function run(env = process.env) {
  const action = env.PUBLISH_ACTION || 'check';
  if (!['check', 'verify', 'archive', 'publish'].includes(action)) throw new Error('Unknown deployment action');
  const root = path.resolve(__dirname, '../..');
  const directory = fs.mkdtempSync(path.join(env.RUNNER_TEMP || os.tmpdir(), 'neuink-cdn-'));
  let result;
  if (action === 'check') {
    result = await checkConnection({ storage: createStorage(env), directory });
  } else {
    const event = env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : {};
    const tag = env.RELEASE_TAG || event.release?.tag_name;
    const repository = env.GITHUB_REPOSITORY;
    if (!env.GH_TOKEN) throw new Error('GitHub token is required for Release metadata');
    const release = await githubRelease(repository, tag, env.GH_TOKEN);
    const groups = releaseFiles(release, tag);
    const commit = sourceCommit(root, tag);
    if (action === 'publish') {
      const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=100`, {
        headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`Cannot confirm latest Release (HTTP ${response.status})`);
      assertNewestRelease(await response.json(), tag);
    }
    await downloadArtifacts(release, groups, repository, directory);
    const files = await verifyArtifacts(directory, groups, tag, commit);
    if (env.PUBLISH_TRANSPORT === 'fetch') {
      for (const file of files) file.sourceUrl = `https://github.com/${repository}/releases/download/${tag}/${file.name}`;
    }
    console.log(`Verified ${tag} from main commit ${commit}: ${files.length} release files`);
    result = action === 'verify' ? { verified: true, tag, commit }
      : await publish({ storage: createStorage(env), files, release, directory, archiveOnly: action === 'archive' });
  }
  const message = `Qiniu ${action} succeeded\nBucket: ${BUCKET}\nRegion: ${REGION}\nDomain: ${DOMAIN}\n${JSON.stringify(result, null, 2)}`;
  console.log(message);
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `### Qiniu deployment\n\n\`\`\`text\n${message}\n\`\`\`\n`);
  return result;
}

module.exports = { run, assertNewestRelease };
if (require.main === module) run().catch(error => {
  // Never print SDK response objects, request headers, upload tokens or stack traces.
  let message = String(error.message || 'Deployment failed');
  for (const key of ['QINIU_ACCESS_KEY', 'QINIU_SECRET_KEY', 'GH_TOKEN']) if (process.env[key]) message = message.replaceAll(process.env[key], '[redacted]');
  console.error(message);
  process.exitCode = 1;
});
