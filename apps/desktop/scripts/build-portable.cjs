const { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } = require('node:fs');
const { copyOptionalResources, assertEmbeddingResources, writeAvailabilityManifest } = require('./onboarding-resources.cjs');
const { DEFAULT_SOURCE: browserReaderSource, verifyResources: verifyBrowserReader,
  copyResources: copyBrowserReader } = require('./browser-reader-resources.cjs');
const { DEFAULT_SOURCE: readerLicenseSource, verifyResources: verifyReaderLicenses,
  copyResources: copyReaderLicenses } = require('./reader-licenses.cjs');
const { execFileSync, spawn } = require('node:child_process');
const researchComponent = require('./research-component.cjs');
const { findVcRuntimeDir } = require('./windows-runtime.cjs');
const { assertGuiExecutable } = require('./windows-pe-subsystem.cjs');
const path = require('node:path');
const { preparePortableLayout } = require('./portable-layout.cjs');

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
const onboardingSource = path.join(desktopRoot, 'src-tauri', 'resources', 'onboarding');
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
  assertEmbeddingResources(modelSource);
  verifyBrowserReader(browserReaderSource);
  verifyReaderLicenses(readerLicenseSource);
  researchComponent.verifyResources();
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
  assertGuiExecutable(executableSource);
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
  mkdirSync(path.join(portableRoot, 'resources'), { recursive: true });
  copyFileSync(path.join(desktopRoot, 'src-tauri/resources/unrar-license.txt'), path.join(portableRoot, 'resources/unrar-license.txt'));
  copyBrowserReader(browserReaderSource, path.join(portableRoot, 'resources', 'browser-reader'));
  copyReaderLicenses(readerLicenseSource, path.join(portableRoot, 'resources', 'reader-licenses'));
  researchComponent.copyResources(researchComponent.DEFAULT_SOURCE, path.join(portableRoot, 'resources', 'research-component'));
  const includesOnboarding = copyOptionalResources(onboardingSource, path.join(portableRoot, 'resources', 'onboarding'));
  writeAvailabilityManifest(includesOnboarding, path.join(portableRoot, 'resources', 'onboarding-availability.json'));
  preparePortableLayout(portableRoot);
  writeFileSync(path.join(portableRoot, '使用说明.txt'), '\ufeff' + [
    'Neuink Windows x64 便携版', '',
    '1. 完整解压此压缩包到一个可写目录。',
    '2. 双击 Neuink.exe 启动，无需安装 Node.js、Rust 或启动开发服务。',
    '3. 请保留同目录的 embedding-models 文件夹，用于本地语义搜索。', '',
    '4. 请保留 resources/browser-reader 文件夹及其许可证；视频字幕读取已内置所需运行环境，无需安装 Python。', '',
    '5. 请保留 resources/reader-licenses 文件夹及 resources/unrar-license.txt，其中包含读取组件和 RAR 解压组件的原始许可证。', '',
    '6. 深度研究组件已包含在 resources/research-component 中。首次在助手中打开“深度研究”，点击“安装并启用”；不需要预装 Python。', '',
    includesOnboarding
      ? '已包含离线演示素材。请保留 resources/onboarding 文件夹；新手教程的演示 PDF、解析结果与笔记无需联网即可准备。'
      : '本包未包含演示素材（构建时缺失或校验未通过）；不影响主程序、本地 PDF 阅读及 embedding 语义搜索。',
    '适用于 Windows 10 1903 或更新版本、Windows 11（64 位）。已附带 Visual C++ 运行库。',
    '系统需要 Microsoft Edge WebView2 Runtime；若提示缺失，请从微软官方网站安装后再运行。',
    '资料库、设置和阅读界面状态默认保存在本包 data 文件夹；请连同程序一起复制到 U 盘。',
    '数据固定保存在程序文件夹内，无需选择路径。启动时检查程序目录旁及所在磁盘根目录的 neuink_data，自动补入旧资料，冲突保留当前内容。',
    '保留 neuink.portable.json 便携标记。换电脑或换盘符会自动定位包内资料；不会沿用另一台电脑的资料库设置。',
    '旧资料合并校验完成后，旧目录放入系统回收站；回收站不可用或整理失败时保留原目录，不会永久删除。',
    '本公开包的 data 为空；使用后其中可能包含个人论文、聊天和模型密钥，请勿将个人 data 公开分享。',
    '更新前关闭程序并备份 data，新版程序文件与已有 data 放在一起；不要用新包的空 data 覆盖旧数据。',
    '正常关闭 Neuink 后再安全弹出移动盘。Claude Code 等工具与登录仍需在每台电脑上配置。',
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
