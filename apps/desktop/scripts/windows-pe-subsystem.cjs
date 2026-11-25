const { closeSync, openSync, readSync } = require('node:fs');

function readWindowsSubsystem(executable) {
  const fd = openSync(executable, 'r');
  try {
    const dos = Buffer.alloc(64);
    if (readSync(fd, dos, 0, dos.length, 0) !== dos.length || dos.toString('ascii', 0, 2) !== 'MZ') {
      throw new Error('不是有效的 Windows EXE');
    }
    const peOffset = dos.readUInt32LE(0x3c);
    const header = Buffer.alloc(94);
    if (readSync(fd, header, 0, header.length, peOffset) !== header.length || header.toString('ascii', 0, 4) !== 'PE\0\0') {
      throw new Error('Windows EXE 缺少 PE 标头');
    }
    const magic = header.readUInt16LE(24);
    if (magic !== 0x10b && magic !== 0x20b) throw new Error('Windows EXE 的格式不受支持');
    return header.readUInt16LE(92);
  } finally {
    closeSync(fd);
  }
}

function assertGuiExecutable(executable) {
  if (readWindowsSubsystem(executable) !== 2) {
    throw new Error(`便携版必须使用无终端的 Windows GUI 程序：${executable}`);
  }
}

module.exports = { assertGuiExecutable, readWindowsSubsystem };
