const { existsSync, mkdirSync, rmSync, statSync } = require('node:fs');
const { spawn } = require('node:child_process');
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
  rmSync(portableRoot, { force: true, recursive: true });
  rmSync(zipPath, { force: true });
  mkdirSync(path.join(portableRoot, 'embedding-models'), { recursive: true });

  await copyPortableResources(executableSource, portableRoot);

  assertFile(path.join(portableRoot, 'Neuink.exe'), '便携版 exe 复制失败');
  assertFile(path.join(portableRoot, '.env.example'), '便携版配置模板复制失败');
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

function copyPortableResources(executableSource, portableRoot) {
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
        `Copy-Item -LiteralPath ${powershellLiteral(modelSource)} -Destination ${powershellLiteral(modelDestination)} -Recurse -Force`,
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
