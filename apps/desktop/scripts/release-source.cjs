const path = require('node:path');
const { spawnSync } = require('node:child_process');
const DEFAULT_ROOT = path.resolve(__dirname, '../../..');

function validateReleaseSource(root = DEFAULT_ROOT, context = process.env) {
  const event = context.GITHUB_EVENT_NAME;
  const ref = context.GITHUB_REF;
  if (event === 'pull_request' && context.GITHUB_BASE_REF === 'main') {
    return 'pull-request-validation';
  }
  if (['push', 'workflow_dispatch'].includes(event) && ref === 'refs/heads/main') {
    return 'main';
  }
  if (event === 'push' && /^refs\/tags\/v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(ref || '')) {
    const result = spawnSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'refs/remotes/origin/main'], {
      cwd: root, stdio: 'ignore', windowsHide: true, timeout: 15000,
    });
    if (result.status !== 0) {
      throw new Error('Release tag must point to a commit already included in origin/main. Full checkout history is required.');
    }
    return 'main-release-tag';
  }
  throw new Error('Release builds require main. Develop on beta and merge after approval; PRs targeting main run validation only.');
}

module.exports = { validateReleaseSource };
if (require.main === module) {
  try { console.log(`Release source verified: ${validateReleaseSource()}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
