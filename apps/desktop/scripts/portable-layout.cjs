const fs = require('node:fs');
const path = require('node:path');

function preparePortableLayout(root) {
  // A release is assembled into a fresh directory; never copy the builder's user profile.
  const data = path.join(root, 'data');
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(root, 'neuink.portable.json'), JSON.stringify({ version: 1 }) + '\n', { flag: 'wx' });
  fs.writeFileSync(path.join(data, '说明.txt'), '\ufeff' + [
    '此目录随 Neuink 一起移动。首次启动会建立 library 资料库、settings.json 设置和 webview 界面偏好。',
    '无需配置路径。所有数据固定放在程序文件夹内的 data 中。',
    '每次启动自动检查程序文件夹旁及所在磁盘根目录的 neuink_data：补入旧资料，冲突保留当前数据。',
    '合并并校验成功后，旧目录放入系统回收站；不能回收或复制失败时保留原目录，不会永久删除。',
    '升级程序时保留整个 data 目录；不要用新包的空 data 覆盖已有数据。',
    '退出 Neuink 后再安全弹出 U 盘。备份时复制整个 data 目录。',
    '模型配置中填写的 API Key 可能随 settings.json 保存；个人 data 不用于公开发布。',
    'Claude Code 等本机工具及其登录、系统凭据仍需在每台电脑各自配置。', ''
  ].join('\r\n'), { flag: 'wx' });
}

module.exports = { preparePortableLayout };
