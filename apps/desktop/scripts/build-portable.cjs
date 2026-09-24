const { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } = require('node:fs');
const { execFileSync, spawn } = require('node:child_process');
const path = require('node:path');

if (process.platform !== 'win32') {
  throw new Error('release:portable 目前仅支持 Windows，因为压缩步骤使用 PowerShell Compress-Archive。');
}

const desktopRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(desktopRoot, '..', '..');
const releaseRoot = path.join(projectRoot, 'release');
const modelSource = path.join(
  desktopRoot,
  'src-tauri',
  'resources',
  'embedding-models',
  'default',
);
const envExampleSource = path.join(projectRoot, '.env.example');
const skipBuild = process.argv.includes('--skip-build');
const powershell = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell.exe';

void main().catch((caught) => {
  console.error('\n便携版构建失败：');
  console.error(caught instanceof Error ? caught.message : String(caught));
  process.exitCode = 1;
});

async function main() {
  const runtimeSource = findVcRuntimeDir();
  if (!skipBuild) {
    console.log('步骤 1/3：构建 Tauri release exe…');
    await run(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', 'npm run tauri -- build --no-bundle'],
      desktopRoot,
    );
  } else {
    console.log('步骤 1/3：跳过 exe 构建，使用已有 release 产物。');
  }

  const executableSource = firstExistingPath([
    path.join(projectRoot, 'target', 'release', 'neuink-desktop.exe'),
    path.join(desktopRoot, 'src-tauri', 'target', 'release', 'neuink-desktop.exe'),
  ]);
  assertFile(executableSource, '未找到编译后的 neuink-desktop.exe');
  assertFile(envExampleSource, '未找到根目录 .env.example');
  assertFile(path.join(modelSource, 'onnx', 'model.onnx'), '未找到 embedding 的 ONNX 模型');
  assertFile(path.join(modelSource, 'tokenizer.json'), '未找到 embedding 的 tokenizer.json');

  const timestamp = formatTimestamp(new Date());
  const folderName = `Neuink-portable-${timestamp}`;
  const portableRoot = path.join(releaseRoot, folderName);
  const zipPath = path.join(releaseRoot, `${folderName}.zip`);

  console.log('步骤 2/3：组装 exe、配置模板和 embedding 模型…');
  mkdirSync(releaseRoot, { recursive: true });
  if (path.dirname(portableRoot) !== path.resolve(releaseRoot) || existsSync(portableRoot) || existsSync(zipPath)) {
    throw new Error('发行目录不安全或已存在，请稍后重试；已有压缩包不会被覆盖。');
  }
  mkdirSync(path.join(portableRoot, 'embedding-models'), { recursive: true });

  await copyPortableResources(executableSource, portableRoot, runtimeSource);
  writeFileSync(path.join(portableRoot, '使用说明.txt'), '\ufeff' + [
    'Neuink Windows x64 便携版', '',
    '1. 完整解压此压缩包到一个可写目录。',
    '2. 双击 Neuink.exe 启动，无需安装 Node.js、Rust 或启动开发服务。',
    '3. 请保留同目录的 embedding-models 文件夹，用于本地语义搜索。', '',
    '适用于 Windows 10 1903 或更新版本、Windows 11（64 位）。已附带 Visual C++ 运行库。',
    '系统需要 Microsoft Edge WebView2 Runtime；若提示缺失，请从微软官方网站安装后再运行。',
    '资料库和设置沿用应用默认位置，可在“设置 → 资料库与数据”中更改资料库位置。',
    '此包不包含个人资料库、模型密钥或聊天记录；在同一台电脑启动时会沿用已有设置。',
    '首次使用时，可在设置中配置翻译模型和 MinerU 解析服务；这两项服务不包含在压缩包中。',
    '本地 PDF 阅读无需配置模型。',
  ].join('\r\n'), 'utf8');

  assertFile(path.join(portableRoot, 'Neuink.exe'), '便携版 exe 复制失败');
  assertFile(path.join(portableRoot, '.env.example'), '便携版配置模板复制失败');
  assertFile(path.join(portableRoot, 'msvcp140.dll'), 'Visual C++ 运行库复制失败');
  assertFile(path.join(portableRoot, 'msvcp140_1.dll'), 'Visual C++ 运行库复制失败');
  assertFile(
    path.join(portableRoot, 'embedding-models', 'default', 'onnx', 'model.onnx'),
    '便携版模型复制失败',
  );

  console.log('步骤 3/3：压缩 ZIP…');
  await run(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -LiteralPath ${powershellLiteral(portableRoot)} -DestinationPath ${powershellLiteral(zipPath)} -CompressionLevel Optimal -Force`,
    ],
    projectRoot,
  );

  assertFile(zipPath, 'ZIP 压缩失败');
  console.log(`\n便携版已生成：${zipPath}`);
  console.log(`压缩包大小：${formatBytes(statSync(zipPath).size)}`);
  console.log('提示：压缩包只包含 .env.example，不包含本机密钥。');
}

function copyPortableResources(executableSource, portableRoot, runtimeSource) {
  const executableDestination = path.join(portableRoot, 'Neuink.exe');
  const envExampleDestination = path.join(portableRoot, '.env.example');
  const modelDestination = path.join(portableRoot, 'embedding-models', 'default');
  return run(
    powershell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        "$ErrorActionPreference = 'Stop'",
        `Copy-Item -LiteralPath ${powershellLiteral(executableSource)} -Destination ${powershellLiteral(executableDestination)} -Force`,
        `Copy-Item -LiteralPath ${powershellLiteral(envExampleSource)} -Destination ${powershellLiteral(envExampleDestination)} -Force`,
        `Get-ChildItem -LiteralPath ${powershellLiteral(runtimeSource)} -Filter '*.dll' -File | Copy-Item -Destination ${powershellLiteral(portableRoot)} -Force`,
        `New-Item -ItemType Directory -Path ${powershellLiteral(modelDestination)} -Force | Out-Null`,
        `Get-ChildItem -LiteralPath ${powershellLiteral(modelSource)} -Force | Where-Object { $_.Name -ne '.cache' } | Copy-Item -Destination ${powershellLiteral(modelDestination)} -Recurse -Force`,
      ].join('; '),
    ],
    projectRoot,
  );
}

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
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(`${message}：${filePath ?? ''}`);
  }
}

function firstExistingPath(paths) {
  return paths.find((candidate) => existsSync(candidate)) ?? null;
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = signal
        ? `被信号 ${signal} 中止`
        : `退出码 ${formatExitCode(code)}`;
      reject(new Error(`${path.basename(command)} ${detail}`));
    });
  });
}

function formatExitCode(code) {
  if (typeof code !== 'number') {
    return 'unknown';
  }
  const unsigned = code >>> 0;
  return unsigned > 255 ? `${unsigned} (0x${unsigned.toString(16).toUpperCase()})` : String(unsigned);
}

function powershellLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function formatTimestamp(value) {
  const pad = (part) => String(part).padStart(2, '0');
  return [
    value.getFullYear(),
    pad(value.getMonth() + 1),
    pad(value.getDate()),
  ].join('') + `-${pad(value.getHours())}${pad(value.getMinutes())}${pad(value.getSeconds())}`;
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
