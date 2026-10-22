const { existsSync, openSync, closeSync, writeSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const logFile = process.env.NEUINK_DEV_LOG_FILE;
const log = logFile ? openSync(logFile, 'a') : null;
const report = message => log === null ? console.log(message) : writeSync(log, `${message}\n`, null, 'utf8');
const dataDirectory = path.resolve(process.env.NEUINK_DEV_DATA_DIR || 'D:\\NeuInk\\data');
try {
if (!existsSync(path.join(dataDirectory, 'library'))) {
  report(`开发数据目录缺少 library：${dataDirectory}`);
  process.exitCode = 1;
} else if (process.argv.includes('--check')) {
  report(`开发版将读取：${dataDirectory}`);
} else {
  report(`开发版使用资料目录：${dataDirectory}`);
  const result = spawnSync(process.execPath, [path.join(__dirname, 'tauri.cjs'), 'dev'], {
    stdio: log === null ? 'inherit' : ['ignore', log, log],
    env: { ...process.env, NEUINK_DEV_DATA_DIR: dataDirectory },
  });
  if (result.error) report(result.error.message);
  process.exitCode = result.status ?? 1;
}
} finally {
  if (log !== null) closeSync(log);
}
