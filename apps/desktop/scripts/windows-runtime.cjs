const { existsSync, readdirSync, statSync } = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function findVcRuntimeDir() {
  if (process.env.NEUINK_VC_RUNTIME_DIR) {
    assertFile(path.join(process.env.NEUINK_VC_RUNTIME_DIR, 'msvcp140.dll'), '指定目录缺少 x64 Visual C++ 运行库');
    return process.env.NEUINK_VC_RUNTIME_DIR;
  }
  const vswhere = path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  assertFile(vswhere, '无法定位 Visual Studio；可用 NEUINK_VC_RUNTIME_DIR 指定 x64 CRT 分发目录');
  const installation = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8', windowsHide: true }).trim();
  const redistRoot = path.join(installation, 'VC', 'Redist', 'MSVC');
  const versions = readdirSync(redistRoot).filter(name => /^\d/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const version of versions) {
    const x64 = path.join(redistRoot, version, 'x64');
    if (!existsSync(x64)) continue;
    for (const name of readdirSync(x64).filter(name => /^Microsoft\.VC\d+\.CRT$/.test(name))) {
      const candidate = path.join(x64, name);
      if (existsSync(path.join(candidate, 'msvcp140.dll'))) return candidate;
    }
  }
  throw new Error('未找到 x64 Visual C++ 可分发运行库，请设置 NEUINK_VC_RUNTIME_DIR。');
}

function assertFile(filePath, message) {
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) throw new Error(message);
}
module.exports = { findVcRuntimeDir };
