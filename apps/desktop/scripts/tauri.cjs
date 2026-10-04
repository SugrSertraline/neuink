const { readFileSync } = require('node:fs');
const path = require('node:path');
const { REQUIRED_FILES, prepareResources } = require('./onboarding-resources.cjs');
const { resourcePaths: browserReaderResourcePaths } = require('./browser-reader-resources.cjs');
const { resourcePaths: readerLicenseResourcePaths } = require('./reader-licenses.cjs');

/** Empty optional globs are errors in Tauri. Pass only files verified before the CLI loads its config. */
function resourceArguments(args, options = {}) {
  if (!['build', 'dev', 'bundle'].includes(args[0]) || args.includes('--help') || args.includes('-h')) return args;
  const config = options.config ?? JSON.parse(readFileSync(path.resolve(__dirname, '../src-tauri/tauri.conf.json'), 'utf8'));
  const { included } = prepareResources(options);
  const resources = [...config.bundle.resources];
  if (included) resources.push(...REQUIRED_FILES.map(name => `resources/onboarding/${name}`));
  const separator = args.indexOf('--');
  const at = separator < 0 ? args.length : separator;
  return [...args.slice(0, at), '--config', JSON.stringify({ bundle: { resources } }), ...args.slice(at)];
}

function allResourceArguments(args, options = {}) {
  const selected = resourceArguments(args, options);
  if (selected === args) return args;
  const separator = selected.indexOf('--');
  const configAt = selected.lastIndexOf('--config', separator < 0 ? selected.length : separator);
  const config = JSON.parse(selected[configAt + 1]);
  config.bundle.resources.push(...browserReaderResourcePaths({
    ...options.browserReader, command: args[0], log: options.log ?? console.log,
  }));
  config.bundle.resources.push(...readerLicenseResourcePaths(options.readerLicenses));
  if (process.platform === 'darwin' && process.arch === 'x64' && process.env.NEUINK_MACOS_INTEL_RUNTIME) {
    config.bundle.macOS = require('./macos-intel-runtime.cjs').bundleConfig(process.env.NEUINK_MACOS_INTEL_RUNTIME);
  }
  const result = [...selected];
  result[configAt + 1] = JSON.stringify(config);
  return result;
}

module.exports = { resourceArguments, allResourceArguments };

if (require.main === module) {
  Promise.resolve().then(() => require('@tauri-apps/cli').run(allResourceArguments(process.argv.slice(2)), 'npm run tauri'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
