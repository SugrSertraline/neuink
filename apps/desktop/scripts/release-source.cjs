const path = require('node:path');
const DEFAULT_ROOT = path.resolve(__dirname, '../../..');
function validateReleaseSource(root = DEFAULT_ROOT, context = process.env) {
  const event = context.GITHUB_EVENT_NAME, ref = context.GITHUB_REF;
  const branches = ['main', 'beta', 'alpha'];
  if (event === 'pull_request' && branches.includes(context.GITHUB_BASE_REF)) return 'pull-request-validation';
  if (['push', 'workflow_dispatch'].includes(event) && branches.some(branch => ref === `refs/heads/${branch}`)) return ref.slice(11);
  if (event === 'push' && /^refs\/tags\/v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(ref || '')) return 'release-tag';
  throw new Error('Release builds require a public product branch or version tag; PRs validate only.');
}
module.exports = { validateReleaseSource };
if (require.main === module) {
  try { console.log(`Release source verified: ${validateReleaseSource()}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
