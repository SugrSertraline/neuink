const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// ORT API 24 matches ort-sys 2.0.0-rc.12. Upstream has no Intel macOS archive.
const REVISION = '2d924974ef147392ced8409d36bd6d2e7fcc8a74';
const LIBRARY = 'libonnxruntime.1.24.4.dylib';
function bundleConfig(directory) {
  return { frameworks: [path.join(directory, LIBRARY)], minimumSystemVersion: '13.3', files: {
    'Resources/onnxruntime-LICENSE.txt': path.join(directory, 'LICENSE'),
    'Resources/onnxruntime-ThirdPartyNotices.txt': path.join(directory, 'ThirdPartyNotices.txt'),
  } };
}
function prepare() {
  if (process.platform !== 'darwin' || process.arch !== 'x64' || !process.env.GITHUB_ENV || !process.env.RUNNER_TEMP) {
    throw new Error('Intel runtime preparation requires an Intel macOS Actions runner');
  }
  const source = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'neuink-ort-'));
  const run = (command, args) => execFileSync(command, args, { cwd: source, stdio: 'inherit' });
  run('git', ['init']);
  run('git', ['remote', 'add', 'origin', 'https://github.com/microsoft/onnxruntime.git']);
  run('git', ['fetch', '--depth', '1', 'origin', REVISION]);
  run('git', ['checkout', '--detach', 'FETCH_HEAD']);
  run('git', ['submodule', 'update', '--init', '--recursive', '--depth', '1']);
  run('bash', ['build.sh', '--config', 'Release', '--build_shared_lib', '--parallel', '3',
    '--skip_tests', '--skip_submodule_sync', '--compile_no_warning_as_error',
    '--cmake_extra_defines', 'CMAKE_OSX_ARCHITECTURES=x86_64', 'CMAKE_OSX_DEPLOYMENT_TARGET=13.3',
    'onnxruntime_BUILD_UNIT_TESTS=OFF']);
  const directory = path.join(source, 'build/MacOS/Release');
  const library = path.join(directory, LIBRARY);
  if (!fs.statSync(library).isFile()) throw new Error('Missing built ONNX Runtime');
  // Set the install name before Rust links; no build-machine absolute path survives.
  run('install_name_tool', ['-id', `@executable_path/../Frameworks/${LIBRARY}`, library]);
  run('lipo', [library, '-verify_arch', 'x86_64']);
  for (const name of ['LICENSE', 'ThirdPartyNotices.txt']) fs.copyFileSync(path.join(source, name), path.join(directory, name));
  fs.appendFileSync(process.env.GITHUB_ENV,
    `ORT_LIB_LOCATION=${directory}\nORT_PREFER_DYNAMIC_LINK=1\nNEUINK_MACOS_INTEL_RUNTIME=${directory}\nMACOSX_DEPLOYMENT_TARGET=13.3\n`);
}
module.exports = { bundleConfig, REVISION, LIBRARY };
if (require.main === module) {
  try { prepare(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
